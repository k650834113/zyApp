import { getWalletDetails } from './wallet'
import { getMonthlyCardDetails } from './monthly-card'
import { prepareWalletAccountingPreview } from './wallet-accounting-preview'
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { EmployeeRecord, StoreContext } from './identity'
import { financialPreviewDatabases } from './financial-transaction'

type Context = StoreContext & { actor: EmployeeRecord }
/** Preview domain changes synchronously, persist only commands, and let cloud
 * receipts and mirrors create the authoritative business records. */
export function prepareCloudFinancialCommand<T extends { requestId?: string }>(db: DatabaseSync, context: Context,
  channel: string, request: T, execute: () => unknown): unknown {
  if (!request.requestId) throw new Error('云端业务必须提供请求编号')
  const key = `${channel}:${request.requestId}`
  const json = JSON.stringify(request)
  const hash = createHash('sha256').update(json).digest('hex')
  const previous = db.prepare('SELECT * FROM cloud_financial_command WHERE device_id = ? AND command_key = ?').get(context.deviceId, key)
  if (previous) {
    if (previous.request_hash !== hash || previous.actor_id !== context.actor.id) throw new Error('请求编号已使用，不能更换业务内容或操作人')
    if (previous.resolution_json) throw new Error('原业务已在差异核对中处理，请查看处理记录，不要再次提交原请求')
    return JSON.parse(String(previous.result_json))
  }
  const start = Number((db.prepare('SELECT COALESCE(MAX(rowid), 0) n FROM outbox_operation').get() as {n:number}).n)
  let outbox: Record<string, SQLInputValue>[] = []
  let result: unknown
  db.exec('SAVEPOINT cloud_preview')
  financialPreviewDatabases.add(db)
  try {
    const input = request as Record<string, unknown>
    const memberId = input.memberId ?? input.walletMemberId
    prepareWalletAccountingPreview(db, context.tenantId, typeof memberId === 'string' ? memberId : undefined)
    result = execute()
    if (result instanceof Promise) throw new Error('Cloud command preparation must be synchronous')
    outbox = db.prepare('SELECT * FROM outbox_operation WHERE rowid > ? ORDER BY rowid').all(start) as Record<string, SQLInputValue>[]
    db.exec('ROLLBACK TO SAVEPOINT cloud_preview')
    db.exec('RELEASE SAVEPOINT cloud_preview')
  } catch (error) {
    try { db.exec('ROLLBACK TO SAVEPOINT cloud_preview'); db.exec('RELEASE SAVEPOINT cloud_preview') } catch { /* Domain failure already rolled back. */ }
    throw error
  } finally { financialPreviewDatabases.delete(db) }
  if (!outbox.length) return result
  const groupId = JSON.parse(String(outbox[0]!.payload_json)).atomicGroup?.id
  if (!groupId || outbox.some(row => JSON.parse(String(row.payload_json)).atomicGroup?.id !== groupId)) throw new Error('业务未形成完整的云端事务')
  db.exec('SAVEPOINT cloud_command_store')
  try {
    for (const row of outbox) {
      const mobile = channel==='mobile_cashier' || channel==='mobile_financial'
        ? { ...(result as Record<string,unknown>), kind: channel } : undefined
      row.payload_json = JSON.stringify({ ...JSON.parse(String(row.payload_json)), cloudCommand: true,
        ...(mobile ? {mobileCommand:mobile} : {}) })
      row.payload_hash = createHash('sha256').update(String(row.payload_json)).digest('hex')
      const columns = Object.keys(row)
      db.prepare(`INSERT INTO outbox_operation (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column => row[column]!))
    }
    db.prepare('UPDATE device SET next_sequence = MAX(next_sequence, ?) WHERE id = ?')
      .run(Math.max(...outbox.map(row=>Number(row.device_seq))) + 1, context.deviceId)
    db.prepare(`INSERT INTO cloud_financial_command
      (id,tenant_id,store_id,device_id,actor_id,command_key,request_hash,channel,request_json,result_json,group_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),context.tenantId,context.storeId,context.deviceId,context.actor.id,key,hash,channel,json,JSON.stringify(result),groupId,new Date().toISOString())
    db.exec('RELEASE SAVEPOINT cloud_command_store')
  } catch (error) { db.exec('ROLLBACK TO SAVEPOINT cloud_command_store'); db.exec('RELEASE SAVEPOINT cloud_command_store'); throw error }
  return result
}

/** A phone command must not be reported complete merely because its preview succeeded. */
export function readCloudFinancialCommandOutcome(db: DatabaseSync, deviceId: string, groupId: string): 'pending' | 'confirmed' | 'conflict' {
  const rows=db.prepare(`SELECT sync_status,payload_json FROM outbox_operation
    WHERE device_id=? AND json_extract(payload_json,'$.atomicGroup.id')=?`).all(deviceId,groupId)
  if (!rows.length || rows.length!==JSON.parse(String(rows[0]!.payload_json)).atomicGroup.size ||
      rows.some(row=>!['confirmed','conflict'].includes(String(row.sync_status)))) return 'pending'
  return rows.some(row=>row.sync_status==='conflict')?'conflict':'confirmed'
}

/** Use confirmed ledger deltas and current mirrors for the result shown to staff. */
export function readConfirmedFinancialResult(db: DatabaseSync, context: StoreContext, result: unknown): unknown {
  if (!result || typeof result!=='object' || Array.isArray(result)) return result
  const value=result as Record<string,unknown>
  const wallet=value.wallet as Record<string,unknown>|undefined
  if (wallet && typeof wallet.memberId==='string' && typeof value.operationId==='string') {
    const ledger=db.prepare('SELECT principal_delta_fen,gift_delta_fen FROM wallet_ledger WHERE tenant_id=? AND source_id=?').get(context.tenantId,value.operationId)
    if (!ledger) throw new Error('云端已确认，资金流水仍在刷新，请稍后重试查询原业务')
    return {...value,wallet:getWalletDetails(db,context,wallet.memberId).wallet,
      principalDeltaFen:Number(ledger.principal_delta_fen),giftDeltaFen:Number(ledger.gift_delta_fen)}
  }
  if (typeof value.id==='string' && typeof value.memberId==='string' && 'usageCount' in value) {
    const card=getMonthlyCardDetails(db,context,value.memberId).history.find(item=>item.id===value.id)
    if (!card) throw new Error('云端已确认，月卡仍在刷新，请稍后重试查询原业务')
    return card
  }
  // Mobile results wrap wallet/card records, and execution receipts wrap results.
  for (const key of ['result','wallet','monthlyCard']) {
    if (value[key] && typeof value[key]==='object') return {...value,[key]:readConfirmedFinancialResult(db,context,value[key])}
  }
  return result
}
