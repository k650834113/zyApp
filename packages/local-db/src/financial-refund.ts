import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  FinancialRefundSummary,
  FinancialRefundTargetType,
  RefundStatus
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'
import { refundMonthlyCardInOpenTransaction } from './monthly-card'
import { reverseCashRechargeInOpenTransaction } from './wallet'
import { assertCloudMirrorSafeForFinancialWrite } from './cloud-runtime'

type FinancialRefundContext = StoreContext & {
  actor: EmployeeRecord
}

type FinancialRefundRow = {
  id: string
  request_number: string
  target_type: FinancialRefundTargetType
  target_id: string
  member_id: string
  member_nickname: string
  member_phone: string
  status: RefundStatus
  refund_principal_fen: number
  reclaim_gift_fen: number
  requested_by: string
  requested_at: string
  request_reason: string | null
  approved_by: string | null
  approved_at: string | null
  requires_special_override: number
  special_override: number
  completion_reason: string | null
  execution_operation_id: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  completed_at: string | null
}

type RefundTarget = {
  targetType: FinancialRefundTargetType
  targetId: string
  memberId: string
  refundPrincipalFen: number
  reclaimGiftFen: number
  requiresSpecialOverride: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

function requireManager(context: FinancialRefundContext): void {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can approve, reject, or directly complete refunds')
  }
}

function nextRequestNumber(now: Date, id: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now)
  const value = (type: 'year' | 'month' | 'day'): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `F${value('year')}${value('month')}${value('day')}-${id
    .replaceAll('-', '')
    .slice(0, 8)
    .toUpperCase()}`
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

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: FinancialRefundContext,
  input: {
    action: string
    operationType: string
    requestId: string
    reason: string
    before: unknown
    after: unknown
    timestamp: string
  }
): void {
  const payload = JSON.stringify({
    action: input.action,
    requestId: input.requestId,
    reason: input.reason,
    before: input.before,
    after: input.after
  })
  const sequence = nextDeviceSequence(database, context.deviceId, input.timestamp)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'financial_refund', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.requestId,
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
      input.requestId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

function mapRequest(row: FinancialRefundRow): FinancialRefundSummary {
  return {
    id: row.id,
    requestNumber: row.request_number,
    targetType: row.target_type,
    targetId: row.target_id,
    memberId: row.member_id,
    memberNickname: row.member_nickname,
    memberPhone: row.member_phone,
    paymentMethod: 'cash',
    status: row.status,
    refundPrincipalFen: row.refund_principal_fen,
    reclaimGiftFen: row.reclaim_gift_fen,
    requiresSpecialOverride: row.requires_special_override === 1,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    requestReason: row.request_reason,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    specialOverride: row.special_override === 1,
    completionReason: row.completion_reason,
    executionOperationId: row.execution_operation_id,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    completedAt: row.completed_at
  }
}

function findRequest(
  database: DatabaseSync,
  tenantId: string,
  financialRefundId: string
): FinancialRefundSummary {
  const row = database
    .prepare(
      `SELECT f.id, f.request_number, f.target_type, f.target_id, f.member_id,
              m.nickname member_nickname, m.phone member_phone, f.status,
              f.refund_principal_fen, f.reclaim_gift_fen, f.requested_by,
              f.requested_at, f.request_reason, f.approved_by, f.approved_at,
              f.requires_special_override, f.special_override,
              f.completion_reason, f.execution_operation_id, f.rejected_by,
              f.rejected_at, f.rejection_reason, f.completed_at
       FROM financial_refund_request f
       JOIN member m ON m.tenant_id = f.tenant_id AND m.id = f.member_id
       WHERE f.tenant_id = ? AND f.id = ?`
    )
    .get(tenantId, financialRefundId) as FinancialRefundRow | undefined
  if (!row) throw new Error('Financial refund request was not found')
  return mapRequest(row)
}

function findRequestByOperation(
  database: DatabaseSync,
  tenantId: string,
  requestId: string,
  column: 'request_id' | 'approval_request_id' | 'rejection_request_id'
): FinancialRefundSummary | null {
  const row = database
    .prepare(
      `SELECT id FROM financial_refund_request
       WHERE tenant_id = ? AND ${column} = ?`
    )
    .get(tenantId, requestId) as { id: string } | undefined
  return row ? findRequest(database, tenantId, row.id) : null
}

function readTarget(
  database: DatabaseSync,
  context: StoreContext,
  targetType: FinancialRefundTargetType,
  targetId: string,
  now: Date
): RefundTarget {
  if (targetType === 'monthly_card') {
    const row = database
      .prepare(
        `SELECT c.id, c.member_id, c.price_fen, c.payment_method,
                c.status, c.purchased_at,
                c.legacy_import_batch_id,
                (SELECT COUNT(*) FROM monthly_card_event e
                 WHERE e.tenant_id = c.tenant_id AND e.card_id = c.id
                   AND e.event_type = 'used') usage_count
         FROM monthly_card c
         WHERE c.tenant_id = ? AND c.store_id = ? AND c.id = ?`
      )
      .get(context.tenantId, context.storeId, targetId) as
      | {
          id: string
          member_id: string
          price_fen: number
          payment_method: string
          status: string
          purchased_at: string
          legacy_import_batch_id: string | null
          usage_count: number
        }
      | undefined
    if (!row) throw new Error('Monthly card was not found')
    if (row.legacy_import_batch_id) {
      throw new Error('旧库月卡的原支付渠道未知，不能在程序中自动退款')
    }
    if (row.payment_method !== 'cash') {
      throw new Error(
        'WeChat monthly cards cannot be refunded as PC cash; use the WeChat refund flow'
      )
    }
    if (row.status !== 'active' && row.status !== 'paused') {
      throw new Error('Monthly card cannot be refunded in its current status')
    }
    const purchasedAt = new Date(row.purchased_at).getTime()
    if (
      !Number.isFinite(purchasedAt) ||
      now.getTime() < purchasedAt ||
      now.getTime() - purchasedAt > DAY_MS
    ) {
      throw new Error('Monthly card refund window has expired')
    }
    return {
      targetType,
      targetId: row.id,
      memberId: row.member_id,
      refundPrincipalFen: row.price_fen,
      reclaimGiftFen: 0,
      requiresSpecialOverride: row.usage_count > 0
    }
  }

  const row = database
    .prepare(
      `SELECT r.id, r.member_id, r.status,
              l.remaining_principal_fen, l.remaining_gift_fen
       FROM wallet_recharge r
       JOIN wallet_lot l
         ON l.tenant_id = r.tenant_id
        AND l.source_type = 'recharge'
        AND l.source_id = r.id
       WHERE r.tenant_id = ? AND r.store_id = ? AND r.id = ?
         AND r.payment_method = 'cash'`
    )
    .get(context.tenantId, context.storeId, targetId) as
    | {
        id: string
        member_id: string
        status: string
        remaining_principal_fen: number
        remaining_gift_fen: number
      }
    | undefined
  if (!row) throw new Error('Cash recharge was not found')
  if (row.status === 'reversed') throw new Error('Cash recharge has already been reversed')
  if (row.remaining_principal_fen <= 0) {
    throw new Error('Cash recharge has no refundable principal balance')
  }
  return {
    targetType,
    targetId: row.id,
    memberId: row.member_id,
    refundPrincipalFen: row.remaining_principal_fen,
    reclaimGiftFen: row.remaining_gift_fen,
    requiresSpecialOverride: false
  }
}

function prepareRequestInOpenTransaction(
  database: DatabaseSync,
  context: FinancialRefundContext,
  input: {
    requestId: string
    targetType: FinancialRefundTargetType
    targetId: string
    reason?: string
    now: Date
  }
): FinancialRefundSummary {
  const repeated = findRequestByOperation(
    database,
    context.tenantId,
    input.requestId,
    'request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'financial_refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const pending = database
    .prepare(
      `SELECT id FROM financial_refund_request
       WHERE tenant_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'`
    )
    .get(context.tenantId, input.targetType, input.targetId)
  if (pending) throw new Error('This item already has a pending refund request')
  const target = readTarget(
    database,
    context,
    input.targetType,
    input.targetId,
    input.now
  )
  const id = randomUUID()
  const timestamp = input.now.toISOString()
  database
    .prepare(
      `INSERT INTO financial_refund_request
       (id, tenant_id, store_id, request_number, target_type, target_id, member_id,
        payment_method, status, refund_principal_fen, reclaim_gift_fen, request_id,
        requested_by, requested_at, request_reason, requires_special_override,
        device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      context.tenantId,
      context.storeId,
      nextRequestNumber(input.now, id),
      target.targetType,
      target.targetId,
      target.memberId,
      target.refundPrincipalFen,
      target.reclaimGiftFen,
      input.requestId,
      context.actor.id,
      timestamp,
      input.reason?.trim() || null,
      target.requiresSpecialOverride ? 1 : 0,
      context.deviceId
    )
  return findRequest(database, context.tenantId, id)
}

function completeRequestInOpenTransaction(
  database: DatabaseSync,
  context: FinancialRefundContext,
  request: FinancialRefundSummary,
  input: {
    approvalRequestId: string
    specialOverride: boolean
    reason?: string
    now: Date
  }
): FinancialRefundSummary {
  if (request.status !== 'pending') {
    throw new Error('Only pending financial refunds can be completed')
  }
  const target = readTarget(
    database,
    context,
    request.targetType,
    request.targetId,
    input.now
  )
  if (
    target.memberId !== request.memberId ||
    target.refundPrincipalFen !== request.refundPrincipalFen ||
    target.reclaimGiftFen !== request.reclaimGiftFen
  ) {
    throw new Error('Refundable balance changed; reject this request and create a new one')
  }
  const completionReason = input.reason?.trim() || request.requestReason || ''
  if (target.requiresSpecialOverride && !input.specialOverride) {
    throw new Error('A used monthly card requires a manager special refund override')
  }
  if (target.requiresSpecialOverride && completionReason.length < 2) {
    throw new Error('A special monthly-card refund requires a reason')
  }
  const timestamp = input.now.toISOString()
  let executionOperationId: string
  if (request.targetType === 'monthly_card') {
    executionOperationId = `${input.approvalRequestId}:monthly-card`
    refundMonthlyCardInOpenTransaction(database, context, {
      requestId: executionOperationId,
      cardId: request.targetId,
      reason: completionReason || '月卡退款',
      specialOverride: input.specialOverride,
      now: input.now
    })
  } else {
    const result = reverseCashRechargeInOpenTransaction(database, context, {
      requestId: `${input.approvalRequestId}:cash-recharge`,
      rechargeId: request.targetId,
      reason: completionReason || '现金充值退款',
      now: input.now
    })
    executionOperationId = result.operationId
  }
  database
    .prepare(
      `UPDATE financial_refund_request
       SET status = 'completed', approved_by = ?, approved_at = ?,
           approval_request_id = ?, special_override = ?, completion_reason = ?,
           execution_operation_id = ?, completed_at = ?
       WHERE tenant_id = ? AND id = ? AND status = 'pending'`
    )
    .run(
      context.actor.id,
      timestamp,
      input.approvalRequestId,
      input.specialOverride ? 1 : 0,
      completionReason || null,
      executionOperationId,
      timestamp,
      context.tenantId,
      request.id
    )
  return findRequest(database, context.tenantId, request.id)
}

export function createFinancialRefundRequest(
  database: DatabaseSync,
  context: FinancialRefundContext,
  input: {
    requestId: string
    targetType: FinancialRefundTargetType
    targetId: string
    reason?: string
    now?: Date
  }
): FinancialRefundSummary {
  const repeated = findRequestByOperation(
    database,
    context.tenantId,
    input.requestId,
    'request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'financial_refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const request = prepareRequestInOpenTransaction(database, context, {
      requestId: input.requestId,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    appendAuditAndOutbox(database, context, {
      action: 'financial_refund.requested',
      operationType: 'financial_refund.requested',
      requestId: request.id,
      reason: request.requestReason ?? '退款申请',
      before: null,
      after: request,
      timestamp: now.toISOString()
    })
    database.exec('COMMIT')
    return request
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function approveFinancialRefund(
  database: DatabaseSync,
  context: FinancialRefundContext,
  input: {
    requestId: string
    financialRefundId: string
    specialOverride?: boolean
    reason?: string
    now?: Date
  }
): FinancialRefundSummary {
  requireManager(context)
  const repeated = findRequestByOperation(
    database,
    context.tenantId,
    input.requestId,
    'approval_request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'financial_refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const before = findRequest(database, context.tenantId, input.financialRefundId)
    const after = completeRequestInOpenTransaction(database, context, before, {
      approvalRequestId: input.requestId,
      specialOverride: input.specialOverride === true,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    appendAuditAndOutbox(database, context, {
      action: 'financial_refund.completed',
      operationType: 'financial_refund.completed',
      requestId: after.id,
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

export function rejectFinancialRefund(
  database: DatabaseSync,
  context: FinancialRefundContext,
  input: {
    requestId: string
    financialRefundId: string
    reason: string
    now?: Date
  }
): FinancialRefundSummary {
  requireManager(context)
  const repeated = findRequestByOperation(
    database,
    context.tenantId,
    input.requestId,
    'rejection_request_id'
  )
  if (repeated) return repeated
  const now = input.now ?? new Date()
  const timestamp = now.toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    const before = findRequest(database, context.tenantId, input.financialRefundId)
    if (before.status !== 'pending') {
      throw new Error('Only pending financial refunds can be rejected')
    }
    database
      .prepare(
        `UPDATE financial_refund_request
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
        input.financialRefundId
      )
    const after = findRequest(database, context.tenantId, input.financialRefundId)
    appendAuditAndOutbox(database, context, {
      action: 'financial_refund.rejected',
      operationType: 'financial_refund.rejected',
      requestId: after.id,
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

export function directFinancialRefund(
  database: DatabaseSync,
  context: FinancialRefundContext,
  input: {
    requestId: string
    targetType: FinancialRefundTargetType
    targetId: string
    specialOverride?: boolean
    reason?: string
    now?: Date
  }
): FinancialRefundSummary {
  requireManager(context)
  const repeated = findRequestByOperation(
    database,
    context.tenantId,
    input.requestId,
    'request_id'
  )
  if (repeated) return repeated
  assertCloudMirrorSafeForFinancialWrite(database, context, 'financial_refund')
  assertCloudMirrorSafeForFinancialWrite(database, context, 'wallet')
  const now = input.now ?? new Date()
  database.exec('BEGIN IMMEDIATE')
  try {
    const pending = prepareRequestInOpenTransaction(database, context, {
      requestId: input.requestId,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    const completed = completeRequestInOpenTransaction(database, context, pending, {
      approvalRequestId: `${input.requestId}:direct`,
      specialOverride: input.specialOverride === true,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      now
    })
    appendAuditAndOutbox(database, context, {
      action: 'financial_refund.completed_directly',
      operationType: 'financial_refund.completed',
      requestId: completed.id,
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

export function listFinancialRefunds(
  database: DatabaseSync,
  context: StoreContext,
  input: { limit: number; status?: RefundStatus }
): FinancialRefundSummary[] {
  const rows = database
    .prepare(
      `SELECT f.id, f.request_number, f.target_type, f.target_id, f.member_id,
              m.nickname member_nickname, m.phone member_phone, f.status,
              f.refund_principal_fen, f.reclaim_gift_fen, f.requested_by,
              f.requested_at, f.request_reason, f.approved_by, f.approved_at,
              f.requires_special_override, f.special_override,
              f.completion_reason, f.execution_operation_id, f.rejected_by,
              f.rejected_at, f.rejection_reason, f.completed_at
       FROM financial_refund_request f
       JOIN member m ON m.tenant_id = f.tenant_id AND m.id = f.member_id
       WHERE f.tenant_id = ? AND f.store_id = ? AND (? IS NULL OR f.status = ?)
       ORDER BY f.requested_at DESC, f.rowid DESC
       LIMIT ?`
    )
    .all(
      context.tenantId,
      context.storeId,
      input.status ?? null,
      input.status ?? null,
      input.limit
    ) as FinancialRefundRow[]
  return rows.map(mapRequest)
}
