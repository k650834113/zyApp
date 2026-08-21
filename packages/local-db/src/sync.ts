import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  buildSyncPushBatch,
  type SyncOperation,
  type SyncPullEvent,
  type SyncPullResult,
  type SyncPushBatch,
  type SyncPushResult
} from '@zyapp/sync-protocol'
import type { StoreContext } from './identity'

export type SyncApplyResult = {
  confirmed: number
  conflicts: number
  lastConfirmedDeviceSeq: number
}

export type LocalSyncStatus = {
  pendingOperations: number
  conflictedOperations: number
  pendingConflicts: number
  pendingInboundEvents: number
  inboundConflicts: number
  lastConfirmedDeviceSeq: number
  pullCursor: string | null
  lastPushAt: string | null
  lastPullAt: string | null
}

export type SyncPullApplyResult = {
  received: number
  skippedOrigin: number
  pending: number
  nextCursor: string | null
}

export function getLocalSyncStatus(
  database: DatabaseSync,
  context: StoreContext
): LocalSyncStatus {
  const operations = database
    .prepare(
      `SELECT
         SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) pending,
         SUM(CASE WHEN sync_status = 'conflict' THEN 1 ELSE 0 END) conflicted
       FROM outbox_operation
       WHERE tenant_id = ? AND store_id = ? AND device_id = ?`
    )
    .get(context.tenantId, context.storeId, context.deviceId) as {
    pending: number | null
    conflicted: number | null
  }
  const conflicts = database
    .prepare(
      `SELECT COUNT(*) count FROM sync_conflict
       WHERE tenant_id = ? AND store_id = ? AND device_id = ?
         AND status = 'pending'`
    )
    .get(context.tenantId, context.storeId, context.deviceId) as {
    count: number
  }
  const inbound = database
    .prepare(
      `SELECT
         SUM(CASE WHEN apply_status = 'pending' THEN 1 ELSE 0 END) pending,
         SUM(CASE WHEN apply_status = 'conflict' THEN 1 ELSE 0 END) conflicted
       FROM sync_inbound_event
       WHERE tenant_id = ? AND store_id = ?`
    )
    .get(context.tenantId, context.storeId) as {
    pending: number | null
    conflicted: number | null
  }
  const state = database
    .prepare(
      `SELECT last_confirmed_device_seq, pull_cursor,
              last_push_at, last_pull_at
       FROM sync_state WHERE device_id = ?`
    )
    .get(context.deviceId) as
    | {
        last_confirmed_device_seq: number
        pull_cursor: string | null
        last_push_at: string | null
        last_pull_at: string | null
      }
    | undefined
  return {
    pendingOperations: Number(operations.pending ?? 0),
    conflictedOperations: Number(operations.conflicted ?? 0),
    pendingConflicts: Number(conflicts.count),
    pendingInboundEvents: Number(inbound.pending ?? 0),
    inboundConflicts: Number(inbound.conflicted ?? 0),
    lastConfirmedDeviceSeq: Number(state?.last_confirmed_device_seq ?? 0),
    pullCursor: state?.pull_cursor ?? null,
    lastPushAt: state?.last_push_at ?? null,
    lastPullAt: state?.last_pull_at ?? null
  }
}

export function getSyncPullCursor(
  database: DatabaseSync,
  deviceId: string
): string | null {
  const state = database
    .prepare('SELECT pull_cursor FROM sync_state WHERE device_id = ?')
    .get(deviceId) as { pull_cursor: string | null } | undefined
  return state?.pull_cursor ?? null
}

export function autoResolveNonCriticalOutboundConflicts(
  database: DatabaseSync,
  context: StoreContext,
  now = new Date().toISOString()
): { resolved: number } {
  const conflicts = database.prepare(
    `SELECT conflict.operation_id, conflict.conflict_type,
            operation.operation_type, operation.aggregate_id,
            operation.actor_id, operation.payload_json
     FROM sync_conflict conflict
     JOIN outbox_operation operation
       ON operation.operation_id = conflict.operation_id
     WHERE conflict.tenant_id = ? AND conflict.store_id = ?
       AND conflict.device_id = ? AND conflict.status = 'pending'
       AND operation.sync_status = 'conflict'
       AND (
         operation.operation_type LIKE 'board_game.%'
         OR operation.operation_type LIKE 'announcement.%'
       )`
  ).all(
    context.tenantId,
    context.storeId,
    context.deviceId
  ) as Array<{
    operation_id: string
    conflict_type: string
    operation_type: string
    aggregate_id: string
    actor_id: string | null
    payload_json: string
  }>
  if (conflicts.length === 0) return { resolved: 0 }

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const conflict of conflicts) {
      const aggregateType = conflict.operation_type.startsWith('board_game.')
        ? 'board_game'
        : 'announcement'
      database.prepare(
        `UPDATE outbox_operation SET sync_status = 'confirmed'
         WHERE operation_id = ? AND sync_status = 'conflict'`
      ).run(conflict.operation_id)
      database.prepare(
        `UPDATE sync_conflict
         SET status = 'resolved', resolved_by = NULL, resolved_at = ?,
             resolution_json = ?
         WHERE operation_id = ? AND status = 'pending'`
      ).run(
        now,
        JSON.stringify({
          resolution: 'accept_cloud',
          source: 'automatic_noncritical_policy',
          conflictType: conflict.conflict_type,
          operationType: conflict.operation_type
        }),
        conflict.operation_id
      )
      database.prepare(
        `INSERT INTO audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, reason, before_json, after_json,
          occurred_at)
         VALUES (?, ?, ?, ?, ?, 'sync.outbound.auto_cloud_wins', ?, ?, ?, ?, NULL, ?)`
      ).run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        context.deviceId,
        conflict.actor_id,
        aggregateType,
        conflict.aggregate_id,
        '非核心资料并发冲突自动接受云端版本',
        conflict.payload_json,
        now
      )
    }
    const lastConfirmedDeviceSeq = contiguousConfirmedSequence(
      database,
      context.deviceId
    )
    database.prepare(
      `UPDATE sync_state
       SET last_confirmed_device_seq = ?, updated_at = ?
       WHERE device_id = ?`
    ).run(lastConfirmedDeviceSeq, now, context.deviceId)
    database.exec('COMMIT')
    return { resolved: conflicts.length }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function recordSyncBatchAccepted(
  database: DatabaseSync,
  context: StoreContext,
  timestamp = new Date().toISOString()
): void {
  database
    .prepare(
      `INSERT INTO sync_state
       (device_id, tenant_id, store_id, last_confirmed_device_seq,
        last_push_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT (device_id) DO UPDATE SET
         last_push_at = excluded.last_push_at,
         updated_at = excluded.updated_at`
    )
    .run(
      context.deviceId,
      context.tenantId,
      context.storeId,
      timestamp,
      timestamp
    )
}

export function listPendingSyncBatch(
  database: DatabaseSync,
  context: StoreContext,
  limit = 100
): SyncPushBatch | null {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('Sync batch limit must be between 1 and 500')
  }
  const rows = database
    .prepare(
      `SELECT operation_id, device_id, device_seq, tenant_id, store_id,
              actor_id, operation_type, aggregate_id, base_version,
              occurred_at, payload_json, payload_hash
       FROM outbox_operation
       WHERE tenant_id = ? AND store_id = ? AND device_id = ?
         AND sync_status = 'pending'
       ORDER BY device_seq
       LIMIT ?`
    )
    .all(
      context.tenantId,
      context.storeId,
      context.deviceId,
      limit
    ) as Array<Record<string, unknown>>
  const operations: SyncOperation[] = rows.map((row) => ({
    operationId: String(row.operation_id),
    deviceId: String(row.device_id),
    deviceSeq: Number(row.device_seq),
    tenantId: String(row.tenant_id),
    storeId: String(row.store_id),
    actorId: row.actor_id === null ? null : String(row.actor_id),
    operationType: String(row.operation_type),
    aggregateId: String(row.aggregate_id),
    baseVersion: row.base_version === null ? null : Number(row.base_version),
    occurredAt: String(row.occurred_at),
    payloadJson: String(row.payload_json),
    payloadHash: String(row.payload_hash)
  }))
  return buildSyncPushBatch(operations)
}

function contiguousConfirmedSequence(
  database: DatabaseSync,
  deviceId: string
): number {
  const firstUnconfirmed = database
    .prepare(
      `SELECT device_seq FROM outbox_operation
       WHERE device_id = ? AND sync_status <> 'confirmed'
       ORDER BY device_seq LIMIT 1`
    )
    .get(deviceId) as { device_seq: number } | undefined
  if (firstUnconfirmed) return Math.max(0, firstUnconfirmed.device_seq - 1)
  const maximum = database
    .prepare(
      `SELECT COALESCE(MAX(device_seq), 0) maximum
       FROM outbox_operation WHERE device_id = ?`
    )
    .get(deviceId) as { maximum: number }
  return maximum.maximum
}

export function applySyncPushResult(
  database: DatabaseSync,
  context: StoreContext,
  result: SyncPushResult
): SyncApplyResult {
  if (result.protocolVersion !== 1) {
    throw new Error('Unsupported sync protocol version')
  }
  if (result.deviceId !== context.deviceId) {
    throw new Error('Sync result belongs to another device')
  }
  const receiptIds = new Set<string>()
  let confirmed = 0
  let conflicts = 0
  const timestamp = new Date().toISOString()

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const receipt of result.receipts) {
      if (receiptIds.has(receipt.operationId)) {
        throw new Error('Sync result contains duplicate operation receipts')
      }
      receiptIds.add(receipt.operationId)
      const operation = database
        .prepare(
          `SELECT operation_id, payload_json, sync_status
           FROM outbox_operation
           WHERE tenant_id = ? AND store_id = ? AND device_id = ?
             AND operation_id = ?`
        )
        .get(
          context.tenantId,
          context.storeId,
          context.deviceId,
          receipt.operationId
        ) as
        | {
            operation_id: string
            payload_json: string
            sync_status: 'pending' | 'confirmed' | 'conflict'
          }
        | undefined
      if (!operation) {
        throw new Error('Sync result references an unknown local operation')
      }
      if (
        receipt.status === 'conflict' &&
        operation.sync_status === 'confirmed'
      ) {
        const resolution = database.prepare(
          `SELECT resolution_json FROM sync_conflict
           WHERE operation_id = ? AND status = 'resolved'`
        ).get(receipt.operationId) as
          | { resolution_json: string | null }
          | undefined
        if (resolution?.resolution_json?.includes(
          'automatic_noncritical_policy'
        )) {
          continue
        }
      }
      if (receipt.status === 'confirmed') {
        database
          .prepare(
            `UPDATE outbox_operation SET sync_status = 'confirmed'
             WHERE operation_id = ?`
          )
          .run(receipt.operationId)
        database
          .prepare(
            `UPDATE sync_conflict
             SET status = 'resolved', resolved_at = ?,
                 resolution_json = ?
             WHERE operation_id = ? AND status = 'pending'`
          )
          .run(
            timestamp,
            JSON.stringify({
              source: 'server_confirmation',
              serverVersion: receipt.serverVersion
            }),
            receipt.operationId
          )
        confirmed += 1
      } else {
        database
          .prepare(
            `UPDATE outbox_operation SET sync_status = 'conflict'
             WHERE operation_id = ?`
          )
          .run(receipt.operationId)
        database
          .prepare(
            `INSERT INTO sync_conflict
             (id, tenant_id, store_id, device_id, operation_id, conflict_type,
              local_payload_json, server_payload_json, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
             ON CONFLICT (operation_id) DO UPDATE SET
               conflict_type = excluded.conflict_type,
               server_payload_json = excluded.server_payload_json,
               status = 'pending',
               resolved_by = NULL,
               resolved_at = NULL,
               resolution_json = NULL`
          )
          .run(
            randomUUID(),
            context.tenantId,
            context.storeId,
            context.deviceId,
            receipt.operationId,
            receipt.conflictType,
            operation.payload_json,
            receipt.serverPayloadJson,
            timestamp
          )
        conflicts += 1
      }
    }
    const lastConfirmedDeviceSeq = contiguousConfirmedSequence(
      database,
      context.deviceId
    )
    database
      .prepare(
        `INSERT INTO sync_state
         (device_id, tenant_id, store_id, last_confirmed_device_seq,
          updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET
           last_confirmed_device_seq = excluded.last_confirmed_device_seq,
           updated_at = excluded.updated_at`
      )
      .run(
        context.deviceId,
        context.tenantId,
        context.storeId,
        lastConfirmedDeviceSeq,
        timestamp
      )
    database.exec('COMMIT')
    return { confirmed, conflicts, lastConfirmedDeviceSeq }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function decimalCursor(
  value: string | null,
  label: string,
  allowZero = true
): bigint {
  if (value === null) return 0n
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative decimal integer`)
  }
  const cursor = BigInt(value)
  if (!allowZero && cursor === 0n) {
    throw new Error(`${label} must be positive`)
  }
  return cursor
}

function sameInboundEvent(
  row: Record<string, unknown>,
  event: SyncPullEvent
): boolean {
  return (
    String(row.sequence) === event.sequence &&
    String(row.event_id) === event.eventId &&
    String(row.tenant_id) === event.tenantId &&
    String(row.store_id) === event.storeId &&
    (row.origin_device_id === null
      ? event.originDeviceId === null
      : String(row.origin_device_id) === event.originDeviceId) &&
    String(row.aggregate_type) === event.aggregateType &&
    String(row.aggregate_id) === event.aggregateId &&
    String(row.event_type) === event.eventType &&
    String(row.payload_json) === event.payloadJson &&
    String(row.occurred_at) === event.occurredAt
  )
}

export function applySyncPullResult(
  database: DatabaseSync,
  context: StoreContext,
  result: SyncPullResult
): SyncPullApplyResult {
  if (result.protocolVersion !== 1) {
    throw new Error('Unsupported sync protocol version')
  }
  if (result.deviceId !== context.deviceId) {
    throw new Error('Sync pull result belongs to another device')
  }

  const storedCursor = getSyncPullCursor(database, context.deviceId)
  const storedCursorValue = decimalCursor(storedCursor, 'Stored pull cursor')
  const afterCursorValue = decimalCursor(
    result.afterCursor,
    'Pull result after cursor'
  )
  const nextCursorValue = decimalCursor(
    result.nextCursor,
    'Pull result next cursor'
  )
  if (afterCursorValue !== storedCursorValue) {
    throw new Error('Sync pull result does not continue the stored cursor')
  }
  if (nextCursorValue < afterCursorValue) {
    throw new Error('Sync pull result moves the cursor backwards')
  }
  if (result.hasMore && result.events.length === 0) {
    throw new Error('Sync pull result cannot have more pages without events')
  }

  let previousSequence = afterCursorValue
  for (const event of result.events) {
    const sequence = decimalCursor(event.sequence, 'Cloud event sequence', false)
    if (sequence <= previousSequence) {
      throw new Error('Cloud events must be strictly ordered after the cursor')
    }
    if (sequence > nextCursorValue) {
      throw new Error('Cloud event sequence exceeds the next cursor')
    }
    if (
      event.tenantId !== context.tenantId ||
      event.storeId !== context.storeId
    ) {
      throw new Error('Cloud event belongs to another tenant or store')
    }
    try {
      JSON.parse(event.payloadJson)
    } catch {
      throw new Error('Cloud event payload is not valid JSON')
    }
    previousSequence = sequence
  }
  if (
    result.events.length > 0 &&
    previousSequence !== nextCursorValue
  ) {
    throw new Error('Sync pull result next cursor must match its last event')
  }
  if (
    result.events.length === 0 &&
    nextCursorValue !== afterCursorValue
  ) {
    throw new Error('An empty sync pull result cannot advance the cursor')
  }

  const timestamp = new Date().toISOString()
  let received = 0
  let skippedOrigin = 0
  let pending = 0

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const event of result.events) {
      const existing = database
        .prepare(
          `SELECT sequence, event_id, tenant_id, store_id, origin_device_id,
                  aggregate_type, aggregate_id, event_type, payload_json,
                  occurred_at
           FROM sync_inbound_event
           WHERE sequence = ? OR event_id = ?`
        )
        .get(event.sequence, event.eventId) as
        | Record<string, unknown>
        | undefined
      if (existing) {
        if (!sameInboundEvent(existing, event)) {
          throw new Error(
            'Cloud event sequence or id was reused with different data'
          )
        }
        continue
      }

      const applyStatus =
        event.originDeviceId === context.deviceId
          ? 'skipped_origin'
          : 'pending'
      database
        .prepare(
          `INSERT INTO sync_inbound_event
           (sequence, event_id, tenant_id, store_id, origin_device_id,
            aggregate_type, aggregate_id, event_type, payload_json,
            occurred_at, apply_status, received_at, applied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.sequence,
          event.eventId,
          event.tenantId,
          event.storeId,
          event.originDeviceId,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.payloadJson,
          event.occurredAt,
          applyStatus,
          timestamp,
          applyStatus === 'skipped_origin' ? timestamp : null
        )
      received += 1
      if (applyStatus === 'skipped_origin') {
        skippedOrigin += 1
      } else {
        pending += 1
      }
    }

    database
      .prepare(
        `INSERT INTO sync_state
         (device_id, tenant_id, store_id, last_confirmed_device_seq,
          pull_cursor, last_pull_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT (device_id) DO UPDATE SET
           pull_cursor = excluded.pull_cursor,
           last_pull_at = excluded.last_pull_at,
           updated_at = excluded.updated_at`
      )
      .run(
        context.deviceId,
        context.tenantId,
        context.storeId,
        result.nextCursor,
        timestamp,
        timestamp
      )
    database.exec('COMMIT')
    return {
      received,
      skippedOrigin,
      pending,
      nextCursor: result.nextCursor
    }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
