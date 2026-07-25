import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common'
import type {
  FillMemberBirthdayRequest,
  MemberActivitySummary,
  MemberAgeGate,
  MemberSelfServiceSummary,
  MemberSelfServiceHistory,
  PhoneVerificationChallenge,
  RegisterMiniappMemberRequest,
  UpdateMemberProfileRequest,
  WechatOneTapMemberLoginRequest
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import Redis from 'ioredis'
import { createHash, randomUUID } from 'node:crypto'
import type { ApiConfig } from './config'
import type { MiniappPrincipal } from './miniapp-auth'
import {
  createPhoneVerificationCode,
  birthdayRequestHash,
  hashPhoneVerificationCode,
  maskPhone,
  nextCloudMemberNumber,
  phoneVerificationCodeMatches,
  registrationRequestHash,
  validateWechatOneTapMemberLoginRequest,
  validateMemberRegistrationRequest,
  validateFillBirthdayRequest,
  validatePhoneVerificationRequest,
  validateUpdateMemberProfileRequest,
  wechatOneTapLoginRequestHash
} from './member-self-service'
import {
  API_CONFIG,
  POSTGRES_POOL,
  REDIS_CLIENT
} from './infrastructure.module'
import { resolveWechatPhoneNumber } from './wechat-miniapp-provider'

type ChallengeRow = {
  identity_id: string
  phone: string
  purpose: string
  code_hash: string
  attempts: number
  max_attempts: number
  expires_at: Date | string
  consumed_at: Date | string | null
}

type MemberSummaryRow = {
  id: string
  phone: string
  nickname: string
  avatar_url: string | null
  profile_completed: boolean
  tier: 'ordinary' | 'advanced'
  birthday_month: number | null
  birthday_day: number | null
  age_gate_status: MemberAgeGate
  principal_balance_fen: number | string | null
  gift_balance_fen: number | string | null
  monthly_card_status: 'active' | 'paused' | null
  monthly_card_expires_at: Date | string | null
}

type MemberProjectionRow = {
  id: string
  member_number: string
  phone: string
  nickname: string
  avatar_url: string | null
  profile_completed: boolean
  tier: 'ordinary' | 'advanced'
  status: 'active' | 'disabled'
  birthday_month: number | null
  birthday_day: number | null
  birthday_source: 'customer' | 'manager_correction' | 'legacy' | null
  note: string | null
  source: 'desktop' | 'miniapp' | 'legacy'
  age_gate_status: MemberAgeGate
  created_at: Date | string
  updated_at: Date | string
}

type PgError = Error & { code?: string; constraint?: string }

type MiniappMemberProfileInput = {
  requestId: string
  phone: string
  nickname: string
  avatarUrl?: string | null
  confirmedAtLeast14: boolean
}

type WechatOneTapMemberInput = WechatOneTapMemberLoginRequest & {
  phone: string
  nickname: string
  avatarUrl: string | null
}

function badRequest(error: unknown): BadRequestException {
  return new BadRequestException(
    error instanceof Error ? error.message : 'Invalid request'
  )
}

function monthlyCardActivity(
  eventType: string
): Pick<MemberActivitySummary, 'title' | 'status'> {
  switch (eventType) {
    case 'paused':
      return { title: '月卡暂停', status: 'paused' }
    case 'resumed':
      return { title: '月卡恢复', status: 'resumed' }
    case 'used':
      return { title: '月卡使用', status: 'used' }
    case 'refunded':
      return { title: '月卡退款', status: 'refunded' }
    case 'expired':
      return { title: '月卡到期', status: 'expired' }
    case 'manual_extended':
      return { title: '月卡续期', status: 'active' }
    case 'snapshot':
      return { title: '月卡状态', status: 'active' }
    default:
      return { title: '月卡续费', status: 'active' }
  }
}

function safeFen(value: number | string | null): number {
  const amount = value === null ? 0 : Number(value)
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Cloud balance is outside the safe integer range')
  }
  return amount
}

function memberSummary(row: MemberSummaryRow): MemberSelfServiceSummary {
  return {
    memberId: row.id,
    nickname: row.nickname,
    avatarUrl: row.avatar_url ?? null,
    profileCompleted: row.profile_completed === true,
    phoneMasked: maskPhone(row.phone),
    tier: row.tier,
    principalBalanceFen: safeFen(row.principal_balance_fen),
    giftBalanceFen: safeFen(row.gift_balance_fen),
    monthlyCardStatus: row.monthly_card_status ?? 'none',
    monthlyCardExpiresAt:
      row.monthly_card_expires_at === null
        ? null
        : new Date(row.monthly_card_expires_at).toISOString(),
    birthdayMonth: row.birthday_month,
    birthdayDay: row.birthday_day,
    birthdayCanBeFilled:
      row.birthday_month === null && row.birthday_day === null,
    ageGate: row.age_gate_status
  }
}

@Injectable()
export class MemberSelfService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  async requestPhoneVerification(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<PhoneVerificationChallenge> {
    if (principal.memberId) {
      throw new ConflictException('Miniapp identity is already bound to a member')
    }
    if (this.config.phoneVerificationMode === 'disabled') {
      throw new ServiceUnavailableException(
        'Phone verification provider is not configured'
      )
    }
    let input
    try {
      input = validatePhoneVerificationRequest(rawInput)
    } catch (error) {
      throw badRequest(error)
    }

    const rateKeyHash = createHash('sha256')
      .update(`${principal.identityId}:${input.phone}`)
      .digest('hex')
    const rateKey = `zyapp:phone-verification:${rateKeyHash}`
    const allowed = await this.redis.set(rateKey, '1', 'EX', 60, 'NX')
    if (allowed !== 'OK') {
      throw new HttpException(
        '请稍后再获取验证码',
        HttpStatus.TOO_MANY_REQUESTS
      )
    }

    const challengeId = randomUUID()
    const code = createPhoneVerificationCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO phone_verification_challenge
         (id, tenant_id, store_id, identity_id, phone, purpose, code_hash,
          max_attempts, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'member_registration', $6, 5, $7)`,
        [
          challengeId,
          principal.tenantId,
          principal.storeId,
          principal.identityId,
          input.phone,
          hashPhoneVerificationCode(
            this.config.phoneVerificationSecret,
            challengeId,
            code
          ),
          expiresAt.toISOString()
        ]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, NULL, 'phone.verification_requested',
                 'phone_verification', $4, $5::jsonb)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          challengeId,
          JSON.stringify({
            identityId: principal.identityId,
            phoneMasked: maskPhone(input.phone),
            mode: this.config.phoneVerificationMode
          })
        ]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      await this.redis.del(rateKey).catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    return {
      challengeId,
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: 60,
      ...(this.config.phoneVerificationMode === 'mock'
        ? { mockCode: code }
        : {})
    }
  }

  async registerMember(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MemberSelfServiceSummary> {
    let input: RegisterMiniappMemberRequest
    try {
      input = validateMemberRegistrationRequest(rawInput)
    } catch (error) {
      throw badRequest(error)
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.registerMemberTransaction(principal, input)
      } catch (error) {
        const databaseError = error as PgError
        if (
          attempt === 0 &&
          databaseError.code === '23505' &&
          databaseError.constraint === 'cloud_member_tenant_id_phone_key'
        ) {
          continue
        }
        throw error
      }
    }
    throw new ConflictException('Member registration could not be completed')
  }

  async loginWithWechatProfile(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MemberSelfServiceSummary> {
    let input: WechatOneTapMemberLoginRequest & {
      nickname: string
      avatarUrl: string | null
    }
    try {
      input = validateWechatOneTapMemberLoginRequest(rawInput)
    } catch (error) {
      throw badRequest(error)
    }

    const phone = await resolveWechatPhoneNumber(
      this.config,
      this.redis,
      input.phoneCode
    )
    const profileInput: WechatOneTapMemberInput = { ...input, phone }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.wechatOneTapLoginTransaction(
          principal,
          profileInput
        )
      } catch (error) {
        const databaseError = error as PgError
        if (
          attempt === 0 &&
          databaseError.code === '23505' &&
          (databaseError.constraint === 'cloud_member_tenant_id_phone_key' ||
            databaseError.constraint === 'uq_cloud_member_tenant_phone')
        ) {
          continue
        }
        throw error
      }
    }
    throw new ConflictException('WeChat login could not be completed')
  }

  async getSelf(
    principal: MiniappPrincipal
  ): Promise<MemberSelfServiceSummary | null> {
    if (!principal.memberId) return null
    return this.loadMemberSummary(this.pool, principal.tenantId, principal.memberId)
  }

  updateProfile(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MemberSelfServiceSummary> {
    return this.updateProfileTransaction(principal, rawInput)
  }

  updateProfileWithAvatar(
    principal: MiniappPrincipal,
    rawInput: unknown,
    avatarUrl: string
  ): Promise<MemberSelfServiceSummary> {
    return this.updateProfileTransaction(principal, rawInput, avatarUrl)
  }

  private async updateProfileTransaction(
    principal: MiniappPrincipal,
    rawInput: unknown,
    avatarUrl?: string
  ): Promise<MemberSelfServiceSummary> {
    const memberId = this.requireMemberId(principal)
    let input: UpdateMemberProfileRequest
    try {
      input = validateUpdateMemberProfileRequest(rawInput)
    } catch (error) {
      throw badRequest(error)
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const idempotencyKey =
        `miniapp-member-profile:${principal.identityId}:${input.requestId}`
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            nickname: input.nickname,
            ...(avatarUrl ? { avatarUrl } : {})
          })
        )
        .digest('hex')
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [principal.tenantId, idempotencyKey, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: MemberSelfServiceSummary | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2
           FOR UPDATE`,
          [principal.tenantId, idempotencyKey]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException(
            'Idempotency key was used for another request'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('Profile request is still in progress')
        }
        await client.query('COMMIT')
        return row.response_json
      }

      const memberResult = await client.query<{
        id: string
        nickname: string
        avatar_url: string | null
        profile_completed: boolean
        status: 'active' | 'disabled'
      }>(
        `SELECT id, nickname, avatar_url, profile_completed, status
         FROM cloud_member
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [principal.tenantId, memberId]
      )
      const before = memberResult.rows[0]
      if (!before || before.status !== 'active') {
        throw new NotFoundException('Member was not found')
      }

      const timestamp = new Date().toISOString()
      const nextAvatarUrl = avatarUrl ?? before.avatar_url
      const event = await client.query<{ sequence: number | string }>(
        `INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         VALUES ($1, $2, $3, 'member', $4, 'member.profile_updated',
                 $5::jsonb, $6)
         RETURNING sequence`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          memberId,
          JSON.stringify({
            action: 'member.profile_updated',
            memberId,
            before: {
              nickname: before.nickname,
              avatarUrl: before.avatar_url,
              profileCompleted: before.profile_completed
            },
            after: {
              nickname: input.nickname,
              avatarUrl: nextAvatarUrl,
              profileCompleted: true
            },
            reason: 'customer profile self-service update'
          }),
          timestamp
        ]
      )
      const serverVersion = Number(event.rows[0]?.sequence)
      if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
        throw new Error('Cloud event did not return a valid sequence')
      }
      await client.query(
        `UPDATE cloud_member
         SET nickname = $3, avatar_url = $4, profile_completed = TRUE,
             server_version = $5, updated_at = $6
         WHERE tenant_id = $1 AND id = $2`,
        [
          principal.tenantId,
          memberId,
          input.nickname,
          nextAvatarUrl,
          serverVersion,
          timestamp
        ]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json, occurred_at)
         VALUES ($1, $2, $3, NULL, 'member.profile_updated', 'member',
                 $4, $5::jsonb, $6)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          memberId,
          JSON.stringify({ identityId: principal.identityId }),
          timestamp
        ]
      )
      const summary = await this.loadMemberSummary(
        client,
        principal.tenantId,
        memberId
      )
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 200, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, idempotencyKey, JSON.stringify(summary)]
      )
      await client.query('COMMIT')
      return summary
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async fillBirthday(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MemberSelfServiceSummary> {
    const memberId = this.requireMemberId(principal)
    let input: FillMemberBirthdayRequest
    try {
      input = validateFillBirthdayRequest(rawInput)
    } catch (error) {
      throw badRequest(error)
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const idempotencyKey =
        `miniapp-member-birthday:${principal.identityId}:${input.requestId}`
      const requestHash = birthdayRequestHash(input)
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [principal.tenantId, idempotencyKey, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: MemberSelfServiceSummary | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2
           FOR UPDATE`,
          [principal.tenantId, idempotencyKey]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException(
            'Idempotency key was used for another request'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('Birthday request is still in progress')
        }
        await client.query('COMMIT')
        return row.response_json
      }

      const memberResult = await client.query<MemberProjectionRow>(
        `SELECT id, member_number, phone, nickname, avatar_url,
                profile_completed, tier, status,
                birthday_month, birthday_day, birthday_source, note, source,
                age_gate_status, created_at, updated_at
         FROM cloud_member
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [principal.tenantId, memberId]
      )
      const before = memberResult.rows[0]
      if (!before || before.status !== 'active') {
        throw new NotFoundException('Member was not found')
      }
      if (before.birthday_month !== null || before.birthday_day !== null) {
        throw new ConflictException('Birthday has already been filled')
      }

      const timestamp = new Date().toISOString()
      const after = {
        id: before.id,
        memberNumber: before.member_number,
        phone: before.phone,
        nickname: before.nickname,
        tier: before.tier,
        status: before.status,
        birthdayMonth: input.month,
        birthdayDay: input.day,
        birthdaySource: 'customer' as const,
        note: before.note,
        source: before.source,
        ageGate: before.age_gate_status,
        createdAt: new Date(before.created_at).toISOString(),
        updatedAt: timestamp
      }
      const eventPayload = {
        action: 'member.birthday_filled',
        memberId,
        before: {
          ...after,
          birthdayMonth: null,
          birthdayDay: null,
          birthdaySource: null,
          updatedAt: new Date(before.updated_at).toISOString()
        },
        after,
        reason: 'customer birthday self-service fill'
      }
      const event = await client.query<{ sequence: number | string }>(
        `INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         VALUES ($1, $2, $3, 'member', $4, 'member.updated', $5::jsonb, $6)
         RETURNING sequence`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          memberId,
          JSON.stringify(eventPayload),
          timestamp
        ]
      )
      const serverVersion = Number(event.rows[0]?.sequence)
      if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
        throw new Error('Cloud event did not return a valid sequence')
      }
      await client.query(
        `UPDATE cloud_member
         SET birthday_month = $3,
             birthday_day = $4,
             birthday_source = 'customer',
             server_version = $5,
             updated_at = $6
         WHERE tenant_id = $1 AND id = $2`,
        [
          principal.tenantId,
          memberId,
          input.month,
          input.day,
          serverVersion,
          timestamp
        ]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json, occurred_at)
         VALUES ($1, $2, $3, NULL, 'member.birthday_filled', 'member',
                 $4, $5::jsonb, $6)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          memberId,
          JSON.stringify({
            identityId: principal.identityId,
            birthdayMonth: input.month,
            birthdayDay: input.day
          }),
          timestamp
        ]
      )
      const summary = await this.loadMemberSummary(
        client,
        principal.tenantId,
        memberId
      )
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 200, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, idempotencyKey, JSON.stringify(summary)]
      )
      await client.query('COMMIT')
      return summary
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async getHistory(
    principal: MiniappPrincipal
  ): Promise<MemberSelfServiceHistory> {
    const memberId = this.requireMemberId(principal)
    const [orders, rechargeOrders, walletEntries, monthlyCardEvents] =
      await Promise.all([
      this.pool.query<{
        id: string
        order_number: string
        total_fen: number | string
        payment_method: 'cash' | 'stored_value'
        completed_at: Date | string
      }>(
        `SELECT id, order_number, total_fen, payment_method, completed_at
         FROM cloud_sales_order
         WHERE tenant_id = $1
           AND (customer_member_id = $2 OR wallet_member_id = $2)
         ORDER BY completed_at DESC
         LIMIT 50`,
        [principal.tenantId, memberId]
      ),
      this.pool.query<{
        id: string
        out_trade_no: string
        principal_fen: number | string
        gift_fen: number | string
        settled_at: Date | string
      }>(
        `SELECT id, out_trade_no, principal_fen, gift_fen, settled_at
         FROM wechat_recharge_order
         WHERE tenant_id = $1 AND member_id = $2 AND status = 'settled'
         ORDER BY settled_at DESC
         LIMIT 100`,
        [principal.tenantId, memberId]
      ),
      this.pool.query<{
        operation_id: string
        event_type: string
        principal_delta_fen: number | string
        gift_delta_fen: number | string
        reason: string | null
        occurred_at: Date | string
      }>(
        `SELECT operation_id, event_type, principal_delta_fen,
                gift_delta_fen, reason, occurred_at
         FROM cloud_wallet_ledger
         WHERE tenant_id = $1 AND member_id = $2
         ORDER BY occurred_at DESC
         LIMIT 100`,
        [principal.tenantId, memberId]
      ),
      this.pool.query<{
        operation_id: string
        card_id: string
        event_type: string
        reason: string | null
        occurred_at: Date | string
      }>(
        `SELECT operation_id, card_id, event_type, reason, occurred_at
         FROM cloud_monthly_card_event
         WHERE tenant_id = $1 AND member_id = $2
         ORDER BY occurred_at DESC
         LIMIT 100`,
        [principal.tenantId, memberId]
      )
    ])
    const activities: MemberActivitySummary[] = [
      ...orders.rows.map((row) => ({
        activityId: `sales-order:${row.id}`,
        kind: 'consumption' as const,
        businessId: row.id,
        businessNumber: row.order_number,
        title: '桌位消费',
        amountFen: safeFen(row.total_fen),
        direction: 'debit' as const,
        status: 'completed' as const,
        occurredAt: new Date(row.completed_at).toISOString()
      })),
      ...rechargeOrders.rows.map((row) => ({
        activityId: `wechat-recharge:${row.id}`,
        kind: 'recharge' as const,
        businessId: row.id,
        businessNumber: row.out_trade_no,
        title: '微信充值',
        amountFen: safeFen(row.principal_fen) + safeFen(row.gift_fen),
        direction: 'credit' as const,
        status: 'settled' as const,
        occurredAt: new Date(row.settled_at).toISOString()
      })),
      ...monthlyCardEvents.rows.map((row) => ({
        activityId: `monthly-card:${row.operation_id}`,
        kind: 'monthly_card' as const,
        businessId: row.card_id,
        businessNumber: null,
        ...monthlyCardActivity(row.event_type),
        amountFen: null,
        direction: 'neutral' as const,
        occurredAt: new Date(row.occurred_at).toISOString()
      }))
    ]
      .sort(
        (left, right) =>
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
          left.activityId.localeCompare(right.activityId)
      )
      .slice(0, 100)
    return {
      activities,
      orders: orders.rows.map((row) => ({
        orderId: row.id,
        orderNumber: row.order_number,
        totalFen: safeFen(row.total_fen),
        paymentMethod: row.payment_method,
        completedAt: new Date(row.completed_at).toISOString()
      })),
      walletEntries: walletEntries.rows.map((row) => ({
        operationId: row.operation_id,
        eventType: row.event_type,
        principalDeltaFen: safeFen(row.principal_delta_fen),
        giftDeltaFen: safeFen(row.gift_delta_fen),
        reason: row.reason,
        occurredAt: new Date(row.occurred_at).toISOString()
      })),
      monthlyCardEvents: monthlyCardEvents.rows.map((row) => ({
        operationId: row.operation_id,
        cardId: row.card_id,
        eventType: row.event_type,
        reason: row.reason,
        occurredAt: new Date(row.occurred_at).toISOString()
      }))
    }
  }

  private requireMemberId(principal: MiniappPrincipal): string {
    if (!principal.memberId || principal.memberStatus !== 'active') {
      throw new UnauthorizedException('请先注册会员')
    }
    return principal.memberId
  }

  private memberSnapshot(
    row: MemberProjectionRow,
    overrides: Partial<{
      nickname: string
      avatarUrl: string | null
      profileCompleted: boolean
      tier: 'ordinary' | 'advanced'
      status: 'active' | 'disabled'
      birthdayMonth: number | null
      birthdayDay: number | null
      birthdaySource: 'customer' | 'manager_correction' | 'legacy' | null
      note: string | null
      source: 'desktop' | 'miniapp' | 'legacy'
      ageGate: MemberAgeGate
      updatedAt: string
    }> = {}
  ) {
    return {
      id: row.id,
      memberNumber: row.member_number,
      phone: row.phone,
      nickname: overrides.nickname ?? row.nickname,
      avatarUrl:
        'avatarUrl' in overrides ? overrides.avatarUrl ?? null : row.avatar_url,
      profileCompleted:
        overrides.profileCompleted ?? row.profile_completed,
      tier: overrides.tier ?? row.tier,
      status: overrides.status ?? row.status,
      birthdayMonth:
        'birthdayMonth' in overrides ? overrides.birthdayMonth ?? null : row.birthday_month,
      birthdayDay:
        'birthdayDay' in overrides ? overrides.birthdayDay ?? null : row.birthday_day,
      birthdaySource:
        'birthdaySource' in overrides
          ? overrides.birthdaySource ?? null
          : row.birthday_source,
      note: 'note' in overrides ? overrides.note ?? null : row.note,
      source: overrides.source ?? row.source,
      ageGate: overrides.ageGate ?? row.age_gate_status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: overrides.updatedAt ?? new Date(row.updated_at).toISOString()
    }
  }

  private async enableDisabledMember(
    client: PoolClient,
    principal: MiniappPrincipal,
    input: MiniappMemberProfileInput,
    before: MemberProjectionRow
  ): Promise<void> {
    if (before.status !== 'disabled') return

    const timestamp = new Date().toISOString()
    const ageGate: MemberAgeGate = input.confirmedAtLeast14
      ? 'confirmed_at_least_14'
      : 'recharge_disabled'
    const preserveCompletedProfile = before.profile_completed === true
    const nickname = preserveCompletedProfile
      ? before.nickname
      : input.nickname
    const avatarUrl = preserveCompletedProfile
      ? before.avatar_url
      : input.avatarUrl ?? null
    const profileCompleted =
      preserveCompletedProfile ||
      input.nickname !== '微信用户' ||
      Boolean(input.avatarUrl)
    const after = this.memberSnapshot(before, {
      nickname,
      avatarUrl,
      profileCompleted,
      tier: 'ordinary',
      status: 'active',
      birthdayMonth: null,
      birthdayDay: null,
      birthdaySource: null,
      note: null,
      source: 'miniapp',
      ageGate,
      updatedAt: timestamp
    })
    const event = await client.query<{ sequence: number | string }>(
      `INSERT INTO cloud_event
       (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
        event_type, payload_json, occurred_at)
       VALUES ($1, $2, $3, 'member', $4, 'member.enabled', $5::jsonb, $6)
       RETURNING sequence`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        before.id,
        JSON.stringify({
          action: 'member.enabled',
          memberId: before.id,
          before: this.memberSnapshot(before),
          after,
          reason: 'miniapp member re-registration'
        }),
        timestamp
      ]
    )
    const serverVersion = Number(event.rows[0]?.sequence)
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
      throw new Error('Cloud event did not return a valid sequence')
    }
    await client.query(
      `UPDATE cloud_membership_grant
       SET revoked_at = $3
       WHERE tenant_id = $1 AND member_id = $2 AND revoked_at IS NULL`,
      [principal.tenantId, before.id, timestamp]
    )
    await client.query(
      `UPDATE cloud_member
       SET nickname = $3, avatar_url = $4, profile_completed = $5,
           tier = 'ordinary',
           status = 'active', birthday_month = NULL, birthday_day = NULL,
           birthday_source = NULL, note = NULL, source = 'miniapp',
           age_gate_status = $6, server_version = $7, updated_at = $8
       WHERE tenant_id = $1 AND id = $2`,
      [
        principal.tenantId,
        before.id,
        nickname,
        avatarUrl,
        profileCompleted,
        ageGate,
        serverVersion,
        timestamp
      ]
    )
    await client.query(
      `INSERT INTO cloud_audit_log
       (id, tenant_id, store_id, actor_id, action, aggregate_type,
        aggregate_id, metadata_json, occurred_at)
       VALUES ($1, $2, $3, NULL, 'member.enabled', 'member', $4, $5::jsonb, $6)`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        before.id,
        JSON.stringify({
          identityId: principal.identityId,
          source: 'miniapp_re_registration',
          phoneMasked: maskPhone(before.phone)
        }),
        timestamp
      ]
    )
  }

  private async wechatOneTapLoginTransaction(
    principal: MiniappPrincipal,
    input: WechatOneTapMemberInput
  ): Promise<MemberSelfServiceSummary> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const identity = await client.query<{
        member_id: string | null
        status: 'active' | 'disabled'
      }>(
        `SELECT member_id, status
         FROM miniapp_identity
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         FOR UPDATE`,
        [principal.identityId, principal.tenantId, principal.storeId]
      )
      const currentIdentity = identity.rows[0]
      if (!currentIdentity || currentIdentity.status !== 'active') {
        throw new UnauthorizedException('Miniapp identity is unavailable')
      }
      if (currentIdentity.member_id) {
        const existingMember = await client.query<MemberProjectionRow>(
          `SELECT id, member_number, phone, nickname, avatar_url,
                  profile_completed, tier, status,
                  birthday_month, birthday_day, birthday_source, note, source,
                  age_gate_status, created_at, updated_at
           FROM cloud_member
           WHERE tenant_id = $1 AND id = $2
           FOR UPDATE`,
          [principal.tenantId, currentIdentity.member_id]
        )
        const existing = existingMember.rows[0]
        if (!existing) {
          throw new NotFoundException('Member was not found')
        }
        if (existing.phone !== input.phone) {
          throw new ConflictException(
            'Miniapp identity is already bound to another member'
          )
        }
        await this.enableDisabledMember(client, principal, input, existing)
        const summary = await this.loadMemberSummary(
          client,
          principal.tenantId,
          currentIdentity.member_id
        )
        await client.query('COMMIT')
        return summary
      }

      const idempotencyKey =
        `miniapp-member-wechat-login:${principal.identityId}:${input.requestId}`
      const requestHash = wechatOneTapLoginRequestHash(input)
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [principal.tenantId, idempotencyKey, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: MemberSelfServiceSummary | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2
           FOR UPDATE`,
          [principal.tenantId, idempotencyKey]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException(
            'Idempotency key was used for another request'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('WeChat login request is still in progress')
        }
        await client.query('COMMIT')
        return row.response_json
      }

      const existingMember = await client.query<MemberProjectionRow>(
        `SELECT id, member_number, phone, nickname, avatar_url,
                profile_completed, tier, status,
                birthday_month, birthday_day, birthday_source, note, source,
                age_gate_status, created_at, updated_at
         FROM cloud_member
         WHERE tenant_id = $1 AND phone = $2
         FOR UPDATE`,
        [principal.tenantId, input.phone]
      )
      const existing = existingMember.rows[0]
      let memberId = existing?.id
      let action = 'miniapp.member_bound'
      if (existing?.status === 'disabled') {
        await this.enableDisabledMember(client, principal, input, existing)
      } else if (!memberId) {
        memberId = randomUUID()
        action = 'member.created'
        await this.createMember(client, principal, input, memberId)
      }
      if (!memberId) {
        throw new Error('Member id was not resolved')
      }

      await client.query(
        `UPDATE miniapp_identity
         SET member_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND member_id IS NULL`,
        [principal.identityId, memberId]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, NULL, $4, 'member', $5, $6::jsonb)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          action,
          memberId,
          JSON.stringify({
            identityId: principal.identityId,
            loginMethod: 'wechat_one_tap',
            phoneMasked: maskPhone(input.phone),
            existingMember: action !== 'member.created'
          })
        ]
      )

      const summary = await this.loadMemberSummary(
        client,
        principal.tenantId,
        memberId
      )
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 201, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, idempotencyKey, JSON.stringify(summary)]
      )
      await client.query('COMMIT')
      return summary
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async registerMemberTransaction(
    principal: MiniappPrincipal,
    input: RegisterMiniappMemberRequest
  ): Promise<MemberSelfServiceSummary> {
    const client = await this.pool.connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const identity = await client.query<{
        member_id: string | null
        status: 'active' | 'disabled'
      }>(
        `SELECT member_id, status
         FROM miniapp_identity
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         FOR UPDATE`,
        [principal.identityId, principal.tenantId, principal.storeId]
      )
      const currentIdentity = identity.rows[0]
      if (!currentIdentity || currentIdentity.status !== 'active') {
        throw new UnauthorizedException('Miniapp identity is unavailable')
      }
      if (currentIdentity.member_id) {
        const existingMember = await client.query<MemberProjectionRow>(
          `SELECT id, member_number, phone, nickname, avatar_url,
                  profile_completed, tier, status,
                  birthday_month, birthday_day, birthday_source, note, source,
                  age_gate_status, created_at, updated_at
           FROM cloud_member
           WHERE tenant_id = $1 AND id = $2
           FOR UPDATE`,
          [principal.tenantId, currentIdentity.member_id]
        )
        const existing = existingMember.rows[0]
        if (!existing) {
          throw new NotFoundException('Member was not found')
        }
        if (existing.phone !== input.phone) {
          throw new ConflictException(
            'Miniapp identity is already bound to another member'
          )
        }
        await this.enableDisabledMember(client, principal, input, existing)
        const summary = await this.loadMemberSummary(
          client,
          principal.tenantId,
          currentIdentity.member_id
        )
        await client.query('COMMIT')
        committed = true
        return summary
      }

      const challengeResult = await client.query<ChallengeRow>(
        `SELECT identity_id, phone, purpose, code_hash, attempts, max_attempts,
                expires_at, consumed_at
         FROM phone_verification_challenge
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         FOR UPDATE`,
        [input.challengeId, principal.tenantId, principal.storeId]
      )
      const challenge = challengeResult.rows[0]
      const challengeUnavailable =
        !challenge ||
        challenge.identity_id !== principal.identityId ||
        challenge.phone !== input.phone ||
        challenge.purpose !== 'member_registration' ||
        challenge.consumed_at !== null ||
        challenge.attempts >= challenge.max_attempts ||
        new Date(challenge.expires_at).getTime() <= Date.now()
      if (challengeUnavailable) {
        throw new BadRequestException(
          'Verification challenge is expired or unavailable'
        )
      }
      if (
        !phoneVerificationCodeMatches(
          challenge.code_hash,
          this.config.phoneVerificationSecret,
          input.challengeId,
          input.verificationCode
        )
      ) {
        await client.query(
          `UPDATE phone_verification_challenge
           SET attempts = attempts + 1
           WHERE id = $1`,
          [input.challengeId]
        )
        await client.query('COMMIT')
        committed = true
        throw new UnauthorizedException('验证码不正确')
      }

      const idempotencyKey =
        `miniapp-member-register:${principal.identityId}:${input.requestId}`
      const requestHash = registrationRequestHash(input)
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [principal.tenantId, idempotencyKey, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: MemberSelfServiceSummary | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2
           FOR UPDATE`,
          [principal.tenantId, idempotencyKey]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException(
            'Idempotency key was used for another request'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('Registration request is still in progress')
        }
        await client.query('COMMIT')
        committed = true
        return row.response_json
      }

      const existingMember = await client.query<MemberProjectionRow>(
        `SELECT id, member_number, phone, nickname, avatar_url,
                profile_completed, tier, status,
                birthday_month, birthday_day, birthday_source, note, source,
                age_gate_status, created_at, updated_at
         FROM cloud_member
         WHERE tenant_id = $1 AND phone = $2
         FOR UPDATE`,
        [principal.tenantId, input.phone]
      )
      const existing = existingMember.rows[0]
      let memberId = existing?.id
      let action = 'miniapp.member_bound'
      if (existing?.status === 'disabled') {
        await this.enableDisabledMember(client, principal, input, existing)
      } else if (!memberId) {
        memberId = randomUUID()
        action = 'member.created'
        await this.createMember(client, principal, input, memberId)
      }
      if (!memberId) {
        throw new Error('Member id was not resolved')
      }

      await client.query(
        `UPDATE miniapp_identity
         SET member_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND member_id IS NULL`,
        [principal.identityId, memberId]
      )
      await client.query(
        `UPDATE phone_verification_challenge
         SET consumed_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND consumed_at IS NULL`,
        [input.challengeId]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, NULL, $4, 'member', $5, $6::jsonb)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          action,
          memberId,
          JSON.stringify({
            identityId: principal.identityId,
            challengeId: input.challengeId,
            existingMember: action !== 'member.created'
          })
        ]
      )

      const summary = await this.loadMemberSummary(
        client,
        principal.tenantId,
        memberId
      )
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 201, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, idempotencyKey, JSON.stringify(summary)]
      )
      await client.query('COMMIT')
      committed = true
      return summary
    } catch (error) {
      if (!committed) await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async createMember(
    client: PoolClient,
    principal: MiniappPrincipal,
    input: MiniappMemberProfileInput,
    memberId: string
  ): Promise<void> {
    const timestamp = new Date().toISOString()
    const ageGate: MemberAgeGate = input.confirmedAtLeast14
      ? 'confirmed_at_least_14'
      : 'recharge_disabled'
    const member = {
      id: memberId,
      memberNumber: nextCloudMemberNumber(memberId),
      phone: input.phone,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl ?? null,
      profileCompleted:
        input.nickname !== '微信用户' || Boolean(input.avatarUrl),
      tier: 'ordinary' as const,
      status: 'active' as const,
      birthdayMonth: null,
      birthdayDay: null,
      birthdaySource: null,
      note: null,
      source: 'miniapp' as const,
      ageGate,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const payload = {
      action: 'member.created',
      memberId,
      before: null,
      after: member,
      reason: 'miniapp member registration'
    }
    const event = await client.query<{ sequence: number | string }>(
      `INSERT INTO cloud_event
       (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
        event_type, payload_json, occurred_at)
       VALUES ($1, $2, $3, 'member', $4, 'member.created', $5::jsonb, $6)
       RETURNING sequence`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        memberId,
        JSON.stringify(payload),
        timestamp
      ]
    )
    const serverVersion = Number(event.rows[0]?.sequence)
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
      throw new Error('Cloud event did not return a valid sequence')
    }
    await client.query(
      `INSERT INTO cloud_member
       (id, tenant_id, store_id, member_number, phone, nickname, tier, status,
        avatar_url, profile_completed, birthday_month, birthday_day, birthday_source, note,
        source, age_gate_status, server_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'ordinary', 'active',
               $7, $8, NULL, NULL, NULL, NULL, 'miniapp', $9, $10, $11, $11)`,
      [
        memberId,
        principal.tenantId,
        principal.storeId,
        member.memberNumber,
        input.phone,
        input.nickname,
        input.avatarUrl ?? null,
        member.profileCompleted,
        ageGate,
        serverVersion,
        timestamp
      ]
    )
  }

  private async loadMemberSummary(
    queryable: Pick<Pool, 'query'> | PoolClient,
    tenantId: string,
    memberId: string
  ): Promise<MemberSelfServiceSummary> {
    const result = await queryable.query<MemberSummaryRow>(
      `SELECT m.id, m.phone, m.nickname, m.tier, m.birthday_month,
              m.avatar_url, m.profile_completed, m.birthday_day, m.age_gate_status,
              w.principal_balance_fen, w.gift_balance_fen,
              card.status monthly_card_status,
              card.expires_at monthly_card_expires_at
       FROM cloud_member m
       LEFT JOIN cloud_wallet_account w
         ON w.tenant_id = m.tenant_id AND w.member_id = m.id
       LEFT JOIN LATERAL (
         SELECT status, expires_at
         FROM cloud_monthly_card
         WHERE tenant_id = m.tenant_id
           AND member_id = m.id
           AND status IN ('active', 'paused')
         ORDER BY purchased_at DESC
         LIMIT 1
       ) card ON TRUE
       WHERE m.tenant_id = $1 AND m.id = $2 AND m.status = 'active'
       LIMIT 1`,
      [tenantId, memberId]
    )
    const row = result.rows[0]
    if (!row) throw new NotFoundException('Member was not found')
    return memberSummary(row)
  }
}
