import { canMergeFilledField, mergeFilledField } from './filled-field-merge'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { processFinancialSyncOperation } from './financial-sync-operation-handler'

export type ReceivedOperation = {
  operation_id: string
  device_id: string
  device_seq: string | number
  tenant_id: string
  store_id: string
  actor_id: string | null
  operation_type: string
  aggregate_id: string
  base_version?: string | number | null
  protocol_version?: string | number
  changed_fields?: unknown
  occurred_at: Date
  payload_json: Record<string, unknown>
}

type OperationResult = 'confirmed' | 'conflict'

type EmployeeProjection = {
  username: string
  displayName: string
  role: 'manager' | 'staff'
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

type MemberProjection = {
  memberNumber: string
  phone: string
  nickname: string
  tier: 'ordinary' | 'advanced'
  status: 'active' | 'disabled'
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdaySource: string | null
  note: string | null
  source: string
  ageGate:
    | 'confirmed_at_least_14'
    | 'under_14_verified'
    | 'recharge_disabled'
  createdAt: string
  updatedAt: string
}

type CatalogProjection = {
  code: string
  name: string
  itemType: 'admission' | 'service' | 'product' | 'activity' | 'custom'
  regularPriceFen: number
  advancedPriceFen: number
  status: 'active' | 'disabled'
  availability: 'available' | 'sold_out'
  note: string | null
  createdAt: string
  updatedAt: string
}

type ActivityProjection = {
  title: string
  summary: string
  content: string
  activityType: 'recharge' | 'general'
  status: 'draft' | 'published' | 'disabled'
  startsAt: string
  endsAt: string
  pinned: boolean
  regularPriceFen: number | null
  advancedPriceFen: number | null
  allowStoredValue: boolean
  allowWechat: boolean
  rechargeTiers: Array<{
    id: string
    principalFen: number
    giftFen: number
  }>
  createdAt: string
  updatedAt: string
}

type AnnouncementProjection = {
  title: string
  content: string
  status: 'draft' | 'published' | 'disabled'
  pinned: boolean
  visibleFrom: string
  visibleUntil: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

type BoardGameProjection = {
  baseGameId: string | null
  name: string
  introduction: string
  categories: string[]
  minPlayers: number
  maxPlayers: number
  minMinutes: number | null
  maxMinutes: number | null
  difficulty: 'light' | 'medium' | 'heavy'
  complexityRating: number | null
  quantity: number
  recordStatus: 'active' | 'disabled'
  available: boolean
  customerConsigned: boolean
  missingPieces: boolean
  private: boolean
  recommended: boolean
  imageUrl: string | null
  bggId: number | null
  metadataSource: 'bgg' | null
  metadataImportedAt: string | null
  customerNote: string | null
  internalNote: string | null
  consignorNickname: string | null
  missingParts: Array<{ id: string; name: string; quantity: number }>
  createdAt: string
  updatedAt: string
}

type StoreProfileProjection = {
  name: string
  address: string | null
  contactPhone: string | null
  businessOpenMinute: number
  businessCloseMinute: number
  statusOverride: 'automatic' | 'open' | 'closed'
  customStatusText: string | null
  updatedAt: string
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
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${name} must be text or null`)
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

function integer(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`)
  }
  return Number(value)
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`)
  return value
}

function nullableInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null || value === undefined) return null
  const result = integer(value, name, minimum)
  if (result > maximum) throw new Error(`${name} exceeds ${maximum}`)
  return result
}

function nullableDecimal(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  decimalPlaces: number
): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number or null`)
  }
  const factor = 10 ** decimalPlaces
  const rounded = Math.round(value * factor) / factor
  if (
    value < minimum ||
    value > maximum ||
    Math.abs(value - rounded) > Number.EPSILON * factor
  ) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum} with at most ${decimalPlaces} decimal place`
    )
  }
  return rounded
}

function timestamp(value: unknown, fallback: Date): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fallback.toISOString()
  }
  return new Date(value).toISOString()
}

function afterSnapshot(operation: ReceivedOperation): Record<string, unknown> {
  return record(operation.payload_json.after, 'payload.after')
}

export function classifySyncOperation(
  operationType: string
):
  | 'store'
  | 'employee'
  | 'member'
  | 'catalog'
  | 'activity'
  | 'announcement'
  | 'board_game'
  | 'financial'
  | 'audit'
  | 'unsupported' {
  if (operationType.startsWith('store.')) return 'store'
  if (operationType.startsWith('employee.')) return 'employee'
  if (operationType.startsWith('member.')) return 'member'
  if (operationType.startsWith('catalog.')) return 'catalog'
  if (operationType.startsWith('activity.')) return 'activity'
  if (operationType.startsWith('announcement.')) return 'announcement'
  if (operationType.startsWith('board_game.')) return 'board_game'
  if (
    operationType.startsWith('system.') ||
    operationType.startsWith('report.') ||
    operationType === 'refund.evidence_exported' ||
    operationType === 'legacy.import.completed'
  ) {
    return 'audit'
  }
  if (
    operationType.startsWith('wallet.') ||
    operationType.startsWith('monthly_card.') ||
    operationType === 'order.completed' ||
    operationType.startsWith('refund.') ||
    operationType.startsWith('financial_refund.') ||
    operationType === 'financial_command.reviewed'
  ) {
    return 'financial'
  }
  return 'unsupported'
}

export function parseStoreProfileProjection(
  operation: ReceivedOperation
): StoreProfileProjection {
  const after = afterSnapshot(operation)
  const businessOpenMinute = integer(
    after.businessOpenMinute,
    'store.businessOpenMinute'
  )
  const businessCloseMinute = integer(
    after.businessCloseMinute,
    'store.businessCloseMinute'
  )
  if (businessOpenMinute > 1439 || businessCloseMinute > 1439) {
    throw new Error('store business minutes must not exceed 1439')
  }
  if (businessOpenMinute === businessCloseMinute) {
    throw new Error('store opening and closing time must be different')
  }
  return {
    name: text(after.name, 'store.name'),
    address: nullableText(after.address, 'store.address'),
    contactPhone: nullableText(after.contactPhone, 'store.contactPhone'),
    businessOpenMinute,
    businessCloseMinute,
    statusOverride: enumValue(
      after.statusOverride,
      ['automatic', 'open', 'closed'] as const,
      'store.statusOverride'
    ),
    customStatusText: nullableText(
      after.customStatusText,
      'store.customStatusText'
    ),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

export function parseEmployeeProjection(
  operation: ReceivedOperation
): EmployeeProjection {
  const after = afterSnapshot(operation)
  return {
    username: text(after.username, 'employee.username').toLowerCase(),
    displayName: text(after.displayName, 'employee.displayName'),
    role: enumValue(after.role, ['manager', 'staff'] as const, 'employee.role'),
    status: enumValue(
      after.status,
      ['active', 'disabled'] as const,
      'employee.status'
    ),
    createdAt: timestamp(after.createdAt, operation.occurred_at),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

export function parseMemberProjection(
  operation: ReceivedOperation
): MemberProjection {
  const after = afterSnapshot(operation)
  return {
    memberNumber: text(after.memberNumber, 'member.memberNumber'),
    phone: text(after.phone, 'member.phone'),
    nickname: text(after.nickname, 'member.nickname'),
    tier: enumValue(
      after.tier,
      ['ordinary', 'advanced'] as const,
      'member.tier'
    ),
    status: enumValue(
      after.status,
      ['active', 'disabled'] as const,
      'member.status'
    ),
    birthdayMonth: nullableInteger(
      after.birthdayMonth,
      'member.birthdayMonth',
      1,
      12
    ),
    birthdayDay: nullableInteger(
      after.birthdayDay,
      'member.birthdayDay',
      1,
      31
    ),
    birthdaySource: nullableText(
      after.birthdaySource,
      'member.birthdaySource'
    ),
    note: nullableText(after.note, 'member.note'),
    source: text(after.source, 'member.source'),
    ageGate:
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
          ),
    createdAt: timestamp(after.createdAt, operation.occurred_at),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

export function parseCatalogProjection(
  operation: ReceivedOperation
): CatalogProjection {
  const after = afterSnapshot(operation)
  return {
    code: text(after.code, 'catalog.code'),
    name: text(after.name, 'catalog.name'),
    itemType: enumValue(
      after.itemType,
      ['admission', 'service', 'product', 'activity', 'custom'] as const,
      'catalog.itemType'
    ),
    regularPriceFen: integer(
      after.regularPriceFen,
      'catalog.regularPriceFen'
    ),
    advancedPriceFen: integer(
      after.advancedPriceFen,
      'catalog.advancedPriceFen'
    ),
    status: enumValue(
      after.status,
      ['active', 'disabled'] as const,
      'catalog.status'
    ),
    availability: enumValue(
      after.availability,
      ['available', 'sold_out'] as const,
      'catalog.availability'
    ),
    note: nullableText(after.note, 'catalog.note'),
    createdAt: timestamp(after.createdAt, operation.occurred_at),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

export function parseActivityProjection(
  operation: ReceivedOperation
): ActivityProjection {
  const after = afterSnapshot(operation)
  const startsAt = timestamp(after.startsAt, operation.occurred_at)
  const endsAt = timestamp(after.endsAt, operation.occurred_at)
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error('activity.endsAt must be later than activity.startsAt')
  }
  if (!Array.isArray(after.rechargeTiers)) {
    throw new Error('activity.rechargeTiers must be an array')
  }
  const rechargeTiers = after.rechargeTiers.map((value, index) => {
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
  const activityType = enumValue(
    after.activityType,
    ['recharge', 'general'] as const,
    'activity.activityType'
  )
  if (activityType === 'recharge' && rechargeTiers.length === 0) {
    throw new Error('recharge activity requires at least one tier')
  }
  return {
    title: text(after.title, 'activity.title'),
    summary: text(after.summary, 'activity.summary'),
    content: text(after.content, 'activity.content'),
    activityType,
    status: enumValue(
      after.status,
      ['draft', 'published', 'disabled'] as const,
      'activity.status'
    ),
    startsAt,
    endsAt,
    pinned: booleanValue(after.pinned, 'activity.pinned'),
    regularPriceFen: nullableInteger(
      after.regularPriceFen,
      'activity.regularPriceFen',
      0,
      Number.MAX_SAFE_INTEGER
    ),
    advancedPriceFen: nullableInteger(
      after.advancedPriceFen,
      'activity.advancedPriceFen',
      0,
      Number.MAX_SAFE_INTEGER
    ),
    allowStoredValue: booleanValue(
      after.allowStoredValue,
      'activity.allowStoredValue'
    ),
    allowWechat: booleanValue(after.allowWechat, 'activity.allowWechat'),
    rechargeTiers,
    createdAt: timestamp(after.createdAt, operation.occurred_at),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

export function parseAnnouncementProjection(
  operation: ReceivedOperation
): AnnouncementProjection {
  const after = afterSnapshot(operation)
  const visibleFrom = timestamp(after.visibleFrom, operation.occurred_at)
  const visibleUntil =
    after.visibleUntil === null || after.visibleUntil === undefined
      ? null
      : timestamp(after.visibleUntil, operation.occurred_at)
  if (
    visibleUntil !== null &&
    Date.parse(visibleUntil) <= Date.parse(visibleFrom)
  ) {
    throw new Error('announcement.visibleUntil must be later than visibleFrom')
  }
  return {
    title: text(after.title, 'announcement.title'),
    content: text(after.content, 'announcement.content'),
    status: enumValue(
      after.status,
      ['draft', 'published', 'disabled'] as const,
      'announcement.status'
    ),
    pinned: booleanValue(after.pinned, 'announcement.pinned'),
    visibleFrom,
    visibleUntil,
    publishedAt:
      after.publishedAt === null || after.publishedAt === undefined
        ? null
        : timestamp(after.publishedAt, operation.occurred_at),
    createdAt: timestamp(after.createdAt, operation.occurred_at),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

export function parseBoardGameProjection(
  operation: ReceivedOperation
): BoardGameProjection {
  const after = afterSnapshot(operation)
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
    throw new Error('boardGame.maxPlayers must not be smaller than minPlayers')
  }
  const minMinutes = nullableInteger(
    after.minMinutes,
    'boardGame.minMinutes',
    1,
    Number.MAX_SAFE_INTEGER
  )
  const maxMinutes = nullableInteger(
    after.maxMinutes,
    'boardGame.maxMinutes',
    1,
    Number.MAX_SAFE_INTEGER
  )
  const complexityRating = nullableDecimal(
    after.complexityRating,
    'boardGame.complexityRating',
    0,
    5,
    1
  )
  if (
    minMinutes !== null &&
    maxMinutes !== null &&
    maxMinutes < minMinutes
  ) {
    throw new Error('boardGame.maxMinutes must not be shorter than minMinutes')
  }
  return {
    baseGameId: nullableText(after.baseGameId, 'boardGame.baseGameId'),
    name: text(after.name, 'boardGame.name'),
    introduction: text(after.introduction, 'boardGame.introduction'),
    categories,
    minPlayers,
    maxPlayers,
    minMinutes,
    maxMinutes,
    difficulty: enumValue(
      after.difficulty,
      ['light', 'medium', 'heavy'] as const,
      'boardGame.difficulty'
    ),
    complexityRating,
    quantity: integer(after.quantity, 'boardGame.quantity'),
    recordStatus: enumValue(
      after.recordStatus,
      ['active', 'disabled'] as const,
      'boardGame.recordStatus'
    ),
    available: booleanValue(after.available, 'boardGame.available'),
    customerConsigned: booleanValue(
      after.customerConsigned,
      'boardGame.customerConsigned'
    ),
    missingPieces: booleanValue(
      after.missingPieces,
      'boardGame.missingPieces'
    ),
    private: booleanValue(after.private, 'boardGame.private'),
    recommended: booleanValue(after.recommended, 'boardGame.recommended'),
    imageUrl: nullableText(after.imageUrl, 'boardGame.imageUrl'),
    bggId: nullableInteger(
      after.bggId,
      'boardGame.bggId',
      1,
      Number.MAX_SAFE_INTEGER
    ),
    metadataSource:
      after.metadataSource === null || after.metadataSource === undefined
        ? null
        : enumValue(
            after.metadataSource,
            ['bgg'] as const,
            'boardGame.metadataSource'
          ),
    metadataImportedAt:
      after.metadataImportedAt === null ||
      after.metadataImportedAt === undefined
        ? null
        : timestamp(after.metadataImportedAt, operation.occurred_at),
    customerNote: nullableText(after.customerNote, 'boardGame.customerNote'),
    internalNote: nullableText(after.internalNote, 'boardGame.internalNote'),
    consignorNickname: nullableText(
      after.consignorNickname,
      'boardGame.consignorNickname'
    ),
    missingParts,
    createdAt: timestamp(after.createdAt, operation.occurred_at),
    updatedAt: timestamp(after.updatedAt, operation.occurred_at)
  }
}

async function appendEvent(
  client: PoolClient,
  operation: ReceivedOperation,
  aggregateType: string
): Promise<number> {
  const event = await client.query<{ sequence: string | number }>(
    `INSERT INTO cloud_event
     (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
      event_type, payload_json, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING sequence`,
    [
      randomUUID(),
      operation.tenant_id,
      operation.store_id,
      aggregateType,
      operation.aggregate_id,
      operation.operation_type,
      JSON.stringify(operation.payload_json),
      operation.occurred_at
    ]
  )
  const version = Number(event.rows[0]?.sequence)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('cloud event did not return a valid sequence')
  }
  return version
}

async function appendSanitizedEvent(
  client: PoolClient,
  operation: ReceivedOperation,
  aggregateType: string,
  payload: unknown
): Promise<number> {
  const event = await client.query<{ sequence: string | number }>(
    `INSERT INTO cloud_event
     (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
      event_type, payload_json, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING sequence`,
    [
      randomUUID(),
      operation.tenant_id,
      operation.store_id,
      aggregateType,
      operation.aggregate_id,
      operation.operation_type,
      JSON.stringify(payload),
      operation.occurred_at
    ]
  )
  const version = Number(event.rows[0]?.sequence)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('cloud event did not return a valid sequence')
  }
  return version
}

async function completeOperation(
  client: PoolClient,
  operation: ReceivedOperation,
  aggregateType: string,
  serverVersion: number
): Promise<void> {
  await client.query(
    `INSERT INTO cloud_audit_log
     (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
      aggregate_id, metadata_json, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      randomUUID(),
      operation.tenant_id,
      operation.store_id,
      operation.device_id,
      operation.actor_id,
      operation.operation_type,
      aggregateType,
      operation.aggregate_id,
      JSON.stringify({
        operationId: operation.operation_id,
        deviceSeq: Number(operation.device_seq),
        serverVersion
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
}

export async function markSyncConflict(
  client: PoolClient,
  operation: ReceivedOperation,
  conflictType: string,
  reason: string,
  serverPayload: unknown = null
): Promise<OperationResult> {
  await client.query(
    `INSERT INTO sync_conflict
     (id, operation_id, tenant_id, store_id, device_id, conflict_type,
      local_payload_json, server_payload_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'pending')
     ON CONFLICT (operation_id) DO UPDATE SET
       conflict_type = EXCLUDED.conflict_type,
       server_payload_json = EXCLUDED.server_payload_json,
       status = 'pending',
       resolution_json = NULL,
       resolved_by = NULL,
       resolved_at = NULL`,
    [
      randomUUID(),
      operation.operation_id,
      operation.tenant_id,
      operation.store_id,
      operation.device_id,
      conflictType,
      JSON.stringify(operation.payload_json),
      JSON.stringify({ reason, serverPayload })
    ]
  )
  await client.query(
    `UPDATE sync_operation SET status = 'conflict'
     WHERE operation_id = $1`,
    [operation.operation_id]
  )
  const conflictEvent: ReceivedOperation = {
    ...operation,
    operation_type: 'sync.conflict.created',
    payload_json: {
      operationId: operation.operation_id,
      originalOperationType: operation.operation_type,
      conflictType,
      reason,
      serverPayload
    }
  }
  const version = await appendEvent(client, conflictEvent, 'sync_conflict')
  await completeOperationAuditOnly(
    client,
    conflictEvent,
    'sync_conflict',
    version
  )
  await client.query(
    `UPDATE device
     SET last_device_seq = GREATEST(last_device_seq, $2),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [operation.device_id, Number(operation.device_seq)]
  )
  return 'conflict'
}

async function completeOperationAuditOnly(
  client: PoolClient,
  operation: ReceivedOperation,
  aggregateType: string,
  serverVersion: number
): Promise<void> {
  await client.query(
    `INSERT INTO cloud_audit_log
     (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
      aggregate_id, metadata_json, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      randomUUID(),
      operation.tenant_id,
      operation.store_id,
      operation.device_id,
      operation.actor_id,
      operation.operation_type,
      aggregateType,
      operation.aggregate_id,
      JSON.stringify({
        operationId: operation.operation_id,
        deviceSeq: Number(operation.device_seq),
        serverVersion
      }),
      operation.occurred_at
    ]
  )
}

async function confirmAuditOnly(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  const version = await appendEvent(client, operation, 'system_operation')
  await completeOperation(
    client,
    operation,
    'system_operation',
    version
  )
  return 'confirmed'
}

async function confirmStoreProfile(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  if (
    operation.operation_type !== 'store.profile.updated' ||
    operation.aggregate_id !== operation.store_id
  ) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'store profile operation does not match its envelope'
    )
  }
  let projection: StoreProfileProjection
  try {
    projection = parseStoreProfileProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid store profile payload'
    )
  }
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM store
     WHERE id = $1 AND tenant_id = $2 AND status = 'active'
     LIMIT 1`,
    [operation.store_id, operation.tenant_id]
  )
  if (!existing.rows[0]) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'active store registration is missing'
    )
  }
  const version = await appendEvent(client, operation, 'store')
  await client.query(
    `UPDATE store
     SET name = $3, address = $4, contact_phone = $5,
         business_open_minute = $6, business_close_minute = $7,
         status_override = $8, custom_status_text = $9,
         updated_at = $10
     WHERE id = $1 AND tenant_id = $2`,
    [
      operation.store_id,
      operation.tenant_id,
      projection.name,
      projection.address,
      projection.contactPhone,
      projection.businessOpenMinute,
      projection.businessCloseMinute,
      projection.statusOverride,
      projection.customStatusText,
      projection.updatedAt
    ]
  )
  await completeOperation(client, operation, 'store', version)
  return 'confirmed'
}

async function aggregateOwnershipConflict(
  client: PoolClient,
  operation: ReceivedOperation,
  tableName:
    | 'cloud_employee'
    | 'cloud_member'
    | 'cloud_catalog_item'
    | 'cloud_activity_campaign'
    | 'cloud_announcement'
    | 'cloud_board_game',
  conflictType: string
): Promise<OperationResult | null> {
  const existing = await client.query<{
    tenant_id: string
    store_id: string
  }>(
    `SELECT tenant_id, store_id
     FROM ${tableName}
     WHERE id = $1
     LIMIT 1`,
    [operation.aggregate_id]
  )
  const owner = existing.rows[0]
  if (
    owner &&
    (owner.tenant_id !== operation.tenant_id ||
      (tableName !== 'cloud_member' &&
        owner.store_id !== operation.store_id))
  ) {
    return markSyncConflict(
      client,
      operation,
      conflictType,
      'aggregate id belongs to another tenant or store',
      {
        tenantId: owner.tenant_id,
        storeId: owner.store_id
      }
    )
  }
  return null
}

async function confirmEmployeeMobileAccess(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let employeeId: string
  let enabled: boolean
  let passwordHash: string | null
  let updatedAt: string
  try {
    const after = afterSnapshot(operation)
    employeeId = text(
      after.employeeId,
      'employeeMobileAccess.employeeId'
    )
    if (employeeId !== operation.aggregate_id) {
      throw new Error('employee mobile access aggregate does not match')
    }
    enabled = booleanValue(
      after.enabled,
      'employeeMobileAccess.enabled'
    )
    passwordHash = nullableText(
      after.passwordHash,
      'employeeMobileAccess.passwordHash'
    )
    if (enabled && (!passwordHash || !passwordHash.startsWith('scrypt$'))) {
      throw new Error('enabled mobile access requires a scrypt password hash')
    }
    updatedAt = timestamp(after.updatedAt, operation.occurred_at)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error
        ? error.message
        : 'invalid employee mobile access payload'
    )
  }

  const employee = await client.query<{ status: string }>(
    `SELECT access.status
     FROM cloud_employee employee
     JOIN cloud_employee_store_access access
       ON access.employee_id = employee.id
      AND access.tenant_id = employee.tenant_id
     WHERE employee.id = $1 AND employee.tenant_id = $2
       AND access.store_id = $3
     LIMIT 1`,
    [employeeId, operation.tenant_id, operation.store_id]
  )
  if (!employee.rows[0]) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'employee must exist before mobile access can be configured'
    )
  }
  if (enabled && employee.rows[0].status !== 'active') {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'disabled employee cannot enable mobile access'
    )
  }

  await client.query(
    `INSERT INTO cloud_employee_mobile_credential
     (employee_id, tenant_id, store_id, enabled, password_hash, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (employee_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       password_hash = EXCLUDED.password_hash,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_employee_mobile_credential.tenant_id = EXCLUDED.tenant_id
       AND cloud_employee_mobile_credential.store_id = EXCLUDED.store_id`,
    [
      employeeId,
      operation.tenant_id,
      operation.store_id,
      enabled,
      enabled ? passwordHash : null,
      updatedAt
    ]
  )
  const version = await appendSanitizedEvent(
    client,
    operation,
    'employee_mobile_access',
    {
      action: enabled
        ? 'employee.mobile_access.enabled'
        : 'employee.mobile_access.disabled',
      aggregateId: employeeId,
      before: null,
      after: {
        employeeId,
        enabled,
        updatedAt
      },
      reason: 'mobile access state synchronized'
    }
  )
  await completeOperation(client, operation, 'employee', version)
  return 'confirmed'
}

async function confirmEmployee(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  if (operation.operation_type === 'employee.pc_credential.updated') {
    const after = afterSnapshot(operation)
    const employeeId = text(after.employeeId, 'employeePcCredential.employeeId')
    const passwordHash = text(
      after.passwordHash,
      'employeePcCredential.passwordHash'
    )
    if (employeeId !== operation.aggregate_id || !passwordHash.startsWith('scrypt$')) {
      return markSyncConflict(
        client,
        operation,
        'unknown',
        'desktop credential payload is invalid'
      )
    }
    const employee = await client.query<{ id: string }>(
      `SELECT employee.id::text
       FROM cloud_employee employee
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
       WHERE employee.id = $1 AND employee.tenant_id = $2
         AND access.store_id = $3
       FOR UPDATE`,
      [operation.aggregate_id, operation.tenant_id, operation.store_id]
    )
    if (!employee.rows[0]) {
      return markSyncConflict(
        client,
        operation,
        'unknown',
        'employee was not found for desktop credential'
      )
    }
    const previous = await client.query<{ credential_version: string }>(
      `SELECT credential_version
       FROM cloud_employee_pc_credential
       WHERE employee_id = $1 FOR UPDATE`,
      [operation.aggregate_id]
    )
    const credentialVersion = Number(previous.rows[0]?.credential_version ?? 0) + 1
    const updatedAt = timestamp(after.updatedAt, operation.occurred_at)
    await client.query(
      `INSERT INTO cloud_employee_pc_credential
       (employee_id, tenant_id, password_hash, credential_version, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         credential_version = EXCLUDED.credential_version,
         updated_at = EXCLUDED.updated_at
       WHERE cloud_employee_pc_credential.tenant_id = EXCLUDED.tenant_id`,
      [
        operation.aggregate_id,
        operation.tenant_id,
        passwordHash,
        credentialVersion,
        updatedAt
      ]
    )
    const version = await appendSanitizedEvent(
      client,
      operation,
      'employee_pc_credential',
      {
        action: 'employee.pc_credential.updated',
        aggregateId: operation.aggregate_id,
        before: null,
        after: {
          employeeId: operation.aggregate_id,
          credentialVersion,
          updatedAt
        },
        reason: 'desktop credential version changed'
      }
    )
    await completeOperation(
      client,
      operation,
      'employee_pc_credential',
      version
    )
    return 'confirmed'
  }
  if (operation.operation_type === 'employee.password.changed') {
    return confirmAuditOnly(client, operation)
  }
  if (operation.operation_type === 'employee.mobile_access.updated') {
    return confirmEmployeeMobileAccess(client, operation)
  }
  let projection: EmployeeProjection
  try {
    projection = parseEmployeeProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid employee payload'
    )
  }
  const existingIdentity = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id::text FROM cloud_employee WHERE id = $1 FOR UPDATE`,
    [operation.aggregate_id]
  )
  if (
    existingIdentity.rows[0] &&
    existingIdentity.rows[0].tenant_id !== operation.tenant_id
  ) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'employee belongs to another tenant'
    )
  }
  const duplicate = await client.query<{ id: string }>(
    `SELECT id FROM cloud_employee
     WHERE tenant_id = $1 AND username = $2 AND id <> $3
     LIMIT 1`,
    [operation.tenant_id, projection.username, operation.aggregate_id]
  )
  if (duplicate.rows[0]) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      'employee username already exists',
      { employeeId: duplicate.rows[0].id }
    )
  }
  const version = await appendEvent(client, operation, 'employee')
  await client.query(
    `INSERT INTO cloud_employee
     (id, tenant_id, store_id, username, display_name, role, status,
      server_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_employee.tenant_id = EXCLUDED.tenant_id`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.username,
      projection.displayName,
      projection.role,
      projection.status,
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  await client.query(
    `INSERT INTO cloud_employee_store_access
     (employee_id, tenant_id, store_id, role, status,
      authorization_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (employee_id, store_id) DO UPDATE SET
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       authorization_version = EXCLUDED.authorization_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_employee_store_access.tenant_id = EXCLUDED.tenant_id`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.role,
      projection.status,
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  if (projection.role === 'manager' && projection.status === 'active') {
    await client.query(
      `INSERT INTO tenant_administrator (tenant_id, employee_id)
       SELECT $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM tenant_administrator WHERE tenant_id = $1
       )
       ON CONFLICT DO NOTHING`,
      [operation.tenant_id, operation.aggregate_id]
    )
  }
  await completeOperation(client, operation, 'employee', version)
  return 'confirmed'
}

async function confirmMember(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let projection: MemberProjection
  try {
    projection = parseMemberProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid member payload'
    )
  }
  const ownershipConflict = await aggregateOwnershipConflict(
    client,
    operation,
    'cloud_member',
    'member_version_mismatch'
  )
  if (ownershipConflict) return ownershipConflict
  const duplicate = await client.query<{
    id: string
    phone: string
    member_number: string
  }>(
    `SELECT id, phone, member_number FROM cloud_member
     WHERE tenant_id = $1
       AND (phone = $2 OR member_number = $3)
       AND id <> $4
     LIMIT 1`,
    [
      operation.tenant_id,
      projection.phone,
      projection.memberNumber,
      operation.aggregate_id
    ]
  )
  const duplicateMember = duplicate.rows[0]
  if (duplicateMember) {
    const phoneConflict = duplicateMember.phone === projection.phone
    return markSyncConflict(
      client,
      operation,
      phoneConflict ? 'member_phone_duplicate' : 'member_version_mismatch',
      phoneConflict
        ? 'member phone already belongs to another cloud member'
        : 'member number already belongs to another cloud member',
      {
        memberId: duplicateMember.id,
        phone: duplicateMember.phone,
        memberNumber: duplicateMember.member_number
      }
    )
  }
  const version = await appendEvent(client, operation, 'member')
  await client.query(
    `INSERT INTO cloud_member
     (id, tenant_id, store_id, member_number, phone, nickname, tier, status,
      birthday_month, birthday_day, birthday_source, note, source,
      age_gate_status, server_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17)
     ON CONFLICT (id) DO UPDATE SET
       member_number = EXCLUDED.member_number,
       phone = EXCLUDED.phone,
       nickname = EXCLUDED.nickname,
       tier = EXCLUDED.tier,
       status = EXCLUDED.status,
       birthday_month = EXCLUDED.birthday_month,
       birthday_day = EXCLUDED.birthday_day,
       birthday_source = EXCLUDED.birthday_source,
       note = EXCLUDED.note,
       source = EXCLUDED.source,
       age_gate_status = EXCLUDED.age_gate_status,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_member.tenant_id = EXCLUDED.tenant_id
    `,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.memberNumber,
      projection.phone,
      projection.nickname,
      projection.tier,
      projection.status,
      projection.birthdayMonth,
      projection.birthdayDay,
      projection.birthdaySource,
      projection.note,
      projection.source,
      projection.ageGate,
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  await completeOperation(client, operation, 'member', version)
  return 'confirmed'
}

async function confirmMemberTier(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let tier: 'ordinary' | 'advanced'
  let updatedAt: string
  try {
    const after = afterSnapshot(operation)
    tier = enumValue(
      after.tier,
      ['ordinary', 'advanced'] as const,
      'member.tier'
    )
    updatedAt = timestamp(after.updatedAt, operation.occurred_at)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid member tier payload'
    )
  }
  const member = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM cloud_member
     WHERE id = $1
     LIMIT 1
     FOR UPDATE`,
    [operation.aggregate_id]
  )
  if (member.rows[0]?.tenant_id !== operation.tenant_id) {
    return markSyncConflict(
      client,
      operation,
      'member_version_mismatch',
      'member tier reconciliation requires an existing tenant member'
    )
  }
  const version = await appendEvent(client, operation, 'member')
  await client.query(
    `UPDATE cloud_member
     SET tier = $3, server_version = $4,
         updated_at = GREATEST(updated_at, $5::timestamptz)
     WHERE id = $1 AND tenant_id = $2`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      tier,
      version,
      updatedAt
    ]
  )
  await completeOperation(client, operation, 'member', version)
  return 'confirmed'
}

async function confirmCatalog(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let projection: CatalogProjection
  try {
    projection = parseCatalogProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'catalog_version_mismatch',
      error instanceof Error ? error.message : 'invalid catalog payload'
    )
  }
  const existing = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM cloud_catalog_item WHERE id = $1 FOR UPDATE`,
    [operation.aggregate_id]
  )
  if (existing.rows[0] && existing.rows[0].tenant_id !== operation.tenant_id) {
    return markSyncConflict(
      client, operation, 'catalog_version_mismatch',
      'catalog item belongs to another tenant'
    )
  }
  const duplicate = await client.query<{ id: string }>(
    `SELECT id FROM cloud_catalog_item
     WHERE tenant_id = $1 AND code = $2 AND id <> $3
     LIMIT 1`,
    [operation.tenant_id, projection.code, operation.aggregate_id]
  )
  if (duplicate.rows[0]) {
    return markSyncConflict(
      client,
      operation,
      'catalog_version_mismatch',
      'catalog code already belongs to another item',
      { itemId: duplicate.rows[0].id, code: projection.code }
    )
  }
  const version = await appendEvent(client, operation, 'catalog_item')
  await client.query(
    `INSERT INTO cloud_catalog_item
     (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
      advanced_price_fen, status, availability, note, server_version,
      created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       name = EXCLUDED.name,
       item_type = EXCLUDED.item_type,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_catalog_item.tenant_id = EXCLUDED.tenant_id`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.code,
      projection.name,
      projection.itemType,
      projection.regularPriceFen,
      projection.advancedPriceFen,
      projection.status,
      projection.availability,
      projection.note,
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  await client.query(
    `INSERT INTO cloud_catalog_store_config
     (tenant_id, store_id, catalog_item_id, regular_price_fen,
      advanced_price_fen, status, availability, note, server_version, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, store_id, catalog_item_id) DO UPDATE SET
       regular_price_fen = EXCLUDED.regular_price_fen,
       advanced_price_fen = EXCLUDED.advanced_price_fen,
       status = EXCLUDED.status,
       availability = EXCLUDED.availability,
       note = EXCLUDED.note,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at`,
    [operation.tenant_id, operation.store_id, operation.aggregate_id,
      projection.regularPriceFen, projection.advancedPriceFen,
      projection.status, projection.availability, projection.note,
      version, projection.updatedAt]
  )
  await completeOperation(client, operation, 'catalog_item', version)
  return 'confirmed'
}

async function confirmActivity(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let projection: ActivityProjection
  try {
    projection = parseActivityProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid activity payload'
    )
  }
  const ownershipConflict = await aggregateOwnershipConflict(
    client,
    operation,
    'cloud_activity_campaign',
    'unknown'
  )
  if (ownershipConflict) return ownershipConflict
  const version = await appendEvent(client, operation, 'activity')
  await client.query(
    `INSERT INTO cloud_activity_campaign
     (id, tenant_id, store_id, title, summary, content, activity_type, status,
      starts_at, ends_at, pinned, regular_price_fen, advanced_price_fen,
      allow_stored_value, allow_wechat, recharge_tiers_json, server_version,
      created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16::jsonb, $17, $18, $19)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       content = EXCLUDED.content,
       activity_type = EXCLUDED.activity_type,
       status = EXCLUDED.status,
       starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at,
       pinned = EXCLUDED.pinned,
       regular_price_fen = EXCLUDED.regular_price_fen,
       advanced_price_fen = EXCLUDED.advanced_price_fen,
       allow_stored_value = EXCLUDED.allow_stored_value,
       allow_wechat = EXCLUDED.allow_wechat,
       recharge_tiers_json = EXCLUDED.recharge_tiers_json,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_activity_campaign.tenant_id = EXCLUDED.tenant_id
       AND cloud_activity_campaign.store_id = EXCLUDED.store_id`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.title,
      projection.summary,
      projection.content,
      projection.activityType,
      projection.status,
      projection.startsAt,
      projection.endsAt,
      projection.pinned,
      projection.regularPriceFen,
      projection.advancedPriceFen,
      projection.allowStoredValue,
      projection.allowWechat,
      JSON.stringify(projection.rechargeTiers),
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  await completeOperation(client, operation, 'activity', version)
  return 'confirmed'
}

async function confirmAnnouncement(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let projection: AnnouncementProjection
  try {
    projection = parseAnnouncementProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid announcement payload'
    )
  }
  const ownershipConflict = await aggregateOwnershipConflict(
    client,
    operation,
    'cloud_announcement',
    'unknown'
  )
  if (ownershipConflict) return ownershipConflict
  const version = await appendEvent(client, operation, 'announcement')
  await client.query(
    `INSERT INTO cloud_announcement
     (id, tenant_id, store_id, title, content, status, pinned, visible_from,
      visible_until, published_at, server_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       status = EXCLUDED.status,
       pinned = EXCLUDED.pinned,
       visible_from = EXCLUDED.visible_from,
       visible_until = EXCLUDED.visible_until,
       published_at = EXCLUDED.published_at,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_announcement.tenant_id = EXCLUDED.tenant_id
       AND cloud_announcement.store_id = EXCLUDED.store_id`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.title,
      projection.content,
      projection.status,
      projection.pinned,
      projection.visibleFrom,
      projection.visibleUntil,
      projection.publishedAt,
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  await completeOperation(client, operation, 'announcement', version)
  return 'confirmed'
}

async function confirmBoardGame(
  client: PoolClient,
  operation: ReceivedOperation
): Promise<OperationResult> {
  let projection: BoardGameProjection
  try {
    projection = parseBoardGameProjection(operation)
  } catch (error) {
    return markSyncConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid board-game payload'
    )
  }
  const existing = await client.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM cloud_board_game WHERE id = $1 FOR UPDATE`,
    [operation.aggregate_id]
  )
  if (existing.rows[0] && existing.rows[0].tenant_id !== operation.tenant_id) {
    return markSyncConflict(client, operation, 'unknown',
      'board game belongs to another tenant')
  }
  if (projection.baseGameId === operation.aggregate_id) {
    return markSyncConflict(client, operation, 'unknown',
      'an expansion cannot use itself as its base game')
  }
  if (projection.baseGameId) {
    const children = await client.query(
      `SELECT 1 FROM cloud_board_game
       WHERE tenant_id = $1 AND base_game_id = $2 LIMIT 1`,
      [operation.tenant_id, operation.aggregate_id]
    )
    if (children.rows[0]) {
      return markSyncConflict(client, operation, 'unknown',
        'a base game with expansions cannot become an expansion')
    }
    const baseGame = await client.query<{
      tenant_id: string
      base_game_id: string | null
    }>(
      `SELECT tenant_id, base_game_id FROM cloud_board_game
       WHERE id = $1 FOR UPDATE`,
      [projection.baseGameId]
    )
    if (
      baseGame.rows[0]?.tenant_id !== operation.tenant_id ||
      baseGame.rows[0]?.base_game_id !== null
    ) {
      return markSyncConflict(client, operation, 'unknown',
        'base game must be a top-level game in the same tenant')
    }
  }
  const version = await appendEvent(client, operation, 'board_game')
  await client.query(
    `INSERT INTO cloud_board_game
     (id, tenant_id, store_id, base_game_id, name, introduction, categories_json,
      min_players, max_players, min_minutes, max_minutes, difficulty,
      complexity_rating, quantity, record_status, available,
      customer_consigned, missing_pieces, private, recommended, image_url,
      bgg_id, metadata_source, metadata_imported_at, customer_note,
      internal_note, consignor_nickname, missing_parts_json, server_version,
      created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
             $25, $26, $27, $28::jsonb, $29, $30, $31)
     ON CONFLICT (id) DO UPDATE SET
       base_game_id = EXCLUDED.base_game_id,
       name = EXCLUDED.name,
       introduction = EXCLUDED.introduction,
       categories_json = EXCLUDED.categories_json,
       min_players = EXCLUDED.min_players,
       max_players = EXCLUDED.max_players,
       min_minutes = EXCLUDED.min_minutes,
       max_minutes = EXCLUDED.max_minutes,
       difficulty = EXCLUDED.difficulty,
       complexity_rating = EXCLUDED.complexity_rating,
       image_url = EXCLUDED.image_url,
       bgg_id = EXCLUDED.bgg_id,
       metadata_source = EXCLUDED.metadata_source,
       metadata_imported_at = EXCLUDED.metadata_imported_at,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_board_game.tenant_id = EXCLUDED.tenant_id`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      projection.baseGameId,
      projection.name,
      projection.introduction,
      JSON.stringify(projection.categories),
      projection.minPlayers,
      projection.maxPlayers,
      projection.minMinutes,
      projection.maxMinutes,
      projection.difficulty,
      projection.complexityRating,
      projection.quantity,
      projection.recordStatus,
      projection.available,
      projection.customerConsigned,
      projection.missingPieces,
      projection.private,
      projection.recommended,
      projection.imageUrl,
      projection.bggId,
      projection.metadataSource,
      projection.metadataImportedAt,
      projection.customerNote,
      projection.internalNote,
      projection.consignorNickname,
      JSON.stringify(projection.missingParts),
      version,
      projection.createdAt,
      projection.updatedAt
    ]
  )
  await client.query(
    `INSERT INTO cloud_board_game_store_config
     (tenant_id, store_id, board_game_id, quantity, record_status, available,
      customer_consigned, missing_pieces, private, recommended, customer_note,
      internal_note, consignor_nickname, missing_parts_json, server_version, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14::jsonb, $15, $16)
     ON CONFLICT (tenant_id, store_id, board_game_id) DO UPDATE SET
       quantity = EXCLUDED.quantity,
       record_status = EXCLUDED.record_status,
       available = EXCLUDED.available,
       customer_consigned = EXCLUDED.customer_consigned,
       missing_pieces = EXCLUDED.missing_pieces,
       private = EXCLUDED.private,
       recommended = EXCLUDED.recommended,
       customer_note = EXCLUDED.customer_note,
       internal_note = EXCLUDED.internal_note,
       consignor_nickname = EXCLUDED.consignor_nickname,
       missing_parts_json = EXCLUDED.missing_parts_json,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at`,
    [operation.tenant_id, operation.store_id, operation.aggregate_id,
      projection.quantity, projection.recordStatus, projection.available,
      projection.customerConsigned, projection.missingPieces,
      projection.private, projection.recommended, projection.customerNote,
      projection.internalNote, projection.consignorNickname,
      JSON.stringify(projection.missingParts), version, projection.updatedAt]
  )
  await completeOperation(client, operation, 'board_game', version)
  return 'confirmed'
}

export async function processSyncOperation(
  client: PoolClient,
  operation: ReceivedOperation,
  confirmStoreBootstrap: (
    client: PoolClient,
    operation: ReceivedOperation
  ) => Promise<OperationResult>
): Promise<OperationResult | 'unsupported'> {
  const classification = classifySyncOperation(operation.operation_type)
  const prepared = await prepareConcurrentProjection(
    client,
    operation,
    classification
  )
  if ('conflict' in prepared) return prepared.conflict
  operation = prepared.operation
  switch (classification) {
    case 'store':
      return operation.operation_type === 'store.bootstrapped'
        ? confirmStoreBootstrap(client, operation)
        : confirmStoreProfile(client, operation)
    case 'employee':
      return confirmEmployee(client, operation)
    case 'member':
      return operation.operation_type === 'member.tier.reconciled'
        ? confirmMemberTier(client, operation)
        : confirmMember(client, operation)
    case 'catalog':
      return confirmCatalog(client, operation)
    case 'activity':
      return confirmActivity(client, operation)
    case 'announcement':
      return confirmAnnouncement(client, operation)
    case 'board_game':
      return confirmBoardGame(client, operation)
    case 'financial':
      return processFinancialSyncOperation(client, operation, {
        appendEvent,
        completeOperation,
        markConflict: markSyncConflict
      })
    case 'audit':
      return confirmAuditOnly(client, operation)
    case 'unsupported':
      return 'unsupported'
  }
}

async function prepareConcurrentProjection(
  client: PoolClient,
  operation: ReceivedOperation,
  classification: ReturnType<typeof classifySyncOperation>
): Promise<
  | { operation: ReceivedOperation }
  | { conflict: OperationResult }
> {
  if (
    operation.base_version === null ||
    operation.base_version === undefined ||
    !Array.isArray(operation.changed_fields) ||
    operation.changed_fields.length === 0 ||
    classification === 'financial' ||
    classification === 'audit' ||
    classification === 'unsupported'
  ) {
    return { operation }
  }
  const aggregateType =
    classification === 'catalog' ? 'catalog_item' : classification
  const latest = await client.query<{
    sequence: string | number
    payload_json: Record<string, unknown>
  }>(
    `SELECT sequence, payload_json FROM cloud_event
     WHERE tenant_id = $1 AND store_id = $2 AND aggregate_type = $3
       AND aggregate_id = $4
     ORDER BY sequence DESC LIMIT 1`,
    [
      operation.tenant_id,
      operation.store_id,
      aggregateType,
      operation.aggregate_id
    ]
  )
  const current = latest.rows[0]
  const baseVersion = Number(operation.base_version)
  if (!current || Number(current.sequence) === baseVersion) {
    return { operation }
  }
  const intervening = await client.query<{
    payload_json: Record<string, unknown>
  }>(
    `SELECT payload_json FROM cloud_event
     WHERE tenant_id = $1 AND store_id = $2 AND aggregate_type = $3
       AND aggregate_id = $4 AND sequence > $5
     ORDER BY sequence`,
    [
      operation.tenant_id,
      operation.store_id,
      aggregateType,
      operation.aggregate_id,
      baseVersion
    ]
  )
  const remoteChanged = new Set<string>()
  for (const event of intervening.rows) {
    const payload = event.payload_json
    if (Array.isArray(payload.changedFields)) {
      for (const field of payload.changedFields) {
        if (typeof field === 'string') remoteChanged.add(field)
      }
      continue
    }
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
      for (const key of Object.keys(afterRecord)) {
        if (
          key !== 'updatedAt' &&
          JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key])
        ) {
          remoteChanged.add(key)
        }
      }
    }
  }
  const localChanged = operation.changed_fields.filter(
    (field): field is string => typeof field === 'string'
  )
  const currentFields = current.payload_json.after as Record<string, unknown> | undefined
  const proposedFields = operation.payload_json.after as Record<string, unknown> | undefined
  const overlap = localChanged.filter((field) => remoteChanged.has(field) &&
    JSON.stringify(currentFields?.[field]) !== JSON.stringify(proposedFields?.[field]) &&
    !canMergeFilledField(classification, field, currentFields?.[field], proposedFields?.[field]))
  if (overlap.length > 0) {
    const conflictType =
      classification === 'member'
        ? 'member_version_mismatch'
        : classification === 'catalog'
          ? 'catalog_version_mismatch'
          : 'unknown'
    return {
      conflict: await markSyncConflict(
        client,
        operation,
        conflictType,
        `concurrent fields changed: ${overlap.join(', ')}`,
        { serverVersion: Number(current.sequence), fields: overlap, after: current.payload_json.after }
      )
    }
  }
  const currentAfter = current.payload_json.after
  const localAfter = operation.payload_json.after
  if (
    !currentAfter ||
    !localAfter ||
    typeof currentAfter !== 'object' ||
    typeof localAfter !== 'object' ||
    Array.isArray(currentAfter) ||
    Array.isArray(localAfter)
  ) {
    return {
      conflict: await markSyncConflict(
        client,
        operation,
        'unknown',
        'concurrent event does not contain mergeable snapshots'
      )
    }
  }
  const mergedAfter: Record<string, unknown> = {
    ...(currentAfter as Record<string, unknown>)
  }
  for (const field of localChanged) {
    const proposed = (localAfter as Record<string, unknown>)[field]
    mergedAfter[field] = canMergeFilledField(classification, field, mergedAfter[field], proposed)
      ? mergeFilledField(mergedAfter[field], proposed) : proposed
  }
  if ('updatedAt' in (localAfter as Record<string, unknown>)) {
    mergedAfter.updatedAt = (localAfter as Record<string, unknown>).updatedAt
  }
  return {
    operation: {
      ...operation,
      payload_json: {
        ...operation.payload_json,
        before: currentAfter,
        after: mergedAfter,
        changedFields: localChanged
      }
    }
  }
}
