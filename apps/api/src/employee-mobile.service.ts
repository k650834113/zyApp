import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common'
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  verifyPassword
} from '@zyapp/auth'
import type {
  EmployeeMobileCreateMemberRequest,
  EmployeeMobileMemberSummary,
  MiniappIdentity
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import Redis from 'ioredis'
import { createHash, randomUUID } from 'node:crypto'
import type { MiniappPrincipal } from './miniapp-auth'
import { nextCloudMemberNumber } from './member-self-service'
import {
  POSTGRES_POOL,
  REDIS_CLIENT
} from './infrastructure.module'

type LoginInput = {
  username: string
  password: string
}

type EmployeeCredentialRow = {
  id: string
  display_name: string
  role: 'manager' | 'staff'
  status: 'active' | 'disabled'
  enabled: boolean | null
  password_hash: string | null
}

type MobileMemberRow = {
  id: string
  member_number: string
  phone: string
  nickname: string
  tier: 'ordinary' | 'advanced'
  status: 'active' | 'disabled'
  birthday_month: number | null
  birthday_day: number | null
  note: string | null
  age_gate_status:
    | 'confirmed_at_least_14'
    | 'under_14_verified'
    | 'recharge_disabled'
  principal_balance_fen: number | string | null
  gift_balance_fen: number | string | null
  monthly_card_id: string | null
  monthly_card_status: 'active' | 'paused' | null
  monthly_card_plan_name: string | null
  monthly_card_price_fen: number | string | null
  monthly_card_expires_at: Date | string | null
  updated_at: Date | string
}

type PgError = Error & { code?: string; constraint?: string }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

function validateLoginInput(value: unknown): LoginInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Login request must be an object')
  }
  const input = value as Record<string, unknown>
  if (typeof input.username !== 'string') {
    throw new Error('员工账号不能为空')
  }
  if (typeof input.password !== 'string') {
    throw new Error('移动端密码不能为空')
  }
  const username = input.username.trim().toLowerCase()
  if (username.length < 3 || username.length > 32) {
    throw new Error('员工账号长度应为 3 至 32 个字符')
  }
  if (input.password.length < 8 || input.password.length > 128) {
    throw new Error('移动端密码长度应为 8 至 128 个字符')
  }
  return { username, password: input.password }
}

function staffIdentity(row: EmployeeCredentialRow): MiniappIdentity {
  return {
    role: row.role,
    employeeId: row.id,
    displayName: row.display_name,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[row.role]]
  }
}

function safeFen(value: number | string | null): number {
  const amount = value === null ? 0 : Number(value)
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Cloud balance is outside the safe integer range')
  }
  return amount
}

function mobileMember(row: MobileMemberRow): EmployeeMobileMemberSummary {
  const principalBalanceFen = safeFen(row.principal_balance_fen)
  const giftBalanceFen = safeFen(row.gift_balance_fen)
  return {
    memberId: row.id,
    memberNumber: row.member_number,
    phone: row.phone,
    nickname: row.nickname,
    tier: row.tier,
    status: row.status,
    birthdayMonth: row.birthday_month,
    birthdayDay: row.birthday_day,
    note: row.note,
    ageGate: row.age_gate_status,
    principalBalanceFen,
    giftBalanceFen,
    totalBalanceFen: principalBalanceFen + giftBalanceFen,
    monthlyCardStatus: row.monthly_card_status ?? 'none',
    monthlyCardId: row.monthly_card_id ?? null,
    monthlyCardPlanName: row.monthly_card_plan_name ?? null,
    monthlyCardPriceFen:
      row.monthly_card_price_fen === null ||
      row.monthly_card_price_fen === undefined
        ? null
        : safeFen(row.monthly_card_price_fen),
    monthlyCardExpiresAt:
      row.monthly_card_expires_at === null
        ? null
        : new Date(row.monthly_card_expires_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

function createMemberInput(value: unknown): EmployeeMobileCreateMemberRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Member request must be an object')
  }
  const input = value as Record<string, unknown>
  if (typeof input.requestId !== 'string') {
    throw new Error('requestId must be text')
  }
  const requestId = input.requestId.trim()
  if (
    requestId.length < 8 ||
    requestId.length > 100 ||
    !REQUEST_ID_PATTERN.test(requestId)
  ) {
    throw new Error('requestId is invalid')
  }
  if (
    typeof input.phone !== 'string' ||
    !/^1\d{10}$/.test(input.phone.trim())
  ) {
    throw new Error('手机号格式不正确')
  }
  if (typeof input.nickname !== 'string') {
    throw new Error('会员昵称不能为空')
  }
  const nickname = input.nickname.trim()
  if (nickname.length < 1 || nickname.length > 30) {
    throw new Error('会员昵称长度应为 1 至 30 个字符')
  }
  if (
    input.note !== undefined &&
    input.note !== null &&
    typeof input.note !== 'string'
  ) {
    throw new Error('会员备注必须是文字')
  }
  const note =
    typeof input.note === 'string' ? input.note.trim() : undefined
  if (note !== undefined && note.length > 500) {
    throw new Error('会员备注不能超过 500 个字符')
  }
  return {
    requestId,
    phone: input.phone.trim(),
    nickname,
    ...(note ? { note } : {})
  }
}

@Injectable()
export class EmployeeMobileService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  async login(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<MiniappIdentity> {
    let input: LoginInput
    try {
      input = validateLoginInput(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '登录信息不正确'
      )
    }

    const rateHash = createHash('sha256')
      .update(`${principal.identityId}:${input.username}`)
      .digest('hex')
    const rateKey = `zyapp:employee-mobile-login:${rateHash}`
    const attempts = await this.redis.incr(rateKey)
    if (attempts === 1) await this.redis.expire(rateKey, 5 * 60)
    if (attempts > 5) {
      throw new HttpException(
        '登录尝试过多，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS
      )
    }

    const result = await this.pool.query<EmployeeCredentialRow>(
      `SELECT e.id, e.display_name, access.role,
              CASE WHEN e.status = 'disabled' THEN 'disabled'
                   ELSE access.status END status,
              c.enabled, c.password_hash
       FROM cloud_employee e
       JOIN cloud_employee_store_access access
         ON access.employee_id = e.id
        AND access.tenant_id = e.tenant_id
       LEFT JOIN cloud_employee_mobile_credential c
         ON c.employee_id = e.id
        AND c.tenant_id = e.tenant_id
       WHERE e.tenant_id = $1 AND access.store_id = $2 AND e.username = $3
       LIMIT 1`,
      [principal.tenantId, principal.storeId, input.username]
    )
    const employee = result.rows[0]
    const valid =
      employee?.status === 'active' &&
      employee.enabled === true &&
      Boolean(employee.password_hash) &&
      await verifyPassword(input.password, employee.password_hash ?? '')
    if (!valid || !employee) {
      await this.recordFailure(principal)
      throw new UnauthorizedException('员工账号或移动端密码不正确')
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const identity = await client.query<{ id: string }>(
        `UPDATE miniapp_identity
         SET employee_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND tenant_id = $3 AND store_id = $4
           AND status = 'active'
         RETURNING id`,
        [
          employee.id,
          principal.identityId,
          principal.tenantId,
          principal.storeId
        ]
      )
      if (!identity.rows[0]) {
        throw new UnauthorizedException('小程序身份已失效')
      }
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4, 'employee.mobile_login.succeeded',
                 'miniapp_identity', $5, $6)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          employee.id,
          principal.identityId,
          JSON.stringify({ provider: principal.provider })
        ]
      )
      await client.query('COMMIT')
      await this.redis.del(rateKey)
      return staffIdentity(employee)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async logout(principal: MiniappPrincipal): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE miniapp_identity
         SET employee_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3`,
        [principal.identityId, principal.tenantId, principal.storeId]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4, 'employee.mobile_logout',
                 'miniapp_identity', $5, $6)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          principal.employeeId,
          principal.identityId,
          JSON.stringify({ provider: principal.provider })
        ]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async searchMembers(
    principal: MiniappPrincipal,
    rawQuery: string,
    rawLimit?: string
  ): Promise<EmployeeMobileMemberSummary[]> {
    this.requireEmployeePermission(principal, PERMISSIONS.memberRead)
    const query = rawQuery.trim()
    if (query.length > 60) throw new BadRequestException('查询内容过长')
    const limit = rawLimit === undefined ? 30 : Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('查询数量应为 1 至 100')
    }
    const result = await this.pool.query<MobileMemberRow>(
      `${this.memberSummarySelect()}
       WHERE m.tenant_id = $1
         AND (
           $3 = ''
           OR m.phone LIKE '%' || $3 || '%'
           OR m.member_number ILIKE '%' || $3 || '%'
           OR m.nickname ILIKE '%' || $3 || '%'
         )
       ORDER BY m.updated_at DESC, m.id
       LIMIT $4`,
      [principal.tenantId, principal.storeId, query, limit]
    )
    return result.rows.map(mobileMember)
  }

  async getMember(
    principal: MiniappPrincipal,
    memberId: string
  ): Promise<EmployeeMobileMemberSummary> {
    this.requireEmployeePermission(principal, PERMISSIONS.memberRead)
    if (!UUID_PATTERN.test(memberId)) {
      throw new BadRequestException('会员编号格式不正确')
    }
    return this.loadMember(
      this.pool,
      principal.tenantId,
      principal.storeId,
      memberId
    )
  }

  async createMember(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<EmployeeMobileMemberSummary> {
    const employeeId = this.requireEmployeePermission(
      principal,
      PERMISSIONS.memberWrite
    )
    let input: EmployeeMobileCreateMemberRequest
    try {
      input = createMemberInput(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '会员资料不正确'
      )
    }
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          phone: input.phone,
          nickname: input.nickname,
          note: input.note ?? null
        })
      )
      .digest('hex')
    const idempotencyKey =
      `employee-mobile-member-create:${employeeId}:${input.requestId}`
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
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
          response_json: EmployeeMobileMemberSummary | null
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
            '同一请求号已用于不同的会员资料'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('会员创建请求仍在处理中')
        }
        await client.query('COMMIT')
        return row.response_json
      }

      const duplicate = await client.query<{ id: string }>(
        `SELECT id FROM cloud_member
         WHERE tenant_id = $1 AND phone = $2
         LIMIT 1
         FOR UPDATE`,
        [principal.tenantId, input.phone]
      )
      if (duplicate.rows[0]) {
        throw new ConflictException('该手机号已经登记为会员')
      }
      const memberId = randomUUID()
      const timestamp = new Date().toISOString()
      const memberNumber = nextCloudMemberNumber(memberId)
      const projection = {
        id: memberId,
        memberNumber,
        phone: input.phone,
        nickname: input.nickname,
        tier: 'ordinary' as const,
        status: 'active' as const,
        birthdayMonth: null,
        birthdayDay: null,
        birthdaySource: null,
        note: input.note ?? null,
        source: 'miniapp' as const,
        ageGate: 'confirmed_at_least_14' as const,
        createdAt: timestamp,
        updatedAt: timestamp
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
          JSON.stringify({
            action: 'member.created',
            memberId,
            before: null,
            after: projection,
            reason: 'employee mobile member creation'
          }),
          timestamp
        ]
      )
      const serverVersion = Number(event.rows[0]?.sequence)
      if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
        throw new Error('Cloud event did not return a valid sequence')
      }
      await client.query(
        `INSERT INTO cloud_member
         (id, tenant_id, store_id, member_number, phone, nickname, tier,
          status, birthday_month, birthday_day, birthday_source, note, source,
          age_gate_status, server_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ordinary', 'active',
                 NULL, NULL, NULL, $7, 'miniapp',
                 'confirmed_at_least_14', $8, $9, $9)`,
        [
          memberId,
          principal.tenantId,
          principal.storeId,
          memberNumber,
          input.phone,
          input.nickname,
          input.note ?? null,
          serverVersion,
          timestamp
        ]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, actor_id, action, aggregate_type,
          aggregate_id, metadata_json, occurred_at)
         VALUES ($1, $2, $3, $4, 'member.created', 'member', $5, $6::jsonb, $7)`,
        [
          randomUUID(),
          principal.tenantId,
          principal.storeId,
          employeeId,
          memberId,
          JSON.stringify({
            identityId: principal.identityId,
            source: 'employee_mobile'
          }),
          timestamp
        ]
      )
      const summary = await this.loadMember(
        client,
        principal.tenantId,
        principal.storeId,
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
      const databaseError = error as PgError
      if (
        databaseError.code === '23505' &&
        databaseError.constraint === 'uq_cloud_member_tenant_phone'
      ) {
        throw new ConflictException('该手机号已经登记为会员')
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async recordFailure(principal: MiniappPrincipal): Promise<void> {
    await this.pool.query(
      `INSERT INTO cloud_audit_log
       (id, tenant_id, store_id, action, aggregate_type,
        aggregate_id, metadata_json)
       VALUES ($1, $2, $3, 'employee.mobile_login.failed',
               'miniapp_identity', $4, $5)`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        principal.identityId,
        JSON.stringify({ provider: principal.provider })
      ]
    )
  }

  private requireEmployeePermission(
    principal: MiniappPrincipal,
    permission: string
  ): string {
    if (
      !principal.employeeId ||
      (principal.identity.role !== 'staff' &&
        principal.identity.role !== 'manager') ||
      !principal.identity.permissions.includes(permission)
    ) {
      throw new ForbiddenException('当前身份没有员工操作权限')
    }
    return principal.employeeId
  }

  private memberSummarySelect(): string {
    return `SELECT m.id, m.member_number, m.phone, m.nickname, m.tier,
                   m.status, m.birthday_month, m.birthday_day, m.note,
                   m.age_gate_status, m.updated_at,
                   w.principal_balance_fen, w.gift_balance_fen,
                   card.id monthly_card_id,
                   card.status monthly_card_status,
                   card.plan_name monthly_card_plan_name,
                   card.price_fen monthly_card_price_fen,
                   card.expires_at monthly_card_expires_at
            FROM cloud_member m
            LEFT JOIN cloud_wallet_account w
              ON w.tenant_id = m.tenant_id AND w.member_id = m.id
            LEFT JOIN LATERAL (
              SELECT id, status, plan_name, price_fen, expires_at
              FROM cloud_monthly_card
              WHERE tenant_id = m.tenant_id
                AND member_id = m.id
                AND (scope_type = 'tenant' OR store_id = $2)
                AND status IN ('active', 'paused')
              ORDER BY purchased_at DESC
              LIMIT 1
            ) card ON TRUE`
  }

  private async loadMember(
    queryable: Pick<Pool, 'query'> | PoolClient,
    tenantId: string,
    storeId: string,
    memberId: string
  ): Promise<EmployeeMobileMemberSummary> {
    const result = await queryable.query<MobileMemberRow>(
      `${this.memberSummarySelect()}
       WHERE m.tenant_id = $1 AND m.id = $3
       LIMIT 1`,
      [tenantId, storeId, memberId]
    )
    const row = result.rows[0]
    if (!row) throw new NotFoundException('会员不存在')
    return mobileMember(row)
  }
}
