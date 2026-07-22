import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  markSyncConflict,
  processSyncOperation,
  type ReceivedOperation
} from './sync-operation-handler'

export type StoreBootstrapPayload = {
  tenantId: string
  storeId: string
  deviceId: string
  managerId: string
  storeName: string
  deviceName: string
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be non-empty text`)
  }
  return value.trim()
}

export function parseStoreBootstrapPayload(
  value: unknown
): StoreBootstrapPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('store.bootstrapped payload must be an object')
  }
  const payload = value as Record<string, unknown>
  return {
    tenantId: text(payload.tenantId, 'tenantId'),
    storeId: text(payload.storeId, 'storeId'),
    deviceId: text(payload.deviceId, 'deviceId'),
    managerId: text(payload.managerId, 'managerId'),
    storeName: text(payload.storeName, 'storeName'),
    deviceName: text(payload.deviceName, 'deviceName')
  }
}

async function confirmStoreBootstrap(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<'confirmed' | 'conflict'> {
  let payload: StoreBootstrapPayload
  try {
    payload = parseStoreBootstrapPayload(operation.payload_json)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid payload'
    )
  }
  if (
    payload.tenantId !== operation.tenant_id ||
    payload.storeId !== operation.store_id ||
    payload.deviceId !== operation.device_id ||
    payload.storeId !== operation.aggregate_id
  ) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'store.bootstrapped identifiers do not match the operation envelope'
    )
  }
  const registered = await client.query<{
    store_name: string
    device_name: string
  }>(
    `SELECT store.name store_name, device.name device_name
     FROM store
     JOIN device ON device.store_id = store.id
     WHERE store.id = $1
       AND store.tenant_id = $2
       AND device.id = $3
       AND device.status = 'active'`,
    [payload.storeId, payload.tenantId, payload.deviceId]
  )
  const current = registered.rows[0]
  if (!current) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'tenant, store, or active device registration is missing'
    )
  }
  const event = await client.query<{ sequence: string | number }>(
    `INSERT INTO cloud_event
     (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
      event_type, payload_json, occurred_at)
     VALUES ($1, $2, $3, 'store', $3::uuid::text,
             'store.bootstrapped', $4::jsonb, $5)
     RETURNING sequence`,
    [
      randomUUID(),
      operation.tenant_id,
      operation.store_id,
      JSON.stringify({
        ...payload,
        registeredStoreName: current.store_name,
        registeredDeviceName: current.device_name
      }),
      operation.occurred_at
    ]
  )
  const serverVersion = Number(event.rows[0]?.sequence)
  if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
    throw new Error('cloud event did not return a valid sequence')
  }
  await client.query(
    `INSERT INTO cloud_audit_log
     (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
      aggregate_id, metadata_json, occurred_at)
     VALUES ($1, $2, $3, $4, $5, 'store.bootstrapped', 'store',
             $3::uuid::text,
             $6::jsonb, $7)`,
    [
      randomUUID(),
      operation.tenant_id,
      operation.store_id,
      operation.device_id,
      operation.actor_id,
      JSON.stringify({
        operationId: operation.operation_id,
        deviceSeq: Number(operation.device_seq)
      }),
      operation.occurred_at
    ]
  )
  await client.query(
    `UPDATE sync_operation
     SET status = 'confirmed', server_version = $2
     WHERE operation_id = $1`,
    [operation.operation_id, serverVersion]
  )
  await client.query(
    `UPDATE device
     SET last_device_seq = GREATEST(last_device_seq, $2),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [operation.device_id, Number(operation.device_seq)]
  )
  return 'confirmed'
}

export async function processReceivedSyncOperations(
  pool: Pool,
  limit = 20
): Promise<{ confirmed: number; conflicts: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Sync processing limit must be between 1 and 100')
  }
  const client = await pool.connect()
  let confirmed = 0
  let conflicts = 0
  try {
    await client.query('BEGIN')
    const result = await client.query<ReceivedOperation>(
      `SELECT operation_id, device_id, device_seq, tenant_id, store_id,
              actor_id, operation_type, aggregate_id, base_version,
              protocol_version,
              changed_fields, occurred_at, payload_json
       FROM sync_operation operation
       WHERE operation.status = 'received'
         AND NOT EXISTS (
           SELECT 1 FROM sync_operation earlier
           WHERE earlier.device_id = operation.device_id
             AND earlier.device_seq < operation.device_seq
             AND (
               earlier.status = 'received'
               OR (earlier.status = 'conflict' AND operation.protocol_version = 1)
             )
         )
       ORDER BY operation.received_at, operation.device_id, operation.device_seq
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [limit]
    )
    for (const operation of result.rows) {
      const status = await processSyncOperation(
        client,
        operation,
        confirmStoreBootstrap
      )
      if (status === 'confirmed') confirmed += 1
      else if (status === 'conflict') conflicts += 1
    }
    await client.query('COMMIT')
    return { confirmed, conflicts }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function processReceivedSyncOperation(
  pool: Pool,
  input: {
    operationId: string
    tenantId: string
    storeId: string
    deviceId: string
  }
): Promise<'received' | 'confirmed' | 'conflict'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<ReceivedOperation & { status: string }>(
      `SELECT operation_id, device_id, device_seq, tenant_id, store_id,
              actor_id, operation_type, aggregate_id, base_version,
              protocol_version,
              changed_fields, occurred_at,
              payload_json, status
       FROM sync_operation
       WHERE operation_id = $1 AND tenant_id = $2 AND store_id = $3
         AND device_id = $4
       FOR UPDATE`,
      [input.operationId, input.tenantId, input.storeId, input.deviceId]
    )
    const operation = result.rows[0]
    if (!operation) throw new Error('Sync operation was not received')
    if (operation.status === 'confirmed' || operation.status === 'conflict') {
      await client.query('COMMIT')
      return operation.status
    }
    const blocked = await client.query(
      `SELECT 1 FROM sync_operation
       WHERE device_id = $1 AND device_seq < $2
         AND (
           status = 'received'
           OR (status = 'conflict' AND $3 = 1)
         )
       LIMIT 1`,
      [
        operation.device_id,
        Number(operation.device_seq),
        Number(operation.protocol_version ?? 1)
      ]
    )
    if (blocked.rowCount) {
      await client.query('COMMIT')
      return 'received'
    }
    const status = await processSyncOperation(
      client,
      operation,
      confirmStoreBootstrap
    )
    await client.query(
      `UPDATE sync_operation SET completed_at = CURRENT_TIMESTAMP
       WHERE operation_id = $1 AND status IN ('confirmed', 'conflict')`,
      [operation.operation_id]
    )
    await client.query('COMMIT')
    return status === 'unsupported' ? 'received' : status
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
