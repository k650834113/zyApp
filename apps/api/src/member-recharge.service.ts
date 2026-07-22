import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common'
import type {
  CreateMemberRechargeOrderRequest,
  MemberRechargeOrderSummary
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import {
  calculateMaximumRechargeGift,
  nonNegativeFen,
  type RechargeGiftTier
} from '@zyapp/domain'
import { createHash, randomUUID } from 'node:crypto'
import type { MiniappPrincipal } from './miniapp-auth'
import {
  POSTGRES_POOL,
  WECHAT_PAYMENT_PROVIDER
} from './infrastructure.module'
import type { WechatPaymentProvider } from './wechat-payment-provider'

type RechargeOrderRow = {
  id: string
  request_id: string
  request_hash: string
  out_trade_no: string
  provider_mode: 'mock' | 'wechat'
  principal_fen: number | string
  gift_fen: number | string
  gift_rule_snapshot_json: unknown
  client_payment_json: Record<string, string> | null
  status: MemberRechargeOrderSummary['status']
  error_message: string | null
  expires_at: Date | string
  settled_at: Date | string | null
  created_at: Date | string
}

type LockedRechargeOrderRow = RechargeOrderRow & {
  tenant_id: string
  store_id: string
  member_id: string
  identity_id: string
}

function safeFen(value: number | string, name: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${name} is outside the safe integer range`)
  }
  return result
}

function summarize(row: RechargeOrderRow): MemberRechargeOrderSummary {
  const principalFen = safeFen(row.principal_fen, 'principalFen')
  const giftFen = safeFen(row.gift_fen, 'giftFen')
  return {
    orderId: row.id,
    requestId: row.request_id,
    principalFen,
    giftFen,
    totalCreditFen: principalFen + giftFen,
    status: row.status,
    providerMode: row.provider_mode,
    clientPaymentParameters: row.client_payment_json,
    expiresAt: new Date(row.expires_at).toISOString(),
    settledAt:
      row.settled_at === null
        ? null
        : new Date(row.settled_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    errorMessage: row.error_message
  }
}

function request(
  value: unknown
): CreateMemberRechargeOrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Recharge order request must be an object')
  }
  const input = value as Record<string, unknown>
  if (
    typeof input.requestId !== 'string' ||
    input.requestId.trim().length < 8 ||
    input.requestId.trim().length > 100
  ) {
    throw new Error('requestId must contain 8 to 100 characters')
  }
  if (
    !Number.isSafeInteger(input.principalFen) ||
    Number(input.principalFen) <= 0 ||
    Number(input.principalFen) > 100_000_000
  ) {
    throw new Error('principalFen must be an integer from 1 to 100000000')
  }
  return {
    requestId: input.requestId.trim(),
    principalFen: Number(input.principalFen)
  }
}

function requestHash(input: CreateMemberRechargeOrderRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        principalFen: input.principalFen,
        requestId: input.requestId
      })
    )
    .digest('hex')
}

function callbackHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

@Injectable()
export class MemberRechargeService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(WECHAT_PAYMENT_PROVIDER)
    private readonly paymentProvider: WechatPaymentProvider
  ) {}

  async createOrder(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MemberRechargeOrderSummary> {
    const memberId = this.requireMember(principal)
    if (this.paymentProvider.mode === 'disabled') {
      throw new ServiceUnavailableException('微信支付商户配置尚未启用')
    }
    let input: CreateMemberRechargeOrderRequest
    try {
      input = request(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid recharge order'
      )
    }

    const hash = requestHash(input)
    const existing = await this.pool.query<RechargeOrderRow>(
      `SELECT id, request_id, request_hash, out_trade_no, provider_mode,
              principal_fen, gift_fen, gift_rule_snapshot_json,
              client_payment_json, status, error_message, expires_at,
              settled_at, created_at
       FROM wechat_recharge_order
       WHERE tenant_id = $1 AND identity_id = $2 AND request_id = $3
       LIMIT 1`,
      [principal.tenantId, principal.identityId, input.requestId]
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== hash) {
        throw new ConflictException(
          'requestId has already been used for another recharge'
        )
      }
      return summarize(existing.rows[0])
    }

    const orderId = randomUUID()
    const outTradeNo = orderId.replaceAll('-', '')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000)
    const client = await this.pool.connect()
    let giftFen = 0
    let giftSnapshot: unknown = null
    let concurrentOrder: MemberRechargeOrderSummary | null = null
    try {
      await client.query('BEGIN')
      const member = await client.query<{
        status: 'active' | 'disabled'
        age_gate_status:
          | 'confirmed_at_least_14'
          | 'under_14_verified'
          | 'recharge_disabled'
      }>(
        `SELECT status, age_gate_status
         FROM cloud_member
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [principal.tenantId, memberId]
      )
      const currentMember = member.rows[0]
      if (!currentMember || currentMember.status !== 'active') {
        throw new NotFoundException('Member was not found')
      }
      if (currentMember.age_gate_status === 'recharge_disabled') {
        throw new ConflictException(
          '当前账号未完成监护人同意与身份核验，暂不能储值'
        )
      }
      const tiers = await client.query<{
        id: string
        principal_fen: number | string
        gift_fen: number | string
      }>(
        `SELECT id, principal_fen, gift_fen
         FROM cloud_recharge_gift_tier
         WHERE tenant_id = $1 AND store_id = $2 AND active = TRUE
         ORDER BY principal_fen`,
        [principal.tenantId, principal.storeId]
      )
      const template = await client.query<{
        id: string
        payload_json: Record<string, unknown>
        override_payload_json: Record<string, unknown> | null
      }>(
        `SELECT template.id::text, template.payload_json,
                override.payload_json override_payload_json
         FROM cloud_merchant_business_template template
         LEFT JOIN cloud_store_business_template_override override
           ON override.tenant_id = template.tenant_id
          AND override.store_id = $2 AND override.template_id = template.id
          AND override.active = TRUE
         WHERE template.tenant_id = $1
           AND template.template_type = 'recharge_gift_tier'
           AND template.active = TRUE
         ORDER BY template.created_at, template.id LIMIT 1`,
        [principal.tenantId, principal.storeId]
      )
      const templateRow = template.rows[0]
      const resolvedPayload = templateRow
        ? { ...templateRow.payload_json, ...(templateRow.override_payload_json ?? {}) }
        : null
      const resolvedTiers = resolvedPayload && Array.isArray(resolvedPayload.tiers)
        ? resolvedPayload.tiers.map((value, index) => {
            const tier = value as Record<string, unknown>
            return {
              id: `${templateRow?.id ?? 'template'}:${index}`,
              principal_fen: Number(tier.principalFen),
              gift_fen: Number(tier.giftFen)
            }
          })
        : tiers.rows
      const domainTiers: RechargeGiftTier[] = resolvedTiers.map((tier) => ({
        id: tier.id,
        principal: nonNegativeFen(
          safeFen(tier.principal_fen, 'tier.principalFen')
        ),
        gift: nonNegativeFen(safeFen(tier.gift_fen, 'tier.giftFen'))
      }))
      const allocation = calculateMaximumRechargeGift(
        nonNegativeFen(input.principalFen),
        domainTiers
      )
      giftFen = allocation.gift
      giftSnapshot = {
        tiers: resolvedTiers.map((tier) => ({
          id: tier.id,
          principalFen: safeFen(tier.principal_fen, 'tier.principalFen'),
          giftFen: safeFen(tier.gift_fen, 'tier.giftFen')
        })),
        allocation
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO wechat_recharge_order
         (id, tenant_id, store_id, member_id, identity_id, request_id,
          request_hash, out_trade_no, provider_mode, principal_fen, gift_fen,
          gift_rule_snapshot_json, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'mock', $9, $10,
                 $11::jsonb, 'creating', $12)
         ON CONFLICT (tenant_id, identity_id, request_id) DO NOTHING
         RETURNING id`,
        [
          orderId,
          principal.tenantId,
          principal.storeId,
          memberId,
          principal.identityId,
          input.requestId,
          hash,
          outTradeNo,
          input.principalFen,
          giftFen,
          JSON.stringify(giftSnapshot),
          expiresAt.toISOString()
        ]
      )
      if (!inserted.rows[0]) {
        const concurrent = await client.query<RechargeOrderRow>(
          `SELECT id, request_id, request_hash, out_trade_no, provider_mode,
                  principal_fen, gift_fen, gift_rule_snapshot_json,
                  client_payment_json, status, error_message, expires_at,
                  settled_at, created_at
           FROM wechat_recharge_order
           WHERE tenant_id = $1 AND identity_id = $2 AND request_id = $3
           FOR UPDATE`,
          [principal.tenantId, principal.identityId, input.requestId]
        )
        const row = concurrent.rows[0]
        if (!row || row.request_hash !== hash) {
          throw new ConflictException(
            'requestId has already been used for another recharge'
          )
        }
        concurrentOrder = summarize(row)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    if (concurrentOrder) return concurrentOrder

    try {
      const payment = await this.paymentProvider.createRechargePayment({
        outTradeNo,
        principalFen: input.principalFen,
        payerSubject: principal.providerSubject,
        description: '桌游吧会员储值',
        expiresAt: expiresAt.toISOString()
      })
      const updated = await this.pool.query<RechargeOrderRow>(
        `UPDATE wechat_recharge_order
         SET provider_mode = $2, provider_prepay_id = $3,
             client_payment_json = $4::jsonb, status = 'pending_payment',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'creating'
         RETURNING id, request_id, request_hash, out_trade_no, provider_mode,
                   principal_fen, gift_fen, gift_rule_snapshot_json,
                   client_payment_json, status, error_message, expires_at,
                   settled_at, created_at`,
        [
          orderId,
          payment.providerMode,
          payment.prepayId,
          JSON.stringify(payment.clientPaymentParameters)
        ]
      )
      const row = updated.rows[0]
      if (!row) throw new Error('Recharge order did not enter payment state')
      return summarize(row)
    } catch (error) {
      await this.pool.query(
        `UPDATE wechat_recharge_order
         SET status = 'failed', error_message = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'creating'`,
        [
          orderId,
          error instanceof Error ? error.message.slice(0, 1000) : 'Payment failed'
        ]
      )
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : '微信支付下单失败'
      )
    }
  }

  async getOrder(
    principal: MiniappPrincipal,
    orderId: string
  ): Promise<MemberRechargeOrderSummary> {
    this.requireMember(principal)
    const result = await this.pool.query<RechargeOrderRow>(
      `SELECT id, request_id, request_hash, out_trade_no, provider_mode,
              principal_fen, gift_fen, gift_rule_snapshot_json,
              client_payment_json, status, error_message, expires_at,
              settled_at, created_at
       FROM wechat_recharge_order
       WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         AND identity_id = $4
       LIMIT 1`,
      [
        orderId,
        principal.tenantId,
        principal.storeId,
        principal.identityId
      ]
    )
    const row = result.rows[0]
    if (!row) throw new NotFoundException('Recharge order was not found')
    return summarize(row)
  }

  async settleMockOrder(
    principal: MiniappPrincipal,
    orderId: string
  ): Promise<MemberRechargeOrderSummary> {
    this.requireMember(principal)
    if (this.paymentProvider.mode !== 'mock') {
      throw new NotFoundException('Mock payment endpoint is unavailable')
    }
    const eventId = `mock-paid:${orderId}`
    const transactionId = `mock-tx-${orderId}`
    return this.settlePaidOrder({
      provider: 'wechat-mock',
      eventId,
      payload: {
        eventId,
        orderId,
        transactionId,
        identityId: principal.identityId
      },
      orderId,
      transactionId,
      expectedIdentityId: principal.identityId
    })
  }

  private async settlePaidOrder(input: {
    provider: string
    eventId: string
    payload: unknown
    orderId: string
    transactionId: string
    expectedIdentityId?: string
  }): Promise<MemberRechargeOrderSummary> {
    const payloadHash = callbackHash(input.payload)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const reserved = await client.query(
        `INSERT INTO payment_callback_inbox
         (provider, event_id, payload_hash, order_id, status, payload_json)
         VALUES ($1, $2, $3, $4, 'received', $5::jsonb)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING event_id`,
        [
          input.provider,
          input.eventId,
          payloadHash,
          input.orderId,
          JSON.stringify(input.payload)
        ]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          payload_hash: string
        }>(
          `SELECT payload_hash
           FROM payment_callback_inbox
           WHERE provider = $1 AND event_id = $2
           FOR UPDATE`,
          [input.provider, input.eventId]
        )
        if (previous.rows[0]?.payload_hash !== payloadHash) {
          throw new ConflictException(
            'Payment callback id was reused with different data'
          )
        }
      }

      const orderResult = await client.query<LockedRechargeOrderRow>(
        `SELECT id, tenant_id, store_id, member_id, identity_id, request_id,
                request_hash, out_trade_no, provider_mode, principal_fen,
                gift_fen, gift_rule_snapshot_json, client_payment_json,
                status, error_message, expires_at, settled_at, created_at
         FROM wechat_recharge_order
         WHERE id = $1
         FOR UPDATE`,
        [input.orderId]
      )
      const order = orderResult.rows[0]
      if (!order) throw new NotFoundException('Recharge order was not found')
      if (
        input.expectedIdentityId &&
        order.identity_id !== input.expectedIdentityId
      ) {
        throw new UnauthorizedException('Recharge order belongs to another user')
      }
      if (order.status === 'settled') {
        await client.query(
          `UPDATE payment_callback_inbox
           SET status = 'processed', order_id = $3,
               processed_at = CURRENT_TIMESTAMP
           WHERE provider = $1 AND event_id = $2`,
          [input.provider, input.eventId, order.id]
        )
        await client.query('COMMIT')
        return summarize(order)
      }
      if (order.status !== 'pending_payment') {
        throw new ConflictException(
          `Recharge order cannot be paid from status ${order.status}`
        )
      }
      if (new Date(order.expires_at).getTime() <= Date.now()) {
        const expired = await client.query<RechargeOrderRow>(
          `UPDATE wechat_recharge_order
           SET status = 'expired', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, request_id, request_hash, out_trade_no, provider_mode,
                     principal_fen, gift_fen, gift_rule_snapshot_json,
                     client_payment_json, status, error_message, expires_at,
                     settled_at, created_at`,
          [order.id]
        )
        await client.query(
          `UPDATE payment_callback_inbox
           SET status = 'failed', order_id = $3,
               error_message = 'recharge order expired',
               processed_at = CURRENT_TIMESTAMP
           WHERE provider = $1 AND event_id = $2`,
          [input.provider, input.eventId, order.id]
        )
        await client.query('COMMIT')
        const row = expired.rows[0]
        if (!row) throw new Error('Expired recharge order was not returned')
        return summarize(row)
      }

      const member = await client.query<{ id: string }>(
        `SELECT id FROM cloud_member
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [order.tenant_id, order.member_id]
      )
      if (!member.rows[0]) {
        throw new ConflictException('Recharge member no longer exists')
      }
      const walletResult = await client.query<{
        id: string
        status: 'active' | 'frozen'
        principal_balance_fen: number | string
        gift_balance_fen: number | string
      }>(
        `SELECT id, status, principal_balance_fen, gift_balance_fen
         FROM cloud_wallet_account
         WHERE tenant_id = $1 AND member_id = $2
         FOR UPDATE`,
        [order.tenant_id, order.member_id]
      )
      const walletId = walletResult.rows[0]?.id ?? randomUUID()
      const principalBefore = walletResult.rows[0]
        ? safeFen(
            walletResult.rows[0].principal_balance_fen,
            'wallet.principalBalanceFen'
          )
        : 0
      const giftBefore = walletResult.rows[0]
        ? safeFen(
            walletResult.rows[0].gift_balance_fen,
            'wallet.giftBalanceFen'
          )
        : 0
      const principalFen = safeFen(order.principal_fen, 'principalFen')
      const giftFen = safeFen(order.gift_fen, 'giftFen')
      const principalAfter = principalBefore + principalFen
      const giftAfter = giftBefore + giftFen
      if (
        !Number.isSafeInteger(principalAfter) ||
        !Number.isSafeInteger(giftAfter)
      ) {
        throw new Error('Wallet balance exceeds the safe integer range')
      }
      const timestamp = new Date().toISOString()
      const settlementOperationId = randomUUID()
      const membershipGrantId =
        principalFen >= 50_000 ? randomUUID() : null
      const eventPayload = {
        action: 'wallet.wechat_recharged',
        before: null,
        after: {
          rechargeId: order.id,
          paymentOrderId: order.id,
          memberId: order.member_id,
          principalFen,
          giftFen,
          giftRuleSnapshot: order.gift_rule_snapshot_json,
          providerTransactionId: input.transactionId,
          membershipGrantId,
          occurredAt: timestamp
        },
        reason: '小程序微信充值'
      }
      const event = await client.query<{ sequence: number | string }>(
        `INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         VALUES ($1, $2, $3, 'wallet_recharge', $4,
                 'wallet.wechat_recharged', $5::jsonb, $6)
         RETURNING sequence`,
        [
          settlementOperationId,
          order.tenant_id,
          order.store_id,
          order.id,
          JSON.stringify(eventPayload),
          timestamp
        ]
      )
      const serverVersion = Number(event.rows[0]?.sequence)
      if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
        throw new Error('Cloud event did not return a valid sequence')
      }
      await client.query(
        `INSERT INTO cloud_wallet_account
         (id, tenant_id, store_id, member_id, status,
          principal_balance_fen, gift_balance_fen, server_version,
          created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $8)
         ON CONFLICT (tenant_id, member_id) DO UPDATE SET
           principal_balance_fen = EXCLUDED.principal_balance_fen,
           gift_balance_fen = EXCLUDED.gift_balance_fen,
           server_version = EXCLUDED.server_version,
           updated_at = EXCLUDED.updated_at`,
        [
          walletId,
          order.tenant_id,
          order.store_id,
          order.member_id,
          principalAfter,
          giftAfter,
          serverVersion,
          timestamp
        ]
      )
      await client.query(
        `INSERT INTO cloud_wallet_ledger
         (operation_id, tenant_id, store_id, wallet_account_id, member_id,
          event_type, source_operation_id, principal_delta_fen,
          gift_delta_fen, principal_balance_after_fen,
          gift_balance_after_fen, reason, payload_json, server_version,
          occurred_at)
         VALUES ($1, $2, $3, $4, $5, 'wallet.wechat_recharged', $6,
                 $7, $8, $9, $10, '小程序微信充值', $11::jsonb, $12, $13)`,
        [
          settlementOperationId,
          order.tenant_id,
          order.store_id,
          walletId,
          order.member_id,
          order.id,
          principalFen,
          giftFen,
          principalAfter,
          giftAfter,
          JSON.stringify(eventPayload),
          serverVersion,
          timestamp
        ]
      )
      if (membershipGrantId) {
        await client.query(
          `INSERT INTO cloud_membership_grant
           (id, tenant_id, store_id, member_id, source_type, source_id,
            granted_tier, reason, granted_at)
           VALUES ($1, $2, $3, $4, 'recharge', $5, 'advanced',
                   '单笔充值达到高级会员门槛', $6)
           ON CONFLICT (tenant_id, source_type, source_id) DO NOTHING`,
          [
            membershipGrantId,
            order.tenant_id,
            order.store_id,
            order.member_id,
            order.id,
            timestamp
          ]
        )
        await client.query(
          `UPDATE cloud_member
           SET tier = 'advanced', server_version = $3, updated_at = $4
           WHERE tenant_id = $1 AND id = $2`,
          [order.tenant_id, order.member_id, serverVersion, timestamp]
        )
      }
      const updated = await client.query<RechargeOrderRow>(
        `UPDATE wechat_recharge_order
         SET provider_transaction_id = $2, status = 'settled',
             paid_at = $3, settled_at = $3, updated_at = $3,
             error_message = NULL
         WHERE id = $1
         RETURNING id, request_id, request_hash, out_trade_no, provider_mode,
                   principal_fen, gift_fen, gift_rule_snapshot_json,
                   client_payment_json, status, error_message, expires_at,
                   settled_at, created_at`,
        [order.id, input.transactionId, timestamp]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json, occurred_at)
         VALUES ($1, $2, $3, NULL, 'wallet.wechat_recharged',
                 'wallet_recharge', $4, $5::jsonb, $6)`,
        [
          randomUUID(),
          order.tenant_id,
          order.store_id,
          order.id,
          JSON.stringify({
            identityId: order.identity_id,
            memberId: order.member_id,
            principalFen,
            giftFen,
            providerTransactionId: input.transactionId
          }),
          timestamp
        ]
      )
      await client.query(
        `UPDATE payment_callback_inbox
         SET status = 'processed', order_id = $3, processed_at = $4
         WHERE provider = $1 AND event_id = $2`,
        [input.provider, input.eventId, order.id, timestamp]
      )
      await client.query('COMMIT')
      const row = updated.rows[0]
      if (!row) throw new Error('Settled recharge order was not returned')
      return summarize(row)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private requireMember(principal: MiniappPrincipal): string {
    if (!principal.memberId || principal.memberStatus !== 'active') {
      throw new UnauthorizedException('请先注册会员')
    }
    return principal.memberId
  }
}
