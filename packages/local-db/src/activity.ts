import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  ActivityStatus,
  ActivitySummary,
  ActivityType,
  SaveActivityFields
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { restoreAppliedActivityRechargeGiftTiersInOpenTransaction } from './wallet'

type ActivityContext = StoreContext & { actor: EmployeeRecord }

function visibility(
  status: ActivityStatus,
  startsAt: string,
  endsAt: string,
  now: Date
): ActivitySummary['visibility'] {
  if (status === 'draft') return 'draft'
  if (status === 'disabled') return 'disabled'
  const time = now.getTime()
  if (time < new Date(startsAt).getTime()) return 'scheduled'
  if (time >= new Date(endsAt).getTime()) return 'ended'
  return 'active'
}

function validateFields(fields: SaveActivityFields): void {
  if (fields.title.trim().length < 2 || fields.title.trim().length > 100) {
    throw new Error('Activity title must contain 2-100 characters')
  }
  if (fields.summary.trim().length < 2 || fields.summary.trim().length > 300) {
    throw new Error('Activity summary must contain 2-300 characters')
  }
  if (fields.content.trim().length < 2 || fields.content.trim().length > 5000) {
    throw new Error('Activity content must contain 2-5000 characters')
  }
  const startsAt = Date.parse(fields.startsAt)
  const endsAt = Date.parse(fields.endsAt)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new Error('Activity end time must be later than its start time')
  }
  for (const value of [fields.regularPriceFen, fields.advancedPriceFen]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error('Activity prices must use non-negative integer fen')
    }
  }
  const principals = new Set<number>()
  for (const tier of fields.rechargeTiers) {
    if (
      !Number.isSafeInteger(tier.principalFen) ||
      tier.principalFen <= 0 ||
      !Number.isSafeInteger(tier.giftFen) ||
      tier.giftFen < 0
    ) {
      throw new Error('Recharge activity tiers must use integer fen')
    }
    if (principals.has(tier.principalFen)) {
      throw new Error('Recharge activity principal amounts must be unique')
    }
    principals.add(tier.principalFen)
  }
  if (fields.activityType === 'recharge' && fields.rechargeTiers.length === 0) {
    throw new Error('Recharge activity requires at least one gift tier')
  }
}

function findActivity(
  database: DatabaseSync,
  tenantId: string,
  activityId: string,
  now = new Date()
): ActivitySummary {
  const row = database
    .prepare(
      `SELECT id, title, summary, content, activity_type, status, starts_at,
              ends_at, pinned, regular_price_fen, advanced_price_fen,
              allow_stored_value, allow_wechat, created_at, updated_at
       FROM activity_campaign
       WHERE tenant_id = ? AND id = ?`
    )
    .get(tenantId, activityId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Activity was not found')
  const tiers = database
    .prepare(
      `SELECT id, principal_fen, gift_fen
       FROM activity_recharge_tier
       WHERE tenant_id = ? AND activity_id = ?
       ORDER BY principal_fen`
    )
    .all(tenantId, activityId) as Array<Record<string, unknown>>
  const status = row.status as ActivityStatus
  const startsAt = String(row.starts_at)
  const endsAt = String(row.ends_at)
  return {
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    content: String(row.content),
    activityType: row.activity_type as ActivityType,
    status,
    visibility: visibility(status, startsAt, endsAt, now),
    startsAt,
    endsAt,
    pinned: Number(row.pinned) === 1,
    regularPriceFen:
      row.regular_price_fen === null ? null : Number(row.regular_price_fen),
    advancedPriceFen:
      row.advanced_price_fen === null
        ? null
        : Number(row.advanced_price_fen),
    allowStoredValue: Number(row.allow_stored_value) === 1,
    allowWechat: Number(row.allow_wechat) === 1,
    rechargeTiers: tiers.map((tier) => ({
      id: String(tier.id),
      principalFen: Number(tier.principal_fen),
      giftFen: Number(tier.gift_fen)
    })),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: ActivityContext,
  input: {
    action: string
    activityId: string
    reason: string
    before: unknown
    after: unknown
    timestamp: string
  }
): void {
  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')
  const payload = JSON.stringify({
    action: input.action,
    activityId: input.activityId,
    before: input.before,
    after: input.after,
    reason: input.reason
  })
  database
    .prepare(
      'UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?'
    )
    .run(input.timestamp, context.deviceId)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'activity', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.activityId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.timestamp
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
      input.activityId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

function replaceTiers(
  database: DatabaseSync,
  context: StoreContext,
  activityId: string,
  tiers: SaveActivityFields['rechargeTiers'],
  timestamp: string
): void {
  database
    .prepare(
      'DELETE FROM activity_recharge_tier WHERE tenant_id = ? AND activity_id = ?'
    )
    .run(context.tenantId, activityId)
  const insert = database.prepare(
    `INSERT INTO activity_recharge_tier
     (id, tenant_id, store_id, activity_id, principal_fen, gift_fen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const tier of [...tiers].sort((a, b) => a.principalFen - b.principalFen)) {
    insert.run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      activityId,
      tier.principalFen,
      tier.giftFen,
      timestamp
    )
  }
}

function materializeActivityTemplates(database: DatabaseSync, context: StoreContext): void {
  if (!database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table'
     AND name = 'merchant_business_template'`
  ).get()) return
  const templates = database.prepare(
    `SELECT template.id, template.name, template.payload_json,
            override.payload_json override_payload_json,
            COALESCE(override.active, template.active) resolved_active,
            template.created_at, template.updated_at
     FROM merchant_business_template template
     LEFT JOIN store_business_template_override override
       ON override.tenant_id = template.tenant_id
      AND override.store_id = ?
      AND override.template_id = template.id
     WHERE template.tenant_id = ? AND template.template_type = 'activity'
       AND template.active = 1
       AND NOT EXISTS (
         SELECT 1 FROM activity_campaign activity
         WHERE activity.tenant_id = template.tenant_id
           AND activity.store_id = ?
           AND activity.source_template_id = template.id
       )
     ORDER BY template.created_at, template.id`
  ).all(context.storeId, context.tenantId, context.storeId) as Array<{
    id: string
    name: string
    payload_json: string
    override_payload_json: string | null
    resolved_active: number
    created_at: string
    updated_at: string
  }>
  if (templates.length === 0) return
  const actor = database.prepare(
    `SELECT id FROM employee WHERE tenant_id = ? AND role = 'manager'
     ORDER BY created_at LIMIT 1`
  ).get(context.tenantId) as { id: string } | undefined
  for (const template of templates) {
    if (Number(template.resolved_active) !== 1) continue
    const base = JSON.parse(template.payload_json) as Record<string, unknown>
    const override = template.override_payload_json
      ? JSON.parse(template.override_payload_json) as Record<string, unknown>
      : {}
    const payload = { ...base, ...override }
    const fields: SaveActivityFields = {
      title: typeof payload.title === 'string' ? payload.title : template.name,
      summary: String(payload.summary ?? template.name),
      content: String(payload.content ?? payload.summary ?? template.name),
      activityType: payload.activityType === 'recharge' ? 'recharge' : 'general',
      startsAt: String(payload.startsAt),
      endsAt: String(payload.endsAt),
      pinned: payload.pinned === true,
      ...(payload.regularPriceFen === null || payload.regularPriceFen === undefined
        ? {}
        : { regularPriceFen: Number(payload.regularPriceFen) }),
      ...(payload.advancedPriceFen === null || payload.advancedPriceFen === undefined
        ? {}
        : { advancedPriceFen: Number(payload.advancedPriceFen) }),
      allowStoredValue: payload.allowStoredValue === true,
      allowWechat: payload.allowWechat === true,
      rechargeTiers: Array.isArray(payload.rechargeTiers)
        ? payload.rechargeTiers.map((value) => {
            const tier = value as Record<string, unknown>
            return { principalFen: Number(tier.principalFen), giftFen: Number(tier.giftFen) }
          })
        : []
    }
    validateFields(fields)
    const id = randomUUID()
    database.prepare(
      `INSERT INTO activity_campaign
       (id, tenant_id, store_id, title, summary, content, activity_type,
        status, starts_at, ends_at, pinned, regular_price_fen,
        advanced_price_fen, allow_stored_value, allow_wechat, created_by,
        created_at, updated_at, source_template_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, context.tenantId, context.storeId, fields.title.trim(), fields.summary.trim(),
      fields.content.trim(), fields.activityType, fields.startsAt, fields.endsAt,
      fields.pinned ? 1 : 0, fields.regularPriceFen ?? null,
      fields.advancedPriceFen ?? null, fields.allowStoredValue ? 1 : 0,
      fields.allowWechat ? 1 : 0, actor?.id ?? 'cloud-sync',
      template.created_at, template.updated_at, template.id
    )
    replaceTiers(database, context, id, fields.rechargeTiers, template.updated_at)
  }
}

export function listActivities(
  database: DatabaseSync,
  context: StoreContext,
  now = new Date()
): ActivitySummary[] {
  materializeActivityTemplates(database, context)
  const rows = database
    .prepare(
      `SELECT id FROM activity_campaign
       WHERE tenant_id = ? AND store_id = ?
       ORDER BY pinned DESC, starts_at DESC, created_at DESC`
    )
    .all(context.tenantId, context.storeId) as Array<{ id: string }>
  return rows.map((row) => findActivity(database, context.tenantId, row.id, now))
}

export function createActivity(
  database: DatabaseSync,
  context: ActivityContext,
  fields: SaveActivityFields
): ActivitySummary {
  validateFields(fields)
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO activity_campaign
         (id, tenant_id, store_id, title, summary, content, activity_type,
          status, starts_at, ends_at, pinned, regular_price_fen,
          advanced_price_fen, allow_stored_value, allow_wechat, created_by,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        context.tenantId,
        context.storeId,
        fields.title.trim(),
        fields.summary.trim(),
        fields.content.trim(),
        fields.activityType,
        fields.startsAt,
        fields.endsAt,
        fields.pinned ? 1 : 0,
        fields.regularPriceFen ?? null,
        fields.advancedPriceFen ?? null,
        fields.allowStoredValue ? 1 : 0,
        fields.allowWechat ? 1 : 0,
        context.actor.id,
        timestamp,
        timestamp
      )
    replaceTiers(database, context, id, fields.rechargeTiers, timestamp)
    const after = findActivity(database, context.tenantId, id)
    appendAuditAndOutbox(database, context, {
      action: 'activity.created',
      activityId: id,
      reason: '创建活动草稿',
      before: null,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function updateActivity(
  database: DatabaseSync,
  context: ActivityContext,
  activityId: string,
  fields: SaveActivityFields,
  reason: string
): ActivitySummary {
  validateFields(fields)
  const before = findActivity(database, context.tenantId, activityId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE activity_campaign SET
           title = ?, summary = ?, content = ?, activity_type = ?,
           starts_at = ?, ends_at = ?, pinned = ?, regular_price_fen = ?,
           advanced_price_fen = ?, allow_stored_value = ?, allow_wechat = ?,
           updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        fields.title.trim(),
        fields.summary.trim(),
        fields.content.trim(),
        fields.activityType,
        fields.startsAt,
        fields.endsAt,
        fields.pinned ? 1 : 0,
        fields.regularPriceFen ?? null,
        fields.advancedPriceFen ?? null,
        fields.allowStoredValue ? 1 : 0,
        fields.allowWechat ? 1 : 0,
        timestamp,
        context.tenantId,
        activityId
      )
    replaceTiers(database, context, activityId, fields.rechargeTiers, timestamp)
    const after = findActivity(database, context.tenantId, activityId)
    appendAuditAndOutbox(database, context, {
      action: 'activity.updated',
      activityId,
      reason,
      before,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function setActivityStatus(
  database: DatabaseSync,
  context: ActivityContext,
  activityId: string,
  status: 'published' | 'disabled',
  reason: string
): ActivitySummary {
  const before = findActivity(database, context.tenantId, activityId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE activity_campaign SET status = ?,
           published_by = CASE WHEN ? = 'published' THEN ? ELSE published_by END,
           published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
           updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        status,
        status,
        context.actor.id,
        status,
        timestamp,
        timestamp,
        context.tenantId,
        activityId
      )
    const after = findActivity(database, context.tenantId, activityId)
    if (status === 'disabled' && before.activityType === 'recharge') {
      restoreAppliedActivityRechargeGiftTiersInOpenTransaction(database, context, {
        activityId,
        reason,
        timestamp
      })
    }
    appendAuditAndOutbox(database, context, {
      action: status === 'published' ? 'activity.published' : 'activity.disabled',
      activityId,
      reason,
      before,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function getActivity(
  database: DatabaseSync,
  tenantId: string,
  activityId: string
): ActivitySummary {
  return findActivity(database, tenantId, activityId)
}
