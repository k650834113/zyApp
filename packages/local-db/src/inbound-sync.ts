import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  InboundSyncConflictSummary,
  ResolveInboundSyncConflictRequest
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { reconcileProjectedMemberTier } from './member-tier-projection'

type InboundEventRow = {
  sequence: string
  event_id: string
  aggregate_type:
    | 'activity'
    | 'announcement'
    | 'board_game'
    | 'catalog'
    | 'employee'
    | 'employee_pc_credential'
    | 'employee_mobile_access'
    | 'member'
    | 'store'
    | 'wallet_recharge'
    | 'business_template'
  aggregate_id: string
  event_type: string
  payload_json: string
  occurred_at: string
}

type InboundResolutionContext = StoreContext & { actor: EmployeeRecord }

export type InboundApplyBatchResult = {
  applied: number
  conflicts: number
  skippedSuperseded: number
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be non-empty text`)
  }
  return value.trim()
}

function nullableText(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new Error(`${name} must be text or null`)
  return value.trim() || null
}

function integer(
  value: unknown,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function complexityTenths(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number or null`)
  }
  const tenths = Math.round(value * 10)
  if (
    tenths < 0 ||
    tenths > 50 ||
    Math.abs(value - tenths / 10) > 1e-9
  ) {
    throw new Error(`${name} must be 0.0-5.0 with at most one decimal place`)
  }
  return tenths
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`)
  return value
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  name: string
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${name} is invalid`)
  }
  return value as T[number]
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a timestamp`)
  }
  return new Date(value).toISOString()
}

function afterPayload(event: InboundEventRow): Record<string, unknown> {
  const payload = record(JSON.parse(event.payload_json), 'event payload')
  return record(payload.after, 'event payload after')
}

function currentSnapshot(
  database: DatabaseSync,
  event: InboundEventRow
): unknown {
  if (event.aggregate_type === 'employee_mobile_access') {
    return (
      database
        .prepare(
          `SELECT employee_id, enabled, updated_at
           FROM employee_mobile_credential
           WHERE employee_id = ?`
        )
        .get(event.aggregate_id) ?? null
    )
  }
  if (event.aggregate_type === 'employee_pc_credential') {
    return (
      database.prepare(
        `SELECT employee_id, credential_version, authorization_version,
                verified_at, expires_at, invalidated_at
         FROM employee_pc_offline_credential WHERE employee_id = ?`
      ).get(event.aggregate_id) ?? null
    )
  }
  if (event.aggregate_type === 'wallet_recharge') {
    return (
      database
        .prepare(
          `SELECT id, member_id, principal_fen, gift_fen, payment_method,
                  status, occurred_at
           FROM wallet_recharge
           WHERE id = ?`
        )
        .get(event.aggregate_id) ?? null
    )
  }
  if (event.aggregate_type === 'business_template') {
    return database.prepare(
      `SELECT * FROM merchant_business_template WHERE id = ?`
    ).get(event.aggregate_id) ?? null
  }
  const table =
    event.aggregate_type === 'activity'
      ? 'activity_campaign'
      : event.aggregate_type === 'announcement'
        ? 'announcement'
        : event.aggregate_type === 'board_game'
          ? 'board_game'
          : event.aggregate_type === 'catalog'
            ? 'catalog_item'
            : event.aggregate_type === 'employee'
              ? 'employee'
            : event.aggregate_type === 'member'
              ? 'member'
          : 'store'
  return (
    database
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(event.aggregate_id) ?? null
  )
}

function applyEmployeeMobileAccess(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const employee = database
    .prepare(
      `SELECT id FROM employee
       WHERE id = ? AND tenant_id = ? AND store_id = ?`
    )
    .get(event.aggregate_id, context.tenantId, context.storeId)
  if (!employee) throw new Error('Employee was not found for mobile access')
  const enabled = booleanValue(after.enabled, 'employeeMobileAccess.enabled')
  const updatedAt = timestamp(
    after.updatedAt,
    'employeeMobileAccess.updatedAt'
  )
  database
    .prepare(
      `INSERT INTO employee_mobile_credential
       (employee_id, tenant_id, store_id, enabled, password_hash, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT (employee_id) DO UPDATE SET
         enabled = excluded.enabled,
         password_hash = CASE
           WHEN excluded.enabled = 0 THEN NULL
           ELSE employee_mobile_credential.password_hash
         END,
         updated_at = excluded.updated_at`
    )
    .run(
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      enabled ? 1 : 0,
      updatedAt
    )
  database
    .prepare(
      `UPDATE employee SET updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    )
    .run(updatedAt, event.aggregate_id, context.tenantId)
}

function applyEmployee(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const status = enumValue(
    after.status,
    ['active', 'disabled'] as const,
    'employee.status'
  )
  const updatedAt = timestamp(after.updatedAt, 'employee.updatedAt')
  const authorizationVersion = after.authorizationVersion === undefined
    ? 0
    : integer(after.authorizationVersion, 'employee.authorizationVersion', 1)
  database.prepare(
    `INSERT INTO employee
     (id, tenant_id, store_id, username, password_hash, display_name, role,
      status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'cloud-login-not-configured', ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       username = excluded.username,
       display_name = excluded.display_name,
       role = excluded.role,
       status = excluded.status,
       updated_at = excluded.updated_at
     WHERE employee.tenant_id = excluded.tenant_id
       AND employee.store_id = excluded.store_id`
  ).run(
    event.aggregate_id,
    context.tenantId,
    context.storeId,
    text(after.username, 'employee.username'),
    text(after.displayName, 'employee.displayName'),
    enumValue(after.role, ['manager', 'staff'] as const, 'employee.role'),
    status,
    after.createdAt === undefined
      ? updatedAt
      : timestamp(after.createdAt, 'employee.createdAt'),
    updatedAt
  )
  if (status === 'disabled' || authorizationVersion > 0) {
    database.prepare(
      `UPDATE employee_pc_offline_credential
       SET invalidated_at = CASE
             WHEN ? = 'disabled' OR authorization_version < ?
               THEN COALESCE(invalidated_at, ?)
             ELSE invalidated_at
           END,
           updated_at = ?
       WHERE employee_id = ? AND tenant_id = ? AND store_id = ? AND device_id = ?`
    ).run(
      status,
      authorizationVersion,
      event.occurred_at,
      event.occurred_at,
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      context.deviceId
    )
  }
}

function applyEmployeePcCredential(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const credentialVersion = integer(
    after.credentialVersion,
    'employeePcCredential.credentialVersion',
    1
  )
  database.prepare(
    `UPDATE employee_pc_offline_credential
     SET invalidated_at = CASE
           WHEN credential_version < ? THEN COALESCE(invalidated_at, ?)
           ELSE invalidated_at
         END,
         updated_at = ?
     WHERE employee_id = ? AND tenant_id = ? AND store_id = ? AND device_id = ?`
  ).run(
    credentialVersion,
    event.occurred_at,
    event.occurred_at,
    event.aggregate_id,
    context.tenantId,
    context.storeId,
    context.deviceId
  )
}

function appendInboundAudit(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  action: 'sync.inbound.applied' | 'sync.inbound.conflict',
  reason: string,
  before: unknown,
  after: unknown,
  timestampValue: string,
  actorId: string | null = null
): void {
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      actorId,
      action,
      event.aggregate_type,
      event.aggregate_id,
      reason,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      timestampValue
    )
}

export function listInboundSyncConflicts(
  database: DatabaseSync,
  context: StoreContext
): InboundSyncConflictSummary[] {
  const rows = database
    .prepare(
      `SELECT sequence, event_id, aggregate_type, aggregate_id, event_type,
              occurred_at, received_at, error_message
       FROM sync_inbound_event
       WHERE tenant_id = ? AND store_id = ? AND apply_status = 'conflict'
       ORDER BY length(sequence), sequence`
    )
    .all(context.tenantId, context.storeId) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    sequence: String(row.sequence),
    eventId: String(row.event_id),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    eventType: String(row.event_type),
    occurredAt: String(row.occurred_at),
    receivedAt: String(row.received_at),
    errorMessage: String(row.error_message ?? 'Unknown inbound conflict')
  }))
}

function hasPendingLocalChange(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow
): boolean {
  if (event.aggregate_type === 'wallet_recharge') return false
  const row = database
    .prepare(
      `SELECT COUNT(*) count
       FROM outbox_operation
       WHERE tenant_id = ? AND store_id = ? AND device_id = ?
         AND aggregate_id = ? AND sync_status <> 'confirmed'`
    )
    .get(
      context.tenantId,
      context.storeId,
      context.deviceId,
      event.aggregate_id
    ) as { count: number }
  return row.count > 0
}

function hasLaterLocalOriginEvent(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow
): boolean {
  if (event.aggregate_type === 'wallet_recharge') return false
  const row = database
    .prepare(
      `SELECT COUNT(*) count
       FROM sync_inbound_event
       WHERE tenant_id = ? AND store_id = ?
         AND aggregate_type = ? AND aggregate_id = ?
         AND origin_device_id = ?
         AND (
           length(sequence) > length(?)
           OR (length(sequence) = length(?) AND sequence > ?)
         )`
    )
    .get(
      context.tenantId,
      context.storeId,
      event.aggregate_type,
      event.aggregate_id,
      context.deviceId,
      event.sequence,
      event.sequence,
      event.sequence
    ) as { count: number }
  return row.count > 0
}

function skipSupersededEvent(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow
): void {
  const timestampValue = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE sync_inbound_event
         SET apply_status = 'skipped_origin', applied_at = ?,
             error_message = 'superseded_by_later_local_origin'
         WHERE sequence = ? AND apply_status = 'pending'`
      )
      .run(timestampValue, event.sequence)
    appendInboundAudit(
      database,
      context,
      event,
      'sync.inbound.applied',
      'Skipped because a later event from this device is authoritative',
      currentSnapshot(database, event),
      null,
      timestampValue
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function applyStore(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  if (event.aggregate_id !== context.storeId) {
    throw new Error('Inbound store event targets another store')
  }
  const opening = integer(
    after.businessOpenMinute,
    'store.businessOpenMinute',
    0,
    1439
  )
  const closing = integer(
    after.businessCloseMinute,
    'store.businessCloseMinute',
    0,
    1439
  )
  if (opening === closing) {
    throw new Error('Store opening and closing time must be different')
  }
  const result = database
    .prepare(
      `UPDATE store
       SET name = ?, address = ?, contact_phone = ?,
           business_open_minute = ?, business_close_minute = ?,
           status_override = ?, custom_status_text = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?`
    )
    .run(
      text(after.name, 'store.name'),
      nullableText(after.address, 'store.address'),
      nullableText(after.contactPhone, 'store.contactPhone'),
      opening,
      closing,
      enumValue(
        after.statusOverride,
        ['automatic', 'open', 'closed'] as const,
        'store.statusOverride'
      ),
      nullableText(after.customStatusText, 'store.customStatusText'),
      timestamp(after.updatedAt, 'store.updatedAt'),
      context.tenantId,
      context.storeId
    )
  if (Number(result.changes) !== 1) {
    throw new Error('Local store profile was not found')
  }
}

function applyAnnouncement(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const status = enumValue(
    after.status,
    ['draft', 'published', 'disabled'] as const,
    'announcement.status'
  )
  const visibleFrom = timestamp(
    after.visibleFrom,
    'announcement.visibleFrom'
  )
  const visibleUntil =
    after.visibleUntil === null || after.visibleUntil === undefined
      ? null
      : timestamp(after.visibleUntil, 'announcement.visibleUntil')
  if (
    visibleUntil !== null &&
    Date.parse(visibleUntil) <= Date.parse(visibleFrom)
  ) {
    throw new Error('Announcement visible-until time must be later')
  }
  const createdAt = timestamp(after.createdAt, 'announcement.createdAt')
  const updatedAt = timestamp(after.updatedAt, 'announcement.updatedAt')
  const publishedAt =
    after.publishedAt === null || after.publishedAt === undefined
      ? null
      : timestamp(after.publishedAt, 'announcement.publishedAt')
  database
    .prepare(
      `INSERT INTO announcement
       (id, tenant_id, store_id, title, content, status, pinned,
        visible_from, visible_until, created_by, published_by, published_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cloud-sync',
               ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         status = excluded.status,
         pinned = excluded.pinned,
         visible_from = excluded.visible_from,
         visible_until = excluded.visible_until,
         published_by = excluded.published_by,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at
       WHERE announcement.tenant_id = excluded.tenant_id
         AND announcement.store_id = excluded.store_id`
    )
    .run(
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      text(after.title, 'announcement.title'),
      text(after.content, 'announcement.content'),
      status,
      booleanValue(after.pinned, 'announcement.pinned') ? 1 : 0,
      visibleFrom,
      visibleUntil,
      status === 'published' ? 'cloud-sync' : null,
      publishedAt,
      createdAt,
      updatedAt
    )
}

function applyActivity(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const startsAt = timestamp(after.startsAt, 'activity.startsAt')
  const endsAt = timestamp(after.endsAt, 'activity.endsAt')
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error('Activity end time must be later than start time')
  }
  const activityType = enumValue(
    after.activityType,
    ['recharge', 'general'] as const,
    'activity.activityType'
  )
  const status = enumValue(
    after.status,
    ['draft', 'published', 'disabled'] as const,
    'activity.status'
  )
  if (!Array.isArray(after.rechargeTiers)) {
    throw new Error('activity.rechargeTiers must be an array')
  }
  const tiers = after.rechargeTiers.map((value, index) => {
    const tier = record(value, `activity.rechargeTiers[${index}]`)
    return {
      id: text(tier.id, `activity.rechargeTiers[${index}].id`),
      principalFen: integer(
        tier.principalFen,
        `activity.rechargeTiers[${index}].principalFen`,
        1
      ),
      giftFen: integer(
        tier.giftFen,
        `activity.rechargeTiers[${index}].giftFen`
      )
    }
  })
  if (activityType === 'recharge' && tiers.length === 0) {
    throw new Error('Recharge activity requires at least one tier')
  }
  const createdAt = timestamp(after.createdAt, 'activity.createdAt')
  const updatedAt = timestamp(after.updatedAt, 'activity.updatedAt')
  database
    .prepare(
      `INSERT INTO activity_campaign
       (id, tenant_id, store_id, title, summary, content, activity_type,
        status, starts_at, ends_at, pinned, regular_price_fen,
        advanced_price_fen, allow_stored_value, allow_wechat, created_by,
        published_by, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'cloud-sync', ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         content = excluded.content,
         activity_type = excluded.activity_type,
         status = excluded.status,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         pinned = excluded.pinned,
         regular_price_fen = excluded.regular_price_fen,
         advanced_price_fen = excluded.advanced_price_fen,
         allow_stored_value = excluded.allow_stored_value,
         allow_wechat = excluded.allow_wechat,
         published_by = excluded.published_by,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at
       WHERE activity_campaign.tenant_id = excluded.tenant_id
         AND activity_campaign.store_id = excluded.store_id`
    )
    .run(
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      text(after.title, 'activity.title'),
      text(after.summary, 'activity.summary'),
      text(after.content, 'activity.content'),
      activityType,
      status,
      startsAt,
      endsAt,
      booleanValue(after.pinned, 'activity.pinned') ? 1 : 0,
      after.regularPriceFen === null
        ? null
        : integer(after.regularPriceFen, 'activity.regularPriceFen'),
      after.advancedPriceFen === null
        ? null
        : integer(after.advancedPriceFen, 'activity.advancedPriceFen'),
      booleanValue(after.allowStoredValue, 'activity.allowStoredValue')
        ? 1
        : 0,
      booleanValue(after.allowWechat, 'activity.allowWechat') ? 1 : 0,
      status === 'published' ? 'cloud-sync' : null,
      status === 'published' ? event.occurred_at : null,
      createdAt,
      updatedAt
    )
  database
    .prepare(
      `DELETE FROM activity_recharge_tier
       WHERE tenant_id = ? AND activity_id = ?`
    )
    .run(context.tenantId, event.aggregate_id)
  const insertTier = database.prepare(
    `INSERT INTO activity_recharge_tier
     (id, tenant_id, store_id, activity_id, principal_fen, gift_fen,
      created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const tier of tiers) {
    insertTier.run(
      tier.id,
      context.tenantId,
      context.storeId,
      event.aggregate_id,
      tier.principalFen,
      tier.giftFen,
      updatedAt
    )
  }
}

function applyBoardGame(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  if (!Array.isArray(after.categories) || after.categories.length === 0) {
    throw new Error('boardGame.categories must be a non-empty array')
  }
  const categories = after.categories.map((value, index) =>
    text(value, `boardGame.categories[${index}]`)
  )
  if (!Array.isArray(after.missingParts)) {
    throw new Error('boardGame.missingParts must be an array')
  }
  const missingParts = after.missingParts.map((value, index) => {
    const part = record(value, `boardGame.missingParts[${index}]`)
    return {
      id: text(part.id, `boardGame.missingParts[${index}].id`),
      name: text(part.name, `boardGame.missingParts[${index}].name`),
      quantity: integer(
        part.quantity,
        `boardGame.missingParts[${index}].quantity`,
        1
      )
    }
  })
  const minPlayers = integer(after.minPlayers, 'boardGame.minPlayers', 1)
  const maxPlayers = integer(after.maxPlayers, 'boardGame.maxPlayers', 1)
  if (maxPlayers < minPlayers) {
    throw new Error('Board-game maximum players must not be smaller')
  }
  const createdAt = timestamp(after.createdAt, 'boardGame.createdAt')
  const updatedAt = timestamp(after.updatedAt, 'boardGame.updatedAt')
  const metadataSource =
    after.metadataSource === null || after.metadataSource === undefined
      ? null
      : enumValue(
          after.metadataSource,
          ['bgg'] as const,
          'boardGame.metadataSource'
        )
  const metadataImportedAt =
    after.metadataImportedAt === null ||
    after.metadataImportedAt === undefined
      ? null
      : timestamp(
          after.metadataImportedAt,
          'boardGame.metadataImportedAt'
        )
  database
    .prepare(
      `INSERT INTO board_game
       (id, tenant_id, store_id, base_game_id, name, introduction, categories_json,
        min_players, max_players, min_minutes, max_minutes, difficulty,
        complexity_tenths, quantity, record_status, available, customer_consigned,
        missing_pieces, private, recommended, image_url, local_image_path,
        bgg_id, metadata_source, metadata_imported_at, customer_note,
        internal_note, consignor_nickname, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               NULL, ?, ?, ?, ?, ?, ?, 'cloud-sync', ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         base_game_id = excluded.base_game_id,
         name = excluded.name,
         introduction = excluded.introduction,
         categories_json = excluded.categories_json,
         min_players = excluded.min_players,
         max_players = excluded.max_players,
         min_minutes = excluded.min_minutes,
         max_minutes = excluded.max_minutes,
         difficulty = excluded.difficulty,
         complexity_tenths = excluded.complexity_tenths,
         quantity = excluded.quantity,
         record_status = excluded.record_status,
         available = excluded.available,
         customer_consigned = excluded.customer_consigned,
         missing_pieces = excluded.missing_pieces,
         private = excluded.private,
         recommended = excluded.recommended,
         image_url = excluded.image_url,
         bgg_id = excluded.bgg_id,
         metadata_source = excluded.metadata_source,
         metadata_imported_at = excluded.metadata_imported_at,
         customer_note = excluded.customer_note,
         internal_note = excluded.internal_note,
         consignor_nickname = excluded.consignor_nickname,
         updated_at = excluded.updated_at
       WHERE board_game.tenant_id = excluded.tenant_id
         AND board_game.store_id = excluded.store_id`
    )
    .run(
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      nullableText(after.baseGameId, 'boardGame.baseGameId'),
      text(after.name, 'boardGame.name'),
      text(after.introduction, 'boardGame.introduction'),
      JSON.stringify(categories),
      minPlayers,
      maxPlayers,
      after.minMinutes === null
        ? null
        : integer(after.minMinutes, 'boardGame.minMinutes', 1),
      after.maxMinutes === null
        ? null
        : integer(after.maxMinutes, 'boardGame.maxMinutes', 1),
      enumValue(
        after.difficulty,
        ['light', 'medium', 'heavy'] as const,
        'boardGame.difficulty'
      ),
      complexityTenths(
        after.complexityRating,
        'boardGame.complexityRating'
      ),
      integer(after.quantity, 'boardGame.quantity'),
      enumValue(
        after.recordStatus,
        ['active', 'disabled'] as const,
        'boardGame.recordStatus'
      ),
      booleanValue(after.available, 'boardGame.available') ? 1 : 0,
      booleanValue(after.customerConsigned, 'boardGame.customerConsigned')
        ? 1
        : 0,
      booleanValue(after.missingPieces, 'boardGame.missingPieces') ? 1 : 0,
      booleanValue(after.private, 'boardGame.private') ? 1 : 0,
      booleanValue(after.recommended, 'boardGame.recommended') ? 1 : 0,
      nullableText(after.imageUrl, 'boardGame.imageUrl'),
      after.bggId === null
        ? null
        : integer(after.bggId, 'boardGame.bggId', 1),
      metadataSource,
      metadataImportedAt,
      nullableText(after.customerNote, 'boardGame.customerNote'),
      nullableText(after.internalNote, 'boardGame.internalNote'),
      nullableText(after.consignorNickname, 'boardGame.consignorNickname'),
      createdAt,
      updatedAt
    )
  database
    .prepare(
      `DELETE FROM board_game_missing_part
       WHERE tenant_id = ? AND board_game_id = ?`
    )
    .run(context.tenantId, event.aggregate_id)
  const insertPart = database.prepare(
    `INSERT INTO board_game_missing_part
     (id, tenant_id, store_id, board_game_id, name, quantity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const part of missingParts) {
    insertPart.run(
      part.id,
      context.tenantId,
      context.storeId,
      event.aggregate_id,
      part.name,
      part.quantity,
      updatedAt
    )
  }
}

function applyCatalog(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const createdAt = timestamp(after.createdAt, 'catalog.createdAt')
  const updatedAt = timestamp(after.updatedAt, 'catalog.updatedAt')
  database
    .prepare(
      `INSERT INTO catalog_item
       (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
        advanced_price_fen, status, availability, note, source, created_at,
        updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'desktop', ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         code = excluded.code,
         name = excluded.name,
         item_type = excluded.item_type,
         regular_price_fen = excluded.regular_price_fen,
         advanced_price_fen = excluded.advanced_price_fen,
         status = excluded.status,
         availability = excluded.availability,
         note = excluded.note,
         updated_at = excluded.updated_at
       WHERE catalog_item.tenant_id = excluded.tenant_id
         AND catalog_item.store_id = excluded.store_id`
    )
    .run(
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      text(after.code, 'catalog.code'),
      text(after.name, 'catalog.name'),
      enumValue(
        after.itemType,
        ['admission', 'product', 'service', 'activity'] as const,
        'catalog.itemType'
      ),
      integer(after.regularPriceFen, 'catalog.regularPriceFen'),
      integer(after.advancedPriceFen, 'catalog.advancedPriceFen'),
      enumValue(
        after.status,
        ['active', 'disabled'] as const,
        'catalog.status'
      ),
      enumValue(
        after.availability,
        ['available', 'sold_out'] as const,
        'catalog.availability'
      ),
      nullableText(after.note, 'catalog.note'),
      createdAt,
      updatedAt
    )
}

function applyMember(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  const tier = enumValue(
    after.tier,
    ['ordinary', 'advanced'] as const,
    'member.tier'
  )
  const existing = database
    .prepare(
      `SELECT m.id,
              COUNT(CASE WHEN g.id IS NOT NULL AND g.revoked_at IS NULL
                         THEN 1 END) advanced_grants
       FROM member m
       LEFT JOIN membership_grant g
         ON g.tenant_id = m.tenant_id AND g.member_id = m.id
       WHERE m.tenant_id = ? AND m.id = ?
       GROUP BY m.id`
    )
    .get(context.tenantId, event.aggregate_id) as
    | { id: string; advanced_grants: number }
    | undefined
  const localTier =
    existing && Number(existing.advanced_grants) > 0
      ? 'advanced'
      : 'ordinary'
  const memberEnabledTierReset = event.event_type === 'member.enabled' && tier === 'ordinary'
  if (
    event.event_type !== 'member.snapshot' &&
    !memberEnabledTierReset &&
    ((!existing && tier !== 'ordinary') || (existing && tier !== localTier))
  ) {
    throw new Error(
      'Member tier requires its original recharge, activity, or manual grant'
    )
  }
  const birthdayMonth =
    after.birthdayMonth === null
      ? null
      : integer(after.birthdayMonth, 'member.birthdayMonth', 1, 12)
  const birthdayDay =
    after.birthdayDay === null
      ? null
      : integer(after.birthdayDay, 'member.birthdayDay', 1, 31)
  if ((birthdayMonth === null) !== (birthdayDay === null)) {
    throw new Error('Member birthday month and day must be provided together')
  }
  const birthdaySource =
    birthdayMonth === null
      ? null
      : enumValue(
          after.birthdaySource,
          ['customer', 'manager_correction', 'legacy'] as const,
          'member.birthdaySource'
        )
  const ageGate =
    after.ageGate === undefined
      ? 'confirmed_at_least_14'
      : enumValue(
          after.ageGate,
          [
            'confirmed_at_least_14',
            'under_14_verified',
            'recharge_disabled'
          ] as const,
          'member.ageGate'
        )
  const source = enumValue(
    after.source,
    ['desktop', 'miniapp', 'legacy'] as const,
    'member.source'
  )
  const updatedAt = timestamp(after.updatedAt, 'member.updatedAt')
  database
    .prepare(
      `INSERT INTO member
       (id, tenant_id, store_id, member_number, phone, nickname, status,
        birthday_month, birthday_day, birthday_source, birthday_locked,
        confirmed_at_least_14, age_gate_status, note, source, created_at,
        updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         member_number = excluded.member_number,
         phone = excluded.phone,
         nickname = excluded.nickname,
         status = excluded.status,
         birthday_month = excluded.birthday_month,
         birthday_day = excluded.birthday_day,
         birthday_source = excluded.birthday_source,
         birthday_locked = excluded.birthday_locked,
         confirmed_at_least_14 = excluded.confirmed_at_least_14,
         age_gate_status = excluded.age_gate_status,
         note = excluded.note,
         source = excluded.source,
         updated_at = excluded.updated_at
       WHERE member.tenant_id = excluded.tenant_id
         AND member.store_id = excluded.store_id`
    )
    .run(
      event.aggregate_id,
      context.tenantId,
      context.storeId,
      text(after.memberNumber, 'member.memberNumber'),
      text(after.phone, 'member.phone'),
      text(after.nickname, 'member.nickname'),
      enumValue(
        after.status,
        ['active', 'disabled'] as const,
        'member.status'
      ),
      birthdayMonth,
      birthdayDay,
      birthdaySource,
      birthdayMonth === null ? 0 : 1,
      ageGate === 'confirmed_at_least_14' ? 1 : 0,
      ageGate,
      nullableText(after.note, 'member.note'),
      source,
      timestamp(after.createdAt, 'member.createdAt'),
      updatedAt
    )
  if (memberEnabledTierReset) {
    database
      .prepare(
        `UPDATE membership_grant
         SET revoked_by = 'cloud-sync', revoked_at = ?,
             revoke_reason = '云端会员恢复时重置为普通会员'
         WHERE tenant_id = ? AND member_id = ? AND revoked_at IS NULL`
      )
      .run(updatedAt, context.tenantId, event.aggregate_id)
  }
  reconcileProjectedMemberTier(database, context, {
    memberId: event.aggregate_id,
    sourceStoreId: context.storeId,
    tier,
    source,
    occurredAt: updatedAt
  })
}

function applyWechatRecharge(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  if (event.event_type !== 'wallet.wechat_recharged') {
    throw new Error('Unsupported inbound wallet recharge event')
  }
  const rechargeId = text(after.rechargeId, 'walletRecharge.rechargeId')
  if (rechargeId !== event.aggregate_id) {
    throw new Error('Wallet recharge id does not match the event envelope')
  }
  const memberId = text(after.memberId, 'walletRecharge.memberId')
  const principalFen = integer(
    after.principalFen,
    'walletRecharge.principalFen',
    1
  )
  const giftFen = integer(after.giftFen, 'walletRecharge.giftFen')
  const occurredAt = timestamp(
    after.occurredAt,
    'walletRecharge.occurredAt'
  )
  const member = database
    .prepare(
      `SELECT id FROM member
       WHERE tenant_id = ? AND store_id = ? AND id = ? AND status = 'active'`
    )
    .get(context.tenantId, context.storeId, memberId)
  if (!member) {
    throw new Error('Wallet recharge member has not reached the PC')
  }
  const existing = database
    .prepare(
      `SELECT principal_fen, gift_fen, payment_method
       FROM wallet_recharge
       WHERE tenant_id = ? AND id = ?`
    )
    .get(context.tenantId, rechargeId) as
    | {
        principal_fen: number
        gift_fen: number
        payment_method: string
      }
    | undefined
  if (existing) {
    if (
      existing.principal_fen !== principalFen ||
      existing.gift_fen !== giftFen ||
      existing.payment_method !== 'wechat'
    ) {
      throw new Error('Wallet recharge id was reused with different data')
    }
    return
  }

  const wallet = database
    .prepare(
      `SELECT id, status, principal_balance_fen, gift_balance_fen
       FROM wallet_account
       WHERE tenant_id = ? AND member_id = ?`
    )
    .get(context.tenantId, memberId) as
    | {
        id: string
        status: 'active' | 'frozen'
        principal_balance_fen: number
        gift_balance_fen: number
      }
    | undefined
  const walletId = wallet?.id ?? randomUUID()
  if (!wallet) {
    database
      .prepare(
        `INSERT INTO wallet_account
         (id, tenant_id, store_id, member_id, status, principal_balance_fen,
          gift_balance_fen, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, 0, ?, ?)`
      )
      .run(
        walletId,
        context.tenantId,
        context.storeId,
        memberId,
        occurredAt,
        occurredAt
      )
  }
  const principalBefore = wallet?.principal_balance_fen ?? 0
  const giftBefore = wallet?.gift_balance_fen ?? 0
  const principalAfter = principalBefore + principalFen
  const giftAfter = giftBefore + giftFen
  if (
    !Number.isSafeInteger(principalAfter) ||
    !Number.isSafeInteger(giftAfter)
  ) {
    throw new Error('Wallet recharge exceeds the safe integer range')
  }
  const requestId = `cloud:${event.event_id}`
  database
    .prepare(
      `INSERT INTO wallet_recharge
       (id, tenant_id, store_id, wallet_account_id, member_id, payment_method,
        principal_fen, gift_fen, status, gift_rule_snapshot_json, request_id,
        actor_id, device_id, reason, occurred_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'wechat', ?, ?, 'completed', ?, ?,
               'cloud-payment', ?, '小程序微信充值', ?, ?)`
    )
    .run(
      rechargeId,
      context.tenantId,
      context.storeId,
      walletId,
      memberId,
      principalFen,
      giftFen,
      JSON.stringify(after.giftRuleSnapshot ?? null),
      requestId,
      context.deviceId,
      occurredAt,
      occurredAt
    )
  database
    .prepare(
      `INSERT INTO wallet_lot
       (id, tenant_id, store_id, wallet_account_id, member_id, source_type,
        source_id, original_principal_fen, original_gift_fen,
        remaining_principal_fen, remaining_gift_fen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'recharge', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      walletId,
      memberId,
      rechargeId,
      principalFen,
      giftFen,
      principalFen,
      giftFen,
      occurredAt,
      occurredAt
    )
  database
    .prepare(
      `INSERT INTO wallet_ledger
       (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
        principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
        gift_balance_after_fen, source_id, related_ledger_id, request_id,
        actor_id, device_id, reason, metadata_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'wechat_recharge', ?, ?, ?, ?, ?, NULL, ?,
               'cloud-payment', ?, '小程序微信充值', ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      walletId,
      memberId,
      principalFen,
      giftFen,
      principalAfter,
      giftAfter,
      rechargeId,
      requestId,
      context.deviceId,
      JSON.stringify({
        paymentOrderId: after.paymentOrderId ?? rechargeId,
        providerTransactionId: after.providerTransactionId ?? null,
        giftRuleSnapshot: after.giftRuleSnapshot ?? null
      }),
      occurredAt
    )
  database
    .prepare(
      `UPDATE wallet_account
       SET principal_balance_fen = ?, gift_balance_fen = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(principalAfter, giftAfter, occurredAt, walletId)

  if (principalFen >= 50_000) {
    const grantId =
      typeof after.membershipGrantId === 'string' &&
      after.membershipGrantId.trim()
        ? after.membershipGrantId.trim()
        : randomUUID()
    database
      .prepare(
        `INSERT INTO membership_grant
         (id, tenant_id, store_id, member_id, source_type, source_id,
          granted_tier, reason, granted_by, granted_at)
         VALUES (?, ?, ?, ?, 'recharge', ?, 'advanced',
                 '单笔充值达到高级会员门槛', 'cloud-payment', ?)`
      )
      .run(
        grantId,
        context.tenantId,
        context.storeId,
        memberId,
        rechargeId,
        occurredAt
      )
  }
}

function applyEvent(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  after: Record<string, unknown>
): void {
  if (event.aggregate_type === 'store') {
    applyStore(database, context, event, after)
  } else if (event.aggregate_type === 'employee') {
    applyEmployee(database, context, event, after)
  } else if (event.aggregate_type === 'employee_pc_credential') {
    applyEmployeePcCredential(database, context, event, after)
  } else if (event.aggregate_type === 'employee_mobile_access') {
    applyEmployeeMobileAccess(database, context, event, after)
  } else if (event.aggregate_type === 'announcement') {
    applyAnnouncement(database, context, event, after)
  } else if (event.aggregate_type === 'activity') {
    applyActivity(database, context, event, after)
  } else if (event.aggregate_type === 'catalog') {
    applyCatalog(database, context, event, after)
  } else if (event.aggregate_type === 'member') {
    applyMember(database, context, event, after)
  } else if (event.aggregate_type === 'wallet_recharge') {
    applyWechatRecharge(database, context, event, after)
  } else if (event.aggregate_type === 'business_template') {
    const templateType = typeof after.template_type === 'string'
      ? after.template_type
      : null
    if (templateType) {
      database.prepare(
        `INSERT INTO merchant_business_template
         (id, tenant_id, template_type, name, payload_json, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           template_type = excluded.template_type,
           name = excluded.name,
           payload_json = excluded.payload_json,
           active = excluded.active,
           updated_at = excluded.updated_at
         WHERE merchant_business_template.tenant_id = excluded.tenant_id`
      ).run(
        event.aggregate_id,
        context.tenantId,
        templateType,
        String(after.name),
        JSON.stringify(after.payload_json ?? {}),
        after.active === true ? 1 : 0,
        typeof after.created_at === 'string' ? after.created_at : event.occurred_at,
        typeof after.updated_at === 'string' ? after.updated_at : event.occurred_at
      )
    }
    if (typeof after.override_id === 'string') {
      database.prepare(
        `INSERT INTO store_business_template_override
         (id, tenant_id, store_id, template_id, payload_json, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, store_id, template_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           active = excluded.active,
           updated_at = excluded.updated_at`
      ).run(
        after.override_id,
        context.tenantId,
        context.storeId,
        event.aggregate_id,
        JSON.stringify(after.override_payload_json ?? {}),
        after.override_active === true ? 1 : 0,
        typeof after.override_created_at === 'string'
          ? after.override_created_at
          : event.occurred_at,
        typeof after.override_updated_at === 'string'
          ? after.override_updated_at
          : event.occurred_at
      )
    }
  } else {
    applyBoardGame(database, context, event, after)
  }
}

function markConflict(
  database: DatabaseSync,
  context: StoreContext,
  event: InboundEventRow,
  reason: string
): void {
  const timestampValue = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE sync_inbound_event
         SET apply_status = 'conflict', error_message = ?
         WHERE sequence = ? AND apply_status = 'pending'`
      )
      .run(reason.slice(0, 1000), event.sequence)
    appendInboundAudit(
      database,
      context,
      event,
      'sync.inbound.conflict',
      reason,
      currentSnapshot(database, event),
      null,
      timestampValue
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function applyPendingInboundEvents(
  database: DatabaseSync,
  context: StoreContext,
  limit = 50
): InboundApplyBatchResult {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError('Inbound apply limit must be between 1 and 200')
  }
  const events = database
    .prepare(
      `SELECT sequence, event_id, aggregate_type, aggregate_id, event_type,
              payload_json, occurred_at
       FROM sync_inbound_event
       WHERE tenant_id = ? AND store_id = ? AND apply_status = 'pending'
         AND aggregate_type IN (
           'activity', 'announcement', 'board_game', 'catalog',
           'employee', 'employee_pc_credential', 'employee_mobile_access',
           'member', 'store', 'wallet_recharge'
         )
       ORDER BY length(sequence), sequence
       LIMIT ?`
    )
    .all(context.tenantId, context.storeId, limit) as InboundEventRow[]
  let applied = 0
  let conflicts = 0
  let skippedSuperseded = 0

  for (const event of events) {
    if (hasLaterLocalOriginEvent(database, context, event)) {
      skipSupersededEvent(database, context, event)
      skippedSuperseded += 1
      continue
    }
    if (hasPendingLocalChange(database, context, event)) {
      markConflict(
        database,
        context,
        event,
        'Local pending changes exist for the same aggregate'
      )
      conflicts += 1
      continue
    }

    try {
      const timestampValue = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        const before = currentSnapshot(database, event)
        const after = afterPayload(event)
        applyEvent(database, context, event, after)
        database
          .prepare(
            `UPDATE sync_inbound_event
             SET apply_status = 'applied', applied_at = ?,
                 error_message = NULL
             WHERE sequence = ? AND apply_status = 'pending'`
          )
          .run(timestampValue, event.sequence)
        appendInboundAudit(
          database,
          context,
          event,
          'sync.inbound.applied',
          `Applied cloud event ${event.event_id}`,
          before,
          after,
          timestampValue
        )
        database.exec('COMMIT')
        applied += 1
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    } catch (error) {
      markConflict(
        database,
        context,
        event,
        error instanceof Error ? error.message : String(error)
      )
      conflicts += 1
    }
  }
  return { applied, conflicts, skippedSuperseded }
}

export function autoResolveNonCriticalInboundConflicts(
  database: DatabaseSync,
  context: StoreContext
): { applied: number; skippedSuperseded: number } {
  const events = database.prepare(
    `SELECT sequence, event_id, aggregate_type, aggregate_id, event_type,
            payload_json, occurred_at
     FROM sync_inbound_event
     WHERE tenant_id = ? AND store_id = ? AND apply_status = 'conflict'
       AND error_message = 'Local pending changes exist for the same aggregate'
       AND aggregate_type IN ('announcement', 'board_game')
     ORDER BY length(sequence), sequence`
  ).all(context.tenantId, context.storeId) as InboundEventRow[]
  let applied = 0
  let skippedSuperseded = 0

  for (const event of events) {
    if (hasPendingLocalChange(database, context, event)) continue
    const timestampValue = new Date().toISOString()
    if (hasLaterLocalOriginEvent(database, context, event)) {
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare(
          `UPDATE sync_inbound_event
           SET apply_status = 'skipped_origin', applied_at = ?,
               error_message = 'auto_resolved_superseded_by_later_local_origin'
           WHERE sequence = ? AND apply_status = 'conflict'`
        ).run(timestampValue, event.sequence)
        appendInboundAudit(
          database,
          context,
          event,
          'sync.inbound.applied',
          'Automatically skipped cloud event superseded by a later confirmed local event',
          currentSnapshot(database, event),
          null,
          timestampValue
        )
        database.exec('COMMIT')
        skippedSuperseded += 1
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      continue
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      const before = currentSnapshot(database, event)
      const after = afterPayload(event)
      applyEvent(database, context, event, after)
      database.prepare(
        `UPDATE sync_inbound_event
         SET apply_status = 'applied', applied_at = ?,
             error_message = 'auto_resolved_apply_cloud_noncritical'
         WHERE sequence = ? AND apply_status = 'conflict'`
      ).run(timestampValue, event.sequence)
      appendInboundAudit(
        database,
        context,
        event,
        'sync.inbound.applied',
        'Automatically applied cloud version for non-critical content conflict',
        before,
        after,
        timestampValue
      )
      database.exec('COMMIT')
      applied += 1
    } catch (error) {
      database.exec('ROLLBACK')
      database.prepare(
        `UPDATE sync_inbound_event SET error_message = ?
         WHERE sequence = ? AND apply_status = 'conflict'`
      ).run(
        `Automatic cloud apply failed: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 1000),
        event.sequence
      )
    }
  }
  return { applied, skippedSuperseded }
}

export function resolveInboundSyncConflict(
  database: DatabaseSync,
  context: InboundResolutionContext,
  request: ResolveInboundSyncConflictRequest
): void {
  if (!/^(0|[1-9]\d*)$/.test(request.sequence)) {
    throw new Error('Inbound conflict sequence is invalid')
  }
  if (
    request.resolution !== 'keep_local' &&
    request.resolution !== 'apply_cloud'
  ) {
    throw new Error('Inbound conflict resolution is invalid')
  }
  const reason = request.reason.trim()
  if (reason.length < 2 || reason.length > 200) {
    throw new Error('Inbound conflict reason must contain 2-200 characters')
  }
  const event = database
    .prepare(
      `SELECT sequence, event_id, aggregate_type, aggregate_id, event_type,
              payload_json, occurred_at
       FROM sync_inbound_event
       WHERE tenant_id = ? AND store_id = ? AND sequence = ?
         AND apply_status = 'conflict'
         AND aggregate_type IN (
           'activity', 'announcement', 'board_game', 'catalog',
           'employee', 'employee_pc_credential', 'employee_mobile_access',
           'member', 'store'
         )`
    )
    .get(
      context.tenantId,
      context.storeId,
      request.sequence
    ) as InboundEventRow | undefined
  if (!event) throw new Error('Inbound sync conflict was not found')

  if (request.resolution === 'keep_local') {
    const timestampValue = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `UPDATE sync_inbound_event
           SET apply_status = 'skipped_origin', applied_at = ?,
               error_message = ?
           WHERE sequence = ? AND apply_status = 'conflict'`
        )
        .run(
          timestampValue,
          `resolved_keep_local: ${reason}`.slice(0, 1000),
          event.sequence
        )
      appendInboundAudit(
        database,
        context,
        event,
        'sync.inbound.applied',
        `Manager kept local data: ${reason}`,
        currentSnapshot(database, event),
        null,
        timestampValue,
        context.actor.id
      )
      database.exec('COMMIT')
      return
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  if (hasPendingLocalChange(database, context, event)) {
    throw new Error('Local changes are still pending; sync them first')
  }
  if (hasLaterLocalOriginEvent(database, context, event)) {
    throw new Error(
      'A later local event is authoritative; choose keep local'
    )
  }

  const timestampValue = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    const before = currentSnapshot(database, event)
    const after = afterPayload(event)
    applyEvent(database, context, event, after)
    database
      .prepare(
        `UPDATE sync_inbound_event
         SET apply_status = 'applied', applied_at = ?,
             error_message = ?
         WHERE sequence = ? AND apply_status = 'conflict'`
      )
      .run(
        timestampValue,
        `resolved_apply_cloud: ${reason}`.slice(0, 1000),
        event.sequence
      )
    appendInboundAudit(
      database,
      context,
      event,
      'sync.inbound.applied',
      `Manager applied cloud data: ${reason}`,
      before,
      after,
      timestampValue,
      context.actor.id
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
