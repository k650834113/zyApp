import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import type {
  BusinessTemplateSummary,
  BusinessTemplateType,
  CreateTenantStoreResult,
  EmployeeRole,
  EmployeeStatus,
  EmployeeStoreAccessSummary,
  TenantStoreAdminSummary
} from '@zyapp/contracts'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { ApiConfig } from './config'
import type { DevicePrincipal } from './device-auth'
import { API_CONFIG, POSTGRES_POOL } from './infrastructure.module'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,40}$/u
const ACTIVATION_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('request body must be an object')
  }
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  name: string,
  min: number,
  max: number
): string {
  if (typeof value !== 'string') throw new BadRequestException(`${name} is required`)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) {
    throw new BadRequestException(`${name} length is invalid`)
  }
  return normalized
}

function uuid(value: unknown, name: string): string {
  const normalized = text(value, name, 36, 36)
  if (!UUID_PATTERN.test(normalized)) {
    throw new BadRequestException(`${name} must be a UUID`)
  }
  return normalized
}

function role(value: unknown): EmployeeRole {
  if (value !== 'manager' && value !== 'staff') {
    throw new BadRequestException('role must be manager or staff')
  }
  return value
}

function status(value: unknown): EmployeeStatus {
  if (value !== 'active' && value !== 'disabled') {
    throw new BadRequestException('status must be active or disabled')
  }
  return value
}

function templateType(value: unknown): BusinessTemplateType {
  if (value !== 'recharge_gift_tier' && value !== 'monthly_card_plan' && value !== 'activity') {
    throw new BadRequestException('templateType is invalid')
  }
  return value
}

function jsonObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${name} must be an object`)
  }
  if (JSON.stringify(value).length > 50_000) {
    throw new BadRequestException(`${name} is too large`)
  }
  return value as Record<string, unknown>
}

@Injectable()
export class TenantAdminService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  private activationCode(tenantId: string, requestId: string): string {
    const digest = createHmac('sha256', this.config.deviceEnrollmentSecret)
      .update(`activate-store:${tenantId}:${requestId}`)
      .digest()
    const compact = Array.from(
      digest,
      (value) => ACTIVATION_ALPHABET[value % ACTIVATION_ALPHABET.length]
    ).join('')
    return compact.match(/.{1,4}/g)?.join('-') ?? compact
  }

  private codeHash(code: string): string {
    return createHmac('sha256', this.config.deviceEnrollmentSecret)
      .update(code.replaceAll('-', '').trim().toUpperCase())
      .digest('hex')
  }

  private async requireAdministrator(
    queryable: Queryable,
    principal: DevicePrincipal,
    actorId: string
  ): Promise<void> {
    const result = await queryable.query(
      `SELECT administrator.status administrator_status,
              employee.status employee_status,
              access.role, access.status access_status
       FROM tenant_administrator administrator
       JOIN cloud_employee employee
         ON employee.id = administrator.employee_id
        AND employee.tenant_id = administrator.tenant_id
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
        AND access.store_id = $3
       WHERE administrator.tenant_id = $1
         AND administrator.employee_id = $2`,
      [principal.tenantId, actorId, principal.storeId]
    )
    const row = result.rows[0] as
      | {
          administrator_status: string
          employee_status: string
          role: string
          access_status: string
        }
      | undefined
    if (
      row?.administrator_status !== 'active' ||
      row.employee_status !== 'active' ||
      row.role !== 'manager' ||
      row.access_status !== 'active'
    ) {
      throw new UnauthorizedException('当前员工没有商户管理员权限')
    }
  }

  async listStores(
    principal: DevicePrincipal,
    actorId: string
  ): Promise<TenantStoreAdminSummary[]> {
    await this.requireAdministrator(this.pool, principal, uuid(actorId, 'actorId'))
    const result = await this.pool.query<{
      id: string
      name: string
      status: 'active' | 'disabled'
      created_at: Date
    }>(
      `SELECT id::text, name, status, created_at
       FROM store WHERE tenant_id = $1
       ORDER BY created_at, id`,
      [principal.tenantId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      currentStore: row.id === principal.storeId
    }))
  }

  async listEmployeeAccess(
    principal: DevicePrincipal,
    actorId: string
  ): Promise<EmployeeStoreAccessSummary[]> {
    await this.requireAdministrator(this.pool, principal, uuid(actorId, 'actorId'))
    const result = await this.pool.query<{
      employee_id: string
      username: string
      display_name: string
      identity_status: 'active' | 'disabled'
      store_id: string
      store_name: string
      role: EmployeeRole
      status: EmployeeStatus
      authorization_version: string | number
      updated_at: Date
    }>(
      `SELECT employee.id::text employee_id, employee.username,
              employee.display_name, employee.status identity_status,
              store.id::text store_id, store.name store_name,
              access.role, access.status, access.authorization_version,
              access.updated_at
       FROM cloud_employee employee
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
       JOIN store ON store.id = access.store_id
       WHERE employee.tenant_id = $1
       ORDER BY employee.username, store.created_at, store.id`,
      [principal.tenantId]
    )
    return result.rows.map((row) => ({
      employeeId: row.employee_id,
      username: row.username,
      displayName: row.display_name,
      identityStatus: row.identity_status,
      storeId: row.store_id,
      storeName: row.store_name,
      role: row.role,
      status: row.status,
      authorizationVersion: Number(row.authorization_version),
      updatedAt: row.updated_at.toISOString()
    }))
  }

  async createStore(
    principal: DevicePrincipal,
    actorIdValue: string,
    rawInput: unknown
  ): Promise<CreateTenantStoreResult> {
    const actorId = uuid(actorIdValue, 'actorId')
    const input = body(rawInput)
    const requestId = text(input.requestId, 'requestId', 8, 100)
    const storeName = text(input.storeName, 'storeName', 1, 60)
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ storeName }))
      .digest('hex')
    const key = `tenant-store-create:${actorId}:${requestId}`
    const activationCode = this.activationCode(principal.tenantId, requestId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.requireAdministrator(client, principal, actorId)
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
          response_json: Omit<CreateTenantStoreResult, 'activationCode'> | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2 FOR UPDATE`,
          [principal.tenantId, key]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException('同一请求号已经用于不同的新门店')
        }
        if (!row.response_json) throw new ConflictException('新门店创建仍在处理中')
        await client.query('COMMIT')
        return { ...row.response_json, activationCode }
      }

      const storeId = randomUUID()
      const epochId = randomUUID()
      const registrationCodeId = randomUUID()
      const createdAt = new Date()
      const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000)
      await client.query(
        `INSERT INTO store (id, tenant_id, name, status)
         VALUES ($1, $2, $3, 'active')`,
        [storeId, principal.tenantId, storeName]
      )
      await client.query(
        `INSERT INTO cloud_employee_store_access
         (employee_id, tenant_id, store_id, role, status,
          authorization_version, granted_by)
         VALUES ($1, $2, $3, 'manager', 'active', 1, $1)`,
        [actorId, principal.tenantId, storeId]
      )
      await client.query(
        `INSERT INTO cloud_mirror_epoch
         (tenant_id, store_id, initiated_by_device_id, epoch_id)
         VALUES ($1, $2, $3, $4)`,
        [principal.tenantId, storeId, principal.deviceId, epochId]
      )
      await client.query(
        `INSERT INTO device_registration_code
         (id, code_hash, expires_at, action, tenant_id, store_id,
          created_by_employee_id)
         VALUES ($1, $2, $3, 'activate_store', $4, $5, $6)`,
        [
          registrationCodeId,
          this.codeHash(activationCode),
          expiresAt.toISOString(),
          principal.tenantId,
          storeId,
          actorId
        ]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4, $5, 'tenant.store.created',
                 'store', $3::uuid::text, $6::jsonb)`,
        [
          randomUUID(),
          principal.tenantId,
          storeId,
          principal.deviceId,
          actorId,
          JSON.stringify({ storeName, epochId, requestId })
        ]
      )
      const responseWithoutCode: Omit<CreateTenantStoreResult, 'activationCode'> = {
        store: {
          id: storeId,
          name: storeName,
          status: 'active',
          createdAt: createdAt.toISOString(),
          currentStore: false
        },
        expiresAt: expiresAt.toISOString()
      }
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 200, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, key, JSON.stringify(responseWithoutCode)]
      )
      await client.query('COMMIT')
      return { ...responseWithoutCode, activationCode }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async setEmployeeAccess(
    principal: DevicePrincipal,
    actorIdValue: string,
    rawInput: unknown
  ): Promise<EmployeeStoreAccessSummary> {
    const actorId = uuid(actorIdValue, 'actorId')
    const input = body(rawInput)
    const requestId = text(input.requestId, 'requestId', 8, 100)
    const employeeId = uuid(input.employeeId, 'employeeId')
    const storeId = uuid(input.storeId, 'storeId')
    const nextRole = role(input.role)
    const nextStatus = status(input.status)
    const reason = text(input.reason, 'reason', 1, 200)
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ employeeId, storeId, role: nextRole, status: nextStatus, reason }))
      .digest('hex')
    const key = `employee-store-access:${actorId}:${requestId}`
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.requireAdministrator(client, principal, actorId)
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING RETURNING key`,
        [principal.tenantId, key, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: EmployeeStoreAccessSummary | null
        }>(
          `SELECT request_hash, response_json FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2 FOR UPDATE`,
          [principal.tenantId, key]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException('同一请求号已经用于不同的门店授权')
        }
        if (!row.response_json) throw new ConflictException('门店授权仍在处理中')
        await client.query('COMMIT')
        return row.response_json
      }

      const target = await client.query<{
        username: string
        display_name: string
        created_at: Date
        identity_status: 'active' | 'disabled'
        store_name: string
        previous_version: string | number | null
      }>(
        `SELECT employee.username, employee.display_name, employee.created_at,
                employee.status identity_status, store.name store_name,
                access.authorization_version previous_version
         FROM cloud_employee employee
         JOIN store ON store.id = $3 AND store.tenant_id = employee.tenant_id
         LEFT JOIN cloud_employee_store_access access
           ON access.employee_id = employee.id AND access.store_id = store.id
         WHERE employee.id = $1 AND employee.tenant_id = $2
         FOR UPDATE OF employee, store, access`,
        [employeeId, principal.tenantId, storeId]
      )
      const employee = target.rows[0]
      if (!employee) throw new NotFoundException('员工或门店不存在')
      if (employee.identity_status !== 'active' && nextStatus === 'active') {
        throw new ConflictException('员工身份已全局停用，不能新增有效门店授权')
      }
      if (nextRole !== 'manager' || nextStatus !== 'active') {
        const managers = await client.query<{ count: string | number }>(
          `SELECT COUNT(*) count FROM cloud_employee_store_access
           WHERE tenant_id = $1 AND store_id = $2
             AND role = 'manager' AND status = 'active'
             AND employee_id <> $3`,
          [principal.tenantId, storeId, employeeId]
        )
        if (Number(managers.rows[0]?.count ?? 0) === 0) {
          throw new ConflictException('每家门店必须至少保留一名有效店长')
        }
      }
      const authorizationVersion = Number(employee.previous_version ?? 0) + 1
      const updatedAt = new Date().toISOString()
      await client.query(
        `INSERT INTO cloud_employee_store_access
         (employee_id, tenant_id, store_id, role, status,
          authorization_version, granted_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (employee_id, store_id) DO UPDATE SET
           role = EXCLUDED.role, status = EXCLUDED.status,
           authorization_version = EXCLUDED.authorization_version,
           granted_by = EXCLUDED.granted_by, updated_at = EXCLUDED.updated_at
         WHERE cloud_employee_store_access.tenant_id = EXCLUDED.tenant_id`,
        [employeeId, principal.tenantId, storeId, nextRole, nextStatus,
          authorizationVersion, actorId, updatedAt]
      )
      const eventId = randomUUID()
      const event = await client.query<{ sequence: string | number }>(
        `INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         VALUES ($1, $2, $3, 'employee', $4,
                 'employee.authorization.updated', $5::jsonb, $6)
         RETURNING sequence`,
        [
          eventId,
          principal.tenantId,
          storeId,
          employeeId,
          JSON.stringify({
            action: 'employee.authorization.updated',
            aggregateId: employeeId,
            before: null,
            after: {
              id: employeeId,
              username: employee.username,
              displayName: employee.display_name,
              role: nextRole,
              status: nextStatus,
              authorizationVersion,
              createdAt: employee.created_at.toISOString(),
              updatedAt
            },
            reason
          }),
          updatedAt
        ]
      )
      const result: EmployeeStoreAccessSummary = {
        employeeId,
        username: employee.username,
        displayName: employee.display_name,
        identityStatus: employee.identity_status,
        storeId,
        storeName: employee.store_name,
        role: nextRole,
        status: nextStatus,
        authorizationVersion,
        updatedAt
      }
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, metadata_json, occurred_at)
         VALUES ($1, $2, $3, $4, $5, 'employee.store_access.updated',
                 'employee', $6, $7::jsonb, $8)`,
        [randomUUID(), principal.tenantId, storeId, principal.deviceId,
          actorId, employeeId, JSON.stringify({ ...result, reason,
            eventSequence: String(event.rows[0]?.sequence ?? '') }), updatedAt]
      )
      await client.query(
        `UPDATE api_idempotency SET response_status = 200,
                response_json = $3::jsonb
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

  async listBusinessTemplates(
    principal: DevicePrincipal,
    actorIdValue: string
  ): Promise<BusinessTemplateSummary[]> {
    const actorId = uuid(actorIdValue, 'actorId')
    await this.requireAdministrator(this.pool, principal, actorId)
    const result = await this.pool.query<{
      id: string
      template_type: BusinessTemplateType
      name: string
      payload_json: Record<string, unknown>
      active: boolean
      override_payload: Record<string, unknown> | null
      override_active: boolean | null
      updated_at: Date
    }>(
      `SELECT template.id::text, template.template_type, template.name,
              template.payload_json, template.active,
              override.payload_json override_payload,
              override.active override_active,
              GREATEST(template.updated_at, COALESCE(override.updated_at, template.updated_at)) updated_at
       FROM cloud_merchant_business_template template
       LEFT JOIN cloud_store_business_template_override override
         ON override.tenant_id = template.tenant_id
        AND override.store_id = $2
        AND override.template_id = template.id
       WHERE template.tenant_id = $1
       ORDER BY template.template_type, template.name, template.id`,
      [principal.tenantId, principal.storeId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      templateType: row.template_type,
      name: row.name,
      payload: row.payload_json,
      active: row.active,
      overridePayload: row.override_payload,
      overrideActive: row.override_active,
      updatedAt: row.updated_at.toISOString()
    }))
  }

  async saveBusinessTemplate(
    principal: DevicePrincipal,
    actorIdValue: string,
    rawInput: unknown
  ): Promise<BusinessTemplateSummary> {
    const actorId = uuid(actorIdValue, 'actorId')
    const input = body(rawInput)
    const id = uuid(input.id, 'id')
    const requestId = uuid(input.requestId, 'requestId')
    const type = templateType(input.templateType)
    const name = text(input.name, 'name', 1, 100)
    const payload = jsonObject(input.payload, 'payload')
    if (typeof input.active !== 'boolean') throw new BadRequestException('active must be boolean')
    await this.requireAdministrator(this.pool, principal, actorId)
    const result = await this.pool.query<{
      id: string
      template_type: BusinessTemplateType
      name: string
      payload_json: Record<string, unknown>
      active: boolean
      updated_at: Date
    }>(
      `WITH saved AS (
       INSERT INTO cloud_merchant_business_template
       (id, tenant_id, template_type, name, payload_json, active, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         template_type = EXCLUDED.template_type,
         name = EXCLUDED.name,
         payload_json = EXCLUDED.payload_json,
         active = EXCLUDED.active,
         updated_at = CURRENT_TIMESTAMP
       WHERE cloud_merchant_business_template.tenant_id = EXCLUDED.tenant_id
       RETURNING id, template_type, name, payload_json, active, updated_at
       ), event AS (
         INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         SELECT $8, $2, $9, 'business_template', saved.id::text,
                'business_template.saved',
                jsonb_build_object('after', to_jsonb(saved)), CURRENT_TIMESTAMP
         FROM saved
         ON CONFLICT (event_id) DO NOTHING
       ), audit AS (
         INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, metadata_json)
         SELECT $8, $2, $9, $10, $7, 'business_template.saved',
                'business_template', saved.id::text,
                jsonb_build_object('requestId', $8::text, 'templateType', saved.template_type)
         FROM saved
         ON CONFLICT (id) DO NOTHING
       )
       SELECT id::text, template_type, name, payload_json, active, updated_at FROM saved`,
      [id, principal.tenantId, type, name, JSON.stringify(payload), input.active,
        actorId, requestId, principal.storeId, principal.deviceId]
    )
    const row = result.rows[0]
    if (!row) throw new ConflictException('template id belongs to another tenant')
    return {
      id: row.id,
      templateType: row.template_type,
      name: row.name,
      payload: row.payload_json,
      active: row.active,
      overridePayload: null,
      overrideActive: null,
      updatedAt: row.updated_at.toISOString()
    }
  }

  async saveBusinessTemplateOverride(
    principal: DevicePrincipal,
    actorIdValue: string,
    rawInput: unknown
  ): Promise<BusinessTemplateSummary> {
    const actorId = uuid(actorIdValue, 'actorId')
    const input = body(rawInput)
    const templateId = uuid(input.templateId, 'templateId')
    const requestId = uuid(input.requestId, 'requestId')
    const payload = jsonObject(input.payload, 'payload')
    if (typeof input.active !== 'boolean') throw new BadRequestException('active must be boolean')
    await this.requireAdministrator(this.pool, principal, actorId)
    const saved = await this.pool.query(
      `WITH template AS (
         SELECT id FROM cloud_merchant_business_template
         WHERE id = $4 AND tenant_id = $2
       ), saved AS (
       INSERT INTO cloud_store_business_template_override
       (id, tenant_id, store_id, template_id, payload_json, active, updated_by)
       SELECT $1, $2, $3, template.id, $5::jsonb, $6, $7 FROM template
       ON CONFLICT (tenant_id, store_id, template_id) DO UPDATE SET
         payload_json = EXCLUDED.payload_json,
         active = EXCLUDED.active,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING template_id
       ), event AS (
         INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         SELECT $1, $2, $3, 'business_template', saved.template_id::text,
                'business_template.override.saved',
                jsonb_build_object('after', jsonb_build_object(
                  'id', saved.template_id::text,
                  'override_id', $1::text,
                  'override_payload_json', $5::jsonb,
                  'override_active', $6,
                  'override_created_at', CURRENT_TIMESTAMP,
                  'override_updated_at', CURRENT_TIMESTAMP
                )),
                CURRENT_TIMESTAMP FROM saved
         ON CONFLICT (event_id) DO NOTHING
       ), audit AS (
         INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, metadata_json)
         SELECT $1, $2, $3, $8, $7, 'business_template.override.saved',
                'business_template', saved.template_id::text,
                jsonb_build_object('requestId', $1::text)
         FROM saved
         ON CONFLICT (id) DO NOTHING
       ) SELECT template_id FROM saved`,
      [requestId, principal.tenantId, principal.storeId, templateId,
        JSON.stringify(payload), input.active, actorId, principal.deviceId]
    )
    if (!saved.rows[0]) throw new NotFoundException('template was not found')
    const rows = await this.listBusinessTemplates(principal, actorId)
    const resolved = rows.find((item) => item.id === templateId)
    if (!resolved) throw new Error('saved template override was not found')
    return resolved
  }
}
