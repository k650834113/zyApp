import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type BootstrapStoreInput = {
  storeName: string
  managerUsername: string
  managerPasswordHash: string
  managerDisplayName: string
  deviceName: string
}
export type BootstrapStoreResult = {
  tenantId: string
  storeId: string
  deviceId: string
  managerId: string
}

export function isStoreInitialized(database: DatabaseSync): boolean {
  const row = database.prepare('SELECT COUNT(*) AS count FROM store').get() as {
    count: number
  }
  return row.count > 0
}

export function bootstrapStore(
  database: DatabaseSync,
  input: BootstrapStoreInput
): BootstrapStoreResult {
  if (isStoreInitialized(database)) {
    throw new Error('Store has already been initialized')
  }

  const timestamp = new Date().toISOString()
  const tenantId = randomUUID()
  const storeId = randomUUID()
  const deviceId = randomUUID()
  const managerId = randomUUID()
  const auditId = randomUUID()
  const operationId = randomUUID()
  const payload = JSON.stringify({
    tenantId,
    storeId,
    deviceId,
    managerId,
    storeName: input.storeName,
    deviceName: input.deviceName
  })
  const payloadHash = createHash('sha256').update(payload).digest('hex')

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO store (id, tenant_id, name, timezone, created_at, updated_at)
         VALUES (?, ?, ?, 'Asia/Shanghai', ?, ?)`
      )
      .run(storeId, tenantId, input.storeName, timestamp, timestamp)
    database
      .prepare(
        `INSERT INTO device
         (id, tenant_id, store_id, name, next_sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, 2, ?, ?)`
      )
      .run(deviceId, tenantId, storeId, input.deviceName, timestamp, timestamp)
    database
      .prepare(
        `INSERT INTO employee
         (id, tenant_id, store_id, username, password_hash, display_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manager', 'active', ?, ?)`
      )
      .run(
        managerId,
        tenantId,
        storeId,
        input.managerUsername.trim().toLowerCase(),
        input.managerPasswordHash,
        input.managerDisplayName,
        timestamp,
        timestamp
      )
    database
      .prepare(
        `INSERT INTO audit_log
         (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
          aggregate_id, reason, before_json, after_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, 'store.bootstrap', 'store', ?, 'first-run setup', NULL, ?, ?)`
      )
      .run(auditId, tenantId, storeId, deviceId, managerId, storeId, payload, timestamp)
    database
      .prepare(
        `INSERT INTO outbox_operation
         (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
          operation_type, aggregate_id, base_version, occurred_at, payload_json, payload_hash)
         VALUES (?, ?, 1, ?, ?, ?, 'store.bootstrapped', ?, NULL, ?, ?, ?)`
      )
      .run(
        operationId,
        deviceId,
        tenantId,
        storeId,
        managerId,
        storeId,
        timestamp,
        payload,
        payloadHash
      )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return { tenantId, storeId, deviceId, managerId }
}
