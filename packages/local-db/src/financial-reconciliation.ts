import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ResolveInboundSyncConflictRequest } from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { beginFinancialTransaction, commitFinancialTransaction } from './financial-transaction'
import { outboundCloudSnapshot, reviewToken } from './outbound-conflict-review'
import { applyCloudMirrorPage } from './cloud-mirror-materialization'

export function queueFinancialReconciliation(db: DatabaseSync, context: StoreContext & {actor:EmployeeRecord}, request: ResolveInboundSyncConflictRequest): void {
  if(context.actor.role!=='manager') throw new Error('只有店长可以更正资金记录')
  const reason=request.reason.trim()
  if(reason.length<2 || reason.length>200 || !['keep_local','apply_cloud'].includes(request.resolution)) throw new Error('请填写更正方式和原因')
  const sourceId=request.sequence.slice('outbound:'.length)
  const source=db.prepare(`SELECT o.* FROM outbox_operation o JOIN sync_conflict c ON c.operation_id=o.operation_id
    WHERE o.operation_id=? AND o.tenant_id=? AND o.store_id=? AND o.device_id=? AND c.status='pending'`)
    .get(sourceId,context.tenantId,context.storeId,context.deviceId)
  if(!source) throw new Error('该异常已处理，请刷新')
  const type=String(source.operation_type).split('.')[0]!
  if(!['wallet','monthly_card'].includes(type)) throw new Error('此资料不支持资金更正')
  const local=JSON.parse(String(source.payload_json)).after as Record<string,unknown>
  const cloud=outboundCloudSnapshot(db,context,type,String(source.aggregate_id))
  const comparison=type==='wallet' && cloud?{wallet:cloud}:cloud
  if(!cloud || !request.reviewToken || request.reviewToken!==reviewToken(local,comparison)) throw new Error('云端资料已变化，请重新核对')
  const before=Object.fromEntries(Object.entries(cloud).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),value]))
  const chosen=request.resolution==='keep_local' ? type==='wallet'?local.wallet as Record<string,unknown>:local : before
  const now=new Date().toISOString(), correctionId=randomUUID()
  const start=beginFinancialTransaction(db)
  try {
    db.prepare("UPDATE outbox_operation SET sync_status='confirmed' WHERE operation_id=?").run(sourceId)
    db.prepare("UPDATE sync_conflict SET status='resolved',resolved_by=?,resolved_at=?,resolution_json=? WHERE operation_id=?")
      .run(context.actor.id,now,JSON.stringify({source:'manager_review',choice:request.resolution,reason,correctionId}),sourceId)
    // A rejected legacy local ledger never reached the cloud. Neutralize its
    // local effect with an append-only adjustment before restoring the mirror.
    if(type==='wallet') {
      const ledger=db.prepare('SELECT * FROM wallet_ledger WHERE tenant_id=? AND source_id=?').get(context.tenantId,String(local.operationId))
      if(ledger) db.prepare(`INSERT INTO wallet_ledger
        (id,tenant_id,store_id,wallet_account_id,member_id,entry_type,principal_delta_fen,gift_delta_fen,
         principal_balance_after_fen,gift_balance_after_fen,source_id,related_ledger_id,request_id,actor_id,device_id,reason,metadata_json,occurred_at)
        VALUES (?,?,?,?,?,'manual_adjustment',?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(randomUUID(),context.tenantId,context.storeId,ledger.wallet_account_id!,ledger.member_id!,
          -Number(ledger.principal_delta_fen),-Number(ledger.gift_delta_fen),Number(before.principalBalanceFen),Number(before.giftBalanceFen),
          `local-compensation:${correctionId}`,ledger.id!,`reconcile:${sourceId}`,context.actor.id,context.deviceId,reason,JSON.stringify({rejectedOperationId:sourceId}),now)
    }
    applyCloudMirrorPage(db,context,{resource:type==='wallet'?'wallet_accounts':'monthly_cards',rows:[{id:String(cloud.id),payload:cloud}],eventCursor:String(cloud.server_version??0),nextCursor:null,serverTime:now},true)
    const after=type==='wallet'?{
      operationId:correctionId,
      wallet:{...chosen,accountId:cloud.id,memberId:before.memberId,updatedAt:now,totalBalanceFen:Number(chosen.principalBalanceFen)+Number(chosen.giftBalanceFen)},
      principalDeltaFen:Number(chosen.principalBalanceFen)-Number(before.principalBalanceFen),giftDeltaFen:Number(chosen.giftBalanceFen)-Number(before.giftBalanceFen)
    }:{...before,issuingStoreId:before.storeId,status:chosen.status,usageCount:chosen.usageCount,expiresAt:chosen.expiresAt,pausedAt:chosen.pausedAt,updatedAt:now}
    const payload=JSON.stringify({action:`${type}.reconciled`,cloudCommand:true,rejectedOperationId:sourceId,before,after,reason})
    const seq=db.prepare('SELECT next_sequence FROM device WHERE id=?').get(context.deviceId) as {next_sequence:number}
    db.prepare('UPDATE device SET next_sequence=next_sequence+1 WHERE id=?').run(context.deviceId)
    db.prepare(`INSERT INTO outbox_operation (operation_id,device_id,device_seq,tenant_id,store_id,actor_id,operation_type,aggregate_id,base_version,occurred_at,payload_json,payload_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(correctionId,context.deviceId,seq.next_sequence,context.tenantId,context.storeId,context.actor.id,`${type}.reconciled`,String(cloud.id),Number(cloud.server_version??0),now,payload,createHash('sha256').update(payload).digest('hex'))
    db.prepare(`INSERT INTO audit_log (id,tenant_id,store_id,device_id,actor_id,action,aggregate_type,aggregate_id,reason,before_json,after_json,occurred_at)
      VALUES (?,?,?,?,?,'sync.financial_reconciliation.requested',?,?,?,?,?,?)`)
      .run(randomUUID(),context.tenantId,context.storeId,context.deviceId,context.actor.id,type,String(cloud.id),reason,JSON.stringify(local),JSON.stringify(after),now)
    commitFinancialTransaction(db,start)
  } catch(error) {db.exec('ROLLBACK');throw error}
}
