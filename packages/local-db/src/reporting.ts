import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  BusinessReport,
  BusinessReportItem,
  BusinessReportRequest,
  CatalogItemType
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'

type AmountRow = {
  count: number
  amount_fen: number
}

type WalletAmountRow = {
  count: number
  principal_fen: number
  gift_fen: number
}

type ItemRow = {
  item_name: string
  item_type: CatalogItemType
  quantity: number
  amount_fen: number
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function requireDate(value: string, fieldName: string): Date {
  if (!DATE_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} must use YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00+08:00`)
  if (
    Number.isNaN(parsed.getTime()) ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(parsed) !== value
  ) {
    throw new TypeError(`${fieldName} is not a valid calendar date`)
  }
  return parsed
}

export function resolveBusinessReportRange(input: BusinessReportRequest): {
  fromDate: string
  toDate: string
  fromTimestamp: string
  toExclusiveTimestamp: string
} {
  const from = requireDate(input.fromDate, 'fromDate')
  const to = requireDate(input.toDate, 'toDate')
  if (from.getTime() > to.getTime()) {
    throw new TypeError('fromDate cannot be later than toDate')
  }
  return {
    fromDate: input.fromDate,
    toDate: input.toDate,
    fromTimestamp: from.toISOString(),
    toExclusiveTimestamp: new Date(to.getTime() + 24 * 60 * 60 * 1000).toISOString()
  }
}

function amountRow(row: AmountRow | undefined): AmountRow {
  return {
    count: Number(row?.count ?? 0),
    amount_fen: Number(row?.amount_fen ?? 0)
  }
}

function walletAmountRow(row: WalletAmountRow | undefined): WalletAmountRow {
  return {
    count: Number(row?.count ?? 0),
    principal_fen: Number(row?.principal_fen ?? 0),
    gift_fen: Number(row?.gift_fen ?? 0)
  }
}

function itemKey(row: Pick<ItemRow, 'item_name' | 'item_type'>): string {
  return `${row.item_type}\u0000${row.item_name}`
}

export function getBusinessReport(
  database: DatabaseSync,
  context: StoreContext,
  input: BusinessReportRequest,
  now = new Date()
): BusinessReport {
  const range = resolveBusinessReportRange(input)
  const tenantWide = input.scope === 'tenant'
  const storeClause = (alias = ''): string =>
    tenantWide ? '' : ` AND ${alias}store_id = ?`
  const scope: Array<string> = [
    context.tenantId,
    ...(tenantWide ? [] : [context.storeId]),
    range.fromTimestamp,
    range.toExclusiveTimestamp
  ]

  const orders = amountRow(
    database
      .prepare(
        `SELECT COUNT(*) count, COALESCE(SUM(total_fen), 0) amount_fen
         FROM sales_order
         WHERE tenant_id = ?${storeClause()}
           AND completed_at >= ? AND completed_at < ?`
      )
      .get(...scope) as AmountRow | undefined
  )
  const orderRefunds = amountRow(
    database
      .prepare(
        `SELECT COUNT(*) count, COALESCE(SUM(total_fen), 0) amount_fen
         FROM refund_request
         WHERE tenant_id = ?${storeClause()} AND status = 'completed'
           AND completed_at >= ? AND completed_at < ?`
      )
      .get(...scope) as AmountRow | undefined
  )
  const paymentRows = database
    .prepare(
      `SELECT payment_method, COUNT(*) count, COALESCE(SUM(amount_fen), 0) amount_fen
       FROM order_payment
       WHERE tenant_id = ?${storeClause()}
         AND occurred_at >= ? AND occurred_at < ?
       GROUP BY payment_method`
    )
    .all(...scope) as Array<AmountRow & { payment_method: 'cash' | 'stored_value' }>
  const paymentRefundRows = database
    .prepare(
      `SELECT payment_method, COUNT(*) count, COALESCE(SUM(amount_fen), 0) amount_fen
       FROM refund_payment
       WHERE tenant_id = ?${storeClause()}
         AND occurred_at >= ? AND occurred_at < ?
       GROUP BY payment_method`
    )
    .all(...scope) as Array<AmountRow & { payment_method: 'cash' | 'stored_value' }>
  const paymentAmount = (method: 'cash' | 'stored_value'): number =>
    Number(paymentRows.find((row) => row.payment_method === method)?.amount_fen ?? 0)
  const paymentRefundAmount = (method: 'cash' | 'stored_value'): number =>
    Number(paymentRefundRows.find((row) => row.payment_method === method)?.amount_fen ?? 0)

  const admission = database
    .prepare(
      `SELECT COALESCE(SUM(i.quantity), 0) quantity
       FROM sales_order_item i
       JOIN sales_order o
         ON o.tenant_id = i.tenant_id AND o.id = i.order_id
       WHERE i.tenant_id = ?${storeClause('i.')}
         AND i.item_type_snapshot = 'admission'
         AND o.completed_at >= ? AND o.completed_at < ?`
    )
    .get(...scope) as { quantity: number } | undefined

  const recharge = walletAmountRow(
    database
      .prepare(
        `SELECT COUNT(*) count,
                COALESCE(SUM(principal_fen), 0) principal_fen,
                COALESCE(SUM(gift_fen), 0) gift_fen
         FROM wallet_recharge
         WHERE tenant_id = ?${storeClause()} AND payment_method = 'cash'
           AND occurred_at >= ? AND occurred_at < ?`
      )
      .get(...scope) as WalletAmountRow | undefined
  )
  const rechargeRefund = walletAmountRow(
    database
      .prepare(
        `SELECT COUNT(*) count,
                COALESCE(SUM(refund_principal_fen), 0) principal_fen,
                COALESCE(SUM(reclaim_gift_fen), 0) gift_fen
         FROM financial_refund_request
         WHERE tenant_id = ?${storeClause()} AND status = 'completed'
           AND target_type = 'cash_recharge'
           AND completed_at >= ? AND completed_at < ?`
      )
      .get(...scope) as WalletAmountRow | undefined
  )
  const walletLedgerRows = database
    .prepare(
      `SELECT entry_type,
              COALESCE(SUM(ABS(principal_delta_fen) + ABS(gift_delta_fen)), 0) amount_fen
       FROM wallet_ledger
       WHERE tenant_id = ?${storeClause()}
         AND occurred_at >= ? AND occurred_at < ?
         AND entry_type IN ('consumption_debit', 'order_refund_credit')
       GROUP BY entry_type`
    )
    .all(...scope) as Array<{ entry_type: string; amount_fen: number }>
  const ledgerAmount = (entryType: string): number =>
    Number(walletLedgerRows.find((row) => row.entry_type === entryType)?.amount_fen ?? 0)

  const monthlySales = amountRow(
    database
      .prepare(
        `SELECT COUNT(*) count, COALESCE(SUM(price_fen), 0) amount_fen
         FROM monthly_card
         WHERE tenant_id = ?${storeClause()}
           AND purchased_at >= ? AND purchased_at < ?`
      )
      .get(...scope) as AmountRow | undefined
  )
  const monthlyCashSales = amountRow(
    database
      .prepare(
        `SELECT COUNT(*) count, COALESCE(SUM(price_fen), 0) amount_fen
         FROM monthly_card
         WHERE tenant_id = ?${storeClause()}
           AND payment_method = 'cash'
           AND purchased_at >= ? AND purchased_at < ?`
      )
      .get(...scope) as AmountRow | undefined
  )
  const monthlyRefunds = amountRow(
    database
      .prepare(
        `SELECT COUNT(*) count,
                COALESCE(SUM(refund_principal_fen), 0) amount_fen
         FROM financial_refund_request
         WHERE tenant_id = ?${storeClause()} AND status = 'completed'
           AND target_type = 'monthly_card'
           AND completed_at >= ? AND completed_at < ?`
      )
      .get(...scope) as AmountRow | undefined
  )
  const monthlyUsage = database
    .prepare(
      `SELECT COUNT(*) count
       FROM monthly_card_event
       WHERE tenant_id = ?${storeClause()} AND event_type = 'used'
         AND occurred_at >= ? AND occurred_at < ?`
    )
    .get(...scope) as { count: number } | undefined
  const activeMonthly = database
    .prepare(
      `SELECT COUNT(*) count FROM monthly_card
       WHERE tenant_id = ?${tenantWide ? '' : " AND (scope_type = 'tenant' OR store_id = ?)"}
         AND status IN ('active', 'paused')`
    )
    .get(...(tenantWide ? [context.tenantId] : [context.tenantId, context.storeId])) as
    | { count: number }
    | undefined

  const soldItems = database
    .prepare(
      `SELECT i.item_name_snapshot item_name, i.item_type_snapshot item_type,
              COALESCE(SUM(i.quantity), 0) quantity,
              COALESCE(SUM(i.line_total_fen), 0) amount_fen
       FROM sales_order_item i
       JOIN sales_order o
         ON o.tenant_id = i.tenant_id AND o.id = i.order_id
       WHERE i.tenant_id = ?${storeClause('i.')}
         AND o.completed_at >= ? AND o.completed_at < ?
       GROUP BY i.item_name_snapshot, i.item_type_snapshot`
    )
    .all(...scope) as ItemRow[]
  const refundedItems = database
    .prepare(
      `SELECT i.item_name_snapshot item_name, i.item_type_snapshot item_type,
              COALESCE(SUM(i.quantity), 0) quantity,
              COALESCE(SUM(i.line_refund_fen), 0) amount_fen
       FROM refund_item i
       JOIN refund_request r
         ON r.tenant_id = i.tenant_id AND r.id = i.refund_id
       WHERE i.tenant_id = ?${storeClause('i.')} AND r.status = 'completed'
         AND r.completed_at >= ? AND r.completed_at < ?
       GROUP BY i.item_name_snapshot, i.item_type_snapshot`
    )
    .all(...scope) as ItemRow[]
  const itemMap = new Map<string, BusinessReportItem>()
  for (const row of soldItems) {
    itemMap.set(itemKey(row), {
      itemName: row.item_name,
      itemType: row.item_type,
      soldQuantity: Number(row.quantity),
      refundedQuantity: 0,
      netQuantity: Number(row.quantity),
      grossSalesFen: Number(row.amount_fen),
      refundFen: 0,
      netSalesFen: Number(row.amount_fen)
    })
  }
  for (const row of refundedItems) {
    const key = itemKey(row)
    const current = itemMap.get(key) ?? {
      itemName: row.item_name,
      itemType: row.item_type,
      soldQuantity: 0,
      refundedQuantity: 0,
      netQuantity: 0,
      grossSalesFen: 0,
      refundFen: 0,
      netSalesFen: 0
    }
    current.refundedQuantity += Number(row.quantity)
    current.refundFen += Number(row.amount_fen)
    current.netQuantity = current.soldQuantity - current.refundedQuantity
    current.netSalesFen = current.grossSalesFen - current.refundFen
    itemMap.set(key, current)
  }

  const cashSalesFen = paymentAmount('cash')
  const cashRefundFen = paymentRefundAmount('cash')
  const storedValueSalesFen = paymentAmount('stored_value')
  const storedValueRefundFen = paymentRefundAmount('stored_value')
  const monthlyNetFen = monthlySales.amount_fen - monthlyRefunds.amount_fen
  const monthlyCashNetFen =
    monthlyCashSales.amount_fen - monthlyRefunds.amount_fen
  const rechargeNetPrincipalFen =
    recharge.principal_fen - rechargeRefund.principal_fen

  return {
    fromDate: range.fromDate,
    toDate: range.toDate,
    generatedAt: now.toISOString(),
    order: {
      orderCount: orders.count,
      grossSalesFen: orders.amount_fen,
      refundCount: orderRefunds.count,
      refundFen: orderRefunds.amount_fen,
      netSalesFen: orders.amount_fen - orderRefunds.amount_fen,
      averageOrderFen:
        orders.count === 0 ? 0 : Math.round(orders.amount_fen / orders.count),
      admissionQuantity: Number(admission?.quantity ?? 0)
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
      rechargePrincipalFen: recharge.principal_fen,
      rechargeGiftFen: recharge.gift_fen,
      rechargeRefundCount: rechargeRefund.count,
      rechargeRefundPrincipalFen: rechargeRefund.principal_fen,
      reclaimedGiftFen: rechargeRefund.gift_fen,
      consumptionDebitFen: ledgerAmount('consumption_debit'),
      orderRefundCreditFen: ledgerAmount('order_refund_credit')
    },
    monthlyCard: {
      soldCount: monthlySales.count,
      grossSalesFen: monthlySales.amount_fen,
      refundCount: monthlyRefunds.count,
      refundFen: monthlyRefunds.amount_fen,
      netSalesFen: monthlyNetFen,
      usageCount: Number(monthlyUsage?.count ?? 0),
      activeCount: Number(activeMonthly?.count ?? 0)
    },
    actualCashInflowFen:
      cashSalesFen -
      cashRefundFen +
      rechargeNetPrincipalFen +
      monthlyCashNetFen,
    items: [...itemMap.values()].sort(
      (left, right) =>
        right.netSalesFen - left.netSalesFen ||
        left.itemType.localeCompare(right.itemType) ||
        left.itemName.localeCompare(right.itemName, 'zh-CN')
    )
  }
}

export function recordBusinessReportExport(
  database: DatabaseSync,
  context: StoreContext & { actor: EmployeeRecord },
  input: {
    requestId: string
    report: BusinessReport
    fileName: string
    fileSha256: string
    now?: Date
  }
): void {
  const existing = database
    .prepare(
      `SELECT id FROM audit_log
       WHERE tenant_id = ? AND action = 'report.business.exported'
         AND aggregate_id = ?`
    )
    .get(context.tenantId, input.requestId)
  if (existing) return
  const timestamp = (input.now ?? new Date()).toISOString()
  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')
  const payload = JSON.stringify({
    requestId: input.requestId,
    fromDate: input.report.fromDate,
    toDate: input.report.toDate,
    fileName: input.fileName,
    fileSha256: input.fileSha256,
    generatedAt: input.report.generatedAt
  })

  database.exec('BEGIN IMMEDIATE')
  try {
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
         VALUES (?, ?, ?, ?, ?, 'report.business.exported', 'business_report',
                 ?, '店长导出营业报表', NULL, ?, ?)`
      )
      .run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        context.deviceId,
        context.actor.id,
        input.requestId,
        payload,
        timestamp
      )
    database
      .prepare(
        `INSERT INTO outbox_operation
         (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
          operation_type, aggregate_id, base_version, occurred_at, payload_json,
          payload_hash)
         VALUES (?, ?, ?, ?, ?, ?, 'report.business.exported', ?, NULL, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        context.deviceId,
        sequence.next_sequence,
        context.tenantId,
        context.storeId,
        context.actor.id,
        input.requestId,
        timestamp,
        payload,
        createHash('sha256').update(payload).digest('hex')
      )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
