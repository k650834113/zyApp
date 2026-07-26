import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  calculateMaximumRechargeGift,
  nonNegativeFen,
  type RechargeGiftTier
} from '@zyapp/domain'
import type {
  LegacyFinancialHistorySummary,
  RechargeGiftTierSummary,
  WalletDetails,
  WalletLedgerEntry,
  WalletOperationResult,
  WalletRechargeSummary,
  WalletSummary
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import {
  findEmployeeFinancialCommandExecution,
  recordCompletedEmployeeFinancialCommand,
  recordCompletedEmployeeFinancialCommandInOpenTransaction
} from './employee-financial-command'
import { assertCloudMirrorSafeForFinancialWrite } from './cloud-runtime'
import { appendMemberTierReconciliationInOpenTransaction } from './member-tier-reconciliation'

type WalletWriteContext = StoreContext & {
  actor: EmployeeRecord
}

type WalletRow = {
  id: string
  member_id: string
  status: string
  principal_balance_fen: number
  gift_balance_fen: number
  updated_at: string
}

type LotRow = {
  id: string
  source_id: string
  remaining_principal_fen: number
  remaining_gift_fen: number
}

type GiftTierInput = {
  principalFen: number
  giftFen: number
}

type GiftRuleStateRow = {
  source_type: 'default' | 'activity'
  source_activity_id: string | null
  default_tiers_json: string
}

const DEFAULT_RECHARGE_GIFT_TIERS: readonly GiftTierInput[] = [
  { principalFen: 30_000, giftFen: 2_000 },
  { principalFen: 50_000, giftFen: 5_000 },
  { principalFen: 100_000, giftFen: 20_000 }
]

function negativeDelta(value: number): number {
  return value === 0 ? 0 : -value
}

function mapWallet(row: WalletRow): WalletSummary {
  return {
    accountId: row.id,
    memberId: row.member_id,
    principalBalanceFen: row.principal_balance_fen,
    giftBalanceFen: row.gift_balance_fen,
    totalBalanceFen: row.principal_balance_fen + row.gift_balance_fen,
    status: row.status === 'frozen' ? 'frozen' : 'active',
    updatedAt: row.updated_at
  }
}

function emptyWallet(memberId: string): WalletSummary {
  return {
    accountId: null,
    memberId,
    principalBalanceFen: 0,
    giftBalanceFen: 0,
    totalBalanceFen: 0,
    status: 'active',
    updatedAt: null
  }
}

function requireMember(database: DatabaseSync, tenantId: string, memberId: string): void {
  const member = database
    .prepare("SELECT id FROM member WHERE tenant_id = ? AND id = ? AND status = 'active'")
    .get(tenantId, memberId)
  if (!member) {
    throw new Error('Member was not found or is disabled')
  }
}

function requireRechargeEligible(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): void {
  const hasAgeGate = (
    database.prepare('PRAGMA table_info(member)').all() as Array<{
      name: string
    }>
  ).some((column) => column.name === 'age_gate_status')
  if (!hasAgeGate) return
  const member = database
    .prepare(
      `SELECT age_gate_status FROM member
       WHERE tenant_id = ? AND id = ? AND status = 'active'`
    )
    .get(tenantId, memberId) as
    | { age_gate_status: string }
    | undefined
  if (!member) throw new Error('Member was not found or is disabled')
  if (member.age_gate_status === 'recharge_disabled') {
    throw new Error(
      'Member recharge requires age confirmation or verified guardian consent'
    )
  }
}

function findWalletRow(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): WalletRow | undefined {
  return database
    .prepare(
      `SELECT id, member_id, status, principal_balance_fen, gift_balance_fen, updated_at
       FROM wallet_account
       WHERE tenant_id = ? AND member_id = ?`
    )
    .get(tenantId, memberId) as WalletRow | undefined
}

function ensureWalletRow(
  database: DatabaseSync,
  context: StoreContext,
  memberId: string,
  timestamp: string
): WalletRow {
  const existing = findWalletRow(database, context.tenantId, memberId)
  if (existing) {
    return existing
  }
  const id = randomUUID()
  database
    .prepare(
      `INSERT INTO wallet_account
       (id, tenant_id, store_id, member_id, status, principal_balance_fen,
        gift_balance_fen, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, 0, ?, ?)`
    )
    .run(id, context.tenantId, context.storeId, memberId, timestamp, timestamp)
  return {
    id,
    member_id: memberId,
    status: 'active',
    principal_balance_fen: 0,
    gift_balance_fen: 0,
    updated_at: timestamp
  }
}

function ensureDefaultGiftTiers(database: DatabaseSync, context: StoreContext): void {
  const count = database
    .prepare(
      `SELECT COUNT(*) count FROM recharge_gift_tier
       WHERE tenant_id = ? AND store_id = ?`
    )
    .get(context.tenantId, context.storeId) as { count: number }
  if (count.count > 0) {
    return
  }
  const hasTemplates = Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table'
     AND name = 'merchant_business_template'`
  ).get())
  const template = hasTemplates ? database.prepare(
    `SELECT template.id, template.payload_json,
            override.payload_json override_payload_json
     FROM merchant_business_template template
     LEFT JOIN store_business_template_override override
       ON override.tenant_id = template.tenant_id
      AND override.store_id = ?
      AND override.template_id = template.id
      AND override.active = 1
     WHERE template.tenant_id = ?
       AND template.template_type = 'recharge_gift_tier'
       AND template.active = 1
     ORDER BY template.created_at, template.id
     LIMIT 1`
  ).get(context.storeId, context.tenantId) as
    | { id: string; payload_json: string; override_payload_json: string | null }
    | undefined : undefined
  const templatePayload = template
    ? JSON.parse(template.payload_json) as Record<string, unknown>
    : {}
  const overridePayload = template?.override_payload_json
    ? JSON.parse(template.override_payload_json) as Record<string, unknown>
    : {}
  const resolved = { ...templatePayload, ...overridePayload }
  const configuredTiers = Array.isArray(resolved.tiers)
    ? normalizeGiftTiers(resolved.tiers.map((value) => {
        const tier = value as Record<string, unknown>
        return {
          principalFen: Number(tier.principalFen),
          giftFen: Number(tier.giftFen)
        }
      }))
    : DEFAULT_RECHARGE_GIFT_TIERS
  const timestamp = new Date().toISOString()
  const insert = database.prepare(
    hasTemplates
      ? `INSERT INTO recharge_gift_tier
         (id, tenant_id, store_id, principal_fen, gift_fen, active,
          created_at, updated_at, source_template_id)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
      : `INSERT INTO recharge_gift_tier
         (id, tenant_id, store_id, principal_fen, gift_fen, active,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  )
  for (const { principalFen, giftFen } of configuredTiers) {
    const values = [randomUUID(), context.tenantId, context.storeId,
      principalFen, giftFen, timestamp, timestamp] as const
    if (hasTemplates) insert.run(...values, template?.id ?? null)
    else insert.run(...values)
  }
}

function normalizeGiftTiers(tiers: GiftTierInput[]): GiftTierInput[] {
  const principalValues = new Set<number>()
  const normalized = tiers.map((tier) => {
    nonNegativeFen(tier.principalFen)
    nonNegativeFen(tier.giftFen)
    if (tier.principalFen <= 0) {
      throw new RangeError('Recharge tier principal must be greater than zero')
    }
    if (principalValues.has(tier.principalFen)) {
      throw new Error('Recharge tier principal amounts must be unique')
    }
    principalValues.add(tier.principalFen)
    return {
      principalFen: tier.principalFen,
      giftFen: tier.giftFen
    }
  })
  return normalized.sort((left, right) => left.principalFen - right.principalFen)
}

function serializeGiftTiers(tiers: GiftTierInput[]): string {
  return JSON.stringify(normalizeGiftTiers(tiers))
}

function hasGiftRuleStateTable(database: DatabaseSync): boolean {
  const row = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'recharge_gift_rule_state'`
    )
    .get() as { name: string } | undefined
  return row !== undefined
}

function parseGiftTiers(value: string): GiftTierInput[] {
  const parsed = JSON.parse(value) as GiftTierInput[]
  if (!Array.isArray(parsed)) {
    throw new Error('Stored recharge gift default tiers are invalid')
  }
  return normalizeGiftTiers(
    parsed.map((tier) => ({
      principalFen: Number(tier.principalFen),
      giftFen: Number(tier.giftFen)
    }))
  )
}

function listGiftTiersRaw(
  database: DatabaseSync,
  context: StoreContext
): RechargeGiftTierSummary[] {
  const hasTemplateSource = Boolean(database.prepare(
    `SELECT 1 FROM pragma_table_info('recharge_gift_tier')
     WHERE name = 'source_template_id'`
  ).get())
  return (
    database
      .prepare(
        `SELECT id, principal_fen, gift_fen, active,
                ${hasTemplateSource ? 'source_template_id' : 'NULL source_template_id'}
         FROM recharge_gift_tier
         WHERE tenant_id = ? AND store_id = ?
         ORDER BY principal_fen`
      )
      .all(context.tenantId, context.storeId) as Array<{
      id: string
      principal_fen: number
      gift_fen: number
      active: number
      source_template_id: string | null
    }>
  ).map((row) => ({
    id: row.id,
    principalFen: row.principal_fen,
    giftFen: row.gift_fen,
    active: row.active === 1,
    sourceTemplateId: row.source_template_id
  }))
}

function activeTierInputs(tiers: RechargeGiftTierSummary[]): GiftTierInput[] {
  return normalizeGiftTiers(
    tiers
      .filter((tier) => tier.active)
      .map((tier) => ({
        principalFen: tier.principalFen,
        giftFen: tier.giftFen
      }))
  )
}

function getGiftRuleState(
  database: DatabaseSync,
  context: StoreContext
): GiftRuleStateRow | null {
  const row = database
    .prepare(
      `SELECT source_type, source_activity_id, default_tiers_json
       FROM recharge_gift_rule_state
       WHERE tenant_id = ? AND store_id = ?`
    )
    .get(context.tenantId, context.storeId) as GiftRuleStateRow | undefined
  return row ?? null
}

function upsertGiftRuleStateInOpenTransaction(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    sourceType: 'default' | 'activity'
    sourceActivityId: string | null
    defaultTiers: GiftTierInput[]
    timestamp: string
  }
): void {
  if (!hasGiftRuleStateTable(database)) {
    return
  }
  database
    .prepare(
      `INSERT INTO recharge_gift_rule_state
       (tenant_id, store_id, source_type, source_activity_id, default_tiers_json,
        applied_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, store_id)
       DO UPDATE SET source_type = excluded.source_type,
                     source_activity_id = excluded.source_activity_id,
                     default_tiers_json = excluded.default_tiers_json,
                     applied_at = excluded.applied_at,
                     updated_at = excluded.updated_at`
    )
    .run(
      context.tenantId,
      context.storeId,
      input.sourceType,
      input.sourceActivityId,
      serializeGiftTiers(input.defaultTiers),
      input.timestamp,
      input.timestamp
    )
}

function ensureGiftRuleState(
  database: DatabaseSync,
  context: StoreContext
): GiftRuleStateRow {
  ensureDefaultGiftTiers(database, context)
  if (!hasGiftRuleStateTable(database)) {
    return {
      source_type: 'default',
      source_activity_id: null,
      default_tiers_json: serializeGiftTiers(
        activeTierInputs(listGiftTiersRaw(database, context))
      )
    }
  }
  const existing = getGiftRuleState(database, context)
  if (existing) {
    return existing
  }
  const activeTiers = activeTierInputs(listGiftTiersRaw(database, context))
  const timestamp = new Date().toISOString()
  upsertGiftRuleStateInOpenTransaction(database, context, {
    sourceType: 'default',
    sourceActivityId: null,
    defaultTiers: activeTiers.length > 0 ? activeTiers : [...DEFAULT_RECHARGE_GIFT_TIERS],
    timestamp
  })
  const created = getGiftRuleState(database, context)
  if (!created) throw new Error('Recharge gift rule state was not initialized')
  return created
}

function replaceActiveGiftTiersInOpenTransaction(
  database: DatabaseSync,
  context: StoreContext,
  tiers: GiftTierInput[],
  timestamp: string
): void {
  const normalizedTiers = normalizeGiftTiers(tiers)
  database
    .prepare(
      `UPDATE recharge_gift_tier
       SET active = 0, updated_at = ?
       WHERE tenant_id = ? AND store_id = ?`
    )
    .run(timestamp, context.tenantId, context.storeId)
  const upsert = database.prepare(
    `INSERT INTO recharge_gift_tier
     (id, tenant_id, store_id, principal_fen, gift_fen, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (tenant_id, store_id, principal_fen)
     DO UPDATE SET gift_fen = excluded.gift_fen, active = 1, updated_at = excluded.updated_at`
  )
  for (const tier of normalizedTiers) {
    upsert.run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      tier.principalFen,
      tier.giftFen,
      timestamp,
      timestamp
    )
  }
}

function preserveRechargeTemplateOverrideInOpenTransaction(
  database: DatabaseSync,
  context: StoreContext,
  tiers: GiftTierInput[],
  timestamp: string
): void {
  if (!database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table'
     AND name = 'merchant_business_template'`
  ).get()) return
  const template = database.prepare(
    `SELECT id FROM merchant_business_template
     WHERE tenant_id = ? AND template_type = 'recharge_gift_tier' AND active = 1
     ORDER BY created_at, id LIMIT 1`
  ).get(context.tenantId) as { id: string } | undefined
  if (!template) return
  database.prepare(
    `UPDATE recharge_gift_tier SET source_template_id = ?
     WHERE tenant_id = ? AND store_id = ? AND active = 1`
  ).run(template.id, context.tenantId, context.storeId)
  database.prepare(
    `INSERT INTO store_business_template_override
     (id, tenant_id, store_id, template_id, payload_json, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (tenant_id, store_id, template_id) DO UPDATE SET
       payload_json = excluded.payload_json, active = 1, updated_at = excluded.updated_at`
  ).run(
    randomUUID(),
    context.tenantId,
    context.storeId,
    template.id,
    JSON.stringify({ tiers: normalizeGiftTiers(tiers) }),
    timestamp,
    timestamp
  )
}

function listGiftTiers(
  database: DatabaseSync,
  context: StoreContext
): RechargeGiftTierSummary[] {
  ensureDefaultGiftTiers(database, context)
  ensureGiftRuleState(database, context)
  return listGiftTiersRaw(database, context)
}

export function getRechargeGiftTiers(
  database: DatabaseSync,
  context: StoreContext
): RechargeGiftTierSummary[] {
  return listGiftTiers(database, context)
}

export function updateRechargeGiftTiers(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    tiers: Array<{ principalFen: number; giftFen: number }>
    reason: string
    sourceActivityId?: string
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): RechargeGiftTierSummary[] {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can update recharge gift tiers')
  }
  if (input.sourceFinancialCommand) {
    const existing = findEmployeeFinancialCommandExecution(
      database,
      context,
      input.sourceFinancialCommand.commandId
    )
    if (existing) {
      if (
        existing.status !== 'completed' ||
        existing.result.type !== 'apply_activity_recharge_tiers'
      ) {
        throw new Error('Financial command already has a different result')
      }
      return existing.result.rechargeGiftTiers
    }
  }

  const normalizedTiers = normalizeGiftTiers(input.tiers)
  const before = listGiftTiers(database, context)
  const beforeActiveTiers = activeTierInputs(before)
  const state = ensureGiftRuleState(database, context)
  const defaultTiers = input.sourceActivityId
    ? state.source_type === 'activity'
      ? parseGiftTiers(state.default_tiers_json)
      : beforeActiveTiers
    : normalizedTiers
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    replaceActiveGiftTiersInOpenTransaction(database, context, normalizedTiers, timestamp)
    preserveRechargeTemplateOverrideInOpenTransaction(
      database,
      context,
      normalizedTiers,
      timestamp
    )
    upsertGiftRuleStateInOpenTransaction(database, context, {
      sourceType: input.sourceActivityId ? 'activity' : 'default',
      sourceActivityId: input.sourceActivityId ?? null,
      defaultTiers,
      timestamp
    })
    const after = listGiftTiers(database, context)
    appendWalletAuditAndOutbox(database, context, {
      action: 'wallet.gift_tiers.updated',
      operationType: 'wallet.gift_tiers.updated',
      aggregateId: context.storeId,
      reason: input.reason,
      before,
      after
    })
    if (input.sourceFinancialCommand) {
      recordCompletedEmployeeFinancialCommandInOpenTransaction(
        database,
        context,
        {
          ...input.sourceFinancialCommand,
          commandType: 'apply_activity_recharge_tiers',
          result: {
            type: 'apply_activity_recharge_tiers',
            rechargeGiftTiers: after
          },
          timestamp
        }
      )
    }
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function shouldRestoreActivityGiftTiers(
  database: DatabaseSync,
  context: StoreContext,
  sourceActivityId: string | null,
  now: Date
): boolean {
  if (!sourceActivityId) return true
  const activity = database
    .prepare(
      `SELECT status, ends_at
       FROM activity_campaign
       WHERE tenant_id = ? AND store_id = ? AND id = ?`
    )
    .get(context.tenantId, context.storeId, sourceActivityId) as
    | { status: string; ends_at: string }
    | undefined
  if (!activity) return true
  if (activity.status !== 'published') return true
  const endsAt = Date.parse(activity.ends_at)
  return !Number.isFinite(endsAt) || now.getTime() >= endsAt
}

function restoreDefaultGiftTiersInOpenTransaction(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    reason: string
    timestamp: string
    activityId?: string
  }
): RechargeGiftTierSummary[] | null {
  const state = ensureGiftRuleState(database, context)
  if (state.source_type !== 'activity') {
    return null
  }
  if (input.activityId && state.source_activity_id !== input.activityId) {
    return null
  }
  const defaultTiers = parseGiftTiers(state.default_tiers_json)
  const before = listGiftTiers(database, context)
  replaceActiveGiftTiersInOpenTransaction(database, context, defaultTiers, input.timestamp)
  upsertGiftRuleStateInOpenTransaction(database, context, {
    sourceType: 'default',
    sourceActivityId: null,
    defaultTiers,
    timestamp: input.timestamp
  })
  const after = listGiftTiers(database, context)
  appendWalletAuditAndOutbox(database, context, {
    action: 'wallet.gift_tiers.updated',
    operationType: 'wallet.gift_tiers.updated',
    aggregateId: context.storeId,
    reason: input.reason,
    before,
    after
  })
  return after
}

export function restoreAppliedActivityRechargeGiftTiersInOpenTransaction(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    activityId: string
    reason: string
    timestamp: string
  }
): RechargeGiftTierSummary[] | null {
  return restoreDefaultGiftTiersInOpenTransaction(database, context, input)
}

export function restoreExpiredActivityRechargeGiftTiers(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    reason: string
    now?: Date
  }
): RechargeGiftTierSummary[] | null {
  if (!hasGiftRuleStateTable(database)) {
    return null
  }
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const state = ensureGiftRuleState(database, context)
    if (
      state.source_type !== 'activity' ||
      !shouldRestoreActivityGiftTiers(
        database,
        context,
        state.source_activity_id,
        now
      )
    ) {
      database.exec('COMMIT')
      return null
    }
    const restoreInput: {
      reason: string
      timestamp: string
      activityId?: string
    } = {
      reason: input.reason,
      timestamp: now.toISOString()
    }
    if (state.source_activity_id) {
      restoreInput.activityId = state.source_activity_id
    }
    const result = restoreDefaultGiftTiersInOpenTransaction(
      database,
      context,
      restoreInput
    )
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function listLedger(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): WalletLedgerEntry[] {
  return (
    database
      .prepare(
        `SELECT id, entry_type, principal_delta_fen, gift_delta_fen,
                principal_balance_after_fen, gift_balance_after_fen,
                source_id, reason, occurred_at
         FROM wallet_ledger
         WHERE tenant_id = ? AND member_id = ?
         ORDER BY occurred_at DESC, rowid DESC
         LIMIT 100`
      )
      .all(tenantId, memberId) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    entryType: row.entry_type as WalletLedgerEntry['entryType'],
    principalDeltaFen: Number(row.principal_delta_fen),
    giftDeltaFen: Number(row.gift_delta_fen),
    principalBalanceAfterFen: Number(row.principal_balance_after_fen),
    giftBalanceAfterFen: Number(row.gift_balance_after_fen),
    sourceId: String(row.source_id),
    reason: String(row.reason),
    occurredAt: String(row.occurred_at)
  }))
}

function listRecharges(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): WalletRechargeSummary[] {
  return (
    database
      .prepare(
        `SELECT r.id, r.principal_fen, r.gift_fen, r.status, r.occurred_at,
                l.remaining_principal_fen, l.remaining_gift_fen
         FROM wallet_recharge r
         JOIN wallet_lot l ON l.source_type = 'recharge' AND l.source_id = r.id
         WHERE r.tenant_id = ? AND r.member_id = ?
         ORDER BY r.occurred_at DESC
         LIMIT 50`
      )
      .all(tenantId, memberId) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    principalFen: Number(row.principal_fen),
    giftFen: Number(row.gift_fen),
    remainingPrincipalFen: Number(row.remaining_principal_fen),
    remainingGiftFen: Number(row.remaining_gift_fen),
    status: row.status as WalletRechargeSummary['status'],
    occurredAt: String(row.occurred_at)
  }))
}

function listLegacyHistory(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): LegacyFinancialHistorySummary[] {
  return (
    database
      .prepare(
        `SELECT id, legacy_table, event_type, amount_fen, description,
                occurred_at_raw, occurred_at_normalized
         FROM legacy_financial_history
         WHERE tenant_id = ? AND member_id = ?
         ORDER BY occurred_at_normalized DESC, rowid DESC
         LIMIT 200`
      )
      .all(tenantId, memberId) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    sourceTable:
      row.legacy_table === 'activity_logs'
        ? 'activity_logs'
        : 'transactions',
    eventType: String(row.event_type),
    amountFen: row.amount_fen === null ? null : Number(row.amount_fen),
    description: row.description === null ? null : String(row.description),
    occurredAtRaw:
      row.occurred_at_raw === null ? null : String(row.occurred_at_raw),
    occurredAtNormalized:
      row.occurred_at_normalized === null
        ? null
        : String(row.occurred_at_normalized)
  }))
}

export function getWalletDetails(
  database: DatabaseSync,
  context: StoreContext,
  memberId: string
): WalletDetails {
  requireMember(database, context.tenantId, memberId)
  const wallet = findWalletRow(database, context.tenantId, memberId)
  return {
    wallet: wallet ? mapWallet(wallet) : emptyWallet(memberId),
    giftTiers: listGiftTiers(database, context),
    ledger: listLedger(database, context.tenantId, memberId),
    recharges: listRecharges(database, context.tenantId, memberId),
    legacyHistory: listLegacyHistory(database, context.tenantId, memberId)
  }
}

function nextDeviceSequence(database: DatabaseSync, deviceId: string, timestamp: string): number {
  const row = database.prepare('SELECT next_sequence FROM device WHERE id = ?').get(deviceId) as
    | { next_sequence: number }
    | undefined
  if (!row) {
    throw new Error('Registered device is missing')
  }
  database
    .prepare('UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?')
    .run(timestamp, deviceId)
  return row.next_sequence
}

function appendWalletAuditAndOutbox(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    action: string
    operationType: string
    aggregateId: string
    reason: string
    before: unknown
    after: unknown
  }
): void {
  const timestamp = new Date().toISOString()
  const payload = JSON.stringify({
    action: input.action,
    aggregateId: input.aggregateId,
    before: input.before,
    after: input.after,
    reason: input.reason
  })
  const sequence = nextDeviceSequence(database, context.deviceId, timestamp)
  const payloadHash = createHash('sha256').update(payload).digest('hex')
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'wallet', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.aggregateId,
      input.reason,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      timestamp
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
      input.operationType,
      input.aggregateId,
      timestamp,
      payload,
      payloadHash
    )
}

function existingOperation(
  database: DatabaseSync,
  context: StoreContext,
  requestId: string,
  expectedEntryType: WalletLedgerEntry['entryType']
): WalletOperationResult | null {
  const row = database
    .prepare(
      `SELECT id, member_id, source_id, entry_type, principal_delta_fen, gift_delta_fen
       FROM wallet_ledger WHERE tenant_id = ? AND request_id = ?`
    )
    .get(context.tenantId, requestId) as
    | {
        id: string
        member_id: string
        source_id: string
        entry_type: WalletLedgerEntry['entryType']
        principal_delta_fen: number
        gift_delta_fen: number
      }
    | undefined
  if (!row) {
    return null
  }
  if (row.entry_type !== expectedEntryType) {
    throw new Error('Request id has already been used by another wallet operation')
  }
  const wallet = findWalletRow(database, context.tenantId, row.member_id)
  if (!wallet) {
    throw new Error('Wallet account is missing')
  }
  return {
    operationId: row.source_id,
    wallet: mapWallet(wallet),
    principalDeltaFen: row.principal_delta_fen,
    giftDeltaFen: row.gift_delta_fen
  }
}

function insertLedger(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    wallet: WalletRow
    memberId: string
    entryType: WalletLedgerEntry['entryType']
    principalDeltaFen: number
    giftDeltaFen: number
    principalAfterFen: number
    giftAfterFen: number
    sourceId: string
    relatedLedgerId?: string
    requestId: string
    reason: string
    metadata: unknown
    timestamp: string
  }
): string {
  const id = randomUUID()
  database
    .prepare(
      `INSERT INTO wallet_ledger
       (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
        principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
        gift_balance_after_fen, source_id, related_ledger_id, request_id,
        actor_id, device_id, reason, metadata_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      context.tenantId,
      context.storeId,
      input.wallet.id,
      input.memberId,
      input.entryType,
      input.principalDeltaFen,
      input.giftDeltaFen,
      input.principalAfterFen,
      input.giftAfterFen,
      input.sourceId,
      input.relatedLedgerId ?? null,
      input.requestId,
      context.actor.id,
      context.deviceId,
      input.reason,
      JSON.stringify(input.metadata),
      input.timestamp
    )
  return id
}

export function cashRecharge(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    requestId: string
    memberId: string
    principalFen: number
    reason: string
    now?: Date
    sourceFinancialCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): WalletOperationResult {
  nonNegativeFen(input.principalFen)
  if (input.principalFen <= 0) {
    throw new RangeError('Recharge amount must be greater than zero')
  }
  const repeated = existingOperation(database, context, input.requestId, 'cash_recharge')
  if (repeated) {
    if (input.sourceFinancialCommand) {
      recordCompletedEmployeeFinancialCommand(database, context, {
        ...input.sourceFinancialCommand,
        commandType: 'cash_recharge',
        result: { type: 'cash_recharge', wallet: repeated }
      })
    }
    return repeated
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  requireMember(database, context.tenantId, input.memberId)
  requireRechargeEligible(database, context.tenantId, input.memberId)
  const restoreInput: { reason: string; now?: Date } = {
    reason: 'expired activity recharge gift tiers'
  }
  if (input.now) {
    restoreInput.now = input.now
  }
  restoreExpiredActivityRechargeGiftTiers(database, context, restoreInput)
  const tiers = listGiftTiers(database, context)
  const activeTiers: RechargeGiftTier[] = tiers
    .filter((tier) => tier.active)
    .map((tier) => ({
      id: tier.id,
      principal: nonNegativeFen(tier.principalFen),
      gift: nonNegativeFen(tier.giftFen)
    }))
  const allocation = calculateMaximumRechargeGift(
    nonNegativeFen(input.principalFen),
    activeTiers
  )
  const timestamp = (input.now ?? new Date()).toISOString()
  const rechargeId = randomUUID()

  database.exec('BEGIN IMMEDIATE')
  try {
    const wallet = ensureWalletRow(database, context, input.memberId, timestamp)
    if (wallet.status !== 'active') {
      throw new Error('Wallet account is frozen')
    }
    const principalAfter = wallet.principal_balance_fen + input.principalFen
    const giftAfter = wallet.gift_balance_fen + allocation.gift
    database
      .prepare(
        `INSERT INTO wallet_recharge
         (id, tenant_id, store_id, wallet_account_id, member_id, payment_method,
          principal_fen, gift_fen, status, gift_rule_snapshot_json, request_id,
          actor_id, device_id, reason, occurred_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'cash', ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rechargeId,
        context.tenantId,
        context.storeId,
        wallet.id,
        input.memberId,
        input.principalFen,
        allocation.gift,
        JSON.stringify({ tiers, allocation }),
        input.requestId,
        context.actor.id,
        context.deviceId,
        input.reason,
        timestamp,
        timestamp
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
        wallet.id,
        input.memberId,
        rechargeId,
        input.principalFen,
        allocation.gift,
        input.principalFen,
        allocation.gift,
        timestamp,
        timestamp
      )
    insertLedger(database, context, {
      wallet,
      memberId: input.memberId,
      entryType: 'cash_recharge',
      principalDeltaFen: input.principalFen,
      giftDeltaFen: allocation.gift,
      principalAfterFen: principalAfter,
      giftAfterFen: giftAfter,
      sourceId: rechargeId,
      requestId: input.requestId,
      reason: input.reason,
      metadata: { giftAllocation: allocation },
      timestamp
    })
    database
      .prepare(
        `UPDATE wallet_account
         SET principal_balance_fen = ?, gift_balance_fen = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(principalAfter, giftAfter, timestamp, wallet.id)
    if (input.principalFen >= 50_000) {
      database
        .prepare(
          `INSERT INTO membership_grant
           (id, tenant_id, store_id, member_id, source_type, source_id, granted_tier,
            reason, granted_by, granted_at)
           VALUES (?, ?, ?, ?, 'recharge', ?, 'advanced', ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          context.storeId,
          input.memberId,
          rechargeId,
          '单笔充值达到高级会员门槛',
          context.actor.id,
          timestamp
        )
    }
    const result: WalletOperationResult = {
      operationId: rechargeId,
      wallet: mapWallet({
        ...wallet,
        principal_balance_fen: principalAfter,
        gift_balance_fen: giftAfter,
        updated_at: timestamp
      }),
      principalDeltaFen: input.principalFen,
      giftDeltaFen: allocation.gift
    }
    appendWalletAuditAndOutbox(database, context, {
      action: 'wallet.cash_recharged',
      operationType: 'wallet.cash_recharged',
      aggregateId: wallet.id,
      reason: input.reason,
      before: mapWallet(wallet),
      after: result
    })
    appendMemberTierReconciliationInOpenTransaction(
      database,
      context,
      input.memberId,
      '现金充值后会员等级对账',
      timestamp
    )
    if (input.sourceFinancialCommand) {
      recordCompletedEmployeeFinancialCommandInOpenTransaction(
        database,
        context,
        {
          ...input.sourceFinancialCommand,
          commandType: 'cash_recharge',
          result: { type: 'cash_recharge', wallet: result },
          timestamp
        }
      )
    }
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function allocateDebit(
  database: DatabaseSync,
  context: WalletWriteContext,
  wallet: WalletRow,
  ledgerId: string,
  expectedPrincipalFen: number,
  expectedGiftFen: number,
  timestamp: string
): { principalFen: number; giftFen: number } {
  const lots = database
    .prepare(
      `SELECT id, source_id, remaining_principal_fen, remaining_gift_fen
       FROM wallet_lot
       WHERE tenant_id = ? AND wallet_account_id = ?
         AND (remaining_gift_fen > 0 OR remaining_principal_fen > 0)
       ORDER BY created_at, rowid`
    )
    .all(context.tenantId, wallet.id) as LotRow[]
  let remainingGiftFen = expectedGiftFen
  let remainingPrincipalFen = expectedPrincipalFen
  let giftFen = 0
  let principalFen = 0
  const allocations = new Map<string, { principalFen: number; giftFen: number }>()

  for (const lot of lots) {
    if (remainingGiftFen <= 0) break
    const used = Math.min(lot.remaining_gift_fen, remainingGiftFen)
    if (used > 0) {
      giftFen += used
      remainingGiftFen -= used
      allocations.set(lot.id, { principalFen: 0, giftFen: used })
      lot.remaining_gift_fen -= used
    }
  }
  for (const lot of lots) {
    if (remainingPrincipalFen <= 0) break
    const used = Math.min(lot.remaining_principal_fen, remainingPrincipalFen)
    if (used > 0) {
      principalFen += used
      remainingPrincipalFen -= used
      const current = allocations.get(lot.id) ?? { principalFen: 0, giftFen: 0 }
      current.principalFen += used
      allocations.set(lot.id, current)
      lot.remaining_principal_fen -= used
    }
  }
  if (remainingGiftFen > 0 || remainingPrincipalFen > 0) {
    throw new Error('Wallet lots cannot satisfy the account balance allocation')
  }
  const updateLot = database.prepare(
    `UPDATE wallet_lot
     SET remaining_principal_fen = ?, remaining_gift_fen = ?, updated_at = ?
     WHERE id = ?`
  )
  const insertAllocation = database.prepare(
    `INSERT INTO wallet_ledger_allocation
     (id, tenant_id, ledger_id, lot_id, principal_fen, gift_fen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const lot of lots) {
    const used = allocations.get(lot.id)
    if (!used) continue
    updateLot.run(
      lot.remaining_principal_fen,
      lot.remaining_gift_fen,
      timestamp,
      lot.id
    )
    insertAllocation.run(
      randomUUID(),
      context.tenantId,
      ledgerId,
      lot.id,
      used.principalFen,
      used.giftFen,
      timestamp
    )
    database
      .prepare(
        `UPDATE wallet_recharge
         SET status = CASE
           WHEN status = 'completed' THEN 'partially_consumed'
           ELSE status
         END, updated_at = ?
         WHERE id = ?`
      )
      .run(timestamp, lot.source_id)
  }
  return { principalFen, giftFen }
}

export function debitWallet(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    requestId: string
    memberId: string
    amountFen: number
    reason: string
  }
): WalletOperationResult {
  nonNegativeFen(input.amountFen)
  if (input.amountFen <= 0) {
    throw new RangeError('Debit amount must be greater than zero')
  }
  const repeated = existingOperation(database, context, input.requestId, 'consumption_debit')
  if (repeated) {
    return repeated
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  requireMember(database, context.tenantId, input.memberId)

  database.exec('BEGIN IMMEDIATE')
  try {
    const result = debitWalletInOpenTransaction(database, context, input)
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function debitWalletInOpenTransaction(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    requestId: string
    memberId: string
    amountFen: number
    reason: string
    now?: Date
  }
): WalletOperationResult {
  nonNegativeFen(input.amountFen)
  if (input.amountFen <= 0) {
    throw new RangeError('Debit amount must be greater than zero')
  }
  const repeated = existingOperation(database, context, input.requestId, 'consumption_debit')
  if (repeated) {
    return repeated
  }
  requireMember(database, context.tenantId, input.memberId)
  const timestamp = (input.now ?? new Date()).toISOString()
  const debitId = randomUUID()
  const wallet = findWalletRow(database, context.tenantId, input.memberId)
  if (!wallet || wallet.status !== 'active') {
    throw new Error(wallet ? '储值账户已冻结' : '用户余额不足')
  }
  if (wallet.principal_balance_fen + wallet.gift_balance_fen < input.amountFen) {
    throw new Error('用户余额不足')
  }
  const ledgerId = randomUUID()
  const expectedGiftFen = Math.min(wallet.gift_balance_fen, input.amountFen)
  const expectedPrincipalFen = input.amountFen - expectedGiftFen
  const principalAfter = wallet.principal_balance_fen - expectedPrincipalFen
  const giftAfter = wallet.gift_balance_fen - expectedGiftFen
  database
    .prepare(
      `INSERT INTO wallet_ledger
       (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
        principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
        gift_balance_after_fen, source_id, related_ledger_id, request_id,
        actor_id, device_id, reason, metadata_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'consumption_debit', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ledgerId,
      context.tenantId,
      context.storeId,
      wallet.id,
      input.memberId,
      negativeDelta(expectedPrincipalFen),
      negativeDelta(expectedGiftFen),
      principalAfter,
      giftAfter,
      debitId,
      input.requestId,
      context.actor.id,
      context.deviceId,
      input.reason,
      JSON.stringify({ amountFen: input.amountFen }),
      timestamp
    )
  const used = allocateDebit(
    database,
    context,
    wallet,
    ledgerId,
    expectedPrincipalFen,
    expectedGiftFen,
    timestamp
  )
  if (
    used.principalFen !== expectedPrincipalFen ||
    used.giftFen !== expectedGiftFen
  ) {
    throw new Error('Wallet lot allocation does not match account balances')
  }
  database
    .prepare(
      `UPDATE wallet_account
       SET principal_balance_fen = ?, gift_balance_fen = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(principalAfter, giftAfter, timestamp, wallet.id)
  const result: WalletOperationResult = {
    operationId: debitId,
    wallet: mapWallet({
      ...wallet,
      principal_balance_fen: principalAfter,
      gift_balance_fen: giftAfter,
      updated_at: timestamp
    }),
    principalDeltaFen: negativeDelta(used.principalFen),
    giftDeltaFen: negativeDelta(used.giftFen)
  }
  appendWalletAuditAndOutbox(database, context, {
    action: 'wallet.debited',
    operationType: 'wallet.debited',
    aggregateId: wallet.id,
    reason: input.reason,
    before: mapWallet(wallet),
    after: result
  })
  return result
}

export function creditOrderRefundInOpenTransaction(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    requestId: string
    originalPaymentId: string
    refundPaymentId: string
    refundId: string
    amountFen: number
    reason: string
    timestamp: string
  }
): WalletOperationResult & { ledgerId: string } {
  nonNegativeFen(input.amountFen)
  if (input.amountFen <= 0) {
    throw new RangeError('Refund amount must be greater than zero')
  }
  const repeated = existingOperation(
    database,
    context,
    input.requestId,
    'order_refund_credit'
  )
  if (repeated) {
    const ledger = database
      .prepare(
        `SELECT id FROM wallet_ledger
         WHERE tenant_id = ? AND request_id = ? AND entry_type = 'order_refund_credit'`
      )
      .get(context.tenantId, input.requestId) as { id: string } | undefined
    if (!ledger) throw new Error('Refund wallet ledger is missing')
    return { ...repeated, ledgerId: ledger.id }
  }

  const original = database
    .prepare(
      `SELECT p.wallet_member_id, p.wallet_operation_id,
              l.id debit_ledger_id, l.principal_delta_fen, l.gift_delta_fen
       FROM order_payment p
       JOIN wallet_ledger l
         ON l.tenant_id = p.tenant_id
        AND l.source_id = p.wallet_operation_id
        AND l.entry_type = 'consumption_debit'
       WHERE p.tenant_id = ? AND p.id = ?
         AND p.payment_method = 'stored_value'
         AND p.status = 'completed'`
    )
    .get(context.tenantId, input.originalPaymentId) as
    | {
        wallet_member_id: string
        wallet_operation_id: string
        debit_ledger_id: string
        principal_delta_fen: number
        gift_delta_fen: number
      }
    | undefined
  if (!original) {
    throw new Error('Original stored-value payment was not found')
  }
  const originalPrincipalFen = Math.abs(original.principal_delta_fen)
  const originalGiftFen = Math.abs(original.gift_delta_fen)
  const restored = database
    .prepare(
      `SELECT COALESCE(SUM(principal_fen), 0) principal_fen,
              COALESCE(SUM(gift_fen), 0) gift_fen
       FROM wallet_refund_allocation
       WHERE tenant_id = ? AND original_debit_ledger_id = ?`
    )
    .get(context.tenantId, original.debit_ledger_id) as {
    principal_fen: number
    gift_fen: number
  }
  const availableGiftFen = originalGiftFen - restored.gift_fen
  const availablePrincipalFen = originalPrincipalFen - restored.principal_fen
  if (availableGiftFen < 0 || availablePrincipalFen < 0) {
    throw new Error('Refund allocations exceed the original wallet debit')
  }
  if (input.amountFen > availableGiftFen + availablePrincipalFen) {
    throw new Error('Refund exceeds the remaining stored-value payment')
  }
  const giftFen = Math.min(availableGiftFen, input.amountFen)
  const principalFen = input.amountFen - giftFen
  const wallet = findWalletRow(
    database,
    context.tenantId,
    original.wallet_member_id
  )
  if (!wallet) throw new Error('Original wallet account is missing')
  const principalAfter = wallet.principal_balance_fen + principalFen
  const giftAfter = wallet.gift_balance_fen + giftFen
  if (!Number.isSafeInteger(principalAfter) || !Number.isSafeInteger(giftAfter)) {
    throw new Error('Refund would exceed the supported wallet balance range')
  }
  const refundOperationId = randomUUID()
  const ledgerId = insertLedger(database, context, {
    wallet,
    memberId: original.wallet_member_id,
    entryType: 'order_refund_credit',
    principalDeltaFen: principalFen,
    giftDeltaFen: giftFen,
    principalAfterFen: principalAfter,
    giftAfterFen: giftAfter,
    sourceId: refundOperationId,
    relatedLedgerId: original.debit_ledger_id,
    requestId: input.requestId,
    reason: input.reason,
    metadata: {
      refundId: input.refundId,
      originalPaymentId: input.originalPaymentId,
      originalDebitLedgerId: original.debit_ledger_id,
      amountFen: input.amountFen
    },
    timestamp: input.timestamp
  })

  const allocations = database
    .prepare(
      `SELECT a.lot_id, a.principal_fen, a.gift_fen,
              COALESCE(SUM(r.principal_fen), 0) restored_principal_fen,
              COALESCE(SUM(r.gift_fen), 0) restored_gift_fen
       FROM wallet_ledger_allocation a
       LEFT JOIN wallet_refund_allocation r
         ON r.tenant_id = a.tenant_id
        AND r.original_debit_ledger_id = a.ledger_id
        AND r.lot_id = a.lot_id
       WHERE a.tenant_id = ? AND a.ledger_id = ?
       GROUP BY a.id, a.lot_id, a.principal_fen, a.gift_fen
       ORDER BY a.rowid`
    )
    .all(context.tenantId, original.debit_ledger_id) as Array<{
    lot_id: string
    principal_fen: number
    gift_fen: number
    restored_principal_fen: number
    restored_gift_fen: number
  }>
  let giftRemaining = giftFen
  let principalRemaining = principalFen
  const insertAllocation = database.prepare(
    `INSERT INTO wallet_refund_allocation
     (id, tenant_id, refund_payment_id, refund_ledger_id, original_debit_ledger_id,
      lot_id, principal_fen, gift_fen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const restoreLot = (
    lotId: string,
    restorePrincipalFen: number,
    restoreGiftFen: number
  ): void => {
    if (restorePrincipalFen <= 0 && restoreGiftFen <= 0) return
    const result = database
      .prepare(
        `UPDATE wallet_lot
         SET remaining_principal_fen = remaining_principal_fen + ?,
             remaining_gift_fen = remaining_gift_fen + ?,
             updated_at = ?
         WHERE tenant_id = ? AND id = ?
           AND remaining_principal_fen + ? <= original_principal_fen
           AND remaining_gift_fen + ? <= original_gift_fen`
      )
      .run(
        restorePrincipalFen,
        restoreGiftFen,
        input.timestamp,
        context.tenantId,
        lotId,
        restorePrincipalFen,
        restoreGiftFen
      )
    if (result.changes !== 1) {
      throw new Error('Wallet lot cannot accept the refund allocation')
    }
    insertAllocation.run(
      randomUUID(),
      context.tenantId,
      input.refundPaymentId,
      ledgerId,
      original.debit_ledger_id,
      lotId,
      restorePrincipalFen,
      restoreGiftFen,
      input.timestamp
    )
  }

  for (const allocation of allocations) {
    if (giftRemaining <= 0) break
    const available = allocation.gift_fen - allocation.restored_gift_fen
    const amount = Math.min(Math.max(available, 0), giftRemaining)
    restoreLot(allocation.lot_id, 0, amount)
    giftRemaining -= amount
  }
  for (const allocation of allocations) {
    if (principalRemaining <= 0) break
    const available =
      allocation.principal_fen - allocation.restored_principal_fen
    const amount = Math.min(Math.max(available, 0), principalRemaining)
    restoreLot(allocation.lot_id, amount, 0)
    principalRemaining -= amount
  }
  if (giftRemaining !== 0 || principalRemaining !== 0) {
    throw new Error('Original wallet debit allocations cannot satisfy the refund')
  }
  database
    .prepare(
      `UPDATE wallet_account
       SET principal_balance_fen = ?, gift_balance_fen = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(principalAfter, giftAfter, input.timestamp, wallet.id)

  const result: WalletOperationResult & { ledgerId: string } = {
    operationId: refundOperationId,
    ledgerId,
    wallet: mapWallet({
      ...wallet,
      principal_balance_fen: principalAfter,
      gift_balance_fen: giftAfter,
      updated_at: input.timestamp
    }),
    principalDeltaFen: principalFen,
    giftDeltaFen: giftFen
  }
  appendWalletAuditAndOutbox(database, context, {
    action: 'wallet.order_refund_credited',
    operationType: 'wallet.order_refund_credited',
    aggregateId: wallet.id,
    reason: input.reason,
    before: mapWallet(wallet),
    after: result
  })
  return result
}

export function reverseCashRecharge(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    requestId: string
    rechargeId: string
    reason: string
  }
): WalletOperationResult {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can reverse a cash recharge directly')
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = reverseCashRechargeInOpenTransaction(database, context, input)
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function reverseCashRechargeInOpenTransaction(
  database: DatabaseSync,
  context: WalletWriteContext,
  input: {
    requestId: string
    rechargeId: string
    reason: string
    now?: Date
  }
): WalletOperationResult {
  const repeated = existingOperation(
    database,
    context,
    input.requestId,
    'cash_recharge_reversal'
  )
  if (repeated) {
    return repeated
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const recharge = database
    .prepare(
      `SELECT r.id, r.member_id, r.wallet_account_id, r.status,
              l.id lot_id, l.remaining_principal_fen, l.remaining_gift_fen
       FROM wallet_recharge r
       JOIN wallet_lot l ON l.source_type = 'recharge' AND l.source_id = r.id
       WHERE r.tenant_id = ? AND r.id = ? AND r.payment_method = 'cash'`
    )
    .get(context.tenantId, input.rechargeId) as
    | {
        id: string
        member_id: string
        wallet_account_id: string
        status: string
        lot_id: string
        remaining_principal_fen: number
        remaining_gift_fen: number
      }
    | undefined
  if (!recharge) {
    throw new Error('Cash recharge was not found')
  }
  if (recharge.status === 'reversed') {
    throw new Error('Cash recharge has already been reversed')
  }
  if (recharge.remaining_principal_fen <= 0 && recharge.remaining_gift_fen <= 0) {
    throw new Error('Cash recharge has no refundable balance')
  }
  const timestamp = (input.now ?? new Date()).toISOString()
  const reversalId = randomUUID()

  const wallet = findWalletRow(database, context.tenantId, recharge.member_id)
  if (!wallet) {
    throw new Error('Wallet account is missing')
  }
  const principalAfter =
    wallet.principal_balance_fen - recharge.remaining_principal_fen
  const giftAfter = wallet.gift_balance_fen - recharge.remaining_gift_fen
  if (principalAfter < 0 || giftAfter < 0) {
    throw new Error('Wallet lot and account balances are inconsistent')
  }
  database
    .prepare(
      `UPDATE wallet_lot
       SET remaining_principal_fen = 0, remaining_gift_fen = 0, updated_at = ?
       WHERE id = ?`
    )
    .run(timestamp, recharge.lot_id)
  database
    .prepare("UPDATE wallet_recharge SET status = 'reversed', updated_at = ? WHERE id = ?")
    .run(timestamp, recharge.id)
  insertLedger(database, context, {
    wallet,
    memberId: recharge.member_id,
    entryType: 'cash_recharge_reversal',
    principalDeltaFen: negativeDelta(recharge.remaining_principal_fen),
    giftDeltaFen: negativeDelta(recharge.remaining_gift_fen),
    principalAfterFen: principalAfter,
    giftAfterFen: giftAfter,
    sourceId: reversalId,
    requestId: input.requestId,
    reason: input.reason,
    metadata: {
      rechargeId: recharge.id,
      cashRefundFen: recharge.remaining_principal_fen,
      giftReclaimedFen: recharge.remaining_gift_fen
    },
    timestamp
  })
  database
    .prepare(
      `UPDATE wallet_account
       SET principal_balance_fen = ?, gift_balance_fen = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(principalAfter, giftAfter, timestamp, wallet.id)
  database
    .prepare(
      `UPDATE membership_grant
       SET revoked_by = ?, revoked_at = ?, revoke_reason = ?
       WHERE tenant_id = ? AND source_type = 'recharge' AND source_id = ?
         AND revoked_at IS NULL`
    )
    .run(
      context.actor.id,
      timestamp,
      input.reason,
      context.tenantId,
      recharge.id
    )
  const result: WalletOperationResult = {
    operationId: reversalId,
    wallet: mapWallet({
      ...wallet,
      principal_balance_fen: principalAfter,
      gift_balance_fen: giftAfter,
      updated_at: timestamp
    }),
    principalDeltaFen: negativeDelta(recharge.remaining_principal_fen),
    giftDeltaFen: negativeDelta(recharge.remaining_gift_fen)
  }
  appendWalletAuditAndOutbox(database, context, {
    action: 'wallet.cash_recharge_reversed',
    operationType: 'wallet.cash_recharge_reversed',
    aggregateId: wallet.id,
    reason: input.reason,
    before: mapWallet(wallet),
    after: result
  })
  appendMemberTierReconciliationInOpenTransaction(
    database,
    context,
    recharge.member_id,
    '现金充值冲正后会员等级对账',
    timestamp
  )
  return result
}

export function reconstructWalletBalance(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): { principalBalanceFen: number; giftBalanceFen: number } {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(principal_delta_fen), 0) principal,
              COALESCE(SUM(gift_delta_fen), 0) gift
       FROM wallet_ledger
       WHERE tenant_id = ? AND member_id = ?`
    )
    .get(tenantId, memberId) as { principal: number; gift: number }
  return {
    principalBalanceFen: row.principal,
    giftBalanceFen: row.gift
  }
}
