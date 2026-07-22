import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common'
import { verifyPassword } from '@zyapp/auth'
import type { Pool } from '@zyapp/cloud-db'
import type { DesktopCloudLoginResult } from '@zyapp/contracts'
import { createHash, randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import type { DevicePrincipal } from './device-auth'
import { POSTGRES_POOL, REDIS_CLIENT } from './infrastructure.module'

const OFFLINE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function credentials(value: unknown): { username: string; password: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('login body must be an object')
  }
  const input = value as Record<string, unknown>
  const username = typeof input.username === 'string'
    ? input.username.trim().toLowerCase()
    : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(username)) {
    throw new BadRequestException('username is invalid')
  }
  if (password.length < 1 || password.length > 128) {
    throw new BadRequestException('password is invalid')
  }
  return { username, password }
}

@Injectable()
export class DesktopAuthService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  async login(
    principal: DevicePrincipal,
    rawInput: unknown
  ): Promise<DesktopCloudLoginResult> {
    const input = credentials(rawInput)
    const rateHash = createHash('sha256')
      .update(`${principal.deviceId}:${input.username}`)
      .digest('hex')
    const rateKey = `zyapp:desktop-login:${rateHash}`
    const attempts = await this.redis.incr(rateKey)
    if (attempts === 1) await this.redis.expire(rateKey, 5 * 60)
    if (attempts > 5) {
      throw new HttpException(
        '登录尝试过多，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS
      )
    }

    const result = await this.pool.query<{
      id: string
      username: string
      display_name: string
      role: 'manager' | 'staff'
      identity_status: 'active' | 'disabled'
      access_status: 'active' | 'disabled'
      authorization_version: string
      password_hash: string | null
      credential_version: string | null
      tenant_status: string
      store_status: string
    }>(
      `SELECT employee.id::text, employee.username, employee.display_name,
              access.role, employee.status identity_status,
              access.status access_status, access.authorization_version,
              credential.password_hash, credential.credential_version,
              tenant.status tenant_status, store.status store_status
       FROM cloud_employee employee
       JOIN tenant ON tenant.id = employee.tenant_id
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
       JOIN store ON store.id = access.store_id
       LEFT JOIN cloud_employee_pc_credential credential
         ON credential.employee_id = employee.id
        AND credential.tenant_id = employee.tenant_id
       WHERE employee.tenant_id = $1 AND access.store_id = $2
         AND employee.username = $3
       LIMIT 1`,
      [principal.tenantId, principal.storeId, input.username]
    )
    const employee = result.rows[0]
    const valid =
      employee?.tenant_status === 'active' &&
      employee.store_status === 'active' &&
      employee.identity_status === 'active' &&
      employee.access_status === 'active' &&
      Boolean(employee.password_hash) &&
      await verifyPassword(input.password, employee.password_hash ?? '')
    if (!valid || !employee || !employee.credential_version) {
      await this.recordAttempt(principal, null, input.username, false)
      throw new UnauthorizedException('员工账号或密码错误，或者账号已失效')
    }

    const serverTime = new Date()
    const response: DesktopCloudLoginResult = {
      employee: {
        id: employee.id,
        username: employee.username,
        displayName: employee.display_name,
        role: employee.role,
        status: employee.access_status
      },
      tenantId: principal.tenantId,
      storeId: principal.storeId,
      deviceId: principal.deviceId,
      credentialVersion: Number(employee.credential_version),
      authorizationVersion: Number(employee.authorization_version),
      serverTime: serverTime.toISOString(),
      offlineValidUntil: new Date(serverTime.getTime() + OFFLINE_TTL_MS).toISOString()
    }
    await this.redis.del(rateKey)
    await this.recordAttempt(principal, employee.id, input.username, true)
    return response
  }

  private async recordAttempt(
    principal: DevicePrincipal,
    employeeId: string | null,
    username: string,
    success: boolean
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO cloud_audit_log
       (id, tenant_id, store_id, device_id, actor_id, action,
        aggregate_type, aggregate_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, 'employee', $7, $8::jsonb)`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        principal.deviceId,
        employeeId,
        success ? 'employee.desktop_login.succeeded' : 'employee.desktop_login.failed',
        employeeId ?? username,
        JSON.stringify({ username, success })
      ]
    )
  }
}
