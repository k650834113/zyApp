import { beginFinancialTransaction, commitFinancialTransaction } from './financial-transaction'
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateOrderLineRequest,
  OrderBenefitType,
  OrderPaymentMethod,
  OrderPricingTier,
  SalesOrderItemSummary,
  SalesOrderSummary
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import {
  recordCompletedCashierCommand,
  recordCompletedCashierCommandInOpenTransaction
} from './cashier-command'
import { useMonthlyCardInOpenTransaction } from './monthly-card'
import { debitWalletInOpenTransaction } from './wallet'
import { assertCloudMirrorSafeForFinancialWrite } from './cloud-runtime'

type OrderContext = StoreContext & {
  actor: EmployeeRecord
}

type CatalogPriceRow = {
  id: string
  name: string
  item_type: SalesOrderItemSummary['itemType']
  regular_price_fen: number
  advanced_price_fen: number
  status: string
  availability: string
}

type MemberPricingRow = {
  id: string
  birthday_month: number | null
  birthday_day: number | null
  advanced_grants: number
}

const CUSTOM_COLLECTION_CODE = '__CUSTOM_COLLECTION__'

function shanghaiDateParts(now: Date): { year: number; month: number; day: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value)
  const year = value('year')
  const month = value('month')
  const day = value('day')
  return {
    year,
    month,
    day,
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
}

function isBirthday(member: MemberPricingRow, now: Date): boolean {
  if (member.birthday_month === null || member.birthday_day === null) return false
  const current = shanghaiDateParts(now)
  if (member.birthday_month === 2 && member.birthday_day === 29 && !isLeapYear(current.year)) {
    return current.month === 3 && current.day === 1
  }
  return current.month === member.birthday_month && current.day === member.birthday_day
}

function getMemberPricing(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): MemberPricingRow {
  const row = database
    .prepare(
      `SELECT m.id, m.birthday_month, m.birthday_day,
        COUNT(CASE WHEN g.id IS NOT NULL AND g.revoked_at IS NULL THEN 1 END)
          advanced_grants
       FROM member m
       LEFT JOIN membership_grant g ON g.member_id = m.id
       WHERE m.tenant_id = ? AND m.id = ? AND m.status = 'active'
       GROUP BY m.id`
    )
    .get(tenantId, memberId) as MemberPricingRow | undefined
  if (!row) throw new Error('Member was not found or is disabled')
  return row
}

function getCatalogPrice(
  database: DatabaseSync,
  context: StoreContext,
  itemId: string
): CatalogPriceRow {
  const configured = Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_store_config'`
  ).get())
  const row = database
    .prepare(
      configured
        ? `SELECT item.id, item.name, item.item_type,
                  COALESCE(config.regular_price_fen, item.regular_price_fen) regular_price_fen,
                  COALESCE(config.advanced_price_fen, item.advanced_price_fen) advanced_price_fen,
                  COALESCE(config.status, item.status) status,
                  COALESCE(config.availability, item.availability) availability
           FROM catalog_item item
           LEFT JOIN catalog_store_config config
             ON config.tenant_id = item.tenant_id AND config.store_id = ?
            AND config.catalog_item_id = item.id
           WHERE item.tenant_id = ? AND item.id = ?`
        : `SELECT id, name, item_type, regular_price_fen, advanced_price_fen,
                  status, availability
           FROM catalog_item WHERE tenant_id = ? AND id = ?`
    )
    .get(...(configured
      ? [context.storeId, context.tenantId, itemId]
      : [context.tenantId, itemId])) as CatalogPriceRow | undefined
  if (!row) throw new Error('Catalog item was not found')
  if (row.status !== 'active') throw new Error(`${row.name} 已停用，不能加入订单`)
  if (row.availability !== 'available') throw new Error(`${row.name} 已售罄`)
  return row
}

function getCustomCollectionCatalog(
  database: DatabaseSync,
  context: StoreContext,
  input: { name: string; unitPriceFen: number; timestamp: string }
): CatalogPriceRow {
  const existing = database
    .prepare(
      `SELECT id FROM catalog_item
       WHERE tenant_id = ? AND store_id = ? AND code = ?`
    )
    .get(context.tenantId, context.storeId, CUSTOM_COLLECTION_CODE) as
    | { id: string }
    | undefined
  const id = existing?.id ?? randomUUID()
  if (!existing) {
    database
      .prepare(
        `INSERT INTO catalog_item
         (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
          advanced_price_fen, status, availability, note, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, '自定义收款', 'service', 0, 0, 'active', 'available',
                 '系统内部占位项目，不在收费目录显示', 'desktop', ?, ?)`
      )
      .run(
        id,
        context.tenantId,
        context.storeId,
        CUSTOM_COLLECTION_CODE,
        input.timestamp,
        input.timestamp
      )
  }
  return {
    id,
    name: input.name,
    item_type: 'service',
    regular_price_fen: input.unitPriceFen,
    advanced_price_fen: input.unitPriceFen,
    status: 'active',
    availability: 'available'
  }
}

function currentMonthlyCard(
  database: DatabaseSync,
  tenantId: string,
  storeId: string,
  memberId: string,
  now: Date
): { id: string } | null {
  const hasScope = Boolean(database.prepare(
    `SELECT 1 FROM pragma_table_info('monthly_card') WHERE name = 'scope_type'`
  ).get())
  const row = database
    .prepare(
      `SELECT id FROM monthly_card
       WHERE tenant_id = ? AND member_id = ? AND status = 'active'
         ${hasScope ? "AND (scope_type = 'tenant' OR store_id = ?)" : ''}
         AND starts_at <= ? AND expires_at > ?
       ORDER BY purchased_at DESC LIMIT 1`
    )
    .get(...(hasScope
      ? [tenantId, memberId, storeId, now.toISOString(), now.toISOString()]
      : [tenantId, memberId, now.toISOString(), now.toISOString()])) as
    | { id: string }
    | undefined
  return row ?? null
}

function determineAdmissionBenefit(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    member: MemberPricingRow
    now: Date
  }
): { benefitType: OrderBenefitType; monthlyCardId: string | null } {
  const businessDate = shanghaiDateParts(input.now).date
  const previous = database
    .prepare(
      `SELECT id FROM member_admission_record
       WHERE tenant_id = ? AND member_id = ?
         AND business_date = ?
       LIMIT 1`
    )
    .get(context.tenantId, input.member.id, businessDate)
  if (previous) return { benefitType: 'repeat_admission', monthlyCardId: null }
  if (isBirthday(input.member, input.now)) {
    return { benefitType: 'birthday', monthlyCardId: null }
  }
  const monthlyCard = currentMonthlyCard(
    database,
    context.tenantId,
    context.storeId,
    input.member.id,
    input.now
  )
  if (monthlyCard) {
    return { benefitType: 'monthly_card', monthlyCardId: monthlyCard.id }
  }
  return { benefitType: 'none', monthlyCardId: null }
}

function nextOrderNumber(now: Date, id: string): string {
  const date = shanghaiDateParts(now).date.replaceAll('-', '')
  return `O${date}-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`
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

function appendOrderAuditAndOutbox(
  database: DatabaseSync,
  context: OrderContext,
  order: SalesOrderSummary
): void {
  const payload = JSON.stringify(order)
  const sequence = nextDeviceSequence(database, context.deviceId, order.completedAt)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'order.completed', 'sales_order', ?,
               '前台完成收银', NULL, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      order.id,
      payload,
      order.completedAt
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json, payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'order.completed', ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      order.id,
      order.completedAt,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

function mapOrderItems(database: DatabaseSync, tenantId: string, orderId: string): SalesOrderItemSummary[] {
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

function findOrderById(
  database: DatabaseSync,
  tenantId: string,
  orderId: string
): SalesOrderSummary {
  const row = database
    .prepare(
      `SELECT orders.id, orders.order_number, orders.visit_batch_id,
              orders.customer_member_id, orders.payment_method,
              orders.wallet_member_id, payer.nickname member_nickname,
              orders.status, orders.total_fen, orders.note, orders.completed_at
       FROM sales_order orders
       LEFT JOIN member payer
         ON payer.tenant_id = orders.tenant_id
        AND payer.id = COALESCE(orders.wallet_member_id, orders.customer_member_id)
       WHERE orders.tenant_id = ? AND orders.id = ?`
    )
    .get(tenantId, orderId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Sales order was not found')
  return {
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
    items: mapOrderItems(database, tenantId, orderId)
  }
}

function existingOrder(
  database: DatabaseSync,
  tenantId: string,
  requestId: string
): SalesOrderSummary | null {
  const row = database
    .prepare('SELECT id FROM sales_order WHERE tenant_id = ? AND request_id = ?')
    .get(tenantId, requestId) as { id: string } | undefined
  return row ? findOrderById(database, tenantId, row.id) : null
}

function resolveVisitBatch(
  database: DatabaseSync,
  context: OrderContext,
  timestamp: string
): string {
  const id = randomUUID()
  database
    .prepare(
      `INSERT INTO visit_batch
       (id, tenant_id, store_id, status, started_at, completed_at, created_by, device_id)
       VALUES (?, ?, ?, 'open', ?, NULL, ?, ?)`
    )
    .run(
      id,
      context.tenantId,
      context.storeId,
      timestamp,
      context.actor.id,
      context.deviceId
    )
  return id
}

export function createSalesOrder(
  database: DatabaseSync,
  context: OrderContext,
  input: {
    requestId: string
    customerMemberId?: string
    paymentMethod: OrderPaymentMethod
    walletMemberId?: string
    lines: CreateOrderLineRequest[]
    note?: string
    now?: Date
    sourceCashierCommand?: {
      commandId: string
      requestedByEmployeeId: string
    }
  }
): SalesOrderSummary {
  const repeated = existingOrder(database, context.tenantId, input.requestId)
  if (repeated) {
    if (input.sourceCashierCommand) {
      recordCompletedCashierCommand(database, context, {
        ...input.sourceCashierCommand,
        order: repeated
      })
    }
    return repeated
  }
  assertCloudMirrorSafeForFinancialWrite(database, context, 'order')
  if (input.paymentMethod === 'stored_value') {
    assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  }
  if (input.lines.length === 0) throw new Error('Order must contain at least one item')
  if (input.paymentMethod === 'stored_value' && !input.walletMemberId) {
    throw new Error('Stored-value payment requires a wallet member')
  }
  if (input.paymentMethod === 'cash' && input.walletMemberId) {
    throw new Error('Cash payment cannot include a wallet member')
  }
  const personalLines = input.lines.filter(
    (line) => 'personalAdmissionBenefit' in line && line.personalAdmissionBenefit
  )
  if (personalLines.length > 1) {
    throw new Error('Only one personal admission benefit line is allowed per order')
  }
  if (personalLines.length > 0 && !input.customerMemberId) {
    throw new Error('Personal admission benefit requires an identified member')
  }

  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  const orderId = randomUUID()
  const orderNumber = nextOrderNumber(now, orderId)

  const transactionStart = beginFinancialTransaction(database)
  try {
    const visitBatchId = resolveVisitBatch(database, context, timestamp)
    const customerMember = input.customerMemberId
      ? getMemberPricing(database, context.tenantId, input.customerMemberId)
      : null
    if (input.walletMemberId) {
      getMemberPricing(database, context.tenantId, input.walletMemberId)
    }

    const preparedItems: Array<{
      id: string
      catalog: CatalogPriceRow
      appliedUnitPriceFen: number
      pricingTier: OrderPricingTier
      quantity: number
      lineTotalFen: number
      benefitType: OrderBenefitType
      beneficiaryMemberId: string | null
      monthlyCardId: string | null
    }> = []

    for (const line of input.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > 999) {
        throw new Error('Item quantity must be an integer between 1 and 999')
      }
      const isCustom = 'customName' in line
      const catalog = isCustom
        ? getCustomCollectionCatalog(database, context, {
            name: line.customName.trim(),
            unitPriceFen: line.customUnitPriceFen,
            timestamp
          })
        : getCatalogPrice(database, context, line.catalogItemId)
      let pricingTier = line.pricingTier
      let benefitType: OrderBenefitType = 'none'
      let monthlyCardId: string | null = null
      let beneficiaryMemberId: string | null = null
      let appliedUnitPriceFen =
        pricingTier === 'advanced'
          ? catalog.advanced_price_fen
          : catalog.regular_price_fen

      if (isCustom) {
        if (line.customName.trim().length < 1 || line.customName.trim().length > 60) {
          throw new Error('Custom collection name must contain 1-60 characters')
        }
        if (
          !Number.isSafeInteger(line.customUnitPriceFen) ||
          line.customUnitPriceFen <= 0
        ) {
          throw new Error('Custom collection amount must be a positive integer fen')
        }
        if (line.pricingTier !== 'regular') {
          throw new Error('Custom collection does not support member pricing tiers')
        }
      } else if (line.personalAdmissionBenefit) {
        if (catalog.item_type !== 'admission' || line.quantity !== 1 || !customerMember) {
          throw new Error('Personal admission benefit requires one admission item and a member')
        }
        beneficiaryMemberId = customerMember.id
        pricingTier = customerMember.advanced_grants > 0 ? 'advanced' : 'regular'
        appliedUnitPriceFen =
          pricingTier === 'advanced'
            ? catalog.advanced_price_fen
            : catalog.regular_price_fen
        const benefit = determineAdmissionBenefit(database, context, {
          member: customerMember,
          now
        })
        benefitType = benefit.benefitType
        monthlyCardId = benefit.monthlyCardId
        if (benefitType !== 'none') appliedUnitPriceFen = 0
      }

      const lineTotalFen = appliedUnitPriceFen * line.quantity
      if (!Number.isSafeInteger(lineTotalFen)) {
        throw new Error('Order item amount exceeds the supported range')
      }
      preparedItems.push({
        id: randomUUID(),
        catalog,
        appliedUnitPriceFen,
        pricingTier,
        quantity: line.quantity,
        lineTotalFen,
        benefitType,
        beneficiaryMemberId,
        monthlyCardId
      })
    }

    const totalFen = preparedItems.reduce((sum, item) => sum + item.lineTotalFen, 0)
    if (!Number.isSafeInteger(totalFen)) {
      throw new Error('Order total exceeds the supported range')
    }
    database
      .prepare(
        `INSERT INTO sales_order
         (id, tenant_id, store_id, visit_batch_id, order_number, customer_member_id,
          payment_method, wallet_member_id, status, total_fen, request_id, note,
          completed_by, device_id, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderId,
        context.tenantId,
        context.storeId,
        visitBatchId,
        orderNumber,
        input.customerMemberId ?? null,
        input.paymentMethod,
        input.walletMemberId ?? null,
        totalFen,
        input.requestId,
        input.note?.trim() || null,
        context.actor.id,
        context.deviceId,
        timestamp
      )
    const insertItem = database.prepare(
      `INSERT INTO sales_order_item
       (id, tenant_id, store_id, order_id, catalog_item_id, item_name_snapshot,
        item_type_snapshot, regular_price_fen_snapshot, advanced_price_fen_snapshot,
        applied_unit_price_fen, pricing_tier, quantity, line_total_fen,
        benefit_type, beneficiary_member_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const item of preparedItems) {
      insertItem.run(
        item.id,
        context.tenantId,
        context.storeId,
        orderId,
        item.catalog.id,
        item.catalog.name,
        item.catalog.item_type,
        item.catalog.regular_price_fen,
        item.catalog.advanced_price_fen,
        item.appliedUnitPriceFen,
        item.pricingTier,
        item.quantity,
        item.lineTotalFen,
        item.benefitType,
        item.beneficiaryMemberId
      )
      if (item.beneficiaryMemberId && item.catalog.item_type === 'admission') {
        const businessDate = shanghaiDateParts(now).date
        database
          .prepare(
            `INSERT OR IGNORE INTO member_admission_record
             (id, tenant_id, store_id, member_id, business_date, visit_batch_id,
              order_id, benefit_type, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            context.tenantId,
            context.storeId,
            item.beneficiaryMemberId,
            businessDate,
            visitBatchId,
            orderId,
            item.benefitType,
            timestamp
          )
        if (item.benefitType === 'birthday') {
          database
            .prepare(
              `INSERT OR IGNORE INTO birthday_benefit_usage
               (id, tenant_id, store_id, member_id, business_date, order_id, occurred_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              context.tenantId,
              context.storeId,
              item.beneficiaryMemberId,
              businessDate,
              orderId,
              timestamp
            )
        }
        if (item.benefitType === 'monthly_card' && item.monthlyCardId) {
          useMonthlyCardInOpenTransaction(database, context, {
            requestId: `order-monthly-${orderId}`,
            cardId: item.monthlyCardId,
            reason: `订单 ${orderNumber} 本人免入场`,
            now
          })
        }
      }
    }

    let walletOperationId: string | null = null
    if (input.paymentMethod === 'stored_value' && totalFen > 0 && input.walletMemberId) {
      walletOperationId = debitWalletInOpenTransaction(database, context, {
        requestId: `${input.requestId}:wallet`,
        memberId: input.walletMemberId,
        amountFen: totalFen,
        now,
        reason: `订单 ${orderNumber} 储值支付`
      }).operationId
    }
    database
      .prepare(
        `INSERT INTO order_payment
         (id, tenant_id, store_id, order_id, payment_method, amount_fen,
          wallet_member_id, wallet_operation_id, status, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
      )
      .run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        orderId,
        input.paymentMethod,
        totalFen,
        input.walletMemberId ?? null,
        walletOperationId,
        timestamp
      )
    const order = findOrderById(database, context.tenantId, orderId)
    appendOrderAuditAndOutbox(database, context, order)
    if (input.sourceCashierCommand) {
      recordCompletedCashierCommandInOpenTransaction(database, context, {
        ...input.sourceCashierCommand,
        order,
        timestamp
      })
    }
    commitFinancialTransaction(database, transactionStart)
    return order
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function listRecentOrders(
  database: DatabaseSync,
  context: StoreContext,
  limit: number
): SalesOrderSummary[] {
  const rows = database
    .prepare(
      `SELECT id FROM sales_order
       WHERE tenant_id = ? AND store_id = ?
       ORDER BY completed_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(context.tenantId, context.storeId, limit) as Array<{ id: string }>
  return rows.map((row) => findOrderById(database, context.tenantId, row.id))
}
