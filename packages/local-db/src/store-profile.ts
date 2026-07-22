import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  StoreProfileSummary,
  UpdateStoreProfileRequest
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'

type StoreProfileContext = StoreContext & { actor: EmployeeRecord }

function optionalText(
  value: string | undefined,
  maximum: number,
  name: string
): string | null {
  const normalized = value?.trim() ?? ''
  if (normalized.length > maximum) {
    throw new Error(`${name} must not exceed ${maximum} characters`)
  }
  return normalized || null
}

function validate(request: UpdateStoreProfileRequest): void {
  const name = request.name.trim()
  if (name.length < 1 || name.length > 120) {
    throw new Error('Store name must contain 1-120 characters')
  }
  optionalText(request.address, 300, 'Store address')
  optionalText(request.contactPhone, 50, 'Store contact phone')
  optionalText(request.customStatusText, 100, 'Store status text')
  for (const [label, minute] of [
    ['Business opening minute', request.businessOpenMinute],
    ['Business closing minute', request.businessCloseMinute]
  ] as const) {
    if (!Number.isInteger(minute) || minute < 0 || minute > 1439) {
      throw new Error(`${label} must be between 0 and 1439`)
    }
  }
  if (request.businessOpenMinute === request.businessCloseMinute) {
    throw new Error('Business opening and closing time must be different')
  }
  if (
    request.statusOverride !== 'automatic' &&
    request.statusOverride !== 'open' &&
    request.statusOverride !== 'closed'
  ) {
    throw new Error('Store status override is invalid')
  }
  if (!request.reason.trim()) {
    throw new Error('Store profile update reason is required')
  }
}

export function getStoreProfile(
  database: DatabaseSync,
  context: StoreContext
): StoreProfileSummary {
  const row = database
    .prepare(
      `SELECT id, name, address, contact_phone, business_open_minute,
              business_close_minute, status_override, custom_status_text,
              updated_at
       FROM store
       WHERE tenant_id = ? AND id = ?`
    )
    .get(context.tenantId, context.storeId) as
    | Record<string, unknown>
    | undefined
  if (!row) throw new Error('Store profile was not found')
  return {
    storeId: String(row.id),
    name: String(row.name),
    address: row.address === null ? null : String(row.address),
    contactPhone:
      row.contact_phone === null ? null : String(row.contact_phone),
    businessOpenMinute: Number(row.business_open_minute),
    businessCloseMinute: Number(row.business_close_minute),
    statusOverride:
      row.status_override as StoreProfileSummary['statusOverride'],
    customStatusText:
      row.custom_status_text === null
        ? null
        : String(row.custom_status_text),
    updatedAt: String(row.updated_at)
  }
}

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: StoreProfileContext,
  before: StoreProfileSummary,
  after: StoreProfileSummary,
  reason: string,
  timestamp: string
): void {
  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')
  const payload = JSON.stringify({
    action: 'store.profile.updated',
    storeId: context.storeId,
    before,
    after,
    reason
  })
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
       VALUES (?, ?, ?, ?, ?, 'store.profile.updated', 'store', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      context.storeId,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
      timestamp
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json,
        payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'store.profile.updated', ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence.next_sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      context.storeId,
      timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

export function updateStoreProfile(
  database: DatabaseSync,
  context: StoreProfileContext,
  request: UpdateStoreProfileRequest
): StoreProfileSummary {
  validate(request)
  const before = getStoreProfile(database, context)
  const timestamp = new Date().toISOString()
  const reason = request.reason.trim()

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE store
         SET name = ?, address = ?, contact_phone = ?,
             business_open_minute = ?, business_close_minute = ?,
             status_override = ?, custom_status_text = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        request.name.trim(),
        optionalText(request.address, 300, 'Store address'),
        optionalText(request.contactPhone, 50, 'Store contact phone'),
        request.businessOpenMinute,
        request.businessCloseMinute,
        request.statusOverride,
        optionalText(request.customStatusText, 100, 'Store status text'),
        timestamp,
        context.tenantId,
        context.storeId
      )
    const after = getStoreProfile(database, context)
    appendAuditAndOutbox(
      database,
      context,
      before,
      after,
      reason,
      timestamp
    )
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
