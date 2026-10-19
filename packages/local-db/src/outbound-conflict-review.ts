import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudMirrorResource, ResolveInboundSyncConflictRequest } from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { applyCloudMirrorPage } from './cloud-mirror-materialization'

const resources: Record<string, CloudMirrorResource> = {
  member: 'members', catalog: 'catalog', activity: 'activities', announcement: 'announcements', board_game: 'board_games', store: 'store',
  wallet: 'wallet_accounts', monthly_card: 'monthly_cards', sales_order: 'orders', order: 'orders'
}
export function supportsContentResolution(type: string): boolean {
  return ['member', 'catalog', 'activity', 'announcement', 'board_game', 'store'].includes(type)
}
export function outboundCloudSnapshot(db: DatabaseSync, context: StoreContext, type: string, id: string) {
  const resource = resources[type]
  if (!resource) return null
  let row = db.prepare(`SELECT payload_json FROM cloud_read_model_cache WHERE tenant_id = ? AND store_id = ? AND resource = ? AND row_id = ?`)
    .get(context.tenantId, context.storeId, resource, id) as { payload_json: string } | undefined
  if (!row && type === 'wallet') {
    // An older offline wallet can have a different account ID for the same member.
    const account = db.prepare('SELECT member_id FROM wallet_account WHERE tenant_id=? AND id=?').get(context.tenantId,id)
    if (account) row = db.prepare(`SELECT payload_json FROM cloud_read_model_cache WHERE tenant_id=? AND store_id=?
      AND resource='wallet_accounts' AND json_extract(payload_json,'$.member_id')=? LIMIT 1`)
      .get(context.tenantId,context.storeId,account.member_id!) as {payload_json:string}|undefined
  }
  return row ? JSON.parse(row.payload_json) as Record<string, unknown> : null
}
export function reviewToken(local: unknown, cloud: unknown): string {
  return createHash('sha256').update(JSON.stringify([local, cloud])).digest('hex')
}
export function resolveOutboundConflict(db: DatabaseSync, context: StoreContext & { actor: EmployeeRecord }, request: ResolveInboundSyncConflictRequest): void {
  if (context.actor.role !== 'manager') throw new Error('只有店长可以合并资料')
  const operationId = request.sequence.slice('outbound:'.length)
  const reason = request.reason.trim()
  if (reason.length < 2 || reason.length > 200 || !['keep_local','apply_cloud'].includes(request.resolution)) throw new Error('请填写有效的处理方式和原因')
  const row = db.prepare(`SELECT o.*, c.local_payload_json FROM outbox_operation o JOIN sync_conflict c ON c.operation_id=o.operation_id
    WHERE o.operation_id=? AND o.tenant_id=? AND o.store_id=? AND o.device_id=? AND c.status='pending'`)
    .get(operationId, context.tenantId, context.storeId, context.deviceId) as Record<string, unknown> | undefined
  if (!row) throw new Error('该冲突已处理，请刷新')
  const type = String(row.operation_type).split('.')[0]!
  const resource = resources[type]
  if (!resource || !supportsContentResolution(type)) throw new Error('资金或权限记录需要专门的更正流程，不能覆盖')
  const cloud = outboundCloudSnapshot(db, context, type, String(row.aggregate_id))
  if (!cloud) throw new Error('云端完整资料尚未下载，请先同步')
  const payload = JSON.parse(String(row.local_payload_json)) as Record<string, unknown>
  const local = payload.after as Record<string, unknown>
  if (!request.reviewToken || request.reviewToken !== reviewToken(local, cloud)) throw new Error('资料已变化，请刷新差异并重新选择')
  const newer = db.prepare(`SELECT 1 FROM outbox_operation WHERE tenant_id=? AND aggregate_id=? AND operation_id<>?
    AND sync_status<>'confirmed' LIMIT 1`).get(context.tenantId, String(row.aggregate_id), operationId)
  if (newer) throw new Error('同一资料还有其他待处理修改，请先核对全部修改')
  const now = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`UPDATE outbox_operation SET sync_status='confirmed' WHERE operation_id=?`).run(operationId)
    db.prepare(`UPDATE sync_conflict SET status='resolved', resolved_by=?, resolved_at=?, resolution_json=? WHERE operation_id=?`)
      .run(context.actor.id, now, JSON.stringify({ source:'manager_review', choice:request.resolution, reason }), operationId)
    if (request.resolution === 'apply_cloud') {
      applyCloudMirrorPage(db, context, { resource, rows:[{id:String(row.aggregate_id),payload:cloud}],
        eventCursor:String(cloud.server_version ?? '0'), nextCursor:null, serverTime:now }, true)
    } else {
      // Re-submit the explicitly chosen version as a new operation. Retain the
      // rejected operation and its resolution for audit and idempotent receipts.
      const after = { ...local, updatedAt:now }
      const cloudCanonical = Object.fromEntries(Object.entries(cloud).map(([key,value]) => [key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),value]))
      const json = JSON.stringify({ ...payload, before:cloudCanonical, after, reason })
      const seq = db.prepare('SELECT next_sequence FROM device WHERE id=?').get(context.deviceId) as {next_sequence:number}
      db.prepare('UPDATE device SET next_sequence=next_sequence+1 WHERE id=?').run(context.deviceId)
      db.prepare(`INSERT INTO outbox_operation (operation_id,device_id,device_seq,tenant_id,store_id,actor_id,operation_type,aggregate_id,base_version,occurred_at,payload_json,payload_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),context.deviceId,seq.next_sequence,context.tenantId,context.storeId,context.actor.id,
          String(row.operation_type),String(row.aggregate_id),Number(cloud.server_version ?? 0),now,json,createHash('sha256').update(json).digest('hex'))
    }
    db.prepare(`INSERT INTO audit_log (id,tenant_id,store_id,device_id,actor_id,action,aggregate_type,aggregate_id,reason,before_json,after_json,occurred_at)
      VALUES (?,?,?,?,?,'sync.conflict.resolved',?,?,?,?,?,?)`).run(randomUUID(),context.tenantId,context.storeId,context.deviceId,context.actor.id,type,String(row.aggregate_id),reason,JSON.stringify(local),JSON.stringify(request.resolution==='apply_cloud'?cloud:local),now)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
