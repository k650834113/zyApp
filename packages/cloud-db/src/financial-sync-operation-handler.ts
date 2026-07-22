import type { PoolClient } from 'pg'
import type { ReceivedOperation } from './sync-operation-handler'

type OperationResult = 'confirmed' | 'conflict'

export type FinancialHandlerSupport = {
  appendEvent(
    client: PoolClient,
    operation: ReceivedOperation,
    aggregateType: string
  ): Promise<number>
  completeOperation(
    client: PoolClient,
    operation: ReceivedOperation,
    aggregateType: string,
    serverVersion: number
  ): Promise<void>
  markConflict(
    client: PoolClient,
    operation: ReceivedOperation,
    conflictType: string,
    reason: string,
    serverPayload?: unknown
  ): Promise<OperationResult>
}

type WalletSnapshot = {
  accountId: string
  memberId: string
  status: 'active' | 'frozen'
  principalBalanceFen: number
  giftBalanceFen: number
  updatedAt: string
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
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

function integer(value: unknown, name: string, minimum?: number): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`)
  const result = Number(value)
  if (minimum !== undefined && result < minimum) {
    throw new Error(`${name} must be at least ${minimum}`)
  }
  return result
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`)
  return value
}

function timestamp(value: unknown, name: string, fallback: Date): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    if (value === null || value === undefined) return fallback.toISOString()
    throw new Error(`${name} must be an ISO timestamp`)
  }
  return new Date(value).toISOString()
}

function nullableTimestamp(
  value: unknown,
  name: string,
  fallback: Date
): string | null {
  if (value === null || value === undefined) return null
  return timestamp(value, name, fallback)
}

function afterSnapshot(operation: ReceivedOperation): Record<string, unknown> {
  return record(operation.payload_json.after, 'payload.after')
}

function parseWalletSnapshot(
  value: unknown,
  operation: ReceivedOperation
): WalletSnapshot {
  const wallet = record(value, 'wallet')
  const accountId = text(wallet.accountId, 'wallet.accountId')
  const principalBalanceFen = integer(
    wallet.principalBalanceFen,
    'wallet.principalBalanceFen',
    0
  )
  const giftBalanceFen = integer(
    wallet.giftBalanceFen,
    'wallet.giftBalanceFen',
    0
  )
  const totalBalanceFen = integer(
    wallet.totalBalanceFen,
    'wallet.totalBalanceFen',
    0
  )
  if (totalBalanceFen !== principalBalanceFen + giftBalanceFen) {
    throw new Error('wallet.totalBalanceFen does not match its balances')
  }
  return {
    accountId,
    memberId: text(wallet.memberId, 'wallet.memberId'),
    status: enumValue(
      wallet.status,
      ['active', 'frozen'] as const,
      'wallet.status'
    ),
    principalBalanceFen,
    giftBalanceFen,
    updatedAt: timestamp(
      wallet.updatedAt,
      'wallet.updatedAt',
      operation.occurred_at
    )
  }
}

async function confirmGiftTiers(
  client: PoolClient,
  operation: ReceivedOperation,
  support: FinancialHandlerSupport
): Promise<OperationResult> {
  let tiers: Array<{
    id: string
    principalFen: number
    giftFen: number
    active: boolean
  }>
  try {
    tiers = array(operation.payload_json.after, 'payload.after').map(
      (value, index) => {
        const tier = record(value, `payload.after[${index}]`)
        return {
          id: text(tier.id, `payload.after[${index}].id`),
          principalFen: integer(
            tier.principalFen,
            `payload.after[${index}].principalFen`,
            1
          ),
          giftFen: integer(
            tier.giftFen,
            `payload.after[${index}].giftFen`,
            0
          ),
          active: boolean(tier.active, `payload.after[${index}].active`)
        }
      }
    )
  } catch (error) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      error instanceof Error ? error.message : 'invalid gift tier payload'
    )
  }
  const principals = new Set(tiers.map((tier) => tier.principalFen))
  if (principals.size !== tiers.length) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      'gift tier principal amounts must be unique'
    )
  }
  const version = await support.appendEvent(
    client,
    operation,
    'recharge_gift_tier'
  )
  await client.query(
    `UPDATE cloud_recharge_gift_tier
     SET active = FALSE, server_version = $3, updated_at = $4
     WHERE tenant_id = $1 AND store_id = $2`,
    [
      operation.tenant_id,
      operation.store_id,
      version,
      operation.occurred_at
    ]
  )
  for (const tier of tiers) {
    await client.query(
      `INSERT INTO cloud_recharge_gift_tier
       (id, tenant_id, store_id, principal_fen, gift_fen, active,
        server_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (store_id, principal_fen) DO UPDATE SET
         gift_fen = EXCLUDED.gift_fen,
         active = EXCLUDED.active,
         server_version = EXCLUDED.server_version,
         updated_at = EXCLUDED.updated_at
       WHERE cloud_recharge_gift_tier.tenant_id = EXCLUDED.tenant_id`,
      [
        tier.id,
        operation.tenant_id,
        operation.store_id,
        tier.principalFen,
        tier.giftFen,
        tier.active,
        version,
        operation.occurred_at
      ]
    )
  }
  await support.completeOperation(
    client,
    operation,
    'recharge_gift_tier',
    version
  )
  return 'confirmed'
}

async function confirmWallet(
  client: PoolClient,
  operation: ReceivedOperation,
  support: FinancialHandlerSupport
): Promise<OperationResult> {
  if (operation.operation_type === 'wallet.gift_tiers.updated') {
    return confirmGiftTiers(client, operation, support)
  }
  let after: Record<string, unknown>
  let wallet: WalletSnapshot
  let principalDeltaFen: number
  let giftDeltaFen: number
  let sourceOperationId: string
  try {
    after = afterSnapshot(operation)
    wallet = parseWalletSnapshot(after.wallet, operation)
    principalDeltaFen = integer(
      after.principalDeltaFen,
      'wallet.principalDeltaFen'
    )
    giftDeltaFen = integer(after.giftDeltaFen, 'wallet.giftDeltaFen')
    sourceOperationId = text(after.operationId, 'wallet.operationId')
    if (wallet.accountId !== operation.aggregate_id) {
      throw new Error('wallet account id does not match the operation envelope')
    }
  } catch (error) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      error instanceof Error ? error.message : 'invalid wallet payload'
    )
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${operation.tenant_id}:${wallet.memberId}`
  ])
  const member = await client.query<{ id: string }>(
    `SELECT id FROM cloud_member
     WHERE tenant_id = $1 AND id = $2
     FOR UPDATE`,
    [operation.tenant_id, wallet.memberId]
  )
  if (!member.rows[0]) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      'wallet member does not exist in the cloud projection'
    )
  }
  const current = await client.query<{
    id: string
    tenant_id: string
    store_id: string
    member_id: string
    principal_balance_fen: string | number
    gift_balance_fen: string | number
  }>(
    `SELECT id, tenant_id, store_id, member_id, principal_balance_fen,
            gift_balance_fen
     FROM cloud_wallet_account
     WHERE id = $1
        OR (tenant_id = $2 AND member_id = $3)
     ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
     LIMIT 1
     FOR UPDATE`,
    [operation.aggregate_id, operation.tenant_id, wallet.memberId]
  )
  const account = current.rows[0]
  if (
    account &&
    (account.tenant_id !== operation.tenant_id ||
      account.member_id !== wallet.memberId)
  ) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      'wallet account belongs to another tenant or member',
      account
    )
  }
  const principalBalanceFen = account
    ? Number(account.principal_balance_fen) + principalDeltaFen
    : wallet.principalBalanceFen
  const giftBalanceFen = account
    ? Number(account.gift_balance_fen) + giftDeltaFen
    : wallet.giftBalanceFen
  if (
    !Number.isSafeInteger(principalBalanceFen) ||
    !Number.isSafeInteger(giftBalanceFen) ||
    principalBalanceFen < 0 ||
    giftBalanceFen < 0
  ) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      'wallet delta would create an invalid cloud balance',
      account
        ? {
            principalBalanceFen: Number(account.principal_balance_fen),
            giftBalanceFen: Number(account.gift_balance_fen)
          }
        : undefined
    )
  }
  if (
    !account &&
    (principalDeltaFen !== wallet.principalBalanceFen ||
      giftDeltaFen !== wallet.giftBalanceFen)
  ) {
    return support.markConflict(
      client,
      operation,
      'wallet_authority_conflict',
      'new wallet snapshot does not match its deltas'
    )
  }
  const authoritativeWalletId = account?.id ?? wallet.accountId
  const accountOriginStoreId = account?.store_id ?? operation.store_id
  const version = await support.appendEvent(client, operation, 'wallet')
  await client.query(
    `INSERT INTO cloud_wallet_account
     (id, tenant_id, store_id, member_id, status, principal_balance_fen,
      gift_balance_fen, server_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       principal_balance_fen = EXCLUDED.principal_balance_fen,
       gift_balance_fen = EXCLUDED.gift_balance_fen,
       server_version = EXCLUDED.server_version,
       updated_at = GREATEST(cloud_wallet_account.updated_at, EXCLUDED.updated_at)
     WHERE cloud_wallet_account.tenant_id = EXCLUDED.tenant_id
       AND cloud_wallet_account.member_id = EXCLUDED.member_id`,
    [
      authoritativeWalletId,
      operation.tenant_id,
      accountOriginStoreId,
      wallet.memberId,
      wallet.status,
      principalBalanceFen,
      giftBalanceFen,
      version,
      wallet.updatedAt
    ]
  )
  await client.query(
    `INSERT INTO cloud_wallet_ledger
     (operation_id, tenant_id, store_id, wallet_account_id, member_id,
      event_type, source_operation_id, principal_delta_fen, gift_delta_fen,
      principal_balance_after_fen, gift_balance_after_fen, reason,
      payload_json, server_version, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13::jsonb, $14, $15)`,
    [
      operation.operation_id,
      operation.tenant_id,
      operation.store_id,
      authoritativeWalletId,
      wallet.memberId,
      operation.operation_type,
      sourceOperationId,
      principalDeltaFen,
      giftDeltaFen,
      principalBalanceFen,
      giftBalanceFen,
      nullableText(operation.payload_json.reason, 'wallet.reason'),
      JSON.stringify(operation.payload_json),
      version,
      operation.occurred_at
    ]
  )
  await support.completeOperation(client, operation, 'wallet', version)
  return 'confirmed'
}

type MonthlyCardSnapshot = {
  id: string
  memberId: string
  planName: string
  priceFen: number
  paymentMethod: 'cash' | 'wechat'
  status: 'active' | 'paused' | 'expired' | 'refunded'
  purchasedAt: string
  startsAt: string
  expiresAt: string
  pausedAt: string | null
  usageCount: number
  scopeType: 'tenant' | 'store'
  issuingStoreId: string
}

function parseMonthlyCard(
  value: unknown,
  operation: ReceivedOperation
): MonthlyCardSnapshot {
  const card = record(value, 'monthlyCard')
  return {
    id: text(card.id, 'monthlyCard.id'),
    memberId: text(card.memberId, 'monthlyCard.memberId'),
    planName: text(card.planName, 'monthlyCard.planName'),
    priceFen: integer(card.priceFen, 'monthlyCard.priceFen', 1),
    paymentMethod: enumValue(
      card.paymentMethod,
      ['cash', 'wechat'] as const,
      'monthlyCard.paymentMethod'
    ),
    status: enumValue(
      card.status,
      ['active', 'paused', 'expired', 'refunded'] as const,
      'monthlyCard.status'
    ),
    purchasedAt: timestamp(
      card.purchasedAt,
      'monthlyCard.purchasedAt',
      operation.occurred_at
    ),
    startsAt: timestamp(
      card.startsAt,
      'monthlyCard.startsAt',
      operation.occurred_at
    ),
    expiresAt: timestamp(
      card.expiresAt,
      'monthlyCard.expiresAt',
      operation.occurred_at
    ),
    pausedAt: nullableTimestamp(
      card.pausedAt,
      'monthlyCard.pausedAt',
      operation.occurred_at
    ),
    usageCount: integer(card.usageCount, 'monthlyCard.usageCount', 0),
    scopeType:
      card.scopeType === undefined
        ? 'store'
        : enumValue(card.scopeType, ['tenant', 'store'] as const, 'monthlyCard.scopeType'),
    issuingStoreId:
      card.issuingStoreId === undefined
        ? operation.store_id
        : text(card.issuingStoreId, 'monthlyCard.issuingStoreId')
  }
}

async function confirmMonthlyCard(
  client: PoolClient,
  operation: ReceivedOperation,
  support: FinancialHandlerSupport
): Promise<OperationResult> {
  let card: MonthlyCardSnapshot
  try {
    card = parseMonthlyCard(afterSnapshot(operation), operation)
    if (card.id !== operation.aggregate_id) {
      throw new Error('monthly card id does not match the operation envelope')
    }
  } catch (error) {
    return support.markConflict(
      client,
      operation,
      'monthly_card_state_conflict',
      error instanceof Error ? error.message : 'invalid monthly card payload'
    )
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${operation.tenant_id}:${card.memberId}`
  ])
  const current = await client.query<{
    tenant_id: string
    store_id: string
    member_id: string
    status: MonthlyCardSnapshot['status']
    usage_count: number
    expires_at: Date | string
    scope_type: 'tenant' | 'store'
  }>(
    `SELECT tenant_id, store_id, member_id, status, usage_count, expires_at, scope_type
     FROM cloud_monthly_card WHERE id = $1 LIMIT 1 FOR UPDATE`,
    [card.id]
  )
  const existing = current.rows[0]
  if (
    existing &&
    (existing.tenant_id !== operation.tenant_id ||
      existing.member_id !== card.memberId ||
      existing.store_id !== card.issuingStoreId ||
      (existing.scope_type === 'store' && existing.store_id !== operation.store_id))
  ) {
    return support.markConflict(
      client,
      operation,
      'monthly_card_state_conflict',
      'monthly card does not belong to this tenant, member, or eligible store',
      existing
    )
  }
  if (
    !existing &&
    operation.operation_type !== 'monthly_card.purchased' &&
    operation.operation_type !== 'monthly_card.snapshot' &&
    !operation.payload_json.before
  ) {
    return support.markConflict(
      client,
      operation,
      'monthly_card_state_conflict',
      'monthly card must be purchased before other state changes'
    )
  }
  if (!existing && operation.payload_json.before) {
    try {
      const before = parseMonthlyCard(
        operation.payload_json.before,
        operation
      )
      if (before.id !== card.id || before.memberId !== card.memberId) {
        throw new Error('monthly card before snapshot has different ownership')
      }
    } catch (error) {
      return support.markConflict(
        client,
        operation,
        'monthly_card_state_conflict',
        error instanceof Error
          ? error.message
          : 'invalid monthly card before snapshot'
      )
    }
  }
  if (existing) {
    const beforeValue = operation.payload_json.before
    if (!beforeValue) {
      return support.markConflict(
        client,
        operation,
        'monthly_card_state_conflict',
        'existing monthly card operation is missing its before snapshot'
      )
    }
    let before: MonthlyCardSnapshot
    try {
      before = parseMonthlyCard(beforeValue, operation)
    } catch (error) {
      return support.markConflict(
        client,
        operation,
        'monthly_card_state_conflict',
        error instanceof Error ? error.message : 'invalid monthly card before snapshot'
      )
    }
    if (
      existing.status !== before.status ||
      Number(existing.usage_count) !== before.usageCount ||
      new Date(existing.expires_at).toISOString() !== before.expiresAt
    ) {
      return support.markConflict(
        client,
        operation,
        'monthly_card_state_conflict',
        'cloud monthly card state changed since the local operation began',
        {
          status: existing.status,
          usageCount: Number(existing.usage_count),
          expiresAt: new Date(existing.expires_at).toISOString()
        }
      )
    }
  }
  if (operation.operation_type === 'monthly_card.manual_extended') {
    const manager = await client.query(
      `SELECT 1 FROM cloud_employee employee
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
       WHERE employee.id = $1 AND employee.tenant_id = $2
         AND employee.status = 'active'
         AND access.store_id = $3 AND access.role = 'manager'
         AND access.status = 'active'`,
      [operation.actor_id, operation.tenant_id, operation.store_id]
    )
    if (!manager.rows[0]) {
      return support.markConflict(
        client,
        operation,
        'monthly_card_state_conflict',
        'only an active manager of the occurrence store can extend a monthly card'
      )
    }
    const before = parseMonthlyCard(operation.payload_json.before, operation)
    const reason = nullableText(operation.payload_json.reason, 'monthlyCard.reason')?.trim() ?? ''
    const baseTime = Math.max(
      new Date(before.expiresAt).getTime(),
      operation.occurred_at.getTime()
    )
    const extensionDays =
      (new Date(card.expiresAt).getTime() - baseTime) / (24 * 60 * 60 * 1000)
    if (
      reason.length < 2 ||
      before.status === 'refunded' ||
      !Number.isInteger(extensionDays) ||
      extensionDays < 1 ||
      extensionDays > 365 ||
      (before.status === 'paused' && card.status !== 'paused') ||
      (before.status === 'expired' && card.status !== 'active')
    ) {
      return support.markConflict(
        client,
        operation,
        'monthly_card_state_conflict',
        'manual extension violates the 1-365 day, reason, or state-transition rule'
      )
    }
  }
  const anotherCurrent = await client.query<{ id: string }>(
    `SELECT id FROM cloud_monthly_card
     WHERE tenant_id = $1 AND member_id = $2
       AND status IN ('active', 'paused') AND id <> $3
       AND (
         scope_type = 'tenant'
         OR $4 = 'tenant'
         OR store_id = $5
       )
     LIMIT 1`,
    [operation.tenant_id, card.memberId, card.id, card.scopeType, card.issuingStoreId]
  )
  if (
    anotherCurrent.rows[0] &&
    (card.status === 'active' || card.status === 'paused')
  ) {
    return support.markConflict(
      client,
      operation,
      'monthly_card_state_conflict',
      'member already has another active or paused monthly card',
      { cardId: anotherCurrent.rows[0].id }
    )
  }
  const version = await support.appendEvent(client, operation, 'monthly_card')
  await client.query(
    `INSERT INTO cloud_monthly_card
     (id, tenant_id, store_id, member_id, plan_name, price_fen,
      payment_method, status, purchased_at, starts_at, expires_at, paused_at,
      usage_count, server_version, updated_at, scope_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       expires_at = EXCLUDED.expires_at,
       paused_at = EXCLUDED.paused_at,
       usage_count = EXCLUDED.usage_count,
       server_version = EXCLUDED.server_version,
       updated_at = EXCLUDED.updated_at
     WHERE cloud_monthly_card.tenant_id = EXCLUDED.tenant_id
       AND cloud_monthly_card.store_id = EXCLUDED.store_id
       AND cloud_monthly_card.member_id = EXCLUDED.member_id`,
    [
      card.id,
      operation.tenant_id,
      card.issuingStoreId,
      card.memberId,
      card.planName,
      card.priceFen,
      card.paymentMethod,
      card.status,
      card.purchasedAt,
      card.startsAt,
      card.expiresAt,
      card.pausedAt,
      card.usageCount,
      version,
      operation.occurred_at,
      card.scopeType
    ]
  )
  await client.query(
    `INSERT INTO cloud_monthly_card_event
     (operation_id, tenant_id, store_id, card_id, member_id, event_type,
      reason, payload_json, server_version, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
    [
      operation.operation_id,
      operation.tenant_id,
      operation.store_id,
      card.id,
      card.memberId,
      operation.operation_type.replace('monthly_card.', ''),
      nullableText(operation.payload_json.reason, 'monthlyCard.reason'),
      JSON.stringify(operation.payload_json),
      version,
      operation.occurred_at
    ]
  )
  await support.completeOperation(client, operation, 'monthly_card', version)
  return 'confirmed'
}

type OrderItem = {
  id: string
  catalogItemId: string
  itemName: string
  itemType: 'admission' | 'product' | 'service' | 'activity' | 'custom'
  regularPriceFen: number
  advancedPriceFen: number
  appliedUnitPriceFen: number
  pricingTier: 'regular' | 'advanced'
  quantity: number
  lineTotalFen: number
  benefitType: 'none' | 'birthday' | 'monthly_card' | 'repeat_admission'
  beneficiaryMemberId: string | null
}

function parseOrderItem(value: unknown, index: number): OrderItem {
  const item = record(value, `order.items[${index}]`)
  const appliedUnitPriceFen = integer(
    item.appliedUnitPriceFen,
    `order.items[${index}].appliedUnitPriceFen`,
    0
  )
  const quantity = integer(item.quantity, `order.items[${index}].quantity`, 1)
  const lineTotalFen = integer(
    item.lineTotalFen,
    `order.items[${index}].lineTotalFen`,
    0
  )
  if (lineTotalFen !== appliedUnitPriceFen * quantity) {
    throw new Error(`order.items[${index}].lineTotalFen is inconsistent`)
  }
  return {
    id: text(item.id, `order.items[${index}].id`),
    catalogItemId: text(
      item.catalogItemId,
      `order.items[${index}].catalogItemId`
    ),
    itemName: text(item.itemName, `order.items[${index}].itemName`),
    itemType: enumValue(
      item.itemType,
      ['admission', 'product', 'service', 'activity', 'custom'] as const,
      `order.items[${index}].itemType`
    ),
    regularPriceFen: integer(
      item.regularPriceFen,
      `order.items[${index}].regularPriceFen`,
      0
    ),
    advancedPriceFen: integer(
      item.advancedPriceFen,
      `order.items[${index}].advancedPriceFen`,
      0
    ),
    appliedUnitPriceFen,
    pricingTier: enumValue(
      item.pricingTier,
      ['regular', 'advanced'] as const,
      `order.items[${index}].pricingTier`
    ),
    quantity,
    lineTotalFen,
    benefitType: enumValue(
      item.benefitType,
      ['none', 'birthday', 'monthly_card', 'repeat_admission'] as const,
      `order.items[${index}].benefitType`
    ),
    beneficiaryMemberId: nullableText(
      item.beneficiaryMemberId,
      `order.items[${index}].beneficiaryMemberId`
    )
  }
}

async function confirmOrder(
  client: PoolClient,
  operation: ReceivedOperation,
  support: FinancialHandlerSupport
): Promise<OperationResult> {
  let order: Record<string, unknown>
  let items: OrderItem[]
  let totalFen: number
  try {
    order = record(operation.payload_json, 'order')
    if (text(order.id, 'order.id') !== operation.aggregate_id) {
      throw new Error('order id does not match the operation envelope')
    }
    enumValue(order.status, ['completed'] as const, 'order.status')
    items = array(order.items, 'order.items').map(parseOrderItem)
    if (items.length < 1) throw new Error('order.items cannot be empty')
    totalFen = integer(order.totalFen, 'order.totalFen', 0)
    if (items.reduce((sum, item) => sum + item.lineTotalFen, 0) !== totalFen) {
      throw new Error('order.totalFen does not match item totals')
    }
  } catch (error) {
    return support.markConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid order payload'
    )
  }
  const duplicate = await client.query<{
    id: string
    tenant_id: string
    store_id: string
  }>(
    `SELECT id, tenant_id, store_id FROM cloud_sales_order
     WHERE id = $1 OR (tenant_id = $2 AND order_number = $3)
     LIMIT 1`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      text(order.orderNumber, 'order.orderNumber')
    ]
  )
  if (duplicate.rows[0]) {
    return support.markConflict(
      client,
      operation,
      'unknown',
      'completed order id or order number already exists in the cloud',
      duplicate.rows[0]
    )
  }
  const version = await support.appendEvent(client, operation, 'sales_order')
  await client.query(
    `INSERT INTO cloud_sales_order
     (id, tenant_id, store_id, order_number, visit_batch_id,
      customer_member_id, payment_method, wallet_member_id, status, total_fen,
      note, completed_at, payload_json, server_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10, $11,
             $12::jsonb, $13)`,
    [
      operation.aggregate_id,
      operation.tenant_id,
      operation.store_id,
      text(order.orderNumber, 'order.orderNumber'),
      text(order.visitBatchId, 'order.visitBatchId'),
      nullableText(order.customerMemberId, 'order.customerMemberId'),
      enumValue(
        order.paymentMethod,
        ['cash', 'stored_value'] as const,
        'order.paymentMethod'
      ),
      nullableText(order.walletMemberId, 'order.walletMemberId'),
      totalFen,
      nullableText(order.note, 'order.note'),
      timestamp(order.completedAt, 'order.completedAt', operation.occurred_at),
      JSON.stringify(operation.payload_json),
      version
    ]
  )
  for (const item of items) {
    await client.query(
      `INSERT INTO cloud_sales_order_item
       (id, tenant_id, store_id, order_id, catalog_item_id, item_name,
        item_type, regular_price_fen, advanced_price_fen,
        applied_unit_price_fen, pricing_tier, quantity, line_total_fen,
        benefit_type, beneficiary_member_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15)`,
      [
        item.id,
        operation.tenant_id,
        operation.store_id,
        operation.aggregate_id,
        item.catalogItemId,
        item.itemName,
        item.itemType,
        item.regularPriceFen,
        item.advancedPriceFen,
        item.appliedUnitPriceFen,
        item.pricingTier,
        item.quantity,
        item.lineTotalFen,
        item.benefitType,
        item.beneficiaryMemberId
      ]
    )
  }
  await support.completeOperation(client, operation, 'sales_order', version)
  return 'confirmed'
}

async function confirmRefund(
  client: PoolClient,
  operation: ReceivedOperation,
  support: FinancialHandlerSupport,
  financial: boolean
): Promise<OperationResult> {
  let after: Record<string, unknown>
  try {
    after = afterSnapshot(operation)
    if (text(after.id, 'refund.id') !== operation.aggregate_id) {
      throw new Error('refund id does not match the operation envelope')
    }
  } catch (error) {
    return support.markConflict(
      client,
      operation,
      'unknown',
      error instanceof Error ? error.message : 'invalid refund payload'
    )
  }
  const table = financial
    ? 'cloud_financial_refund_request'
    : 'cloud_refund_request'
  const current = await client.query<{
    tenant_id: string
    store_id: string
    status: string
  }>(
    `SELECT tenant_id, store_id, status FROM ${table}
     WHERE id = $1 LIMIT 1`,
    [operation.aggregate_id]
  )
  const existing = current.rows[0]
  if (
    existing &&
    (existing.tenant_id !== operation.tenant_id ||
      existing.store_id !== operation.store_id)
  ) {
    return support.markConflict(
      client,
      operation,
      'unknown',
      'refund belongs to another tenant or store',
      existing
    )
  }
  if (existing && operation.payload_json.before) {
    const before = record(operation.payload_json.before, 'refund.before')
    if (existing.status !== text(before.status, 'refund.before.status')) {
      return support.markConflict(
        client,
        operation,
        'unknown',
        'cloud refund state changed since the local operation began',
        existing
      )
    }
  }
  const status = enumValue(
    after.status,
    ['pending', 'completed', 'rejected'] as const,
    'refund.status'
  )
  const version = await support.appendEvent(
    client,
    operation,
    financial ? 'financial_refund' : 'refund'
  )
  if (financial) {
    await client.query(
      `INSERT INTO cloud_financial_refund_request
       (id, tenant_id, store_id, request_number, target_type, target_id,
        member_id, payment_method, status, refund_principal_fen,
        reclaim_gift_fen, requested_by, requested_at, completed_at,
        payload_json, server_version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15::jsonb, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         completed_at = EXCLUDED.completed_at,
         payload_json = EXCLUDED.payload_json,
         server_version = EXCLUDED.server_version,
         updated_at = EXCLUDED.updated_at
       WHERE cloud_financial_refund_request.tenant_id = EXCLUDED.tenant_id
         AND cloud_financial_refund_request.store_id = EXCLUDED.store_id`,
      [
        operation.aggregate_id,
        operation.tenant_id,
        operation.store_id,
        text(after.requestNumber, 'financialRefund.requestNumber'),
        enumValue(
          after.targetType,
          ['monthly_card', 'cash_recharge'] as const,
          'financialRefund.targetType'
        ),
        text(after.targetId, 'financialRefund.targetId'),
        text(after.memberId, 'financialRefund.memberId'),
        enumValue(
          after.paymentMethod,
          ['cash', 'wechat'] as const,
          'financialRefund.paymentMethod'
        ),
        status,
        integer(
          after.refundPrincipalFen,
          'financialRefund.refundPrincipalFen',
          1
        ),
        integer(after.reclaimGiftFen, 'financialRefund.reclaimGiftFen', 0),
        text(after.requestedBy, 'financialRefund.requestedBy'),
        timestamp(
          after.requestedAt,
          'financialRefund.requestedAt',
          operation.occurred_at
        ),
        nullableTimestamp(
          after.completedAt,
          'financialRefund.completedAt',
          operation.occurred_at
        ),
        JSON.stringify(after),
        version,
        operation.occurred_at
      ]
    )
    await client.query(
      `INSERT INTO cloud_financial_refund_event
       (operation_id, tenant_id, store_id, financial_refund_id, event_type,
        payload_json, server_version, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        operation.operation_id,
        operation.tenant_id,
        operation.store_id,
        operation.aggregate_id,
        operation.operation_type,
        JSON.stringify(operation.payload_json),
        version,
        operation.occurred_at
      ]
    )
  } else {
    await client.query(
      `INSERT INTO cloud_refund_request
       (id, tenant_id, store_id, refund_number, order_id, order_number,
        payment_method, wallet_member_id, status, total_fen, requested_by,
        requested_at, completed_at, payload_json, server_version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14::jsonb, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         completed_at = EXCLUDED.completed_at,
         payload_json = EXCLUDED.payload_json,
         server_version = EXCLUDED.server_version,
         updated_at = EXCLUDED.updated_at
       WHERE cloud_refund_request.tenant_id = EXCLUDED.tenant_id
         AND cloud_refund_request.store_id = EXCLUDED.store_id`,
      [
        operation.aggregate_id,
        operation.tenant_id,
        operation.store_id,
        text(after.refundNumber, 'refund.refundNumber'),
        text(after.orderId, 'refund.orderId'),
        text(after.orderNumber, 'refund.orderNumber'),
        enumValue(
          after.paymentMethod,
          ['cash', 'stored_value'] as const,
          'refund.paymentMethod'
        ),
        nullableText(after.walletMemberId, 'refund.walletMemberId'),
        status,
        integer(after.totalFen, 'refund.totalFen', 1),
        text(after.requestedBy, 'refund.requestedBy'),
        timestamp(
          after.requestedAt,
          'refund.requestedAt',
          operation.occurred_at
        ),
        nullableTimestamp(
          after.completedAt,
          'refund.completedAt',
          operation.occurred_at
        ),
        JSON.stringify(after),
        version,
        operation.occurred_at
      ]
    )
    await client.query(
      `INSERT INTO cloud_refund_event
       (operation_id, tenant_id, store_id, refund_id, event_type,
        payload_json, server_version, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        operation.operation_id,
        operation.tenant_id,
        operation.store_id,
        operation.aggregate_id,
        operation.operation_type,
        JSON.stringify(operation.payload_json),
        version,
        operation.occurred_at
      ]
    )
  }
  await support.completeOperation(
    client,
    operation,
    financial ? 'financial_refund' : 'refund',
    version
  )
  return 'confirmed'
}

export async function processFinancialSyncOperation(
  client: PoolClient,
  operation: ReceivedOperation,
  support: FinancialHandlerSupport
): Promise<OperationResult | 'unsupported'> {
  if (
    [
      'wallet.cash_recharged',
      'wallet.debited',
      'wallet.order_refund_credited',
      'wallet.cash_recharge_reversed',
      'wallet.gift_tiers.updated',
      'wallet.snapshot'
    ].includes(operation.operation_type)
  ) {
    return confirmWallet(client, operation, support)
  }
  if (
    [
      'monthly_card.purchased',
      'monthly_card.paused',
      'monthly_card.resumed',
      'monthly_card.used',
      'monthly_card.refunded',
      'monthly_card.expired',
      'monthly_card.manual_extended',
      'monthly_card.snapshot'
    ].includes(operation.operation_type)
  ) {
    return confirmMonthlyCard(client, operation, support)
  }
  if (operation.operation_type === 'order.completed') {
    return confirmOrder(client, operation, support)
  }
  if (
    [
      'financial_refund.requested',
      'financial_refund.completed',
      'financial_refund.rejected'
    ].includes(operation.operation_type)
  ) {
    return confirmRefund(client, operation, support, true)
  }
  if (
    ['refund.requested', 'refund.completed', 'refund.rejected'].includes(
      operation.operation_type
    )
  ) {
    return confirmRefund(client, operation, support, false)
  }
  return 'unsupported'
}
