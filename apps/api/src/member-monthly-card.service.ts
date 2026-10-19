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
  CreateMemberMonthlyCardOrderRequest,
  MemberMonthlyCardConfiguration,
  MemberMonthlyCardOrderSummary
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import { createHash, randomUUID } from 'node:crypto'
import type { MiniappPrincipal } from './miniapp-auth'
import {
  API_CONFIG,
  POSTGRES_POOL,
  WECHAT_PAYMENT_PROVIDER
} from './infrastructure.module'
import type { ApiConfig } from './config'
import type {
  VerifiedWechatPaymentNotification,
  WechatPaymentProvider,
  WechatPaymentState
} from './wechat-payment-provider'

type Plan = {
  planName: string
  priceFen: number
  durationDays: number
  scopeType: 'tenant' | 'store'
}

type OrderRow = {
  id: string
  tenant_id: string
  store_id: string
  member_id: string
  identity_id: string
  request_id: string
  request_hash: string
  out_trade_no: string
  provider_mode: 'mock' | 'wechat'
  provider_transaction_id: string | null
  plan_name: string
  price_fen: number | string
  duration_days: number
  scope_type: 'tenant' | 'store'
  client_payment_json: Record<string, string> | null
  status: MemberMonthlyCardOrderSummary['status']
  target_card_id: string | null
  expires_before: Date | string | null
  expires_after: Date | string | null
  error_message: string | null
  expires_at: Date | string
  settled_at: Date | string | null
  created_at: Date | string
  provider_subject?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function callbackHash(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
}

function integer(value: unknown, name: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return result
}

function summary(row: OrderRow): MemberMonthlyCardOrderSummary {
  return {
    orderId: row.id,
    requestId: row.request_id,
    planName: row.plan_name,
    priceFen: integer(row.price_fen, 'priceFen'),
    durationDays: integer(row.duration_days, 'durationDays'),
    status: row.status,
    providerMode: row.provider_mode,
    clientPaymentParameters: row.client_payment_json,
    targetCardId: row.target_card_id,
    expiresBefore:
      row.expires_before === null
        ? null
        : new Date(row.expires_before).toISOString(),
    expiresAfter:
      row.expires_after === null
        ? null
        : new Date(row.expires_after).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    settledAt:
      row.settled_at === null
        ? null
        : new Date(row.settled_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    errorMessage: row.error_message
  }
}

function parseRequest(value: unknown): CreateMemberMonthlyCardOrderRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Monthly-card order request must be an object')
  }
  const requestId = (value as Record<string, unknown>).requestId
  if (
    typeof requestId !== 'string' ||
    requestId.trim().length < 8 ||
    requestId.trim().length > 100
  ) {
    throw new Error('requestId must contain 8 to 100 characters')
  }
  return { requestId: requestId.trim() }
}

@Injectable()
export class MemberMonthlyCardService {
  async getPublicPlan(storeId:string):Promise<{planName:string;priceFen:number;durationDays:number}> {
    const r=await this.pool.query<{tenant_id:string}>("SELECT tenant_id FROM store WHERE id=$1 AND status='active'",[storeId])
    if(!r.rows[0])throw new NotFoundException('门店不存在')
    const {planName,priceFen,durationDays}=await this.resolvePlan(this.pool,{tenantId:r.rows[0].tenant_id,storeId})
    return {planName,priceFen,durationDays}
  }
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(WECHAT_PAYMENT_PROVIDER)
    private readonly paymentProvider: WechatPaymentProvider,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  async getConfiguration(
    principal: MiniappPrincipal
  ): Promise<MemberMonthlyCardConfiguration> {
    const memberId = this.requireMember(principal)
    if (this.paymentProvider.mode === 'disabled') {
      throw new ServiceUnavailableException('微信支付商户配置尚未启用')
    }
    const plan = await this.resolvePlan(this.pool, principal)
    const current = await this.pool.query<{ status: string }>(
      `SELECT status FROM cloud_monthly_card
       WHERE tenant_id = $1 AND member_id = $2
         AND status IN ('active', 'paused')
         AND (scope_type = 'tenant' OR store_id = $3)
       ORDER BY purchased_at DESC LIMIT 1`,
      [principal.tenantId, memberId, principal.storeId]
    )
    const paused = current.rows[0]?.status === 'paused'
    return {
      providerMode: this.paymentProvider.mode,
      ...plan,
      purchaseAllowed: !paused,
      blockedReason: paused ? '月卡暂停中，请联系店员恢复后再续费' : null
    }
  }

  async createOrder(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MemberMonthlyCardOrderSummary> {
    const memberId = this.requireMember(principal)
    if (this.paymentProvider.mode === 'disabled') {
      throw new ServiceUnavailableException('微信支付商户配置尚未启用')
    }
    let input: CreateMemberMonthlyCardOrderRequest
    try {
      input = parseRequest(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid monthly-card order'
      )
    }
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
    const existing = await this.findByRequest(principal, input.requestId)
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new ConflictException('requestId has already been used')
      }
      return summary(
        await this.waitForOrderCreation(principal, input.requestId, hash)
      )
    }
    const configuration = await this.getConfiguration(principal)
    if (!configuration.purchaseAllowed) {
      throw new ConflictException(configuration.blockedReason ?? '当前不能续费')
    }
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const outTradeNo =
      `ZYM${Date.now().toString(36)}${id.replaceAll('-', '').slice(0, 12)}`.toUpperCase()
    const reserved = await this.pool.query<{ id: string }>(
      `INSERT INTO wechat_monthly_card_order
       (id, tenant_id, store_id, member_id, identity_id, request_id,
        request_hash, out_trade_no, provider_mode, plan_name, price_fen,
        duration_days, scope_type, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'creating',$14)
       ON CONFLICT (tenant_id, identity_id, request_id) DO NOTHING
       RETURNING id`,
      [
        id, principal.tenantId, principal.storeId, memberId,
        principal.identityId, input.requestId, hash, outTradeNo,
        this.paymentProvider.mode, configuration.planName,
        configuration.priceFen, configuration.durationDays,
        configuration.scopeType, expiresAt
      ]
    )
    if (!reserved.rows[0]) {
      return summary(
        await this.waitForOrderCreation(principal, input.requestId, hash)
      )
    }
    try {
      const created = await this.paymentProvider.createRechargePayment({
        outTradeNo,
        principalFen: configuration.priceFen,
        payerSubject: principal.providerSubject,
        description: configuration.planName,
        expiresAt
      })
      const saved = await this.pool.query<OrderRow>(
        `UPDATE wechat_monthly_card_order
         SET provider_prepay_id = $2, client_payment_json = $3::jsonb,
             status = 'pending_payment', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [id, created.prepayId, JSON.stringify(created.clientPaymentParameters)]
      )
      if (!saved.rows[0]) throw new Error('Monthly-card order was not returned')
      return summary(saved.rows[0])
    } catch (error) {
      await this.pool.query(
        `UPDATE wechat_monthly_card_order
         SET status = 'failed', error_message = $2,
             updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, error instanceof Error ? error.message : 'payment creation failed']
      )
      throw error
    }
  }

  async getOrder(
    principal: MiniappPrincipal,
    orderId: string
  ): Promise<MemberMonthlyCardOrderSummary> {
    this.requireMember(principal)
    const found = await this.pool.query<OrderRow>(
      `SELECT * FROM wechat_monthly_card_order
       WHERE id = $1 AND tenant_id = $2 AND identity_id = $3 LIMIT 1`,
      [orderId, principal.tenantId, principal.identityId]
    )
    let row = found.rows[0]
    if (!row) throw new NotFoundException('月卡订单不存在')
    if (row.status === 'pending_payment' && this.paymentProvider.mode === 'wechat') {
      const state = await this.paymentProvider.queryRechargePayment(row.out_trade_no)
      if (state.state === 'success') {
        await this.settle(row.out_trade_no, state)
        const refreshed = await this.pool.query<OrderRow>(
          `SELECT * FROM wechat_monthly_card_order WHERE id = $1`,
          [row.id]
        )
        row = refreshed.rows[0] ?? row
      }
    }
    return summary(row)
  }

  async settleMockOrder(
    principal: MiniappPrincipal,
    orderId: string
  ): Promise<MemberMonthlyCardOrderSummary> {
    if (this.paymentProvider.mode !== 'mock') {
      throw new ConflictException('Mock settlement is unavailable')
    }
    const order = await this.getOrder(principal, orderId)
    const row = await this.findByRequest(principal, order.requestId)
    if (!row) throw new NotFoundException('月卡订单不存在')
    await this.settle(row.out_trade_no, {
      state: 'success',
      outTradeNo: row.out_trade_no,
      transactionId: `mock-${row.id}`,
      amountFen: integer(row.price_fen, 'priceFen'),
      currency: 'CNY',
      appId: 'mock',
      merchantId: 'mock',
      payerOpenId: principal.providerSubject.replace(/^openid:/, ''),
      paidAt: new Date().toISOString()
    })
    return this.getOrder(principal, orderId)
  }

  async handleWechatNotification(
    notification: VerifiedWechatPaymentNotification
  ): Promise<boolean> {
    if (!notification.payment.outTradeNo.startsWith('ZYM')) return false
    await this.settle(
      notification.payment.outTradeNo,
      notification.payment,
      {
        eventId: notification.eventId,
        payload: notification.payload
      }
    )
    return true
  }

  private async settle(
    outTradeNo: string,
    payment: Extract<WechatPaymentState, { state: 'success' }>,
    callback?: { eventId: string; payload: unknown }
  ): Promise<void> {
    const client = await this.pool.connect()
    let failedOrderId: string | null = null
    try {
      await client.query('BEGIN')
      const locked = await client.query<OrderRow>(
        `SELECT order_row.*, identity.provider_subject
         FROM wechat_monthly_card_order order_row
         JOIN miniapp_identity identity ON identity.id = order_row.identity_id
         WHERE order_row.out_trade_no = $1 FOR UPDATE`,
        [outTradeNo]
      )
      const order = locked.rows[0]
      if (!order) throw new NotFoundException('月卡订单不存在')
      failedOrderId = order.id
      if (callback) {
        const payloadHash = callbackHash(callback.payload)
        const reserved = await client.query(
          `INSERT INTO payment_callback_inbox
           (provider, event_id, payload_hash, monthly_card_order_id, status,
            payload_json)
           VALUES ('wechat', $1, $2, $3, 'received', $4::jsonb)
           ON CONFLICT (provider, event_id) DO NOTHING
           RETURNING event_id`,
          [
            callback.eventId,
            payloadHash,
            order.id,
            JSON.stringify(callback.payload)
          ]
        )
        if (!reserved.rows[0]) {
          const previous = await client.query<{
            payload_hash: string
            monthly_card_order_id: string | null
          }>(
            `SELECT payload_hash, monthly_card_order_id
             FROM payment_callback_inbox
             WHERE provider = 'wechat' AND event_id = $1
             FOR UPDATE`,
            [callback.eventId]
          )
          if (
            previous.rows[0]?.payload_hash !== payloadHash ||
            previous.rows[0]?.monthly_card_order_id !== order.id
          ) {
            throw new ConflictException(
              'Payment callback id was reused with different data'
            )
          }
        }
      }
      if (order.status === 'settled') {
        if (
          order.provider_transaction_id &&
          order.provider_transaction_id !== payment.transactionId
        ) {
          throw new ConflictException('月卡订单已绑定另一笔微信支付')
        }
        if (callback) {
          await client.query(
            `UPDATE payment_callback_inbox
             SET status = 'processed', processed_at = CURRENT_TIMESTAMP
             WHERE provider = 'wechat' AND event_id = $1`,
            [callback.eventId]
          )
        }
        await client.query('COMMIT')
        return
      }
      if (
        order.status !== 'pending_payment' &&
        order.status !== 'creating'
      ) {
        throw new ConflictException(
          `Monthly-card order cannot be paid from status ${order.status}`
        )
      }
      const expectedOpenId = (order.provider_subject ?? '').replace(/^openid:/, '')
      if (
        order.provider_mode !== this.paymentProvider.mode ||
        payment.amountFen !== integer(order.price_fen, 'priceFen') ||
        payment.currency !== 'CNY' ||
        (order.provider_mode === 'wechat' &&
          (payment.appId !== this.config.wechatMiniappAppId ||
            payment.merchantId !== this.config.wechatPayMerchantId)) ||
        payment.payerOpenId !== expectedOpenId
      ) {
        throw new ConflictException('微信支付结果与月卡订单不匹配')
      }
      const member = await client.query<{ status: string }>(
        `SELECT status FROM cloud_member
         WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [order.tenant_id, order.member_id]
      )
      if (member.rows[0]?.status !== 'active') {
        throw new ConflictException('会员已停用，月卡暂不能结算')
      }
      const current = await client.query<{
        id: string
        status: string
        expires_at: Date | string
        purchased_at: Date | string
        starts_at: Date | string
        usage_count: number
      }>(
        `SELECT id, status, expires_at, purchased_at, starts_at, usage_count
         FROM cloud_monthly_card
         WHERE tenant_id = $1 AND member_id = $2
           AND status IN ('active', 'paused')
           AND (scope_type = 'tenant' OR store_id = $3)
         ORDER BY purchased_at DESC LIMIT 1 FOR UPDATE`,
        [order.tenant_id, order.member_id, order.store_id]
      )
      if (current.rows[0]?.status === 'paused') {
        throw new ConflictException('月卡暂停中，不能自助续费')
      }
      const now = new Date(payment.paidAt)
      const before = current.rows[0]
        ? new Date(current.rows[0].expires_at)
        : null
      const base = before && before.getTime() > now.getTime() ? before : now
      const after = new Date(
        base.getTime() + integer(order.duration_days, 'durationDays') * DAY_MS
      )
      const cardId = current.rows[0]?.id ?? randomUUID()
      const event = await client.query<{ sequence: number | string }>(
        `INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         VALUES ($1,$2,$3,'monthly_card',$4,'monthly_card.purchased',$5::jsonb,$6)
         RETURNING sequence`,
        [
          randomUUID(), order.tenant_id, order.store_id, cardId,
          JSON.stringify({
            action: 'monthly_card.purchased',
            orderId: order.id,
            priceFen: integer(order.price_fen, 'priceFen'),
            expiresBefore: before?.toISOString() ?? null,
            expiresAfter: after.toISOString()
          }),
          payment.paidAt
        ]
      )
      const version = Number(event.rows[0]?.sequence)
      await client.query(
        `INSERT INTO cloud_monthly_card
         (id, tenant_id, store_id, member_id, plan_name, price_fen,
          payment_method, status, purchased_at, starts_at, expires_at,
          paused_at, usage_count, server_version, updated_at, scope_type)
         VALUES ($1,$2,$3,$4,$5,$6,'wechat','active',$7,$7,$8,NULL,0,$9,$7,$10)
         ON CONFLICT (id) DO UPDATE SET
           expires_at = EXCLUDED.expires_at,
           server_version = EXCLUDED.server_version,
           updated_at = EXCLUDED.updated_at
         WHERE cloud_monthly_card.tenant_id = EXCLUDED.tenant_id
           AND cloud_monthly_card.member_id = EXCLUDED.member_id`,
        [
          cardId, order.tenant_id, order.store_id, order.member_id,
          order.plan_name, integer(order.price_fen, 'priceFen'),
          current.rows[0]?.purchased_at ?? payment.paidAt,
          after.toISOString(), version, order.scope_type
        ]
      )
      await client.query(
        `INSERT INTO cloud_monthly_card_event
         (operation_id, tenant_id, store_id, card_id, member_id, event_type,
          reason, payload_json, server_version, occurred_at)
         VALUES ($1,$2,$3,$4,$5,'purchased',$6,$7::jsonb,$8,$9)
         ON CONFLICT (operation_id) DO NOTHING`,
        [
          order.id, order.tenant_id, order.store_id, cardId, order.member_id,
          before ? '小程序微信续费' : '小程序微信开通',
          JSON.stringify({
            orderId: order.id,
            outTradeNo,
            priceFen: integer(order.price_fen, 'priceFen'),
            durationDays: order.duration_days,
            expiresBefore: before?.toISOString() ?? null,
            expiresAfter: after.toISOString()
          }),
          version,
          payment.paidAt
        ]
      )
      await client.query(
        `UPDATE wechat_monthly_card_order
         SET status = 'settled', provider_transaction_id = $2,
             target_card_id = $3, expires_before = $4, expires_after = $5,
             paid_at = $6, settled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          order.id, payment.transactionId, cardId,
          before?.toISOString() ?? null, after.toISOString(), payment.paidAt
        ]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json, occurred_at)
         VALUES ($1,$2,$3,NULL,'monthly_card.wechat_purchased',
                 'monthly_card',$4,$5::jsonb,$6)`,
        [
          randomUUID(),
          order.tenant_id,
          order.store_id,
          cardId,
          JSON.stringify({
            orderId: order.id,
            outTradeNo,
            providerTransactionId: payment.transactionId,
            priceFen: integer(order.price_fen, 'priceFen'),
            durationDays: order.duration_days,
            expiresBefore: before?.toISOString() ?? null,
            expiresAfter: after.toISOString()
          }),
          payment.paidAt
        ]
      )
      if (callback) {
        await client.query(
          `UPDATE payment_callback_inbox
           SET status = 'processed', monthly_card_order_id = $2,
               processed_at = CURRENT_TIMESTAMP
           WHERE provider = 'wechat' AND event_id = $1`,
          [callback.eventId, order.id]
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if (callback && failedOrderId) {
        try {
          await this.recordFailedCallback(
            callback,
            failedOrderId,
            error instanceof Error ? error.message : String(error)
          )
        } catch {
          // Preserve the trusted settlement error even if audit persistence fails.
        }
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async resolvePlan(
    queryable: Pick<Pool, 'query'> | PoolClient,
    principal: Pick<MiniappPrincipal,'tenantId'|'storeId'>
  ): Promise<Plan> {
    const result = await queryable.query<{
      name: string
      payload_json: Record<string, unknown>
      override_payload_json: Record<string, unknown> | null
    }>(
      `SELECT template.name, template.payload_json,
              override.payload_json override_payload_json
       FROM cloud_merchant_business_template template
       LEFT JOIN cloud_store_business_template_override override
         ON override.tenant_id = template.tenant_id
        AND override.store_id = $2 AND override.template_id = template.id
        AND override.active = TRUE
       WHERE template.tenant_id = $1
         AND template.template_type = 'monthly_card_plan'
         AND template.active = TRUE
       ORDER BY template.created_at, template.id LIMIT 1`,
      [principal.tenantId, principal.storeId]
    )
    const row = result.rows[0]
    const payload = {
      ...(row?.payload_json ?? {}),
      ...(row?.override_payload_json ?? {})
    }
    return {
      planName:
        typeof payload.name === 'string' && payload.name.trim()
          ? payload.name.trim()
          : row?.name ?? '30 天月卡',
      priceFen:
        payload.priceFen === undefined
          ? 20_000
          : integer(payload.priceFen, 'priceFen'),
      durationDays:
        payload.durationDays === undefined
          ? 30
          : integer(payload.durationDays, 'durationDays'),
      scopeType: payload.scopeType === 'tenant' ? 'tenant' : 'store'
    }
  }

  private async findByRequest(
    principal: MiniappPrincipal,
    requestId: string
  ): Promise<OrderRow | null> {
    const result = await this.pool.query<OrderRow>(
      `SELECT * FROM wechat_monthly_card_order
       WHERE tenant_id = $1 AND identity_id = $2 AND request_id = $3
       LIMIT 1`,
      [principal.tenantId, principal.identityId, requestId]
    )
    return result.rows[0] ?? null
  }

  private async waitForOrderCreation(
    principal: MiniappPrincipal,
    requestId: string,
    requestHash: string
  ): Promise<OrderRow> {
    for (const milliseconds of [0, 50, 100, 200, 400, 800]) {
      if (milliseconds > 0) await delay(milliseconds)
      const order = await this.findByRequest(principal, requestId)
      if (!order) continue
      if (order.request_hash !== requestHash) {
        throw new ConflictException('requestId has already been used')
      }
      if (order.status !== 'creating') return order
    }
    throw new ConflictException('月卡订单正在创建，请稍后重试')
  }

  private async recordFailedCallback(
    callback: { eventId: string; payload: unknown },
    orderId: string,
    errorMessage: string
  ): Promise<void> {
    const payloadHash = callbackHash(callback.payload)
    await this.pool.query(
      `INSERT INTO payment_callback_inbox
       (provider, event_id, payload_hash, monthly_card_order_id, status,
        payload_json, error_message, processed_at)
       VALUES ('wechat',$1,$2,$3,'failed',$4::jsonb,$5,CURRENT_TIMESTAMP)
       ON CONFLICT (provider, event_id) DO UPDATE SET
         status = 'failed',
         monthly_card_order_id = EXCLUDED.monthly_card_order_id,
         error_message = EXCLUDED.error_message,
         processed_at = CURRENT_TIMESTAMP
       WHERE payment_callback_inbox.status <> 'processed'
         AND payment_callback_inbox.payload_hash = EXCLUDED.payload_hash`,
      [
        callback.eventId,
        payloadHash,
        orderId,
        JSON.stringify(callback.payload),
        errorMessage.slice(0, 1000)
      ]
    )
  }

  private requireMember(principal: MiniappPrincipal): string {
    if (!principal.memberId || principal.memberStatus !== 'active') {
      throw new UnauthorizedException('请先注册会员')
    }
    return principal.memberId
  }
}
