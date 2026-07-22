import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { PERMISSIONS } from '@zyapp/auth'
import type {
  ActivityRechargeTier,
  ActivityStatus,
  ActivitySummary,
  ActivityType,
  BusinessReport,
  BusinessReportItem,
  BusinessReportRequest,
  CatalogItemType,
  EmployeeMobileCreateActivityRequest,
  EmployeeMobileSetActivityStatusRequest,
  EmployeeMobileUpdateActivityRequest,
  SaveActivityFields
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import { createHash, randomUUID } from 'node:crypto'
import type { MiniappPrincipal } from './miniapp-auth'
import { POSTGRES_POOL } from './infrastructure.module'

type ActivityRow = {
  id: string
  title: string
  summary: string
  content: string
  activity_type: ActivityType
  status: ActivityStatus
  starts_at: Date | string
  ends_at: Date | string
  pinned: boolean
  regular_price_fen: number | string | null
  advanced_price_fen: number | string | null
  allow_stored_value: boolean
  allow_wechat: boolean
  recharge_tiers_json: unknown
  created_at: Date | string
  updated_at: Date | string
}

type AmountRow = {
  count: number | string
  amount_fen: number | string
}

type WalletAmountRow = {
  count: number | string
  principal_fen: number | string
  gift_fen: number | string
}

type ItemRow = {
  item_name: string
  item_type: CatalogItemType
  quantity: number | string
  amount_fen: number | string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  name: string,
  min: number,
  max: number
): string {
  if (typeof value !== 'string') throw new Error(`${name} must be text`)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${name} must contain ${min}-${max} characters`)
  }
  return normalized
}

function requestId(value: unknown): string {
  const normalized = text(value, 'requestId', 8, 100)
  if (!REQUEST_ID_PATTERN.test(normalized)) {
    throw new Error('requestId is invalid')
  }
  return normalized
}

function uuid(value: unknown, name: string): string {
  const normalized = text(value, name, 36, 36).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${name} must be a UUID`)
  return normalized
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`)
  return value
}

function optionalFen(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must use non-negative integer fen`)
  }
  return Number(value)
}

function positiveFen(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${name} must use positive integer fen`)
  }
  return Number(value)
}

function nonNegativeFen(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must use non-negative integer fen`)
  }
  return Number(value)
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid timestamp`)
  }
  return new Date(value).toISOString()
}

function activityFields(value: Record<string, unknown>): SaveActivityFields {
  const activityType = value.activityType
  if (activityType !== 'recharge' && activityType !== 'general') {
    throw new Error('activityType is invalid')
  }
  const startsAt = timestamp(value.startsAt, 'startsAt')
  const endsAt = timestamp(value.endsAt, 'endsAt')
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new Error('Activity end time must be later than its start time')
  }
  if (!Array.isArray(value.rechargeTiers)) {
    throw new Error('rechargeTiers must be an array')
  }
  const principals = new Set<number>()
  const rechargeTiers = value.rechargeTiers.map((rawTier, index) => {
    const tier = record(rawTier, `rechargeTiers[${index}]`)
    const principalFen = positiveFen(
      tier.principalFen,
      `rechargeTiers[${index}].principalFen`
    )
    if (principals.has(principalFen)) {
      throw new Error('Recharge activity principal amounts must be unique')
    }
    principals.add(principalFen)
    return {
      principalFen,
      giftFen: nonNegativeFen(
        tier.giftFen,
        `rechargeTiers[${index}].giftFen`
      )
    }
  })
  if (activityType === 'recharge' && rechargeTiers.length === 0) {
    throw new Error('Recharge activity requires at least one gift tier')
  }
  const regularPriceFen = optionalFen(
    value.regularPriceFen,
    'regularPriceFen'
  )
  const advancedPriceFen = optionalFen(
    value.advancedPriceFen,
    'advancedPriceFen'
  )
  return {
    title: text(value.title, 'title', 2, 100),
    summary: text(value.summary, 'summary', 2, 300),
    content: text(value.content, 'content', 2, 5000),
    activityType,
    startsAt,
    endsAt,
    pinned: boolean(value.pinned, 'pinned'),
    ...(regularPriceFen === undefined ? {} : { regularPriceFen }),
    ...(advancedPriceFen === undefined ? {} : { advancedPriceFen }),
    allowStoredValue: boolean(value.allowStoredValue, 'allowStoredValue'),
    allowWechat: boolean(value.allowWechat, 'allowWechat'),
    rechargeTiers
  }
}

function createActivityInput(
  value: unknown
): EmployeeMobileCreateActivityRequest {
  const input = record(value, 'Activity request')
  return {
    requestId: requestId(input.requestId),
    ...activityFields(input)
  }
}

function updateActivityInput(
  value: unknown
): EmployeeMobileUpdateActivityRequest {
  const input = record(value, 'Activity request')
  return {
    requestId: requestId(input.requestId),
    activityId: uuid(input.activityId, 'activityId'),
    reason: text(input.reason, 'reason', 2, 200),
    ...activityFields(input)
  }
}

function statusActivityInput(
  value: unknown
): EmployeeMobileSetActivityStatusRequest {
  const input = record(value, 'Activity status request')
  if (input.status !== 'published' && input.status !== 'disabled') {
    throw new Error('status must be published or disabled')
  }
  return {
    requestId: requestId(input.requestId),
    activityId: uuid(input.activityId, 'activityId'),
    status: input.status,
    reason: text(input.reason, 'reason', 2, 200)
  }
}

function visibility(
  status: ActivityStatus,
  startsAt: string,
  endsAt: string,
  now: Date
): ActivitySummary['visibility'] {
  if (status === 'draft') return 'draft'
  if (status === 'disabled') return 'disabled'
  const current = now.getTime()
  if (current < Date.parse(startsAt)) return 'scheduled'
  if (current >= Date.parse(endsAt)) return 'ended'
  return 'active'
}

function safeInteger(value: number | string | null, name: string): number {
  const result = value === null ? 0 : Number(value)
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${name} is outside the safe integer range`)
  }
  return result
}

function rechargeTiers(value: unknown): ActivityRechargeTier[] {
  if (!Array.isArray(value)) return []
  return value.map((rawTier, index) => {
    const tier = record(rawTier, `rechargeTiers[${index}]`)
    return {
      id: uuid(tier.id, `rechargeTiers[${index}].id`),
      principalFen: positiveFen(
        tier.principalFen,
        `rechargeTiers[${index}].principalFen`
      ),
      giftFen: nonNegativeFen(
        tier.giftFen,
        `rechargeTiers[${index}].giftFen`
      )
    }
  })
}

function activitySummary(row: ActivityRow, now = new Date()): ActivitySummary {
  const startsAt = new Date(row.starts_at).toISOString()
  const endsAt = new Date(row.ends_at).toISOString()
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    activityType: row.activity_type,
    status: row.status,
    visibility: visibility(row.status, startsAt, endsAt, now),
    startsAt,
    endsAt,
    pinned: row.pinned,
    regularPriceFen:
      row.regular_price_fen === null
        ? null
        : safeInteger(row.regular_price_fen, 'regularPriceFen'),
    advancedPriceFen:
      row.advanced_price_fen === null
        ? null
        : safeInteger(row.advanced_price_fen, 'advancedPriceFen'),
    allowStoredValue: row.allow_stored_value,
    allowWechat: row.allow_wechat,
    rechargeTiers: rechargeTiers(row.recharge_tiers_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

function validateReportRequest(input: BusinessReportRequest): {
  fromDate: string
  toDate: string
  fromTimestamp: string
  toExclusiveTimestamp: string
} {
  const parseDate = (value: string, name: string): Date => {
    if (!DATE_PATTERN.test(value)) {
      throw new Error(`${name} must use YYYY-MM-DD`)
    }
    const parsed = new Date(`${value}T00:00:00+08:00`)
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(parsed)
    if (Number.isNaN(parsed.getTime()) || formatted !== value) {
      throw new Error(`${name} is not a valid calendar date`)
    }
    return parsed
  }
  const from = parseDate(input.fromDate, 'fromDate')
  const to = parseDate(input.toDate, 'toDate')
  if (from.getTime() > to.getTime()) {
    throw new Error('fromDate cannot be later than toDate')
  }
  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    fromTimestamp: from.toISOString(),
    toExclusiveTimestamp: new Date(
      to.getTime() + 24 * 60 * 60 * 1000
    ).toISOString()
  }
}

function amountRow(row: AmountRow | undefined): { count: number; amount: number } {
  return {
    count: safeInteger(row?.count ?? 0, 'count'),
    amount: safeInteger(row?.amount_fen ?? 0, 'amount')
  }
}

function itemKey(row: Pick<ItemRow, 'item_name' | 'item_type'>): string {
  return `${row.item_type}\u0000${row.item_name}`
}

@Injectable()
export class EmployeeManagerService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async listActivities(
    principal: MiniappPrincipal
  ): Promise<ActivitySummary[]> {
    this.requireManagerPermission(principal, PERMISSIONS.activityManage)
    const result = await this.pool.query<ActivityRow>(
      `${this.activitySelect()}
       WHERE tenant_id = $1 AND store_id = $2
       ORDER BY pinned DESC, starts_at DESC, created_at DESC`,
      [principal.tenantId, principal.storeId]
    )
    const now = new Date()
    return result.rows.map((row) => activitySummary(row, now))
  }

  async createActivity(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<ActivitySummary> {
    const employeeId = this.requireManagerPermission(
      principal,
      PERMISSIONS.activityManage
    )
    let input: EmployeeMobileCreateActivityRequest
    try {
      input = createActivityInput(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Activity request is invalid'
      )
    }
    return this.withIdempotency(
      principal,
      employeeId,
      input.requestId,
      'create',
      input,
      async (client) => {
        const activityId = randomUUID()
        const occurredAt = new Date().toISOString()
        const after = this.newActivity(
          activityId,
          input,
          'draft',
          occurredAt,
          occurredAt
        )
        const serverVersion = await this.appendActivityEvent(
          client,
          principal,
          'activity.created',
          activityId,
          null,
          after,
          'employee mobile activity creation',
          occurredAt
        )
        await this.insertActivity(
          client,
          principal,
          after,
          serverVersion
        )
        await this.appendAudit(
          client,
          principal,
          employeeId,
          'activity.created',
          activityId,
          { source: 'employee_mobile' },
          occurredAt
        )
        return after
      }
    )
  }

  async updateActivity(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<ActivitySummary> {
    const employeeId = this.requireManagerPermission(
      principal,
      PERMISSIONS.activityManage
    )
    let input: EmployeeMobileUpdateActivityRequest
    try {
      input = updateActivityInput(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Activity request is invalid'
      )
    }
    return this.withIdempotency(
      principal,
      employeeId,
      input.requestId,
      'update',
      input,
      async (client) => {
        const before = await this.loadActivity(
          client,
          principal,
          input.activityId,
          true
        )
        const occurredAt = new Date().toISOString()
        const after = this.newActivity(
          before.id,
          input,
          before.status,
          before.createdAt,
          occurredAt,
          before.rechargeTiers
        )
        const serverVersion = await this.appendActivityEvent(
          client,
          principal,
          'activity.updated',
          before.id,
          before,
          after,
          input.reason,
          occurredAt
        )
        await this.updateActivityProjection(
          client,
          principal,
          after,
          serverVersion
        )
        await this.appendAudit(
          client,
          principal,
          employeeId,
          'activity.updated',
          before.id,
          { source: 'employee_mobile', reason: input.reason },
          occurredAt
        )
        return after
      }
    )
  }

  async setActivityStatus(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<ActivitySummary> {
    const employeeId = this.requireManagerPermission(
      principal,
      PERMISSIONS.activityManage
    )
    let input: EmployeeMobileSetActivityStatusRequest
    try {
      input = statusActivityInput(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Activity request is invalid'
      )
    }
    return this.withIdempotency(
      principal,
      employeeId,
      input.requestId,
      `status-${input.status}`,
      input,
      async (client) => {
        const before = await this.loadActivity(
          client,
          principal,
          input.activityId,
          true
        )
        const occurredAt = new Date().toISOString()
        const after: ActivitySummary = {
          ...before,
          status: input.status,
          visibility: visibility(
            input.status,
            before.startsAt,
            before.endsAt,
            new Date(occurredAt)
          ),
          updatedAt: occurredAt
        }
        const action =
          input.status === 'published'
            ? 'activity.published'
            : 'activity.disabled'
        const serverVersion = await this.appendActivityEvent(
          client,
          principal,
          action,
          before.id,
          before,
          after,
          input.reason,
          occurredAt
        )
        await this.updateActivityProjection(
          client,
          principal,
          after,
          serverVersion
        )
        await this.appendAudit(
          client,
          principal,
          employeeId,
          action,
          before.id,
          { source: 'employee_mobile', reason: input.reason },
          occurredAt
        )
        return after
      }
    )
  }

  async getBusinessReport(
    principal: MiniappPrincipal,
    rawInput: BusinessReportRequest
  ): Promise<BusinessReport> {
    this.requireManagerPermission(principal, PERMISSIONS.reportRead)
    let range: ReturnType<typeof validateReportRequest>
    try {
      range = validateReportRequest(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Report range is invalid'
      )
    }
    const scope = [
      principal.tenantId,
      principal.storeId,
      range.fromTimestamp,
      range.toExclusiveTimestamp
    ]
    const [
      orderResult,
      refundResult,
      paymentResult,
      paymentRefundResult,
      admissionResult,
      walletResult,
      financialRefundResult,
      monthlySalesResult,
      monthlyUsageResult,
      activeMonthlyResult,
      soldItemsResult,
      refundedItemsResult
    ] = await Promise.all([
      this.pool.query<AmountRow>(
        `SELECT COUNT(*) count, COALESCE(SUM(total_fen), 0) amount_fen
         FROM cloud_sales_order
         WHERE tenant_id = $1 AND store_id = $2
           AND completed_at >= $3 AND completed_at < $4`,
        scope
      ),
      this.pool.query<AmountRow>(
        `SELECT COUNT(*) count, COALESCE(SUM(total_fen), 0) amount_fen
         FROM cloud_refund_request
         WHERE tenant_id = $1 AND store_id = $2 AND status = 'completed'
           AND completed_at >= $3 AND completed_at < $4`,
        scope
      ),
      this.pool.query<AmountRow & { payment_method: 'cash' | 'stored_value' }>(
        `SELECT payment_method, COUNT(*) count,
                COALESCE(SUM(total_fen), 0) amount_fen
         FROM cloud_sales_order
         WHERE tenant_id = $1 AND store_id = $2
           AND completed_at >= $3 AND completed_at < $4
         GROUP BY payment_method`,
        scope
      ),
      this.pool.query<AmountRow & { payment_method: 'cash' | 'stored_value' }>(
        `SELECT payment_method, COUNT(*) count,
                COALESCE(SUM(total_fen), 0) amount_fen
         FROM cloud_refund_request
         WHERE tenant_id = $1 AND store_id = $2 AND status = 'completed'
           AND completed_at >= $3 AND completed_at < $4
         GROUP BY payment_method`,
        scope
      ),
      this.pool.query<{ quantity: number | string }>(
        `SELECT COALESCE(SUM(i.quantity), 0) quantity
         FROM cloud_sales_order_item i
         JOIN cloud_sales_order o
           ON o.tenant_id = i.tenant_id AND o.id = i.order_id
         WHERE i.tenant_id = $1 AND i.store_id = $2
           AND i.item_type = 'admission'
           AND o.completed_at >= $3 AND o.completed_at < $4`,
        scope
      ),
      this.pool.query<
        WalletAmountRow & { event_type: string; amount_fen: number | string }
      >(
        `SELECT event_type, COUNT(*) count,
                COALESCE(SUM(principal_delta_fen), 0) principal_fen,
                COALESCE(SUM(gift_delta_fen), 0) gift_fen,
                COALESCE(SUM(ABS(principal_delta_fen) + ABS(gift_delta_fen)), 0)
                  amount_fen
         FROM cloud_wallet_ledger
         WHERE tenant_id = $1 AND store_id = $2
           AND occurred_at >= $3 AND occurred_at < $4
           AND event_type IN (
             'wallet.cash_recharged',
             'wallet.debited',
             'wallet.order_refund_credited'
           )
         GROUP BY event_type`,
        scope
      ),
      this.pool.query<
        WalletAmountRow & { target_type: 'cash_recharge' | 'monthly_card' }
      >(
        `SELECT target_type, COUNT(*) count,
                COALESCE(SUM(refund_principal_fen), 0) principal_fen,
                COALESCE(SUM(reclaim_gift_fen), 0) gift_fen
         FROM cloud_financial_refund_request
         WHERE tenant_id = $1 AND store_id = $2 AND status = 'completed'
           AND completed_at >= $3 AND completed_at < $4
         GROUP BY target_type`,
        scope
      ),
      this.pool.query<AmountRow>(
        `SELECT COUNT(*) count, COALESCE(SUM(price_fen), 0) amount_fen
         FROM cloud_monthly_card
         WHERE tenant_id = $1 AND store_id = $2
           AND purchased_at >= $3 AND purchased_at < $4`,
        scope
      ),
      this.pool.query<{ count: number | string }>(
        `SELECT COUNT(*) count
         FROM cloud_monthly_card_event
         WHERE tenant_id = $1 AND store_id = $2 AND event_type = 'used'
           AND occurred_at >= $3 AND occurred_at < $4`,
        scope
      ),
      this.pool.query<{ count: number | string }>(
        `SELECT COUNT(*) count
         FROM cloud_monthly_card
         WHERE tenant_id = $1 AND store_id = $2
           AND status IN ('active', 'paused')`,
        [principal.tenantId, principal.storeId]
      ),
      this.pool.query<ItemRow>(
        `SELECT i.item_name, i.item_type,
                COALESCE(SUM(i.quantity), 0) quantity,
                COALESCE(SUM(i.line_total_fen), 0) amount_fen
         FROM cloud_sales_order_item i
         JOIN cloud_sales_order o
           ON o.tenant_id = i.tenant_id AND o.id = i.order_id
         WHERE i.tenant_id = $1 AND i.store_id = $2
           AND o.completed_at >= $3 AND o.completed_at < $4
         GROUP BY i.item_name, i.item_type`,
        scope
      ),
      this.pool.query<ItemRow>(
        `SELECT item->>'itemName' item_name,
                item->>'itemType' item_type,
                COALESCE(SUM((item->>'quantity')::integer), 0) quantity,
                COALESCE(SUM((item->>'lineRefundFen')::bigint), 0) amount_fen
         FROM cloud_refund_request r
         CROSS JOIN LATERAL jsonb_array_elements(r.payload_json->'after'->'items')
           item
         WHERE r.tenant_id = $1 AND r.store_id = $2
           AND r.status = 'completed'
           AND r.completed_at >= $3 AND r.completed_at < $4
         GROUP BY item->>'itemName', item->>'itemType'`,
        scope
      )
    ])

    const orders = amountRow(orderResult.rows[0])
    const refunds = amountRow(refundResult.rows[0])
    const paymentAmount = (method: 'cash' | 'stored_value') =>
      safeInteger(
        paymentResult.rows.find((row) => row.payment_method === method)
          ?.amount_fen ?? 0,
        `${method} sales`
      )
    const refundPaymentAmount = (method: 'cash' | 'stored_value') =>
      safeInteger(
        paymentRefundResult.rows.find((row) => row.payment_method === method)
          ?.amount_fen ?? 0,
        `${method} refunds`
      )
    const walletRow = (eventType: string) =>
      walletResult.rows.find((row) => row.event_type === eventType)
    const rechargeRow = walletRow('wallet.cash_recharged')
    const recharge = {
      count: safeInteger(rechargeRow?.count ?? 0, 'recharge count'),
      principal: safeInteger(
        rechargeRow?.principal_fen ?? 0,
        'recharge principal'
      ),
      gift: safeInteger(rechargeRow?.gift_fen ?? 0, 'recharge gift')
    }
    const rechargeRefundRow = financialRefundResult.rows.find(
      (row) => row.target_type === 'cash_recharge'
    )
    const monthlyRefundRow = financialRefundResult.rows.find(
      (row) => row.target_type === 'monthly_card'
    )
    const rechargeRefund = {
      count: safeInteger(rechargeRefundRow?.count ?? 0, 'recharge refund count'),
      principal: safeInteger(
        rechargeRefundRow?.principal_fen ?? 0,
        'recharge refund principal'
      ),
      gift: safeInteger(
        rechargeRefundRow?.gift_fen ?? 0,
        'reclaimed gift'
      )
    }
    const monthlySales = amountRow(monthlySalesResult.rows[0])
    const monthlyRefunds = {
      count: safeInteger(monthlyRefundRow?.count ?? 0, 'monthly refund count'),
      amount: safeInteger(
        monthlyRefundRow?.principal_fen ?? 0,
        'monthly refund'
      )
    }
    const items = this.mergeItems(
      soldItemsResult.rows,
      refundedItemsResult.rows
    )
    const cashSalesFen = paymentAmount('cash')
    const cashRefundFen = refundPaymentAmount('cash')
    const storedValueSalesFen = paymentAmount('stored_value')
    const storedValueRefundFen = refundPaymentAmount('stored_value')
    const monthlyNetFen = monthlySales.amount - monthlyRefunds.amount
    const rechargeNetFen = recharge.principal - rechargeRefund.principal

    return {
      fromDate: range.fromDate,
      toDate: range.toDate,
      generatedAt: new Date().toISOString(),
      order: {
        orderCount: orders.count,
        grossSalesFen: orders.amount,
        refundCount: refunds.count,
        refundFen: refunds.amount,
        netSalesFen: orders.amount - refunds.amount,
        averageOrderFen:
          orders.count === 0 ? 0 : Math.round(orders.amount / orders.count),
        admissionQuantity: safeInteger(
          admissionResult.rows[0]?.quantity ?? 0,
          'admission quantity'
        )
      },
      payment: {
        cashSalesFen,
        cashRefundFen,
        cashNetFen: cashSalesFen - cashRefundFen,
        storedValueSalesFen,
        storedValueRefundFen,
        storedValueNetFen: storedValueSalesFen - storedValueRefundFen
      },
      wallet: {
        rechargeCount: recharge.count,
        rechargePrincipalFen: recharge.principal,
        rechargeGiftFen: recharge.gift,
        rechargeRefundCount: rechargeRefund.count,
        rechargeRefundPrincipalFen: rechargeRefund.principal,
        reclaimedGiftFen: rechargeRefund.gift,
        consumptionDebitFen: safeInteger(
          walletRow('wallet.debited')?.amount_fen ?? 0,
          'wallet debit'
        ),
        orderRefundCreditFen: safeInteger(
          walletRow('wallet.order_refund_credited')?.amount_fen ?? 0,
          'wallet refund credit'
        )
      },
      monthlyCard: {
        soldCount: monthlySales.count,
        grossSalesFen: monthlySales.amount,
        refundCount: monthlyRefunds.count,
        refundFen: monthlyRefunds.amount,
        netSalesFen: monthlyNetFen,
        usageCount: safeInteger(
          monthlyUsageResult.rows[0]?.count ?? 0,
          'monthly usage'
        ),
        activeCount: safeInteger(
          activeMonthlyResult.rows[0]?.count ?? 0,
          'active monthly cards'
        )
      },
      actualCashInflowFen:
        cashSalesFen - cashRefundFen + rechargeNetFen + monthlyNetFen,
      items
    }
  }

  private requireManagerPermission(
    principal: MiniappPrincipal,
    permission: string
  ): string {
    if (
      !principal.employeeId ||
      principal.identity.role !== 'manager' ||
      !principal.identity.permissions.includes(permission)
    ) {
      throw new ForbiddenException('当前身份没有店长操作权限')
    }
    return principal.employeeId
  }

  private activitySelect(): string {
    return `SELECT id, title, summary, content, activity_type, status,
                   starts_at, ends_at, pinned, regular_price_fen,
                   advanced_price_fen, allow_stored_value, allow_wechat,
                   recharge_tiers_json, created_at, updated_at
            FROM cloud_activity_campaign`
  }

  private async loadActivity(
    client: PoolClient,
    principal: MiniappPrincipal,
    activityId: string,
    lock: boolean
  ): Promise<ActivitySummary> {
    const result = await client.query<ActivityRow>(
      `${this.activitySelect()}
       WHERE tenant_id = $1 AND store_id = $2 AND id = $3
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [principal.tenantId, principal.storeId, activityId]
    )
    if (!result.rows[0]) throw new NotFoundException('活动不存在')
    return activitySummary(result.rows[0])
  }

  private newActivity(
    id: string,
    fields: SaveActivityFields,
    status: ActivityStatus,
    createdAt: string,
    updatedAt: string,
    previousTiers: ActivityRechargeTier[] = []
  ): ActivitySummary {
    const previousIds = new Map(
      previousTiers.map((tier) => [tier.principalFen, tier.id])
    )
    const tiers = [...fields.rechargeTiers]
      .sort((left, right) => left.principalFen - right.principalFen)
      .map((tier) => ({
        id: previousIds.get(tier.principalFen) ?? randomUUID(),
        ...tier
      }))
    return {
      id,
      title: fields.title,
      summary: fields.summary,
      content: fields.content,
      activityType: fields.activityType,
      status,
      visibility: visibility(
        status,
        fields.startsAt,
        fields.endsAt,
        new Date(updatedAt)
      ),
      startsAt: fields.startsAt,
      endsAt: fields.endsAt,
      pinned: fields.pinned,
      regularPriceFen: fields.regularPriceFen ?? null,
      advancedPriceFen: fields.advancedPriceFen ?? null,
      allowStoredValue: fields.allowStoredValue,
      allowWechat: fields.allowWechat,
      rechargeTiers: tiers,
      createdAt,
      updatedAt
    }
  }

  private async withIdempotency(
    principal: MiniappPrincipal,
    employeeId: string,
    requestIdValue: string,
    operation: string,
    payload: unknown,
    mutation: (client: PoolClient) => Promise<ActivitySummary>
  ): Promise<ActivitySummary> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
    const key =
      `employee-mobile-activity-${operation}:${employeeId}:${requestIdValue}`
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [principal.tenantId, key, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: ActivitySummary | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2
           FOR UPDATE`,
          [principal.tenantId, key]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException(
            '同一请求号已经用于不同的活动操作'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('活动操作仍在处理中')
        }
        await client.query('COMMIT')
        return row.response_json
      }
      const result = await mutation(client)
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 200, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, key, JSON.stringify(result)]
      )
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async appendActivityEvent(
    client: PoolClient,
    principal: MiniappPrincipal,
    action: string,
    activityId: string,
    before: ActivitySummary | null,
    after: ActivitySummary,
    reason: string,
    occurredAt: string
  ): Promise<number> {
    const event = await client.query<{ sequence: number | string }>(
      `INSERT INTO cloud_event
       (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
        event_type, payload_json, occurred_at)
       VALUES ($1, $2, $3, 'activity', $4, $5, $6::jsonb, $7)
       RETURNING sequence`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        activityId,
        action,
        JSON.stringify({ action, activityId, before, after, reason }),
        occurredAt
      ]
    )
    const sequence = Number(event.rows[0]?.sequence)
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('Cloud event did not return a valid sequence')
    }
    return sequence
  }

  private async insertActivity(
    client: PoolClient,
    principal: MiniappPrincipal,
    activity: ActivitySummary,
    serverVersion: number
  ): Promise<void> {
    await client.query(
      `INSERT INTO cloud_activity_campaign
       (id, tenant_id, store_id, title, summary, content, activity_type, status,
        starts_at, ends_at, pinned, regular_price_fen, advanced_price_fen,
        allow_stored_value, allow_wechat, recharge_tiers_json, server_version,
        created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16::jsonb, $17, $18, $19)`,
      [
        activity.id,
        principal.tenantId,
        principal.storeId,
        activity.title,
        activity.summary,
        activity.content,
        activity.activityType,
        activity.status,
        activity.startsAt,
        activity.endsAt,
        activity.pinned,
        activity.regularPriceFen,
        activity.advancedPriceFen,
        activity.allowStoredValue,
        activity.allowWechat,
        JSON.stringify(activity.rechargeTiers),
        serverVersion,
        activity.createdAt,
        activity.updatedAt
      ]
    )
  }

  private async updateActivityProjection(
    client: PoolClient,
    principal: MiniappPrincipal,
    activity: ActivitySummary,
    serverVersion: number
  ): Promise<void> {
    const updated = await client.query<{ id: string }>(
      `UPDATE cloud_activity_campaign
       SET title = $4, summary = $5, content = $6, activity_type = $7,
           status = $8, starts_at = $9, ends_at = $10, pinned = $11,
           regular_price_fen = $12, advanced_price_fen = $13,
           allow_stored_value = $14, allow_wechat = $15,
           recharge_tiers_json = $16::jsonb, server_version = $17,
           updated_at = $18
       WHERE tenant_id = $1 AND store_id = $2 AND id = $3
       RETURNING id`,
      [
        principal.tenantId,
        principal.storeId,
        activity.id,
        activity.title,
        activity.summary,
        activity.content,
        activity.activityType,
        activity.status,
        activity.startsAt,
        activity.endsAt,
        activity.pinned,
        activity.regularPriceFen,
        activity.advancedPriceFen,
        activity.allowStoredValue,
        activity.allowWechat,
        JSON.stringify(activity.rechargeTiers),
        serverVersion,
        activity.updatedAt
      ]
    )
    if (!updated.rows[0]) throw new NotFoundException('活动不存在')
  }

  private async appendAudit(
    client: PoolClient,
    principal: MiniappPrincipal,
    employeeId: string,
    action: string,
    activityId: string,
    metadata: Record<string, unknown>,
    occurredAt: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO cloud_audit_log
       (id, tenant_id, store_id, actor_id, action, aggregate_type,
        aggregate_id, metadata_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'activity', $6, $7::jsonb, $8)`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        employeeId,
        action,
        activityId,
        JSON.stringify({
          ...metadata,
          identityId: principal.identityId
        }),
        occurredAt
      ]
    )
  }

  private mergeItems(
    soldRows: ItemRow[],
    refundedRows: ItemRow[]
  ): BusinessReportItem[] {
    const items = new Map<string, BusinessReportItem>()
    for (const row of soldRows) {
      const quantity = safeInteger(row.quantity, 'sold quantity')
      const amount = safeInteger(row.amount_fen, 'gross item sales')
      items.set(itemKey(row), {
        itemName: row.item_name,
        itemType: row.item_type,
        soldQuantity: quantity,
        refundedQuantity: 0,
        netQuantity: quantity,
        grossSalesFen: amount,
        refundFen: 0,
        netSalesFen: amount
      })
    }
    for (const row of refundedRows) {
      const key = itemKey(row)
      const current = items.get(key) ?? {
        itemName: row.item_name,
        itemType: row.item_type,
        soldQuantity: 0,
        refundedQuantity: 0,
        netQuantity: 0,
        grossSalesFen: 0,
        refundFen: 0,
        netSalesFen: 0
      }
      current.refundedQuantity += safeInteger(
        row.quantity,
        'refunded quantity'
      )
      current.refundFen += safeInteger(row.amount_fen, 'item refund')
      current.netQuantity =
        current.soldQuantity - current.refundedQuantity
      current.netSalesFen = current.grossSalesFen - current.refundFen
      items.set(key, current)
    }
    return [...items.values()].sort(
      (left, right) =>
        right.netSalesFen - left.netSalesFen ||
        left.itemType.localeCompare(right.itemType) ||
        left.itemName.localeCompare(right.itemName, 'zh-CN')
    )
  }
}
