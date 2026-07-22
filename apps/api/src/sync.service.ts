import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import {
  processReceivedSyncOperation,
  type Pool
} from '@zyapp/cloud-db'
import type {
  SyncCommandResult,
  SyncOperation,
  SyncOperationOutcome,
  SyncPullResult,
  SyncPushResult,
  SyncReceiveResult,
  SyncReceipt
} from '@zyapp/sync-protocol'
import { randomUUID } from 'node:crypto'
import type { DevicePrincipal } from './device-auth'
import { POSTGRES_POOL } from './infrastructure.module'
import {
  validateSyncCommand,
  validateSyncPushBatch
} from './sync-validation'

type ExistingOperation = {
  operation_id: string
  device_id: string
  device_seq: string | number
  tenant_id: string
  store_id: string
  operation_type: string
  aggregate_id: string
  base_version: string | number | null
  occurred_at: Date
  payload_hash: string
  protocol_version: number
  changed_fields: unknown
}

function sameOperation(
  existing: ExistingOperation,
  operation: SyncOperation
): boolean {
  return (
    existing.operation_id === operation.operationId &&
    existing.device_id === operation.deviceId &&
    Number(existing.device_seq) === operation.deviceSeq &&
    existing.tenant_id === operation.tenantId &&
    existing.store_id === operation.storeId &&
    existing.operation_type === operation.operationType &&
    existing.aggregate_id === operation.aggregateId &&
    (existing.base_version === null
      ? operation.baseVersion === null
      : Number(existing.base_version) === operation.baseVersion) &&
    existing.occurred_at.toISOString() ===
      new Date(operation.occurredAt).toISOString() &&
    existing.payload_hash === operation.payloadHash
    && Number(existing.protocol_version) === (operation.protocolVersion ?? 1)
    && JSON.stringify(existing.changed_fields ?? null) ===
      JSON.stringify(operation.changedFields ?? null)
  )
}

function normalizedConflictType(value: string | null) {
  return value === 'member_phone_duplicate' ||
    value === 'member_version_mismatch' ||
    value === 'wallet_authority_conflict' ||
    value === 'monthly_card_state_conflict' ||
    value === 'catalog_version_mismatch'
    ? value
    : 'unknown'
}

function isIdentityBootstrapOperation(operationType: string): boolean {
  return (
    operationType === 'store.bootstrapped' ||
    operationType.startsWith('employee.') ||
    operationType.startsWith('system.')
  )
}

function requiresManager(operationType: string): boolean {
  return (
    operationType.startsWith('employee.') ||
    operationType.startsWith('store.') ||
    operationType.startsWith('catalog.item.created') ||
    operationType.startsWith('catalog.item.updated') ||
    operationType.startsWith('catalog.item.status') ||
    operationType.startsWith('activity.') ||
    operationType.startsWith('announcement.') ||
    operationType.includes('gift_tiers') ||
    operationType.includes('completed') ||
    operationType.includes('rejected') ||
    operationType.includes('reversed')
  )
}

function resultLimit(value: string | undefined): number {
  const parsed = Number(value ?? '100')
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new BadRequestException('limit must be between 1 and 500')
  }
  return parsed
}

function afterSequence(value: string | undefined): number {
  const parsed = Number(value ?? '0')
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BadRequestException('afterDeviceSeq must be a non-negative integer')
  }
  return parsed
}

function pullCursor(value: string | undefined): {
  raw: string | null
  query: string
} {
  if (value === undefined) {
    return { raw: null, query: '0' }
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new BadRequestException(
      'afterCursor must be a non-negative decimal integer'
    )
  }
  return { raw: value, query: value }
}

@Injectable()
export class SyncService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async receive(
    principal: DevicePrincipal,
    rawBatch: unknown
  ): Promise<SyncReceiveResult> {
    let batch
    try {
      batch = validateSyncPushBatch(rawBatch)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid sync batch'
      )
    }
    if (batch.deviceId !== principal.deviceId) {
      throw new ConflictException('Sync batch belongs to another device')
    }
    for (const operation of batch.operations) {
      if (
        operation.tenantId !== principal.tenantId ||
        operation.storeId !== principal.storeId
      ) {
        throw new ConflictException(
          'Sync operation belongs to another tenant or store'
        )
      }
    }
    const client = await this.pool.connect()
    const receipts: SyncReceiveResult['receipts'] = []
    try {
      await client.query('BEGIN')
      const device = await client.query(
        `SELECT id FROM device
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
           AND status = 'active'
         FOR UPDATE`,
        [principal.deviceId, principal.tenantId, principal.storeId]
      )
      if (device.rowCount !== 1) {
        throw new ConflictException('Device is no longer active')
      }
      for (const operation of batch.operations) {
        const existing = await client.query<ExistingOperation>(
          `SELECT operation_id, device_id, device_seq, tenant_id, store_id,
                  operation_type, aggregate_id, base_version, occurred_at,
                  payload_hash, protocol_version, changed_fields
           FROM sync_operation
           WHERE operation_id = $1 OR (device_id = $2 AND device_seq = $3)
           FOR UPDATE`,
          [operation.operationId, operation.deviceId, operation.deviceSeq]
        )
        const row = existing.rows[0]
        if (row) {
          if (!sameOperation(row, operation)) {
            throw new ConflictException(
              'Operation id or device sequence was reused with different data'
            )
          }
          receipts.push({
            operationId: operation.operationId,
            status: 'already_received'
          })
          continue
        }
        await client.query(
          `INSERT INTO sync_operation
           (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
            operation_type, aggregate_id, base_version, occurred_at,
            payload_json, payload_hash, protocol_version, changed_fields, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11::jsonb, $12, $13, $14::jsonb, 'received')`,
          [
            operation.operationId,
            operation.deviceId,
            operation.deviceSeq,
            operation.tenantId,
            operation.storeId,
            operation.actorId,
            operation.operationType,
            operation.aggregateId,
            operation.baseVersion,
            operation.occurredAt,
            operation.payloadJson,
            operation.payloadHash,
            operation.protocolVersion ?? batch.protocolVersion,
            operation.changedFields
              ? JSON.stringify(operation.changedFields)
              : null
          ]
        )
        receipts.push({
          operationId: operation.operationId,
          status: 'accepted'
        })
      }
      await client.query(
        `UPDATE device
         SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [principal.deviceId]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4, 'sync.batch.received', 'device',
                 $4::uuid::text, $5)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          principal.deviceId,
          JSON.stringify({
            count: batch.operations.length,
            firstDeviceSeq: batch.firstDeviceSeq,
            lastDeviceSeq: batch.lastDeviceSeq
          })
        ]
      )
      await client.query('COMMIT')
      return {
        protocolVersion: 1,
        deviceId: principal.deviceId,
        receipts,
        serverTime: new Date().toISOString()
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }


  async command(
    principal: DevicePrincipal,
    rawCommand: unknown
  ): Promise<SyncCommandResult> {
    let command
    try {
      command = validateSyncCommand(rawCommand)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid sync command'
      )
    }
    const operation = command.operation
    if (
      operation.deviceId !== principal.deviceId ||
      operation.tenantId !== principal.tenantId ||
      operation.storeId !== principal.storeId
    ) {
      throw new ConflictException('Sync command identity does not match device')
    }
    if (!isIdentityBootstrapOperation(operation.operationType)) {
      if (!operation.actorId) {
        throw new ForbiddenException('Business sync command requires an actor')
      }
      const actor = await this.pool.query<{
        role: 'manager' | 'staff'
        status: 'active' | 'disabled'
      }>(
        `SELECT role, status FROM cloud_employee
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3`,
        [operation.actorId, principal.tenantId, principal.storeId]
      )
      const employee = actor.rows[0]
      if (!employee || employee.status !== 'active') {
        throw new ForbiddenException('Command actor is not an active employee')
      }
      if (employee.role !== 'manager' && requiresManager(operation.operationType)) {
        throw new ForbiddenException('Command requires manager permission')
      }
    }
    await this.receive(principal, {
      protocolVersion: 2,
      deviceId: operation.deviceId,
      firstDeviceSeq: operation.deviceSeq,
      lastDeviceSeq: operation.deviceSeq,
      operations: [operation]
    })
    await processReceivedSyncOperation(this.pool, {
      operationId: operation.operationId,
      tenantId: principal.tenantId,
      storeId: principal.storeId,
      deviceId: principal.deviceId
    })
    const result = await this.operation(principal, operation.operationId)
    if (
      result.outcome.status === 'confirmed' &&
      !operation.operationType.startsWith('store.') &&
      !operation.operationType.startsWith('employee.') &&
      !operation.operationType.startsWith('catalog.') &&
      !operation.operationType.startsWith('system.')
    ) {
      await this.pool.query(
        `UPDATE cloud_mirror_epoch
         SET first_business_write_at = COALESCE(
           first_business_write_at, CURRENT_TIMESTAMP
         )
         WHERE tenant_id = $1 AND store_id = $2`,
        [principal.tenantId, principal.storeId]
      )
    }
    return result
  }

  async operation(
    principal: DevicePrincipal,
    operationId: string
  ): Promise<SyncCommandResult> {
    const result = await this.pool.query<{
      operation_id: string
      status: 'received' | 'confirmed' | 'conflict'
      server_version: string | number | null
      result_json: unknown
      conflict_type: string | null
      server_payload_json: unknown
    }>(
      `SELECT operation.operation_id, operation.status,
              operation.server_version, operation.result_json,
              conflict.conflict_type, conflict.server_payload_json
       FROM sync_operation operation
       LEFT JOIN sync_conflict conflict
         ON conflict.operation_id = operation.operation_id
       WHERE operation.operation_id = $1 AND operation.tenant_id = $2
         AND operation.store_id = $3 AND operation.device_id = $4`,
      [
        operationId,
        principal.tenantId,
        principal.storeId,
        principal.deviceId
      ]
    )
    const row = result.rows[0]
    if (!row) throw new NotFoundException('Sync operation was not found')
    const common = {
      operationId: row.operation_id,
      serverVersion:
        row.server_version === null ? null : Number(row.server_version),
      resultJson:
        row.result_json === null || row.result_json === undefined
          ? null
          : JSON.stringify(row.result_json)
    }
    const outcome: SyncOperationOutcome =
      row.status === 'conflict'
        ? {
            ...common,
            status: 'conflict',
            conflictType: normalizedConflictType(row.conflict_type),
            serverPayloadJson:
              row.server_payload_json === null
                ? null
                : JSON.stringify(row.server_payload_json)
          }
        : row.status === 'confirmed'
          ? {
              ...common,
              status: 'confirmed',
              conflictType: null,
              serverPayloadJson: null
            }
          : {
              ...common,
              status: 'received',
              serverVersion: null,
              conflictType: null,
              serverPayloadJson: null
            }
    return {
      protocolVersion: 2,
      deviceId: principal.deviceId,
      outcome,
      serverTime: new Date().toISOString()
    }
  }

  async latestEventSequence(principal: DevicePrincipal): Promise<string> {
    const result = await this.pool.query<{ sequence: string | number }>(
      `SELECT COALESCE(MAX(sequence), 0) sequence FROM cloud_event
       WHERE tenant_id = $1 AND store_id = $2`,
      [principal.tenantId, principal.storeId]
    )
    return String(result.rows[0]?.sequence ?? 0)
  }

  async results(
    principal: DevicePrincipal,
    rawAfterDeviceSeq: string | undefined,
    rawLimit: string | undefined
  ): Promise<SyncPushResult> {
    const after = afterSequence(rawAfterDeviceSeq)
    const limit = resultLimit(rawLimit)
    const result = await this.pool.query<{
      operation_id: string
      status: 'confirmed' | 'conflict'
      server_version: string | number | null
      conflict_type: string | null
      server_payload_json: unknown
    }>(
      `SELECT operation.operation_id, operation.status,
              operation.server_version, conflict.conflict_type,
              conflict.server_payload_json
       FROM sync_operation operation
       LEFT JOIN sync_conflict conflict
         ON conflict.operation_id = operation.operation_id
       WHERE operation.tenant_id = $1
         AND operation.store_id = $2
         AND operation.device_id = $3
         AND operation.device_seq > $4
         AND operation.status IN ('confirmed', 'conflict')
       ORDER BY operation.device_seq
       LIMIT $5`,
      [
        principal.tenantId,
        principal.storeId,
        principal.deviceId,
        after,
        limit
      ]
    )
    const receipts: SyncReceipt[] = result.rows.map((row) =>
      row.status === 'confirmed'
        ? {
            operationId: row.operation_id,
            status: 'confirmed',
            serverVersion:
              row.server_version === null ? null : Number(row.server_version)
          }
        : {
            operationId: row.operation_id,
            status: 'conflict',
            conflictType:
              row.conflict_type ===
                'member_phone_duplicate' ||
              row.conflict_type ===
                'member_version_mismatch' ||
              row.conflict_type ===
                'wallet_authority_conflict' ||
              row.conflict_type ===
                'monthly_card_state_conflict' ||
              row.conflict_type ===
                'catalog_version_mismatch'
                ? row.conflict_type
                : 'unknown',
            serverPayloadJson:
              row.server_payload_json === null
                ? null
                : JSON.stringify(row.server_payload_json)
          }
    )
    return {
      protocolVersion: 1,
      deviceId: principal.deviceId,
      receipts,
      serverTime: new Date().toISOString()
    }
  }

  async pull(
    principal: DevicePrincipal,
    rawAfterCursor: string | undefined,
    rawLimit: string | undefined
  ): Promise<SyncPullResult> {
    const after = pullCursor(rawAfterCursor)
    const limit = resultLimit(rawLimit)
    const result = await this.pool.query<{
      sequence: string | number
      event_id: string
      tenant_id: string
      store_id: string
      origin_device_id: string | null
      aggregate_type: string
      aggregate_id: string
      event_type: string
      payload_json: unknown
      occurred_at: Date | string
    }>(
      `SELECT event.sequence, event.event_id, event.tenant_id, event.store_id,
              operation.device_id origin_device_id,
              event.aggregate_type, event.aggregate_id, event.event_type,
              event.payload_json, event.occurred_at
       FROM cloud_event event
       LEFT JOIN sync_operation operation
         ON operation.server_version = event.sequence
        AND operation.tenant_id = event.tenant_id
        AND operation.store_id = event.store_id
       WHERE event.tenant_id = $1
         AND event.store_id = $2
         AND event.sequence > $3::bigint
       ORDER BY event.sequence
       LIMIT $4`,
      [
        principal.tenantId,
        principal.storeId,
        after.query,
        limit + 1
      ]
    )
    const hasMore = result.rows.length > limit
    const rows = result.rows.slice(0, limit)
    const events = rows.map((row) => ({
      sequence: String(row.sequence),
      eventId: row.event_id,
      tenantId: row.tenant_id,
      storeId: row.store_id,
      originDeviceId: row.origin_device_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payloadJson: JSON.stringify(row.payload_json),
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : new Date(row.occurred_at).toISOString()
    }))
    return {
      protocolVersion: 1,
      deviceId: principal.deviceId,
      afterCursor: after.raw,
      nextCursor: events.at(-1)?.sequence ?? after.raw,
      hasMore,
      events,
      serverTime: new Date().toISOString()
    }
  }
}
