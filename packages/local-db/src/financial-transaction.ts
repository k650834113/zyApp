import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const financialPreviewDatabases = new WeakSet<DatabaseSync>()

/** Group every outbox record of the SQLite transaction before its commit. */
export function beginFinancialTransaction(db: DatabaseSync): number {
  db.exec(financialPreviewDatabases.has(db) ? 'SAVEPOINT local_financial' : 'BEGIN IMMEDIATE')
  return Number((db.prepare('SELECT COALESCE(MAX(rowid), 0) value FROM outbox_operation').get() as { value: number }).value)
}
export function commitFinancialTransaction(db: DatabaseSync, start: number): void {
  const rows = db.prepare('SELECT rowid, operation_type, aggregate_id, payload_json FROM outbox_operation WHERE rowid > ? ORDER BY rowid').all(start)
  if (rows.length > 100) throw new Error('一笔业务的同步记录超过上限')
  const id = randomUUID()
  rows.forEach((row, index) => {
    const body = JSON.parse(String(row.payload_json))
    if (String(row.operation_type).startsWith('order.')) body.payment = db.prepare('SELECT * FROM order_payment WHERE order_id = ?').get(row.aggregate_id!)
    if (body.after && typeof body.after === 'object' && !Array.isArray(body.after)) {
      if (String(row.operation_type).startsWith('wallet.') && body.after.operationId) {
        const ledger = db.prepare('SELECT metadata_json, related_ledger_id FROM wallet_ledger WHERE source_id = ?').get(body.after.operationId)
        if (ledger) {
          const metadata = JSON.parse(String(ledger.metadata_json))
          const original = ledger.related_ledger_id ? db.prepare('SELECT source_id FROM wallet_ledger WHERE id = ?').get(ledger.related_ledger_id) : null
          body.after.metadata = { ...metadata, ...(original ? { originalDebitSourceId: original.source_id } : {}) }
        }
      }
      if (String(row.operation_type).startsWith('order.')) {
        body.after.payment = db.prepare('SELECT * FROM order_payment WHERE order_id = ?').get(row.aggregate_id!)
      }
      if (String(row.operation_type).startsWith('refund.')) {
        body.after.payment = db.prepare('SELECT * FROM refund_payment WHERE refund_id = ?').get(row.aggregate_id!)
      }
    }
    const payload = JSON.stringify({ ...body, atomicGroup: { id, size: rows.length, index } })
    db.prepare('UPDATE outbox_operation SET payload_json = ?, payload_hash = ? WHERE rowid = ?')
      .run(payload, createHash('sha256').update(payload).digest('hex'), row.rowid!)
  })
  db.exec(financialPreviewDatabases.has(db) ? 'RELEASE SAVEPOINT local_financial' : 'COMMIT')
}
