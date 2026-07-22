import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EmployeeRecord, StoreContext } from './identity'

export function recordSystemOperation(
  database: DatabaseSync,
  context: StoreContext & { actor: EmployeeRecord },
  input: {
    requestId: string
    action: string
    reason: string
    details: unknown
    now?: Date
  }
): void {
  const existing = database
    .prepare(
      `SELECT id FROM audit_log
       WHERE tenant_id = ? AND action = ? AND aggregate_id = ?`
    )
    .get(context.tenantId, input.action, input.requestId)
  if (existing) return
  const timestamp = (input.now ?? new Date()).toISOString()
  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')
  const payload = JSON.stringify({
    requestId: input.requestId,
    action: input.action,
    details: input.details
  })

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE device
         SET next_sequence = next_sequence + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(timestamp, context.deviceId)
    database
      .prepare(
        `INSERT INTO audit_log
         (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
          aggregate_id, reason, before_json, after_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, 'system_operation', ?, ?, NULL, ?, ?)`
      )
      .run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        context.deviceId,
        context.actor.id,
        input.action,
        input.requestId,
        input.reason,
        payload,
        timestamp
      )
    database
      .prepare(
        `INSERT INTO outbox_operation
         (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
          operation_type, aggregate_id, base_version, occurred_at, payload_json,
          payload_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        context.deviceId,
        sequence.next_sequence,
        context.tenantId,
        context.storeId,
        context.actor.id,
        input.action,
        input.requestId,
        timestamp,
        payload,
        createHash('sha256').update(payload).digest('hex')
      )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
