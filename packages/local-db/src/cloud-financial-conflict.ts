import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ResolveInboundSyncConflictRequest } from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { outboundCloudSnapshot, reviewToken } from './outbound-conflict-review'

export function readCloudFinancialConflict(db: DatabaseSync, context: StoreContext, operationId: string) {
  const command = db.prepare(`SELECT command.* FROM cloud_financial_command command
    JOIN outbox_operation operation ON json_extract(operation.payload_json, '$.atomicGroup.id') = command.group_id
    WHERE operation.operation_id = ? AND command.device_id = ? AND command.tenant_id = ? AND command.store_id = ?
      AND command.resolution_json IS NULL`).get(operationId,context.deviceId,context.tenantId,context.storeId)
  if (!command) return null
  const rows = db.prepare(`SELECT o.*, c.conflict_type, c.server_payload_json, c.status conflict_status FROM outbox_operation o
    LEFT JOIN sync_conflict c ON c.operation_id=o.operation_id
    WHERE o.device_id=? AND json_extract(o.payload_json, '$.atomicGroup.id')=? ORDER BY o.device_seq`)
    .all(context.deviceId,command.group_id!)
  if (!rows.length || rows.length !== JSON.parse(String(rows[0]!.payload_json)).atomicGroup.size ||
      rows.some(row=>row.sync_status!=='conflict' || row.conflict_status!=='pending' || row.conflict_type!=='atomic_group_rejected')) return null
  const canKeepLocal=rows.every(row=>{try {return JSON.parse(String(row.server_payload_json)).serverPayload?.detail?.retryAllowed!==false} catch{return true}})
  const localSnapshot: Record<string,unknown> = {}
  const cloudSnapshot: Record<string,unknown> = {}
  rows.forEach((row,index)=>{
    const type=String(row.operation_type).split('.')[0]!
    const names: Record<string,string> = { 'wallet.cash_recharged':'现金充值','wallet.debited':'储值扣款',
      'wallet.order_refund_credited':'订单退款到账','wallet.cash_recharge_reversed':'充值退回',
      'monthly_card.purchased':'月卡购买','monthly_card.used':'月卡使用','monthly_card.paused':'月卡暂停',
      'monthly_card.resumed':'月卡恢复','monthly_card.refunded':'月卡退款','monthly_card.manual_extended':'月卡延期',
      'order.completed':'收银订单','refund.requested':'退款申请','refund.completed':'退款完成',
      'financial_refund.requested':'资金退款申请','financial_refund.completed':'资金退款完成' }
    const key=`${index+1} ${names[String(row.operation_type)] ?? '业务记录'}`
    const payload=JSON.parse(String(row.payload_json))
    localSnapshot[key]=payload.after ?? payload
    const cloud=outboundCloudSnapshot(db,context,type,String(row.aggregate_id))
    cloudSnapshot[key]=type==='wallet' && cloud ? {wallet:cloud} : cloud ?? {status:'not_executed'}
  })
  return {command,rows,canKeepLocal,localSnapshot,cloudSnapshot,reviewToken:reviewToken(localSnapshot,cloudSnapshot)}
}

/** Only rejected, never-applied cloud commands can be canceled/reissued here.
 * Existing financial ledgers are never overwritten or deleted. */
export function resolveCloudFinancialConflict(db: DatabaseSync, context: StoreContext & {actor:EmployeeRecord},
  request: ResolveInboundSyncConflictRequest,
  retry: (channel:string, request:Record<string,unknown>)=>void): void {
  if (context.actor.role!=='manager') throw new Error('只有店长可以处理资金差异')
  if (!['keep_local','apply_cloud'].includes(request.resolution) || request.reason.trim().length<2 || request.reason.trim().length>200) throw new Error('请填写处理方式和原因')
  const review=readCloudFinancialConflict(db,context,request.sequence.slice('outbound:'.length))
  if (!review || !request.reviewToken || request.reviewToken!==review.reviewToken) throw new Error('业务状态或云端资料已变化，请重新核对差异')
  if(request.resolution==='keep_local' && !review.canKeepLocal) throw new Error('原移动端业务已处理或已由其他设备领取，请采用云端结果，不能重复收款')
  const now=new Date().toISOString()
  const resolution=JSON.stringify({source:'manager_review',choice:request.resolution,reason:request.reason,actorId:context.actor.id})
  db.exec('SAVEPOINT financial_review')
  try {
    for (const row of review.rows) {
      db.prepare("UPDATE outbox_operation SET sync_status='confirmed' WHERE operation_id=?").run(row.operation_id!)
      db.prepare("UPDATE sync_conflict SET status='resolved',resolved_by=?,resolved_at=?,resolution_json=? WHERE operation_id=?")
        .run(context.actor.id,now,resolution,row.operation_id!)
    }
    db.prepare('UPDATE cloud_financial_command SET resolution_json=? WHERE id=?').run(resolution,review.command.id!)
    if (request.resolution==='keep_local') {
      const original=JSON.parse(String(review.command.request_json))
      retry(String(review.command.channel),{...original,requestId:randomUUID()})
    }
    // Synchronize the review itself so cloud audit queues close as well.
    const operationId=randomUUID(), groupId=randomUUID()
    const payload=JSON.stringify({action:'financial_command.reviewed',cloudCommand:true,
      reviewedGroupId:String(review.command.group_id),choice:request.resolution,reason:request.reason,
      atomicGroup:{id:groupId,size:1,index:0}})
    const sequence=db.prepare('SELECT next_sequence FROM device WHERE id=?').get(context.deviceId)!
    db.prepare('UPDATE device SET next_sequence=next_sequence+1 WHERE id=?').run(context.deviceId)
    db.prepare(`INSERT INTO outbox_operation
      (operation_id,device_id,device_seq,tenant_id,store_id,actor_id,operation_type,aggregate_id,base_version,occurred_at,payload_json,payload_hash)
      VALUES (?,?,?,?,?,?,'financial_command.reviewed',?,NULL,?,?,?)`)
      .run(operationId,context.deviceId,sequence.next_sequence!,context.tenantId,context.storeId,context.actor.id,
        String(review.command.group_id),now,payload,createHash('sha256').update(payload).digest('hex'))
    db.prepare(`INSERT INTO audit_log
      (id,tenant_id,store_id,device_id,actor_id,action,aggregate_type,aggregate_id,reason,before_json,after_json,occurred_at)
      VALUES (?,?,?,?,?,'sync.financial_command.resolved','financial_command',?,?,?,?,?)`)
      .run(randomUUID(),context.tenantId,context.storeId,context.deviceId,context.actor.id,String(review.command.id),request.reason,
        JSON.stringify(review.localSnapshot),JSON.stringify({choice:request.resolution,cloud:review.cloudSnapshot}),now)
    db.exec('RELEASE SAVEPOINT financial_review')
  } catch(error) {
    try { db.exec('ROLLBACK TO SAVEPOINT financial_review'); db.exec('RELEASE SAVEPOINT financial_review') } catch { /* Domain failure rolled back the enclosing transaction. */ }
    throw error
  }
}
