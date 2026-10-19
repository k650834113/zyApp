import { lockMobileFinancialCommand, completeMobileFinancialGroup, failMobileFinancialGroup } from './mobile-financial-group'
import type { PoolClient } from 'pg'
import { markSyncConflict, type ReceivedOperation } from './sync-operation-handler'

type Result = 'confirmed' | 'conflict' | 'unsupported'
type Group = { id: string; size: number; index: number }
function group(value: unknown): Group | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Group
  return typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) &&
    Number.isInteger(item.size) && item.size >= 1 && item.size <= 100 &&
    Number.isInteger(item.index) && item.index >= 0 && item.index < item.size ? item : null
}

/** Caller owns the transaction and the first operation lock. */
export async function processAtomicSyncGroup(client: PoolClient, first: ReceivedOperation,
  process: (operation: ReceivedOperation) => Promise<Result>): Promise<{ status: Result; count: number }> {
  if (first.payload_json.atomicGroup === undefined) return { status: await process(first), count: 1 }
  const descriptor = group(first.payload_json.atomicGroup)
  if (!descriptor) return { status: await markSyncConflict(client, first, 'invalid_atomic_group', 'Invalid financial transaction group'), count: 1 }
  const result = await client.query<ReceivedOperation & { status: string }>(
    `SELECT * FROM sync_operation WHERE tenant_id = $1 AND store_id = $2 AND device_id = $3
     AND payload_json->'atomicGroup'->>'id' = $4 ORDER BY device_seq FOR UPDATE`,
    [first.tenant_id, first.store_id, first.device_id, descriptor.id])
  const rows = result.rows
  // A network interruption can split uploads. Do not execute any part until all arrive.
  if (rows.length < descriptor.size) return { status: 'unsupported', count: 0 }
  const valid = rows.length === descriptor.size && rows.every((row, index) => {
    const part = group(row.payload_json.atomicGroup)
    return part?.id === descriptor.id && part.size === descriptor.size && part.index === index &&
      row.actor_id === first.actor_id && row.status === 'received' &&
      Number(row.device_seq) === Number(rows[0]!.device_seq) + index
  })
  if (!valid) return { status: await markSyncConflict(client, first, 'invalid_atomic_group', 'Financial transaction group is inconsistent; no business changes applied'), count: 1 }
  await client.query('SAVEPOINT financial_group')
  let failed: ReceivedOperation | undefined
  let failureDetail: unknown = null
  try {
    failed = first
    const mobile = await lockMobileFinancialCommand(client, first)
    for (const row of rows) {
      failed = row
      if (await process(row) !== 'confirmed') {
        const reason = await client.query<{ server_payload_json: unknown }>('SELECT server_payload_json FROM sync_conflict WHERE operation_id = $1', [row.operation_id])
        failureDetail = reason.rows[0]?.server_payload_json ?? null
        break
      }
      failed = undefined
    }
    if (!failed && mobile) {
      failed = first
      await completeMobileFinancialGroup(client, first, mobile)
      failed = undefined
    }
  } catch (error) {
    const code = String((error as {code?:string}).code ?? '')
    // Constraint / invalid-data errors require review; network, deadlock and
    // serialization failures remain retryable and must not become conflicts.
    if (!/^(22|23)/.test(code)) throw error
    failureDetail = { code, retryAllowed: !(error as {mobileClaimChanged?:boolean}).mobileClaimChanged, message: (error as {mobileClaimChanged?:boolean}).mobileClaimChanged ? '原移动端业务已处理或已由其他设备领取，请核对原业务，不能再次收款' : '数据校验未通过，整笔业务已撤销，请核对后重试' }
  }
  if (failed) {
    await client.query('ROLLBACK TO SAVEPOINT financial_group')
    await failMobileFinancialGroup(client, first)
    for (const row of rows) await markSyncConflict(client, row, 'atomic_group_rejected',
      '整笔业务未执行，请核对失败原因后处理；云端未产生本笔扣款或订单',
      { atomicGroup: descriptor.id, failedOperationId: failed.operation_id, detail: failureDetail })
    await client.query('RELEASE SAVEPOINT financial_group')
    return { status: 'conflict', count: rows.length }
  }
  await client.query('RELEASE SAVEPOINT financial_group')
  return { status: 'confirmed', count: rows.length }
}
