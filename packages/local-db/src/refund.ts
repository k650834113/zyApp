import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateRefundItemRequest,
  RefundEvidenceSummary,
  RefundItemSummary,
  RefundStatus,
  RefundSummary,
  RefundableOrderItemSummary,
  RefundableOrderSummary
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { creditOrderRefundInOpenTransaction } from './wallet'
import { assertCloudMirrorSafeForFinancialWrite } from './cloud-runtime'

const REFUND_WINDOW_MS = 720 * 60 * 60 * 1000

type RefundContext = StoreContext & {
  actor: EmployeeRecord
}

type OrderRow = {
  id: string
  order_number: string
  visit_batch_id: string
  customer_member_id: string | null
  payment_method: 'cash' | 'stored_value'
  wallet_member_id: string | null
  total_fen: number
  note: string | null
  completed_at: string
  payment_id: string
}

type OrderItemRow = {
  id: string
  catalog_item_id: string
  item_name_snapshot: string
  item_type_snapshot: RefundableOrderItemSummary['itemType']
  regular_price_fen_snapshot: number
  advanced_price_fen_snapshot: number
  applied_unit_price_fen: number
  pricing_tier: RefundableOrderItemSummary['pricingTier']
  quantity: number
  line_total_fen: number
  benefit_type: RefundableOrderItemSummary['benefitType']
  beneficiary_member_id: string | null
  pending_refund_quantity: number
  completed_refund_quantity: number
}

type RefundRow = {
  id: string
  refund_number: string
  order_id: string
  order_number: string
  payment_method: 'cash' | 'stored_value'
  wallet_member_id: string | null
  status: RefundStatus
  total_fen: number
  requested_by: string
  requested_at: string
  request_reason: string | null
  approved_by: string | null
  approved_at: string | null
  special_product_override: number
  completion_reason: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  completed_at: string | null
}

function nextRefundNumber(now: Date, id: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const value = (type: 'year' | 'month' | 'day'): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `R${value('year')}${value('month')}${value('day')}-${id
    .replaceAll('-', '')
    .slice(0, 8)
    .toUpperCase()}`
}

function requireManager(context: RefundContext): void {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can approve, reject, or directly complete refunds')
  }
}

function nextDeviceSequence(
  database: DatabaseSync,
  deviceId: string,
  timestamp: string
): number {
  const row = database.prepare('SELECT next_sequence FROM device WHERE id = ?').get(deviceId) as
    | { next_sequence: number }
    | undefined
  if (!row) throw new Error('Registered device is missing')
  database
    .prepare('UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?')
    .run(timestamp, deviceId)
  return row.next_sequence
}

function appendRefundAuditAndOutbox(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    action: string
    operationType: string
    refundId: string
    reason: string
    before: unknown
    after: unknown
    timestamp: string
  }
): void {
  const payload = JSON.stringify({
    action: input.action,
    refundId: input.refundId,
    before: input.before,
    after: input.after,
    reason: input.reason
  })
  const sequence = nextDeviceSequence(database, context.deviceId, input.timestamp)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'refund', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.refundId,
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
      input.operationType,
      input.refundId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

function findOrder(
  database: DatabaseSync,
  context: StoreContext,
  query: string
): OrderRow {
  const row = database
    .prepare(
      `SELECT o.id, o.order_number, o.visit_batch_id, o.customer_member_id,
              o.payment_method, o.wallet_member_id, o.total_fen, o.note,
              o.completed_at, p.id payment_id
       FROM sales_order o
       JOIN order_payment p
         ON p.tenant_id = o.tenant_id AND p.order_id = o.id AND p.status = 'completed'
       WHERE o.tenant_id = ? AND o.store_id = ?
         AND (o.id = ? OR o.order_number = ?)
       LIMIT 1`
    )
    .get(context.tenantId, context.storeId, query, query) as OrderRow | undefined
  if (!row) throw new Error('Sales order was not found')
  return row
}

function orderItems(
  database: DatabaseSync,
  context: StoreContext,
  orderId: string
): OrderItemRow[] {
  return database
    .prepare(
      `SELECT i.id, i.catalog_item_id, i.item_name_snapshot, i.item_type_snapshot,
              i.regular_price_fen_snapshot, i.advanced_price_fen_snapshot,
              i.applied_unit_price_fen, i.pricing_tier, i.quantity,
              i.line_total_fen, i.benefit_type, i.beneficiary_member_id,
              COALESCE(SUM(CASE WHEN r.status = 'pending' THEN ri.quantity ELSE 0 END), 0)
                pending_refund_quantity,
              COALESCE(SUM(CASE WHEN r.status = 'completed' THEN ri.quantity ELSE 0 END), 0)
                completed_refund_quantity
       FROM sales_order_item i
       LEFT JOIN refund_item ri
         ON ri.tenant_id = i.tenant_id AND ri.order_item_id = i.id
       LEFT JOIN refund_request r
         ON r.tenant_id = ri.tenant_id AND r.id = ri.refund_id
       WHERE i.tenant_id = ? AND i.order_id = ?
       GROUP BY i.id
       ORDER BY i.rowid`
    )
    .all(context.tenantId, orderId) as OrderItemRow[]
}

function assertRefundWindow(order: OrderRow, now: Date): void {
  const completedAt = new Date(order.completed_at).getTime()
  const nowTime = now.getTime()
  if (!Number.isFinite(completedAt) || nowTime < completedAt) {
    throw new Error('Order completion time is invalid for refund')
  }
  if (nowTime - completedAt > REFUND_WINDOW_MS) {
    throw new Error('Order refund window has expired')
  }
}

export function findRefundableOrder(
  database: DatabaseSync,
  context: StoreContext,
  query: string,
  now = new Date()
): RefundableOrderSummary {
  const order = findOrder(database, context, query.trim())
  const completedAt = new Date(order.completed_at)
  const refundableUntil = new Date(completedAt.getTime() + REFUND_WINDOW_MS)
  return {
    id: order.id,
    orderNumber: order.order_number,
    visitBatchId: order.visit_batch_id,
    customerMemberId: order.customer_member_id,
    paymentMethod: order.payment_method,
    walletMemberId: order.wallet_member_id,
    status: 'completed',
    totalFen: order.total_fen,
    note: order.note,
    completedAt: order.completed_at,
    refundableUntil: refundableUntil.toISOString(),
    withinRefundWindow:
      now.getTime() >= completedAt.getTime() && now.getTime() <= refundableUntil.getTime(),
    items: orderItems(database, context, order.id).map((item) => ({
      id: item.id,
      catalogItemId: item.catalog_item_id,
      itemName: item.item_name_snapshot,
      itemType: item.item_type_snapshot,
      regularPriceFen: item.regular_price_fen_snapshot,
      advancedPriceFen: item.advanced_price_fen_snapshot,
      appliedUnitPriceFen: item.applied_unit_price_fen,
      pricingTier: item.pricing_tier,
      quantity: item.quantity,
      lineTotalFen: item.line_total_fen,
      benefitType: item.benefit_type,
      beneficiaryMemberId: item.beneficiary_member_id,
      pendingRefundQuantity: item.pending_refund_quantity,
      completedRefundQuantity: item.completed_refund_quantity,
      refundableQuantity:
        item.quantity -
        item.pending_refund_quantity -
        item.completed_refund_quantity
    }))
  }
}

function mapRefundItems(
  database: DatabaseSync,
  tenantId: string,
  refundId: string
): RefundItemSummary[] {
  return (
    database
      .prepare(
        `SELECT id, order_item_id, item_name_snapshot, item_type_snapshot,
                unit_refund_fen, quantity, line_refund_fen
         FROM refund_item
         WHERE tenant_id = ? AND refund_id = ?
         ORDER BY rowid`
      )
      .all(tenantId, refundId) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    orderItemId: String(row.order_item_id),
    itemName: String(row.item_name_snapshot),
    itemType: row.item_type_snapshot as RefundItemSummary['itemType'],
    unitRefundFen: Number(row.unit_refund_fen),
    quantity: Number(row.quantity),
    lineRefundFen: Number(row.line_refund_fen)
  }))
}

function mapRefundEvidence(
  database: DatabaseSync,
  tenantId: string,
  refundId: string
): RefundEvidenceSummary[] {
  return (
    database
      .prepare(
        `SELECT id, evidence_type, file_name, file_sha256, generated_by, generated_at
         FROM refund_evidence
         WHERE tenant_id = ? AND refund_id = ?
         ORDER BY generated_at DESC, rowid DESC`
      )
      .all(tenantId, refundId) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    evidenceType: row.evidence_type as RefundEvidenceSummary['evidenceType'],
    fileName: String(row.file_name),
    fileSha256: String(row.file_sha256),
    generatedBy: String(row.generated_by),
    generatedAt: String(row.generated_at)
  }))
}

function findRefund(
  database: DatabaseSync,
  tenantId: string,
  refundId: string
): RefundSummary {
  const row = database
    .prepare(
      `SELECT r.id, r.refund_number, r.order_id, o.order_number,
              r.payment_method, r.wallet_member_id, r.status, r.total_fen,
              r.requested_by, r.requested_at, r.request_reason,
              r.approved_by, r.approved_at, r.special_product_override,
              r.completion_reason, r.rejected_by, r.rejected_at,
              r.rejection_reason, r.completed_at
       FROM refund_request r
       JOIN sales_order o ON o.tenant_id = r.tenant_id AND o.id = r.order_id
       WHERE r.tenant_id = ? AND r.id = ?`
    )
    .get(tenantId, refundId) as RefundRow | undefined
  if (!row) throw new Error('Refund request was not found')
  return {
    id: row.id,
    refundNumber: row.refund_number,
    orderId: row.order_id,
    orderNumber: row.order_number,
    paymentMethod: row.payment_method,
    walletMemberId: row.wallet_member_id,
    status: row.status,
    totalFen: row.total_fen,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    requestReason: row.request_reason,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    specialProductOverride: row.special_product_override === 1,
    completionReason: row.completion_reason,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    completedAt: row.completed_at,
    items: mapRefundItems(database, tenantId, refundId),
    evidence: mapRefundEvidence(database, tenantId, refundId)
  }
}

export function getRefundDetails(
  database: DatabaseSync,
  context: StoreContext,
  refundId: string
): RefundSummary {
  return findRefund(database, context.tenantId, refundId)
}

function findRefundByRequest(
  database: DatabaseSync,
  tenantId: string,
  requestId: string,
  requestColumn: 'request_id' | 'approval_request_id' | 'rejection_request_id'
): RefundSummary | null {
  const row = database
    .prepare(`SELECT id FROM refund_request WHERE tenant_id = ? AND ${requestColumn} = ?`)
    .get(tenantId, requestId) as { id: string } | undefined
  return row ? findRefund(database, tenantId, row.id) : null
}

function prepareRefundInOpenTransaction(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    requestId: string
    orderId: string
    items: CreateRefundItemRequest[]
    reason?: string
    now: Date
  }
): RefundSummary {
  const repeated = findRefundByRequest(
    database,
    context.tenantId,
    input.requestId,
    'request_id'
  )
  if (repeated) return repeated
  if (input.items.length < 1) throw new Error('Refund must contain at least one item')
  const itemIds = new Set(input.items.map((item) => item.orderItemId))
  if (itemIds.size !== input.items.length) {
    throw new Error('Refund items must not contain duplicates')
  }
  const order = findOrder(database, context, input.orderId)
  assertRefundWindow(order, input.now)
  const available = new Map(
    orderItems(database, context, order.id).map((item) => [item.id, item])
  )
  const prepared = input.items.map((requested) => {
    const item = available.get(requested.orderItemId)
    if (!item) throw new Error('Refund item does not belong to the order')
    if (!Number.isInteger(requested.quantity) || requested.quantity <= 0) {
      throw new Error('Refund quantity must be a positive integer')
    }
    const refundableQuantity =
      item.quantity -
      item.pending_refund_quantity -
      item.completed_refund_quantity
    if (requested.quantity > refundableQuantity) {
      throw new Error(`${item.item_name_snapshot} refund quantity exceeds the remaining quantity`)
    }
    if (item.applied_unit_price_fen <= 0) {
      throw new Error(`${item.item_name_snapshot} has no refundable paid amount`)
    }
    const lineRefundFen = item.applied_unit_price_fen * requested.quantity
    if (!Number.isSafeInteger(lineRefundFen)) {
      throw new Error('Refund amount exceeds the supported range')
    }
    return { item, quantity: requested.quantity, lineRefundFen }
  })
  const totalFen = prepared.reduce((sum, item) => sum + item.lineRefundFen, 0)
  if (!Number.isSafeInteger(totalFen) || totalFen <= 0) {
    throw new Error('Refund total must be greater than zero')
  }
  const paidAndRefunded = database
    .prepare(
      `SELECT p.amount_fen,
              COALESCE(SUM(CASE WHEN r.status = 'completed' THEN r.total_fen ELSE 0 END), 0)
                refunded_fen
       FROM order_payment p
       LEFT JOIN refund_request r
         ON r.tenant_id = p.tenant_id AND r.original_payment_id = p.id
       WHERE p.tenant_id = ? AND p.id = ?
       GROUP BY p.id`
    )
    .get(context.tenantId, order.payment_id) as
    | { amount_fen: number; refunded_fen: number }
    | undefined
  if (!paidAndRefunded || totalFen > paidAndRefunded.amount_fen - paidAndRefunded.refunded_fen) {
    throw new Error('Refund exceeds the remaining payment amount')
  }
  const timestamp = input.now.toISOString()
  const refundId = randomUUID()
  database
    .prepare(
      `INSERT INTO refund_request
       (id, tenant_id, store_id, refund_number, order_id, original_payment_id,
        payment_method, wallet_member_id, status, total_fen, request_id,
        requested_by, requested_at, request_reason, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      refundId,
      context.tenantId,
      context.storeId,
      nextRefundNumber(input.now, refundId),
      order.id,
      order.payment_id,
      order.payment_method,
      order.wallet_member_id,
      totalFen,
      input.requestId,
      context.actor.id,
      timestamp,
      input.reason?.trim() || null,
      context.deviceId
    )
  const insertItem = database.prepare(
    `INSERT INTO refund_item
     (id, tenant_id, store_id, refund_id, order_item_id, item_name_snapshot,
      item_type_snapshot, unit_refund_fen, quantity, line_refund_fen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const item of prepared) {
    insertItem.run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      refundId,
      item.item.id,
      item.item.item_name_snapshot,
      item.item.item_type_snapshot,
      item.item.applied_unit_price_fen,
      item.quantity,
      item.lineRefundFen
    )
  }
  return findRefund(database, context.tenantId, refundId)
}

function completeRefundInOpenTransaction(
  database: DatabaseSync,
  context: RefundContext,
  refund: RefundSummary,
  input: {
    approvalRequestId: string
    specialProductOverride: boolean
    reason?: string
    now: Date
  }
): RefundSummary {
  if (refund.status !== 'pending') {
    throw new Error('Only pending refunds can be completed')
  }
  const order = findOrder(database, context, refund.orderId)
  assertRefundWindow(order, input.now)
  const hasProduct = refund.items.some((item) => item.itemType === 'product')
  const completionReason = input.reason?.trim() || refund.requestReason || ''
  if (hasProduct && !input.specialProductOverride) {
    throw new Error('Delivered products require a manager special refund override')
  }
  if (hasProduct && completionReason.length < 2) {
    throw new Error('A special product refund requires a reason')
  }
  const timestamp = input.now.toISOString()
  const refundPaymentId = randomUUID()
  database
    .prepare(
      `INSERT INTO refund_payment
       (id, tenant_id, store_id, refund_id, original_payment_id, payment_method,
        amount_fen, wallet_member_id, wallet_ledger_id, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'completed', ?)`
    )
    .run(
      refundPaymentId,
      context.tenantId,
      context.storeId,
      refund.id,
      order.payment_id,
      refund.paymentMethod,
      refund.totalFen,
      refund.walletMemberId,
      timestamp
    )
  if (refund.paymentMethod === 'stored_value') {
    const walletResult = creditOrderRefundInOpenTransaction(database, context, {
      requestId: `${input.approvalRequestId}:wallet`,
      originalPaymentId: order.payment_id,
      refundPaymentId,
      refundId: refund.id,
      amountFen: refund.totalFen,
      reason: completionReason || `订单 ${order.order_number} 退款`,
      timestamp
    })
    database
      .prepare('UPDATE refund_payment SET wallet_ledger_id = ? WHERE id = ?')
      .run(walletResult.ledgerId, refundPaymentId)
  }
  database
    .prepare(
      `UPDATE refund_request
       SET status = 'completed', approved_by = ?, approved_at = ?,
           approval_request_id = ?, special_product_override = ?,
           completion_reason = ?, completed_at = ?
       WHERE tenant_id = ? AND id = ? AND status = 'pending'`
    )
    .run(
      context.actor.id,
      timestamp,
      input.approvalRequestId,
      input.specialProductOverride ? 1 : 0,
      completionReason || null,
      timestamp,
      context.tenantId,
      refund.id
    )
  return findRefund(database, context.tenantId, refund.id)
}

export function createRefundRequest(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    requestId: string
    orderId: string
    items: CreateRefundItemRequest[]
    reason?: string
    now?: Date
  }
): RefundSummary {
  const repeated = findRefundByRequest(
    database,
    context.tenantId,
    input.requestId,
    'request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const refund = prepareRefundInOpenTransaction(database, context, {
      ...input,
      now
    })
    appendRefundAuditAndOutbox(database, context, {
      action: 'refund.requested',
      operationType: 'refund.requested',
      refundId: refund.id,
      reason: refund.requestReason ?? '退款申请',
      before: null,
      after: refund,
      timestamp: now.toISOString()
    })
    database.exec('COMMIT')
    return refund
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function approveRefund(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    requestId: string
    refundId: string
    specialProductOverride?: boolean
    reason?: string
    now?: Date
  }
): RefundSummary {
  requireManager(context)
  const repeated = findRefundByRequest(
    database,
    context.tenantId,
    input.requestId,
    'approval_request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const before = findRefund(database, context.tenantId, input.refundId)
    const after = completeRefundInOpenTransaction(database, context, before, {
      approvalRequestId: input.requestId,
      specialProductOverride: input.specialProductOverride === true,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    appendRefundAuditAndOutbox(database, context, {
      action: 'refund.completed',
      operationType: 'refund.completed',
      refundId: after.id,
      reason: after.completionReason ?? '店长审批退款',
      before,
      after,
      timestamp: now.toISOString()
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function rejectRefund(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    requestId: string
    refundId: string
    reason: string
    now?: Date
  }
): RefundSummary {
  requireManager(context)
  const repeated = findRefundByRequest(
    database,
    context.tenantId,
    input.requestId,
    'rejection_request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    const before = findRefund(database, context.tenantId, input.refundId)
    if (before.status !== 'pending') {
      throw new Error('Only pending refunds can be rejected')
    }
    database
      .prepare(
        `UPDATE refund_request
         SET status = 'rejected', rejected_by = ?, rejected_at = ?,
             rejection_request_id = ?, rejection_reason = ?
         WHERE tenant_id = ? AND id = ? AND status = 'pending'`
      )
      .run(
        context.actor.id,
        timestamp,
        input.requestId,
        input.reason,
        context.tenantId,
        input.refundId
      )
    const after = findRefund(database, context.tenantId, input.refundId)
    appendRefundAuditAndOutbox(database, context, {
      action: 'refund.rejected',
      operationType: 'refund.rejected',
      refundId: after.id,
      reason: input.reason,
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

export function directRefund(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    requestId: string
    orderId: string
    items: CreateRefundItemRequest[]
    specialProductOverride?: boolean
    reason?: string
    now?: Date
  }
): RefundSummary {
  requireManager(context)
  const repeated = findRefundByRequest(
    database,
    context.tenantId,
    input.requestId,
    'request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const pending = prepareRefundInOpenTransaction(database, context, {
      requestId: input.requestId,
      orderId: input.orderId,
      items: input.items,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    const completed = completeRefundInOpenTransaction(database, context, pending, {
      approvalRequestId: `${input.requestId}:direct`,
      specialProductOverride: input.specialProductOverride === true,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    appendRefundAuditAndOutbox(database, context, {
      action: 'refund.completed_directly',
      operationType: 'refund.completed',
      refundId: completed.id,
      reason: completed.completionReason ?? '店长直接退款',
      before: null,
      after: completed,
      timestamp: now.toISOString()
    })
    database.exec('COMMIT')
    return completed
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function listRefunds(
  database: DatabaseSync,
  context: StoreContext,
  input: { limit: number; status?: RefundStatus }
): RefundSummary[] {
  const rows = database
    .prepare(
      `SELECT id FROM refund_request
       WHERE tenant_id = ? AND store_id = ?
         AND (? IS NULL OR status = ?)
       ORDER BY requested_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(
      context.tenantId,
      context.storeId,
      input.status ?? null,
      input.status ?? null,
      input.limit
    ) as Array<{ id: string }>
  return rows.map((row) => findRefund(database, context.tenantId, row.id))
}

export function recordRefundEvidence(
  database: DatabaseSync,
  context: RefundContext,
  input: {
    requestId: string
    refundId: string
    evidenceType: 'pdf' | 'excel'
    fileName: string
    fileSha256: string
    now?: Date
  }
): RefundEvidenceSummary {
  requireManager(context)
  const existing = database
    .prepare(
      `SELECT id, evidence_type, file_name, file_sha256, generated_by, generated_at
       FROM refund_evidence WHERE tenant_id = ? AND request_id = ?`
    )
    .get(context.tenantId, input.requestId) as Record<string, unknown> | undefined
  if (existing) {
    return {
      id: String(existing.id),
      evidenceType: existing.evidence_type as RefundEvidenceSummary['evidenceType'],
      fileName: String(existing.file_name),
      fileSha256: String(existing.file_sha256),
      generatedBy: String(existing.generated_by),
      generatedAt: String(existing.generated_at)
    }
  }
  const refund = findRefund(database, context.tenantId, input.refundId)
  if (refund.status !== 'completed') {
    throw new Error('Only completed refunds can export evidence')
  }
  if (!/^[a-f0-9]{64}$/i.test(input.fileSha256)) {
    throw new Error('Refund evidence hash is invalid')
  }
  const timestamp = (input.now ?? new Date()).toISOString()
  const evidence: RefundEvidenceSummary = {
    id: randomUUID(),
    evidenceType: input.evidenceType,
    fileName: input.fileName,
    fileSha256: input.fileSha256.toLowerCase(),
    generatedBy: context.actor.id,
    generatedAt: timestamp
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO refund_evidence
         (id, tenant_id, store_id, refund_id, evidence_type, file_name,
          file_sha256, request_id, generated_by, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        evidence.id,
        context.tenantId,
        context.storeId,
        input.refundId,
        input.evidenceType,
        input.fileName,
        evidence.fileSha256,
        input.requestId,
        context.actor.id,
        timestamp
      )
    appendRefundAuditAndOutbox(database, context, {
      action: 'refund.evidence_exported',
      operationType: 'refund.evidence_exported',
      refundId: refund.id,
      reason: `导出 ${input.evidenceType.toUpperCase()} 退款凭证`,
      before: refund.evidence,
      after: [...refund.evidence, evidence],
      timestamp
    })
    database.exec('COMMIT')
    return evidence
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
