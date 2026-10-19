import { beginFinancialTransaction, commitFinancialTransaction } from './financial-transaction'
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  LegacyMonthlyCardHistorySummary,
  MonthlyCardDetails,
  MonthlyCardEventSummary,
  MonthlyCardPlanSummary,
  MonthlyCardSummary
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import {
  recordCompletedEmployeeFinancialCommand,
  recordCompletedEmployeeFinancialCommandInOpenTransaction
} from './employee-financial-command'
import { assertCloudMirrorSafeForFinancialWrite } from './cloud-runtime'

type MonthlyCardContext = StoreContext & {
  actor: EmployeeRecord
}

type CardRow = Record<string, unknown>

const DAY_MS = 24 * 60 * 60 * 1000

function ensureDefaultPlan(
  database: DatabaseSync,
  context: StoreContext
): MonthlyCardPlanSummary {
  let row = database
    .prepare(
      `SELECT id, name, price_fen, duration_days, active, scope_type, source_template_id
       FROM monthly_card_plan
       WHERE tenant_id = ? AND store_id = ? AND active = 1
       ORDER BY created_at
       LIMIT 1`
    )
    .get(context.tenantId, context.storeId) as
    | {
        id: string
        name: string
        price_fen: number
        duration_days: number
        active: number
        scope_type: 'tenant' | 'store'
        source_template_id: string | null
      }
    | undefined
  if (!row) {
    const timestamp = new Date().toISOString()
    const hasTemplates = Boolean(database.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table'
       AND name = 'merchant_business_template'`
    ).get())
    const template = hasTemplates ? database.prepare(
      `SELECT template.id, template.name, template.payload_json,
              override.payload_json override_payload_json
       FROM merchant_business_template template
       LEFT JOIN store_business_template_override override
         ON override.tenant_id = template.tenant_id
        AND override.store_id = ?
        AND override.template_id = template.id
        AND override.active = 1
       WHERE template.tenant_id = ?
         AND template.template_type = 'monthly_card_plan'
         AND template.active = 1
       ORDER BY template.created_at, template.id
       LIMIT 1`
    ).get(context.storeId, context.tenantId) as
      | { id: string; name: string; payload_json: string; override_payload_json: string | null }
      | undefined : undefined
    const templatePayload = template
      ? JSON.parse(template.payload_json) as Record<string, unknown>
      : {}
    const overridePayload = template?.override_payload_json
      ? JSON.parse(template.override_payload_json) as Record<string, unknown>
      : {}
    const resolved = { ...templatePayload, ...overridePayload }
    const priceFen = resolved.priceFen === undefined ? 20_000 : Number(resolved.priceFen)
    const durationDays = resolved.durationDays === undefined ? 30 : Number(resolved.durationDays)
    const scopeType = resolved.scopeType === 'tenant' ? 'tenant' : 'store'
    if (!Number.isSafeInteger(priceFen) || priceFen <= 0) {
      throw new Error('Monthly-card template price must be positive integer fen')
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new Error('Monthly-card template duration must be a positive integer')
    }
    row = {
      id: randomUUID(),
      name: typeof resolved.name === 'string' && resolved.name.trim()
        ? resolved.name.trim()
        : (template?.name ?? '30 天月卡'),
      price_fen: priceFen,
      duration_days: durationDays,
      active: 1,
      scope_type: scopeType,
      source_template_id: template?.id ?? null
    }
    database
      .prepare(
        `INSERT INTO monthly_card_plan
         (id, tenant_id, store_id, name, price_fen, duration_days, active,
          created_at, updated_at, scope_type, source_template_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        context.tenantId,
        context.storeId,
        row.name,
        row.price_fen,
        row.duration_days,
        timestamp,
        timestamp,
        row.scope_type,
        row.source_template_id
      )
  }
  return {
    id: row.id,
    name: row.name,
    priceFen: row.price_fen,
    durationDays: row.duration_days,
    active: row.active === 1,
    scopeType: row.scope_type,
    sourceTemplateId: row.source_template_id
  }
}

function mapCard(row: CardRow, now = new Date()): MonthlyCardSummary {
  const storedStatus = String(row.status) as MonthlyCardSummary['status']
  const status =
    storedStatus === 'active' && new Date(String(row.expires_at)).getTime() <= now.getTime()
      ? 'expired'
      : storedStatus
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    planName: String(row.plan_name_snapshot),
    priceFen: Number(row.price_fen),
    paymentMethod: row.payment_method === 'wechat' ? 'wechat' : 'cash',
    status,
    purchasedAt: String(row.purchased_at),
    startsAt: String(row.starts_at),
    expiresAt: String(row.expires_at),
    pausedAt: row.paused_at === null ? null : String(row.paused_at),
    usageCount: Number(row.usage_count),
    scopeType: row.scope_type === 'tenant' ? 'tenant' : 'store',
    issuingStoreId: String(row.store_id)
  }
}

function cardSelectSql(): string {
  return `
    SELECT c.*,
      (SELECT COUNT(*) FROM monthly_card_event e
       WHERE e.card_id = c.id AND e.event_type = 'used') usage_count
    FROM monthly_card c
  `
}

function findCard(
  database: DatabaseSync,
  tenantId: string,
  cardId: string,
  now = new Date()
): MonthlyCardSummary {
  const row = database
    .prepare(`${cardSelectSql()} WHERE c.tenant_id = ? AND c.id = ?`)
    .get(tenantId, cardId) as CardRow | undefined
  if (!row) throw new Error('Monthly card was not found')
  return mapCard(row, now)
}

function assertCardEligibleAtStore(card: MonthlyCardSummary, storeId: string): void {
  if (card.scopeType === 'store' && card.issuingStoreId !== storeId) {
    throw new Error('Monthly card is only valid at its issuing store')
  }
}

function requireMember(database: DatabaseSync, tenantId: string, memberId: string): void {
  const row = database
    .prepare("SELECT id FROM member WHERE tenant_id = ? AND id = ? AND status = 'active'")
    .get(tenantId, memberId)
  if (!row) throw new Error('Member was not found or is disabled')
}

function nextDeviceSequence(database: DatabaseSync, deviceId: string, timestamp: string): number {
  const row = database.prepare('SELECT next_sequence FROM device WHERE id = ?').get(deviceId) as
    | { next_sequence: number }
    | undefined
  if (!row) throw new Error('Registered device is missing')
  database
    .prepare('UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?')
    .run(timestamp, deviceId)
  return row.next_sequence
}

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    action: string
    cardId: string
    reason: string
    before: unknown
    after: unknown
    timestamp: string
    metadata?: Record<string, unknown>
  }
): void {
  const payload = JSON.stringify({
    action: input.action,
    cardId: input.cardId,
    before: input.before,
    after: input.after,
    reason: input.reason,
    ...(input.metadata ? { metadata: input.metadata } : {})
  })
  const sequence = nextDeviceSequence(database, context.deviceId, input.timestamp)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'monthly_card', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.cardId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.timestamp
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json, payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      input.action,
      input.cardId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

function insertEvent(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    cardId: string
    memberId: string
    eventType: MonthlyCardEventSummary['eventType']
    requestId: string
    reason: string
    metadata?: unknown
    timestamp: string
  }
): void {
  database
    .prepare(
      `INSERT INTO monthly_card_event
       (id, tenant_id, store_id, card_id, member_id, event_type, request_id,
        actor_id, device_id, reason, metadata_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      input.cardId,
      input.memberId,
      input.eventType,
      input.requestId,
      context.actor.id,
      context.deviceId,
      input.reason,
      JSON.stringify(input.metadata ?? {}),
      input.timestamp
    )
}

function existingEventCard(
  database: DatabaseSync,
  tenantId: string,
  requestId: string,
  expectedType: MonthlyCardEventSummary['eventType'],
  now: Date
): MonthlyCardSummary | null {
  const row = database
    .prepare(
      `SELECT card_id, event_type FROM monthly_card_event
       WHERE tenant_id = ? AND request_id = ?`
    )
    .get(tenantId, requestId) as { card_id: string; event_type: string } | undefined
  if (!row) return null
  if (row.event_type !== expectedType) {
    throw new Error('Request id has already been used by another monthly-card operation')
  }
  return findCard(database, tenantId, row.card_id, now)
}

export function getMonthlyCardDetails(
  database: DatabaseSync,
  context: StoreContext,
  memberId: string,
  now = new Date()
): MonthlyCardDetails {
  requireMember(database, context.tenantId, memberId)
  const plan = ensureDefaultPlan(database, context)
  const rows = database
    .prepare(
      `${cardSelectSql()}
       WHERE c.tenant_id = ? AND c.member_id = ?
       ORDER BY c.purchased_at DESC, c.rowid DESC`
    )
    .all(context.tenantId, memberId) as CardRow[]
  const history = rows.map((row) => mapCard(row, now))
  const current = history.find(
    (card) =>
      (card.scopeType === 'tenant' || card.issuingStoreId === context.storeId) &&
      (card.status === 'active' || card.status === 'paused')
  ) ?? null
  const events = (
    database
      .prepare(
        `SELECT id, event_type, reason, occurred_at
         FROM monthly_card_event
         WHERE tenant_id = ? AND member_id = ?
           AND (store_id = ? OR card_id IN (
             SELECT id FROM monthly_card
             WHERE tenant_id = ? AND member_id = ? AND scope_type = 'tenant'
           ))
         ORDER BY occurred_at DESC, rowid DESC
         LIMIT 100`
      )
      .all(
        context.tenantId,
        memberId,
        context.storeId,
        context.tenantId,
        memberId
      ) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    eventType: row.event_type as MonthlyCardEventSummary['eventType'],
    reason: String(row.reason),
    occurredAt: String(row.occurred_at)
  }))
  const legacyHistory = (
    database
      .prepare(
        `SELECT id, plan_name, starts_at_normalized, expires_at_normalized,
                imported_status, operational_card_id
         FROM legacy_monthly_card_history
         WHERE tenant_id = ? AND member_id = ?
         ORDER BY expires_at_normalized DESC, rowid DESC`
      )
      .all(context.tenantId, memberId) as Array<Record<string, unknown>>
  ).map(
    (row): LegacyMonthlyCardHistorySummary => ({
      id: String(row.id),
      planName: String(row.plan_name),
      startsAt: String(row.starts_at_normalized),
      expiresAt: String(row.expires_at_normalized),
      status: row.imported_status === 'active' ? 'active' : 'expired',
      operationalCardId:
        row.operational_card_id === null
          ? null
          : String(row.operational_card_id)
    })
  )
  return { plan, current, history, events, legacyHistory }
}

export function purchaseMonthlyCard(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    memberId: string
    reason: string
    now?: Date
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): MonthlyCardSummary {
  const now = input.now ?? new Date()
  const repeated = existingEventCard(
    database,
    context.tenantId,
    input.requestId,
    'purchased',
    now
  )
  if (repeated) {
    if (input.sourceFinancialCommand) {
      recordCompletedEmployeeFinancialCommand(database, context, {
        ...input.sourceFinancialCommand,
        commandType: 'monthly_card_purchase',
        result: {
          type: 'monthly_card_purchase',
          monthlyCard: repeated
        }
      })
    }
    return repeated
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'monthly_card')
  requireMember(database, context.tenantId, input.memberId)
  const plan = ensureDefaultPlan(database, context)
  const timestamp = now.toISOString()
  const cardId = randomUUID()
  const expiresAt = new Date(now.getTime() + plan.durationDays * DAY_MS).toISOString()

  const transactionStart = beginFinancialTransaction(database)
  try {
    const currentRows = database
      .prepare(
        `${cardSelectSql()}
         WHERE c.tenant_id = ? AND c.member_id = ?
           AND c.status IN ('active', 'paused')
           AND (
             c.scope_type = 'tenant'
             OR ? = 'tenant'
             OR c.store_id = ?
           )`
      )
      .all(context.tenantId, input.memberId, plan.scopeType, context.storeId) as CardRow[]
    for (const row of currentRows) {
      const card = mapCard(row, now)
      if (card.status !== 'expired') {
        throw new Error('Member already has an active or paused monthly card')
      }
      database
        .prepare("UPDATE monthly_card SET status = 'expired', updated_at = ? WHERE id = ?")
        .run(timestamp, card.id)
      insertEvent(database, context, {
        cardId: card.id,
        memberId: input.memberId,
        eventType: 'expired',
        requestId: `expire-${card.id}-${timestamp}`,
        reason: '月卡到期',
        timestamp
      })
    }
    database
      .prepare(
        `INSERT INTO monthly_card
         (id, tenant_id, store_id, member_id, plan_id, plan_name_snapshot,
          price_fen, duration_days, payment_method, status, request_id,
          purchased_by, purchased_at, starts_at, expires_at, paused_at,
          total_paused_seconds, updated_at, scope_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cash', 'active', ?, ?, ?, ?, ?, NULL, 0, ?, ?)`
      )
      .run(
        cardId,
        context.tenantId,
        context.storeId,
        input.memberId,
        plan.id,
        plan.name,
        plan.priceFen,
        plan.durationDays,
        input.requestId,
        context.actor.id,
        timestamp,
        timestamp,
        expiresAt,
        timestamp,
        plan.scopeType
      )
    insertEvent(database, context, {
      cardId,
      memberId: input.memberId,
      eventType: 'purchased',
      requestId: input.requestId,
      reason: input.reason,
      metadata: { paymentMethod: 'cash', priceFen: plan.priceFen },
      timestamp
    })
    const after = findCard(database, context.tenantId, cardId, now)
    appendAuditAndOutbox(database, context, {
      action: 'monthly_card.purchased',
      cardId,
      reason: input.reason,
      before: null,
      after,
      timestamp
    })
    if (input.sourceFinancialCommand) {
      recordCompletedEmployeeFinancialCommandInOpenTransaction(
        database,
        context,
        {
          ...input.sourceFinancialCommand,
          commandType: 'monthly_card_purchase',
          result: {
            type: 'monthly_card_purchase',
            monthlyCard: after
          },
          timestamp
        }
      )
    }
    commitFinancialTransaction(database, transactionStart)
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function cardAction(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    cardId: string
    reason: string
    eventType: 'paused' | 'resumed' | 'used'
    now?: Date
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): MonthlyCardSummary {
  const transactionStart = beginFinancialTransaction(database)
  try {
    const result = cardActionInOpenTransaction(database, context, input)
    commitFinancialTransaction(database, transactionStart)
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function cardActionInOpenTransaction(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    cardId: string
    reason: string
    eventType: 'paused' | 'resumed' | 'used'
    now?: Date
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): MonthlyCardSummary {
  const now = input.now ?? new Date()
  const repeated = existingEventCard(
    database,
    context.tenantId,
    input.requestId,
    input.eventType,
    now
  )
  if (repeated) {
    if (
      input.sourceFinancialCommand &&
      input.eventType !== 'used'
    ) {
      const commandType =
        input.eventType === 'paused'
          ? 'monthly_card_pause'
          : 'monthly_card_resume'
      recordCompletedEmployeeFinancialCommandInOpenTransaction(
        database,
        context,
        {
          ...input.sourceFinancialCommand,
          commandType,
          result: { type: commandType, monthlyCard: repeated }
        }
      )
    }
    return repeated
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'monthly_card')
  const before = findCard(database, context.tenantId, input.cardId, now)
  assertCardEligibleAtStore(before, context.storeId)
  const timestamp = now.toISOString()

  if (input.eventType === 'paused') {
    if (before.status !== 'active') throw new Error('Only an active monthly card can be paused')
    database
      .prepare(
        "UPDATE monthly_card SET status = 'paused', paused_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(timestamp, timestamp, before.id)
  } else if (input.eventType === 'resumed') {
    if (before.status !== 'paused' || !before.pausedAt) {
      throw new Error('Only a paused monthly card can be resumed')
    }
    const pausedMs = now.getTime() - new Date(before.pausedAt).getTime()
    const expiresAt = new Date(new Date(before.expiresAt).getTime() + pausedMs).toISOString()
    database
      .prepare(
        `UPDATE monthly_card
         SET status = 'active', paused_at = NULL, expires_at = ?,
             total_paused_seconds = total_paused_seconds + ?, updated_at = ?
         WHERE id = ?`
      )
      .run(expiresAt, Math.floor(pausedMs / 1000), timestamp, before.id)
  } else if (before.status !== 'active') {
    throw new Error('Monthly card is not active and cannot be used')
  }
  insertEvent(database, context, {
    cardId: before.id,
    memberId: before.memberId,
    eventType: input.eventType,
    requestId: input.requestId,
    reason: input.reason,
    timestamp
  })
  const after = findCard(database, context.tenantId, before.id, now)
  appendAuditAndOutbox(database, context, {
    action: `monthly_card.${input.eventType}`,
    cardId: before.id,
    reason: input.reason,
    before,
    after,
    timestamp
  })
  if (input.sourceFinancialCommand && input.eventType !== 'used') {
    const commandType =
      input.eventType === 'paused'
        ? 'monthly_card_pause'
        : 'monthly_card_resume'
    recordCompletedEmployeeFinancialCommandInOpenTransaction(
      database,
      context,
      {
        ...input.sourceFinancialCommand,
        commandType,
        result: { type: commandType, monthlyCard: after },
        timestamp
      }
    )
  }
  return after
}

export function pauseMonthlyCard(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    cardId: string
    reason: string
    now?: Date
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): MonthlyCardSummary {
  return cardAction(database, context, { ...input, eventType: 'paused' })
}

export function resumeMonthlyCard(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    cardId: string
    reason: string
    now?: Date
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): MonthlyCardSummary {
  return cardAction(database, context, { ...input, eventType: 'resumed' })
}

export function useMonthlyCard(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: { requestId: string; cardId: string; reason: string; now?: Date }
): MonthlyCardSummary {
  return cardAction(database, context, { ...input, eventType: 'used' })
}

export function useMonthlyCardInOpenTransaction(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: { requestId: string; cardId: string; reason: string; now?: Date }
): MonthlyCardSummary {
  return cardActionInOpenTransaction(database, context, {
    ...input,
    eventType: 'used'
  })
}

export function extendMonthlyCard(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    cardId: string
    days: number
    reason: string
    now?: Date
  }
): MonthlyCardSummary {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can extend a monthly card')
  }
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) {
    throw new TypeError('Monthly card extension days must be an integer from 1 to 365')
  }
  const reason = input.reason.trim()
  if (reason.length < 2) {
    throw new TypeError('Monthly card extension reason must contain at least 2 characters')
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'monthly_card')
  const now = input.now ?? new Date()
  const transactionStart = beginFinancialTransaction(database)
  try {
    const repeated = existingEventCard(
      database,
      context.tenantId,
      input.requestId,
      'manual_extended',
      now
    )
    if (repeated) {
      commitFinancialTransaction(database, transactionStart)
      return repeated
    }
    const before = findCard(database, context.tenantId, input.cardId, now)
    assertCardEligibleAtStore(before, context.storeId)
    if (before.status === 'refunded' || before.status === 'voided') {
      throw new Error('A refunded or voided monthly card cannot be extended')
    }
    const timestamp = now.toISOString()
    const baseTime = Math.max(new Date(before.expiresAt).getTime(), now.getTime())
    const expiresAt = new Date(baseTime + input.days * DAY_MS).toISOString()
    const nextStatus = before.status === 'expired' ? 'active' : before.status
    database
      .prepare(
        `UPDATE monthly_card
         SET expires_at = ?, status = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(expiresAt, nextStatus, timestamp, context.tenantId, before.id)
    insertEvent(database, context, {
      cardId: before.id,
      memberId: before.memberId,
      eventType: 'manual_extended',
      requestId: input.requestId,
      reason,
      metadata: {
        days: input.days,
        beforeExpiresAt: before.expiresAt,
        afterExpiresAt: expiresAt,
        beforeStatus: before.status,
        afterStatus: nextStatus,
        reactivated: before.status === 'expired'
      },
      timestamp
    })
    const after = findCard(database, context.tenantId, before.id, now)
    appendAuditAndOutbox(database, context, {
      action: 'monthly_card.manual_extended',
      cardId: before.id,
      reason,
      before,
      after,
      timestamp,
      metadata: {
        days: input.days,
        beforeExpiresAt: before.expiresAt,
        afterExpiresAt: expiresAt,
        beforeStatus: before.status,
        afterStatus: nextStatus,
        reactivated: before.status === 'expired'
      }
    })
    commitFinancialTransaction(database, transactionStart)
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function refundMonthlyCard(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: { requestId: string; cardId: string; reason: string; now?: Date }
): MonthlyCardSummary {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can refund a monthly card directly')
  }
  const transactionStart = beginFinancialTransaction(database)
  try {
    const result = refundMonthlyCardInOpenTransaction(database, context, input)
    commitFinancialTransaction(database, transactionStart)
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function refundMonthlyCardInOpenTransaction(
  database: DatabaseSync,
  context: MonthlyCardContext,
  input: {
    requestId: string
    cardId: string
    reason: string
    specialOverride?: boolean
    now?: Date
  }
): MonthlyCardSummary {
  const now = input.now ?? new Date()
  const repeated = existingEventCard(
    database,
    context.tenantId,
    input.requestId,
    'refunded',
    now
  )
  if (repeated) return repeated
  const before = findCard(database, context.tenantId, input.cardId, now)
  assertCardEligibleAtStore(before, context.storeId)
  if (before.status !== 'active' && before.status !== 'paused') {
    throw new Error('Monthly card cannot be refunded in its current status')
  }
  if (now.getTime() - new Date(before.purchasedAt).getTime() > DAY_MS) {
    throw new Error('Monthly card refund window has expired')
  }
  if (before.usageCount > 0 && input.specialOverride !== true) {
    throw new Error('A used monthly card cannot use the standard refund')
  }
  const timestamp = now.toISOString()
  database
    .prepare(
      `UPDATE monthly_card
       SET status = 'refunded', paused_at = NULL, refunded_at = ?,
           refund_reason = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(timestamp, input.reason, timestamp, before.id)
  insertEvent(database, context, {
    cardId: before.id,
    memberId: before.memberId,
    eventType: 'refunded',
    requestId: input.requestId,
    reason: input.reason,
    metadata: {
      cashRefundFen: before.priceFen,
      specialOverride: input.specialOverride === true
    },
    timestamp
  })
  const after = findCard(database, context.tenantId, before.id, now)
  appendAuditAndOutbox(database, context, {
    action: 'monthly_card.refunded',
    cardId: before.id,
    reason: input.reason,
    before,
    after,
    timestamp
  })
  return after
}
