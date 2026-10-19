import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common'
import type {
  MiniappIdentity,
  MiniappSessionResult
} from '@zyapp/contracts'
import { DEFAULT_ROLE_PERMISSIONS } from '@zyapp/auth'
import type { Pool } from '@zyapp/cloud-db'
import { randomUUID } from 'node:crypto'
import type { ApiConfig } from './config'
import {
  createMiniappToken,
  hashMiniappToken,
  validateDevelopmentSessionRequest,
  validateWechatSessionRequest,
  type MiniappPrincipal
} from './miniapp-auth'
import {
  API_CONFIG,
  POSTGRES_POOL
} from './infrastructure.module'
import { resolveWechatLoginSubject } from './wechat-miniapp-provider'

type PrincipalRow = {
  identity_id: string
  tenant_id: string
  store_id: string
  provider: 'wechat' | 'development'
  provider_subject: string
  identity_status: 'active' | 'disabled'
  member_id: string | null
  member_status: 'active' | 'disabled' | null
  nickname: string | null
  phone: string | null
  tier: 'ordinary' | 'advanced' | null
  employee_id: string | null
  employee_status: 'active' | 'disabled' | null
  employee_display_name: string | null
  employee_role: 'manager' | 'staff' | null
  mobile_access_enabled: boolean | null
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function identityFromRow(row: PrincipalRow): MiniappIdentity {
  if (
    row.employee_id &&
    row.employee_status === 'active' &&
    row.employee_display_name &&
    row.employee_role &&
    row.mobile_access_enabled
  ) {
    return {
      role: row.employee_role,
      employeeId: row.employee_id,
      displayName: row.employee_display_name,
      permissions: [...DEFAULT_ROLE_PERMISSIONS[row.employee_role]]
    }
  }
  if (
    row.member_id &&
    row.member_status === 'active' &&
    row.nickname &&
    row.phone &&
    row.tier
  ) {
    return {
      role: 'member',
      memberId: row.member_id,
      nickname: row.nickname,
      phoneMasked: maskPhone(row.phone),
      tier: row.tier
    }
  }
  return { role: 'guest' }
}

function principalFromRow(row: PrincipalRow): MiniappPrincipal {
  return {
    identityId: row.identity_id,
    tenantId: row.tenant_id,
    storeId: row.store_id,
    provider: row.provider,
    providerSubject: row.provider_subject,
    memberId: row.member_id,
    memberStatus: row.member_status,
    employeeId:
      row.employee_status === 'active' && row.mobile_access_enabled
        ? row.employee_id
        : null,
    employeeStatus: row.employee_status,
    employeeRole:
      row.employee_status === 'active' && row.mobile_access_enabled
        ? row.employee_role
        : null,
    identity: identityFromRow(row)
  }
}

@Injectable()
export class MiniappSessionService {
  async logout(token:string):Promise<void> {
    await this.pool.query('UPDATE miniapp_session SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=$1 AND revoked_at IS NULL',[hashMiniappToken(token)])
  }
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  async createDevelopmentSession(rawInput: unknown): Promise<MiniappSessionResult> {
    if (!this.config.miniappDevelopmentAuthEnabled) {
      throw new NotFoundException('Development miniapp authentication is disabled')
    }
    let input
    try {
      input = validateDevelopmentSessionRequest(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid development session'
      )
    }

    return this.createSession({
      storeId: input.storeId,
      provider: 'development',
      providerSubject: input.providerSubject
    })
  }

  async createWechatSession(rawInput: unknown): Promise<MiniappSessionResult> {
    let input
    try {
      input = validateWechatSessionRequest(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid WeChat session'
      )
    }
    const providerSubject = await resolveWechatLoginSubject(
      this.config,
      input.loginCode
    )
    return this.createSession({
      storeId: input.storeId,
      provider: 'wechat',
      providerSubject
    })
  }

  private async createSession(input: {
    storeId: string
    provider: 'wechat' | 'development'
    providerSubject: string
  }): Promise<MiniappSessionResult> {
    const token = createMiniappToken()
    const tokenHash = hashMiniappToken(token)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const store = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id
         FROM store
         WHERE id = $1 AND status = 'active'
         FOR UPDATE`,
        [input.storeId]
      )
      const tenantId = store.rows[0]?.tenant_id
      if (!tenantId) throw new NotFoundException('Store was not found')

      const identityId = randomUUID()
      const identity = await client.query<{ id: string }>(
        `INSERT INTO miniapp_identity
         (id, tenant_id, store_id, provider, provider_subject, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (tenant_id, provider, provider_subject) DO UPDATE SET
           updated_at = CURRENT_TIMESTAMP
         WHERE miniapp_identity.store_id = EXCLUDED.store_id
           AND miniapp_identity.status = 'active'
         RETURNING id`,
        [
          identityId,
          tenantId,
          input.storeId,
          input.provider,
          input.providerSubject
        ]
      )
      const resolvedIdentityId = identity.rows[0]?.id
      if (!resolvedIdentityId) {
        throw new ConflictException(
          'Miniapp identity belongs to another store or is disabled'
        )
      }
      await client.query(
        `INSERT INTO miniapp_session
         (id, identity_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), resolvedIdentityId, tokenHash, expiresAt.toISOString()]
      )
      const principal = await this.findPrincipal(
        client,
        resolvedIdentityId,
        false
      )
      await client.query('COMMIT')
      return {
        accessToken: token,
        expiresAt: expiresAt.toISOString(),
        identity: principal.identity
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async authenticate(token: string | undefined): Promise<MiniappPrincipal> {
    if (!token) throw new UnauthorizedException('Miniapp session is required')
    const result = await this.pool.query<PrincipalRow>(
      `SELECT i.id identity_id, i.tenant_id, i.store_id, i.provider,
              i.provider_subject, i.status identity_status, i.member_id,
              m.status member_status, m.nickname, m.phone, m.tier,
              i.employee_id,
              CASE WHEN e.status = 'disabled' THEN 'disabled'
                   ELSE access.status END employee_status,
              e.display_name employee_display_name,
              access.role employee_role,
              c.enabled mobile_access_enabled
       FROM miniapp_session s
       JOIN miniapp_identity i ON i.id = s.identity_id
       LEFT JOIN cloud_member m
         ON m.id = i.member_id AND m.tenant_id = i.tenant_id
       LEFT JOIN cloud_employee e
         ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
       LEFT JOIN cloud_employee_store_access access
         ON access.employee_id = e.id
        AND access.tenant_id = i.tenant_id
        AND access.store_id = i.store_id
       LEFT JOIN cloud_employee_mobile_credential c
         ON c.employee_id = e.id
        AND c.tenant_id = i.tenant_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP
         AND i.status = 'active'
       LIMIT 1`,
      [hashMiniappToken(token)]
    )
    const row = result.rows[0]
    if (!row) throw new UnauthorizedException('Miniapp session is invalid')
    return principalFromRow(row)
  }

  private async findPrincipal(
    client: Pick<Pool, 'query'>,
    identityId: string,
    requireActiveMember: boolean
  ): Promise<MiniappPrincipal> {
    const result = await client.query<PrincipalRow>(
      `SELECT i.id identity_id, i.tenant_id, i.store_id, i.provider,
              i.provider_subject, i.status identity_status, i.member_id,
              m.status member_status, m.nickname, m.phone, m.tier,
              i.employee_id,
              CASE WHEN e.status = 'disabled' THEN 'disabled'
                   ELSE access.status END employee_status,
              e.display_name employee_display_name,
              access.role employee_role,
              c.enabled mobile_access_enabled
       FROM miniapp_identity i
       LEFT JOIN cloud_member m
         ON m.id = i.member_id AND m.tenant_id = i.tenant_id
       LEFT JOIN cloud_employee e
         ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
       LEFT JOIN cloud_employee_store_access access
         ON access.employee_id = e.id
        AND access.tenant_id = i.tenant_id
        AND access.store_id = i.store_id
       LEFT JOIN cloud_employee_mobile_credential c
         ON c.employee_id = e.id
        AND c.tenant_id = i.tenant_id
       WHERE i.id = $1 AND i.status = 'active'
       LIMIT 1`,
      [identityId]
    )
    const row = result.rows[0]
    if (!row || (requireActiveMember && row.member_status !== 'active')) {
      throw new UnauthorizedException('Miniapp identity is unavailable')
    }
    return principalFromRow(row)
  }
}
