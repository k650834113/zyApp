import type {
  ListTransactionRecordsRequest,
  OrderBenefitType,
  OrderPaymentMethod,
  OrderPricingTier,
  RechargeTransactionSummary,
  SalesOrderItemSummary,
  SalesOrderSummary
} from '@zyapp/contracts'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { StoreContext } from './identity'

type QueryBoundaries = {
  query: string
  from: string | null
  toExclusive: string | null
  limit: number
}

function dateBoundary(value: string, field: 'from' | 'to'): string {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dayOnly ? `${value}T00:00:00+08:00` : value)
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`${field} must be a valid ISO date or timestamp`)
  }
  if (field === 'to' && dayOnly) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return date.toISOString()
}

function normalizeRequest(request: ListTransactionRecordsRequest = {}): QueryBoundaries {
  const limit = request.limit ?? 100
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('limit must be an integer between 1 and 500')
  }
  const from = request.from ? dateBoundary(request.from, 'from') : null
  const toExclusive = request.to ? dateBoundary(request.to, 'to') : null
  if (from && toExclusive && from >= toExclusive) {
    throw new RangeError('from must be earlier than to')
  }
  return {
    query: request.query?.trim().toLocaleLowerCase() ?? '',
    from,
    toExclusive,
    limit
  }
}

function mapOrderItems(
  database: DatabaseSync,
  tenantId: string,
  orderId: string
): SalesOrderItemSummary[] {
  return (
    database
      .prepare(
        `SELECT id, catalog_item_id, item_name_snapshot, item_type_snapshot,
                regular_price_fen_snapshot, advanced_price_fen_snapshot,
                applied_unit_price_fen, pricing_tier, quantity, line_total_fen,
                benefit_type, beneficiary_member_id
         FROM sales_order_item
         WHERE tenant_id = ? AND order_id = ?
         ORDER BY rowid`
      )
      .all(tenantId, orderId) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    catalogItemId: String(row.catalog_item_id),
    itemName: String(row.item_name_snapshot),
    itemType: row.item_type_snapshot as SalesOrderItemSummary['itemType'],
    regularPriceFen: Number(row.regular_price_fen_snapshot),
    advancedPriceFen: Number(row.advanced_price_fen_snapshot),
    appliedUnitPriceFen: Number(row.applied_unit_price_fen),
    pricingTier: row.pricing_tier as OrderPricingTier,
    quantity: Number(row.quantity),
    lineTotalFen: Number(row.line_total_fen),
    benefitType: row.benefit_type as OrderBenefitType,
    beneficiaryMemberId:
      row.beneficiary_member_id === null ? null : String(row.beneficiary_member_id)
  }))
}

export function listSalesTransactions(
  database: DatabaseSync,
  context: StoreContext,
  request: ListTransactionRecordsRequest = {}
): SalesOrderSummary[] {
  const boundaries = normalizeRequest(request)
  const conditions = ['orders.tenant_id = ?', 'orders.store_id = ?']
  const values: SQLInputValue[] = [context.tenantId, context.storeId]
  if (boundaries.from) {
    conditions.push('orders.completed_at >= ?')
    values.push(boundaries.from)
  }
  if (boundaries.toExclusive) {
    conditions.push('orders.completed_at < ?')
    values.push(boundaries.toExclusive)
  }
  if (boundaries.query) {
    conditions.push(
      `(LOWER(orders.order_number) LIKE ?
        OR LOWER(COALESCE(member.nickname, '')) LIKE ?
        OR LOWER(COALESCE(member.member_number, '')) LIKE ?
        OR COALESCE(member.phone, '') LIKE ?)`
    )
    const wildcard = `%${boundaries.query}%`
    values.push(wildcard, wildcard, wildcard, wildcard)
  }
  values.push(boundaries.limit)

  const rows = database
    .prepare(
      `SELECT orders.id, orders.order_number, orders.visit_batch_id,
              orders.customer_member_id, orders.payment_method,
              orders.wallet_member_id, member.nickname member_nickname,
              orders.total_fen, orders.note, orders.completed_at
       FROM sales_order orders
       LEFT JOIN member
         ON member.tenant_id = orders.tenant_id
        AND member.id = COALESCE(orders.wallet_member_id, orders.customer_member_id)
       WHERE ${conditions.join(' AND ')}
       ORDER BY orders.completed_at DESC, orders.rowid DESC
       LIMIT ?`
    )
    .all(...values) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: String(row.id),
    orderNumber: String(row.order_number),
    visitBatchId: String(row.visit_batch_id),
    customerMemberId:
      row.customer_member_id === null ? null : String(row.customer_member_id),
    paymentMethod: row.payment_method as OrderPaymentMethod,
    walletMemberId: row.wallet_member_id === null ? null : String(row.wallet_member_id),
    memberNickname: row.member_nickname === null ? null : String(row.member_nickname),
    status: 'completed',
    totalFen: Number(row.total_fen),
    note: row.note === null ? null : String(row.note),
    completedAt: String(row.completed_at),
    items: mapOrderItems(database, context.tenantId, String(row.id))
  }))
}

function maskPhone(phone: string): string {
  return phone.length >= 7
    ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
    : phone.replace(/.(?=.{2})/g, '*')
}

function cashOrderNumber(id: string): string {
  return `CR-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`
}

export function listRechargeTransactions(
  database: DatabaseSync,
  context: StoreContext,
  request: ListTransactionRecordsRequest = {}
): RechargeTransactionSummary[] {
  const boundaries = normalizeRequest(request)
  const cashConditions = [
    'recharge.tenant_id = ?',
    'recharge.store_id = ?',
    `recharge.payment_method = 'cash'`
  ]
  const cashValues: SQLInputValue[] = [context.tenantId, context.storeId]
  const wechatConditions = ['recharge.tenant_id = ?', 'recharge.store_id = ?']
  const wechatValues: SQLInputValue[] = [context.tenantId, context.storeId]

  for (const [conditions, values, dateColumn] of [
    [cashConditions, cashValues, 'recharge.occurred_at'],
    [wechatConditions, wechatValues, 'recharge.created_at']
  ] as const) {
    if (boundaries.from) {
      conditions.push(`${dateColumn} >= ?`)
      values.push(boundaries.from)
    }
    if (boundaries.toExclusive) {
      conditions.push(`${dateColumn} < ?`)
      values.push(boundaries.toExclusive)
    }
  }

  if (boundaries.query) {
    const wildcard = `%${boundaries.query}%`
    cashConditions.push(
      `(LOWER(member.nickname) LIKE ?
        OR LOWER(member.member_number) LIKE ?
        OR member.phone LIKE ?
        OR LOWER('CR-' || REPLACE(recharge.id, '-', '')) LIKE ?)`
    )
    cashValues.push(wildcard, wildcard, wildcard, wildcard)
    wechatConditions.push(
      `(LOWER(member.nickname) LIKE ?
        OR LOWER(member.member_number) LIKE ?
        OR member.phone LIKE ?
        OR LOWER(recharge.out_trade_no) LIKE ?)`
    )
    wechatValues.push(wildcard, wildcard, wildcard, wildcard)
  }

  const cashRows = database
    .prepare(
      `SELECT recharge.id, member.id member_id, member.nickname, member.phone,
              recharge.principal_fen, recharge.gift_fen, recharge.status,
              recharge.occurred_at
       FROM wallet_recharge recharge
       JOIN member ON member.tenant_id = recharge.tenant_id
                  AND member.id = recharge.member_id
       WHERE ${cashConditions.join(' AND ')}
       ORDER BY recharge.occurred_at DESC
       LIMIT ?`
    )
    .all(...cashValues, boundaries.limit) as Array<Record<string, unknown>>

  const wechatRows = database
    .prepare(
      `SELECT recharge.id, recharge.out_trade_no, member.id member_id,
              member.nickname, member.phone, recharge.provider_transaction_id,
              recharge.principal_fen, recharge.gift_fen, recharge.status,
              recharge.created_at, recharge.settled_at
       FROM wechat_recharge_order_mirror recharge
       JOIN member ON member.tenant_id = recharge.tenant_id
                  AND member.id = recharge.member_id
       WHERE ${wechatConditions.join(' AND ')}
       ORDER BY recharge.created_at DESC
       LIMIT ?`
    )
    .all(...wechatValues, boundaries.limit) as Array<Record<string, unknown>>

  const cashRecords: RechargeTransactionSummary[] = cashRows.map((row) => ({
    id: String(row.id),
    orderNumber: cashOrderNumber(String(row.id)),
    memberId: String(row.member_id),
    memberNickname: String(row.nickname),
    phoneMasked: maskPhone(String(row.phone)),
    channel: 'cash',
    principalFen: Number(row.principal_fen),
    giftFen: Number(row.gift_fen),
    totalCreditFen: Number(row.principal_fen) + Number(row.gift_fen),
    status: row.status === 'reversed' ? 'failed' : 'settled',
    providerTransactionId: null,
    createdAt: String(row.occurred_at),
    settledAt: String(row.occurred_at)
  }))
  const wechatRecords: RechargeTransactionSummary[] = wechatRows.map((row) => ({
    id: String(row.id),
    orderNumber: String(row.out_trade_no),
    memberId: String(row.member_id),
    memberNickname: String(row.nickname),
    phoneMasked: maskPhone(String(row.phone)),
    channel: 'wechat',
    principalFen: Number(row.principal_fen),
    giftFen: Number(row.gift_fen),
    totalCreditFen: Number(row.principal_fen) + Number(row.gift_fen),
    status:
      row.status === 'creating'
        ? 'pending_payment'
        : (row.status as RechargeTransactionSummary['status']),
    providerTransactionId:
      row.provider_transaction_id === null ? null : String(row.provider_transaction_id),
    createdAt: String(row.created_at),
    settledAt: row.settled_at === null ? null : String(row.settled_at)
  }))

  return [...cashRecords, ...wechatRecords]
    .sort((left, right) =>
      right.createdAt === left.createdAt
        ? right.id.localeCompare(left.id)
        : right.createdAt.localeCompare(left.createdAt)
    )
    .slice(0, boundaries.limit)
}
