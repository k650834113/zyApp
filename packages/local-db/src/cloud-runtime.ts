import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudRuntimeMode } from '@zyapp/contracts'
import type { CloudMirrorPage } from '@zyapp/contracts'
import type { StoreContext } from './identity'
import type { SyncOperation } from '@zyapp/sync-protocol'

export type CloudRuntimeRecord = {
  mirrorEpoch: string
  cloudPrimaryActivated: boolean
  runtimeMode: CloudRuntimeMode
  lastCloudReachableAt: string | null
  lastError: string | null
  pendingOutcomes: number
  mirrorRepairRequired: boolean
  offlineFinancialLeaseOwnerDeviceId: string | null
  offlineFinancialLeaseExpiresAt: string | null
  offlineFinancialWriteAllowed: boolean
}

export function ensureCloudRuntimeState(
  database: DatabaseSync,
  context: StoreContext,
  now = new Date().toISOString()
): CloudRuntimeRecord {
  database.prepare(
    `INSERT INTO cloud_runtime_state
     (device_id, tenant_id, store_id, mirror_epoch, runtime_mode, updated_at)
     VALUES (?, ?, ?, ?, 'not_configured', ?)
     ON CONFLICT (device_id) DO NOTHING`
  ).run(
    context.deviceId,
    context.tenantId,
    context.storeId,
    randomUUID(),
    now
  )
  return getCloudRuntimeState(database, context)
}

export function setCloudRuntimeMode(
  database: DatabaseSync,
  context: StoreContext,
  runtimeMode: CloudRuntimeMode,
  options: {
    reachable?: boolean
    error?: string | null
    now?: string
  } = {}
): CloudRuntimeRecord {
  const now = options.now ?? new Date().toISOString()
  ensureCloudRuntimeState(database, context, now)
  database.prepare(
    `UPDATE cloud_runtime_state
     SET runtime_mode = ?,
         last_cloud_reachable_at = CASE WHEN ? = 1 THEN ? ELSE last_cloud_reachable_at END,
         last_error = ?, updated_at = ?
     WHERE device_id = ?`
  ).run(
    runtimeMode,
    options.reachable ? 1 : 0,
    now,
    options.error ?? null,
    now,
    context.deviceId
  )
  return getCloudRuntimeState(database, context)
}

export function getCloudRuntimeState(
  database: DatabaseSync,
  context: StoreContext
): CloudRuntimeRecord {
  const row = database.prepare(
    `SELECT mirror_epoch, cloud_primary_activated, runtime_mode,
            last_cloud_reachable_at, offline_lease_owner_device_id,
            offline_lease_expires_at, offline_lease_version, last_error
     FROM cloud_runtime_state WHERE device_id = ?`
  ).get(context.deviceId) as
    | {
        mirror_epoch: string
        cloud_primary_activated: number
        runtime_mode: CloudRuntimeMode
        last_cloud_reachable_at: string | null
        offline_lease_owner_device_id: string | null
        offline_lease_expires_at: string | null
        offline_lease_version: number
        last_error: string | null
      }
    | undefined
  if (!row) {
    return ensureCloudRuntimeState(database, context)
  }
  const pending = database.prepare(
    `SELECT COUNT(*) count FROM cloud_operation_outcome
     WHERE tenant_id = ? AND store_id = ? AND status = 'pending'`
  ).get(context.tenantId, context.storeId) as { count: number }
  const repairs = database.prepare(
    `SELECT COUNT(*) count FROM cloud_mirror_repair
     WHERE tenant_id = ? AND store_id = ? AND repaired_at IS NULL`
  ).get(context.tenantId, context.storeId) as { count: number }
  return {
    mirrorEpoch: row.mirror_epoch,
    cloudPrimaryActivated: row.cloud_primary_activated === 1,
    runtimeMode: row.runtime_mode,
    lastCloudReachableAt: row.last_cloud_reachable_at,
    lastError: row.last_error,
    pendingOutcomes: Number(pending.count),
    mirrorRepairRequired: Number(repairs.count) > 0,
    offlineFinancialLeaseOwnerDeviceId: row.offline_lease_owner_device_id,
    offlineFinancialLeaseExpiresAt: row.offline_lease_expires_at,
    offlineFinancialWriteAllowed:
      row.offline_lease_owner_device_id === context.deviceId &&
      row.offline_lease_expires_at !== null &&
      Date.parse(row.offline_lease_expires_at) > Date.now()
  }
}

export function cacheOfflineFinancialLease(
  database: DatabaseSync,
  context: StoreContext,
  lease: {
    ownerDeviceId: string | null
    expiresAt: string | null
    leaseVersion: number
  },
  now = new Date().toISOString()
): void {
  ensureCloudRuntimeState(database, context, now)
  database.prepare(
    `UPDATE cloud_runtime_state
     SET offline_lease_owner_device_id = ?, offline_lease_expires_at = ?,
         offline_lease_version = ?, updated_at = ?
     WHERE device_id = ?`
  ).run(
    lease.ownerDeviceId,
    lease.expiresAt,
    lease.leaseVersion,
    now,
    context.deviceId
  )
}

export function recordPendingCloudOutcome(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    operationId: string
    aggregateType: string
    aggregateId: string
    now?: string
  }
): void {
  const now = input.now ?? new Date().toISOString()
  database.prepare(
    `INSERT INTO cloud_operation_outcome
     (operation_id, tenant_id, store_id, device_id, aggregate_type,
      aggregate_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT (operation_id) DO NOTHING`
  ).run(
    input.operationId,
    context.tenantId,
    context.storeId,
    context.deviceId,
    input.aggregateType,
    input.aggregateId,
    now,
    now
  )
}

export function resolveCloudOutcome(
  database: DatabaseSync,
  input: {
    operationId: string
    status: 'confirmed' | 'conflict'
    serverVersion: number | null
    resultJson?: string | null
    errorMessage?: string | null
    now?: string
  }
): void {
  const now = input.now ?? new Date().toISOString()
  database.prepare(
    `UPDATE cloud_operation_outcome
     SET status = ?, server_version = ?, result_json = ?, error_message = ?,
         updated_at = ?
     WHERE operation_id = ?`
  ).run(
    input.status,
    input.serverVersion,
    input.resultJson ?? null,
    input.errorMessage ?? null,
    now,
    input.operationId
  )
}

export function recordCloudMirrorRepair(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    operationId: string
    aggregateType: string
    aggregateId: string
    errorMessage: string
    now?: string
  }
): void {
  const now = input.now ?? new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(
      `UPDATE cloud_operation_outcome
       SET status = 'mirror_error', error_message = ?, updated_at = ?
       WHERE operation_id = ?`
    ).run(input.errorMessage, now, input.operationId)
    database.prepare(
      `INSERT INTO cloud_mirror_repair
       (operation_id, tenant_id, store_id, aggregate_type, aggregate_id,
        error_message, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (operation_id) DO UPDATE SET
         error_message = excluded.error_message,
         attempt_count = cloud_mirror_repair.attempt_count + 1,
         next_attempt_at = excluded.next_attempt_at,
         updated_at = excluded.updated_at,
         repaired_at = NULL`
    ).run(
      input.operationId,
      context.tenantId,
      context.storeId,
      input.aggregateType,
      input.aggregateId,
      input.errorMessage,
      now,
      now,
      now
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function assertCloudMirrorSafeForFinancialWrite(
  database: DatabaseSync,
  context: StoreContext,
  aggregateType: string,
  aggregateId?: string
): void {
  const runtimeTables = database.prepare(
    `SELECT COUNT(*) count FROM sqlite_master
     WHERE type = 'table' AND name IN (
       'cloud_runtime_state', 'cloud_mirror_repair'
     )`
  ).get() as { count: number }
  if (Number(runtimeTables.count) < 2) return
  const repair = aggregateId
    ? database.prepare(
        `SELECT 1 FROM cloud_mirror_repair
         WHERE tenant_id = ? AND store_id = ? AND aggregate_type = ?
           AND aggregate_id = ? AND repaired_at IS NULL LIMIT 1`
      ).get(context.tenantId, context.storeId, aggregateType, aggregateId)
    : database.prepare(
        `SELECT 1 FROM cloud_mirror_repair
         WHERE tenant_id = ? AND store_id = ? AND aggregate_type = ?
           AND repaired_at IS NULL LIMIT 1`
      ).get(context.tenantId, context.storeId, aggregateType)
  if (repair) {
    throw new Error('该账户的本地镜像尚未修复，已阻止离线财务操作')
  }
  const runtime = database.prepare(
    `SELECT runtime_mode, offline_lease_owner_device_id,
            offline_lease_expires_at
     FROM cloud_runtime_state WHERE device_id = ?`
  ).get(context.deviceId) as
    | {
        runtime_mode: CloudRuntimeMode
        offline_lease_owner_device_id: string | null
        offline_lease_expires_at: string | null
      }
    | undefined
  const requiresOfflineLease =
    aggregateType === 'wallet' ||
    aggregateType === 'monthly_card' ||
    aggregateType === 'refund' ||
    aggregateType === 'financial_refund'
  if (
    requiresOfflineLease &&
    runtime?.runtime_mode === 'local_offline' &&
    (
      runtime.offline_lease_owner_device_id !== context.deviceId ||
      runtime.offline_lease_expires_at === null ||
      Date.parse(runtime.offline_lease_expires_at) <= Date.now()
    )
  ) {
    throw new Error('本设备没有有效的离线财务主收银租约，已阻止离线扣款')
  }
}

export function cacheCloudMirrorPage(
  database: DatabaseSync,
  context: StoreContext,
  page: CloudMirrorPage,
  now = new Date().toISOString()
): void {
  const insert = database.prepare(
    `INSERT INTO cloud_read_model_cache
     (tenant_id, store_id, resource, row_id, payload_json, event_cursor,
      cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, store_id, resource, row_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       event_cursor = excluded.event_cursor,
       cached_at = excluded.cached_at`
  )
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const row of page.rows) {
      insert.run(
        context.tenantId,
        context.storeId,
        page.resource,
        row.id,
        JSON.stringify(row.payload),
        page.eventCursor,
        now
      )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function mirrorResourceForOperation(operationType: string): string | null {
  if (operationType.startsWith('member.')) return 'members'
  if (operationType.startsWith('catalog.')) return 'catalog'
  if (operationType.startsWith('activity.')) return 'activities'
  if (operationType.startsWith('announcement.')) return 'announcements'
  if (operationType.startsWith('board_game.')) return 'board_games'
  if (operationType.startsWith('store.')) return 'store'
  if (operationType.startsWith('employee.')) return 'employees'
  return null
}

export function enrichCloudSyncOperation(
  database: DatabaseSync,
  context: StoreContext,
  operation: SyncOperation
): SyncOperation {
  const resource = mirrorResourceForOperation(operation.operationType)
  let baseVersion = operation.baseVersion
  if (baseVersion === null && resource) {
    const cached = database.prepare(
      `SELECT payload_json FROM cloud_read_model_cache
       WHERE tenant_id = ? AND store_id = ? AND resource = ? AND row_id = ?`
    ).get(
      context.tenantId,
      context.storeId,
      resource,
      operation.aggregateId
    ) as { payload_json: string } | undefined
    if (cached) {
      const payload = JSON.parse(cached.payload_json) as Record<string, unknown>
      const candidate = payload.server_version ?? payload.serverVersion
      if (Number.isSafeInteger(Number(candidate)) && Number(candidate) >= 0) {
        baseVersion = Number(candidate)
      }
    }
  }
  let changedFields = operation.changedFields
  if (!changedFields) {
    try {
      const payload = JSON.parse(operation.payloadJson) as Record<string, unknown>
      const before = payload.before
      const after = payload.after
      if (
        before &&
        after &&
        typeof before === 'object' &&
        typeof after === 'object' &&
        !Array.isArray(before) &&
        !Array.isArray(after)
      ) {
        const beforeRecord = before as Record<string, unknown>
        const afterRecord = after as Record<string, unknown>
        changedFields = Object.keys(afterRecord).filter(
          (key) =>
            key !== 'updatedAt' &&
            JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key])
        )
      }
    } catch {
      // The sync validator will report malformed payloads.
    }
  }
  return {
    ...operation,
    baseVersion,
    ...(changedFields ? { changedFields } : {}),
    protocolVersion: 2
  }
}
