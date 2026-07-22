import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException
} from '@nestjs/common'
import type { Pool } from '@zyapp/cloud-db'
import type { OfflineFinancialLeaseStatus } from '@zyapp/contracts'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { ApiConfig } from './config'
import {
  createDeviceToken,
  deviceTokenMatchesHash,
  hashDeviceToken,
  secretsEqual,
  validateDeviceEnrollmentInput,
  type DeviceEnrollmentInput,
  type DevicePrincipal
} from './device-auth'
import {
  API_CONFIG,
  POSTGRES_POOL
} from './infrastructure.module'

@Injectable()
export class DeviceService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  private pairingCodeHash(code: string): string {
    return createHmac('sha256', this.config.deviceEnrollmentSecret)
      .update(code.replaceAll('-', '').trim().toUpperCase())
      .digest('hex')
  }

  private registrationCodeHash(code: string): string {
    return createHmac('sha256', this.config.deviceEnrollmentSecret)
      .update(code.replaceAll('-', '').trim().toUpperCase())
      .digest('hex')
  }

  async createRegistrationCode(
    body: unknown,
    providedSecret: string | undefined
  ): Promise<{ code: string; expiresAt: string; environment: 'production' | 'test' }> {
    if (
      !providedSecret ||
      !secretsEqual(providedSecret, this.config.deviceEnrollmentSecret)
    ) {
      throw new UnauthorizedException('Invalid deployment administrator secret')
    }
    const requestedMinutes =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).expiresInMinutes
        : undefined
    const expiresInMinutes = requestedMinutes === undefined
      ? 30
      : Number(requestedMinutes)
    if (
      !Number.isInteger(expiresInMinutes) ||
      expiresInMinutes < 5 ||
      expiresInMinutes > 1_440
    ) {
      throw new BadRequestException('expiresInMinutes must be an integer from 5 to 1440')
    }
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    const bytes = randomBytes(32)
    const code = Array.from(
      bytes,
      (value) => alphabet[value % alphabet.length]
    ).join('')
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)
    await this.pool.query(
      `DELETE FROM device_registration_code
       WHERE consumed_at IS NOT NULL OR expires_at <= CURRENT_TIMESTAMP`
    )
    await this.pool.query(
      `INSERT INTO device_registration_code (id, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [randomUUID(), this.registrationCodeHash(code), expiresAt.toISOString()]
    )
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      environment: this.config.deploymentEnvironment
    }
  }

  async createPairingCode(
    principal: DevicePrincipal,
    body: unknown
  ): Promise<{ code: string; expiresAt: string; storeName: string }> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('pairing body must be an object')
    }
    const actorId = (body as Record<string, unknown>).actorId
    if (typeof actorId !== 'string') {
      throw new BadRequestException('actorId is required')
    }
    const authorization = await this.pool.query<{
      role: string
      status: string
      store_name: string
      epoch_id: string | null
    }>(
      `SELECT access.role, access.status, store.name store_name,
              epoch.epoch_id::text
       FROM cloud_employee employee
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
       JOIN store ON store.id = access.store_id
       LEFT JOIN cloud_mirror_epoch epoch
         ON epoch.tenant_id = employee.tenant_id
        AND epoch.store_id = access.store_id
       WHERE employee.id = $1 AND employee.tenant_id = $2
         AND employee.status = 'active' AND access.store_id = $3`,
      [actorId, principal.tenantId, principal.storeId]
    )
    const actor = authorization.rows[0]
    if (actor?.role !== 'manager' || actor.status !== 'active') {
      throw new UnauthorizedException(
        'Only an active manager can create a device pairing code'
      )
    }
    if (!actor.epoch_id) {
      throw new ConflictException(
        'The store must activate its cloud mirror before pairing another device'
      )
    }
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    const bytes = randomBytes(16)
    const compact = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
    const code = compact.match(/.{1,4}/g)?.join('-') ?? compact
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    await this.pool.query(
      `DELETE FROM device_pairing_code
       WHERE tenant_id = $1 AND store_id = $2
         AND created_by_employee_id = $3 AND consumed_at IS NULL`,
      [principal.tenantId, principal.storeId, actorId]
    )
    await this.pool.query(
      `INSERT INTO device_pairing_code
       (id, tenant_id, store_id, code_hash, created_by_device_id,
        created_by_employee_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        this.pairingCodeHash(code),
        principal.deviceId,
        actorId,
        expiresAt.toISOString()
      ]
    )
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      storeName: actor.store_name
    }
  }

  async enrollPaired(rawInput: unknown): Promise<{
    environment: 'production' | 'test'
    tenantId: string
    storeId: string
    storeName: string
    deviceId: string
    deviceName: string
    token: string
    epochId: string
    manager: {
      id: string
      username: string
      displayName: string
      status: 'active'
      createdAt: string
      updatedAt: string
    }
  }> {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      throw new BadRequestException('pairing enrollment body must be an object')
    }
    const input = rawInput as Record<string, unknown>
    if (input.environment !== this.config.deploymentEnvironment) {
      throw new ConflictException(
        `Client expects a different deployment environment; server is ${this.config.deploymentEnvironment}`
      )
    }
    const pairingCode = typeof input.pairingCode === 'string'
      ? input.pairingCode.replaceAll('-', '').trim().toUpperCase()
      : ''
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : ''
    const deviceName = typeof input.deviceName === 'string' ? input.deviceName.trim() : ''
    const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : null
    if (!/^[23456789A-HJ-NP-Z]{16}$/.test(pairingCode)) {
      throw new BadRequestException('pairingCode is invalid')
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
      throw new BadRequestException('deviceId must be a UUID')
    }
    if (deviceName.length < 1 || deviceName.length > 100) {
      throw new BadRequestException('deviceName must contain 1-100 characters')
    }
    if (requestId !== null && (requestId.length < 8 || requestId.length > 100)) {
      throw new BadRequestException('requestId must contain 8-100 characters')
    }
    const token = createDeviceToken()
    const tokenHash = hashDeviceToken(token)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const pairing = await client.query<{
        id: string
        tenant_id: string
        store_id: string
        store_name: string
        employee_id: string
        username: string
        display_name: string
        employee_status: string
        employee_created_at: Date
        employee_updated_at: Date
        epoch_id: string
        consumed_at: Date | null
      }>(
        `SELECT pairing.id::text, pairing.tenant_id::text,
                pairing.store_id::text, store.name store_name,
                employee.id::text employee_id, employee.username,
                employee.display_name, access.status employee_status,
                employee.created_at employee_created_at,
                employee.updated_at employee_updated_at,
                epoch.epoch_id::text, pairing.consumed_at
         FROM device_pairing_code pairing
         JOIN store ON store.id = pairing.store_id
         JOIN cloud_employee employee
           ON employee.id = pairing.created_by_employee_id
         JOIN cloud_employee_store_access access
           ON access.employee_id = employee.id
          AND access.tenant_id = employee.tenant_id
          AND access.store_id = pairing.store_id
         JOIN cloud_mirror_epoch epoch
           ON epoch.tenant_id = pairing.tenant_id
          AND epoch.store_id = pairing.store_id
         WHERE pairing.code_hash = $1
           AND employee.status = 'active'
           AND access.role = 'manager'
           AND (
             (pairing.consumed_at IS NULL AND pairing.expires_at > CURRENT_TIMESTAMP)
             OR
             (pairing.enrollment_request_id = $2
              AND pairing.consumed_by_device_id = $3)
           )
         FOR UPDATE OF pairing`,
        [this.pairingCodeHash(pairingCode), requestId, deviceId]
      )
      const row = pairing.rows[0]
      if (!row || row.employee_status !== 'active') {
        throw new UnauthorizedException('Pairing code is invalid or expired')
      }
      const existing = await client.query<{
        tenant_id: string
        store_id: string
        status: string
      }>('SELECT tenant_id::text, store_id::text, status FROM device WHERE id = $1 FOR UPDATE', [deviceId])
      if (
        existing.rows[0] &&
        (existing.rows[0].tenant_id !== row.tenant_id ||
          existing.rows[0].store_id !== row.store_id)
      ) {
        throw new ConflictException('Device identifier belongs to another store')
      }
      if (existing.rows[0]?.status === 'disabled') {
        throw new ConflictException('Device is disabled and cannot be paired')
      }
      await client.query(
        `INSERT INTO device
         (id, tenant_id, store_id, name, credential_hash, status, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           credential_hash = EXCLUDED.credential_hash,
           status = 'active',
           last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
        [deviceId, row.tenant_id, row.store_id, deviceName, tokenHash]
      )
      await client.query(
        `UPDATE device_pairing_code
         SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
             consumed_by_device_id = $2,
             enrollment_request_id = COALESCE(enrollment_request_id, $3)
         WHERE id = $1`,
        [row.id, deviceId, requestId]
      )
      if (row.consumed_at == null) await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4::uuid, $5, 'device.paired', 'device', $4::uuid::text,
                 $6::jsonb)`,
        [
          randomUUID(),
          row.tenant_id,
          row.store_id,
          deviceId,
          row.employee_id,
          JSON.stringify({ deviceName })
        ]
      )
      await client.query('COMMIT')
      return {
        environment: this.config.deploymentEnvironment,
        tenantId: row.tenant_id,
        storeId: row.store_id,
        storeName: row.store_name,
        deviceId,
        deviceName,
        token,
        epochId: row.epoch_id,
        manager: {
          id: row.employee_id,
          username: row.username,
          displayName: row.display_name,
          status: 'active',
          createdAt: row.employee_created_at.toISOString(),
          updatedAt: row.employee_updated_at.toISOString()
        }
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async enrollAuthorizedStore(rawInput: unknown): Promise<{
    environment: 'production' | 'test'
    tenantId: string
    storeId: string
    storeName: string
    deviceId: string
    deviceName: string
    token: string
    epochId: string
    manager: {
      id: string
      username: string
      displayName: string
      status: 'active'
      createdAt: string
      updatedAt: string
    }
  }> {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      throw new BadRequestException('store activation body must be an object')
    }
    const input = rawInput as Record<string, unknown>
    if (input.environment !== this.config.deploymentEnvironment) {
      throw new ConflictException(
        `Client expects a different deployment environment; server is ${this.config.deploymentEnvironment}`
      )
    }
    const activationCode = typeof input.activationCode === 'string'
      ? input.activationCode.replaceAll('-', '').trim().toUpperCase()
      : ''
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId : ''
    const deviceName = typeof input.deviceName === 'string' ? input.deviceName.trim() : ''
    const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : ''
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!/^[23456789A-HJ-NP-Z]{32}$/.test(activationCode)) {
      throw new BadRequestException('activationCode is invalid')
    }
    if (!uuidPattern.test(deviceId)) throw new BadRequestException('deviceId must be a UUID')
    if (deviceName.length < 1 || deviceName.length > 60) {
      throw new BadRequestException('deviceName length is invalid')
    }
    if (requestId.length < 8 || requestId.length > 100) {
      throw new BadRequestException('requestId length is invalid')
    }
    const token = createDeviceToken()
    const tokenHash = hashDeviceToken(token)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const registration = await client.query<{
        id: string
        tenant_id: string
        store_id: string
        store_name: string
        employee_id: string
        username: string
        display_name: string
        employee_created_at: Date
        employee_updated_at: Date
        epoch_id: string
      }>(
        `SELECT registration.id::text, registration.tenant_id::text,
                registration.store_id::text, store.name store_name,
                employee.id::text employee_id, employee.username,
                employee.display_name,
                employee.created_at employee_created_at,
                employee.updated_at employee_updated_at,
                epoch.epoch_id::text
         FROM device_registration_code registration
         JOIN store ON store.id = registration.store_id
          AND store.tenant_id = registration.tenant_id
         JOIN cloud_employee employee
           ON employee.id = registration.created_by_employee_id
          AND employee.tenant_id = registration.tenant_id
         JOIN cloud_employee_store_access access
           ON access.employee_id = employee.id
          AND access.tenant_id = employee.tenant_id
          AND access.store_id = registration.store_id
         JOIN cloud_mirror_epoch epoch
           ON epoch.tenant_id = registration.tenant_id
          AND epoch.store_id = registration.store_id
         WHERE registration.code_hash = $1
           AND registration.action = 'activate_store'
           AND employee.status = 'active'
           AND access.role = 'manager' AND access.status = 'active'
           AND (
             (registration.consumed_at IS NULL
              AND registration.expires_at > CURRENT_TIMESTAMP)
             OR
             (registration.enrollment_request_id = $2
              AND registration.consumed_by_device_id = $3)
           )
         FOR UPDATE OF registration`,
        [this.registrationCodeHash(activationCode), requestId, deviceId]
      )
      const row = registration.rows[0]
      if (!row) {
        throw new UnauthorizedException('Invalid or expired store activation code')
      }
      const existing = await client.query<{
        tenant_id: string
        store_id: string
        status: string
      }>(
        `SELECT tenant_id::text, store_id::text, status
         FROM device WHERE id = $1 FOR UPDATE`,
        [deviceId]
      )
      const current = existing.rows[0]
      if (
        current &&
        (current.tenant_id !== row.tenant_id || current.store_id !== row.store_id)
      ) {
        throw new ConflictException('Device identifier belongs to another store')
      }
      if (current?.status === 'disabled') {
        throw new ConflictException('Device is disabled')
      }
      await client.query(
        `INSERT INTO device
         (id, tenant_id, store_id, name, credential_hash, status, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, credential_hash = EXCLUDED.credential_hash,
           status = 'active', last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE device.tenant_id = EXCLUDED.tenant_id
           AND device.store_id = EXCLUDED.store_id
           AND device.status IN ('pending', 'active')`,
        [deviceId, row.tenant_id, row.store_id, deviceName, tokenHash]
      )
      await client.query(
        `UPDATE device_registration_code
         SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP),
             consumed_by_device_id = COALESCE(consumed_by_device_id, $2),
             enrollment_request_id = COALESCE(enrollment_request_id, $3)
         WHERE id = $1`,
        [row.id, deviceId, requestId]
      )
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4, $5, 'device.store_activated',
                 'device', $4::uuid::text, $6::jsonb)`,
        [randomUUID(), row.tenant_id, row.store_id, deviceId, row.employee_id,
          JSON.stringify({ deviceName, requestId })]
      )
      await client.query('COMMIT')
      return {
        environment: this.config.deploymentEnvironment,
        tenantId: row.tenant_id,
        storeId: row.store_id,
        storeName: row.store_name,
        deviceId,
        deviceName,
        token,
        epochId: row.epoch_id,
        manager: {
          id: row.employee_id,
          username: row.username,
          displayName: row.display_name,
          status: 'active',
          createdAt: row.employee_created_at.toISOString(),
          updatedAt: row.employee_updated_at.toISOString()
        }
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async enroll(
    rawInput: unknown,
    providedSecret: string | undefined
  ): Promise<
    DevicePrincipal & { token: string; environment: 'production' | 'test' }
  > {
    const usesAdministratorSecret = Boolean(
      providedSecret &&
      secretsEqual(providedSecret, this.config.deviceEnrollmentSecret)
    )
    const registrationCode = providedSecret?.replaceAll('-', '').trim().toUpperCase() ?? ''
    if (!usesAdministratorSecret && !/^[23456789A-HJ-NP-Z]{32}$/.test(registrationCode)) {
      throw new UnauthorizedException('Invalid or expired device registration code')
    }
    if (
      !rawInput ||
      typeof rawInput !== 'object' ||
      !('environment' in rawInput) ||
      rawInput.environment !== this.config.deploymentEnvironment
    ) {
      throw new ConflictException(
        `Client expects a different deployment environment; server is ${this.config.deploymentEnvironment}`
      )
    }
    let input: DeviceEnrollmentInput
    try {
      input = validateDeviceEnrollmentInput(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid enrollment request'
      )
    }
    const token = createDeviceToken()
    const tokenHash = hashDeviceToken(token)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      let registrationCodeId: string | null = null
      if (!usesAdministratorSecret) {
        const registration = await client.query<{ id: string }>(
          `SELECT id::text
           FROM device_registration_code
           WHERE code_hash = $1 AND consumed_at IS NULL
             AND expires_at > CURRENT_TIMESTAMP
           FOR UPDATE`,
          [this.registrationCodeHash(registrationCode)]
        )
        registrationCodeId = registration.rows[0]?.id ?? null
        if (!registrationCodeId) {
          throw new UnauthorizedException(
            'Invalid or expired device registration code'
          )
        }
      }
      const existing = await client.query<{
        tenant_id: string
        store_id: string
        status: string
      }>(
        `SELECT tenant_id, store_id, status
         FROM device WHERE id = $1 FOR UPDATE`,
        [input.deviceId]
      )
      const current = existing.rows[0]
      if (current && current.status !== 'pending') {
        if (current.status !== 'active') {
          throw new ConflictException(
            'Device is disabled and cannot rotate credentials'
          )
        }
      }
      if (
        current &&
        (current.tenant_id !== input.tenantId ||
          current.store_id !== input.storeId)
      ) {
        throw new ConflictException(
          'Device identifier belongs to another tenant or store'
        )
      }
      await client.query(
        `INSERT INTO tenant (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [input.tenantId, input.storeName]
      )
      await client.query(
        `INSERT INTO store (id, tenant_id, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [input.storeId, input.tenantId, input.storeName]
      )
      const store = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM store WHERE id = $1',
        [input.storeId]
      )
      if (store.rows[0]?.tenant_id !== input.tenantId) {
        throw new ConflictException(
          'Store identifier belongs to another tenant'
        )
      }
      await client.query(
        `INSERT INTO device
         (id, tenant_id, store_id, name, credential_hash, status, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           credential_hash = EXCLUDED.credential_hash,
           status = 'active',
           last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE device.status IN ('pending', 'active')`,
        [
          input.deviceId,
          input.tenantId,
          input.storeId,
          input.deviceName,
          tokenHash
        ]
      )
      const action = current?.status === 'active'
        ? 'device.credential_rotated'
        : 'device.enrolled'
      const eventId = randomUUID()
      await client.query(
        `INSERT INTO cloud_audit_log
         (id, tenant_id, store_id, device_id, action, aggregate_type,
          aggregate_id, metadata_json)
         VALUES ($1, $2, $3, $4, $6, 'device', $4::uuid::text, $5)`,
        [
          randomUUID(),
          input.tenantId,
          input.storeId,
          input.deviceId,
          JSON.stringify({ deviceName: input.deviceName }),
          action
        ]
      )
      await client.query(
        `INSERT INTO cloud_event
         (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
          event_type, payload_json, occurred_at)
         VALUES ($1, $2, $3, 'device', $4, $6, $5,
                 CURRENT_TIMESTAMP)`,
        [
          eventId,
          input.tenantId,
          input.storeId,
          input.deviceId,
          JSON.stringify({
            deviceId: input.deviceId,
            deviceName: input.deviceName
          }),
          action
        ]
      )
      if (registrationCodeId) {
        await client.query(
          `UPDATE device_registration_code
           SET consumed_at = CURRENT_TIMESTAMP, consumed_by_device_id = $2
           WHERE id = $1`,
          [registrationCodeId, input.deviceId]
        )
      }
      await client.query('COMMIT')
      return {
        environment: this.config.deploymentEnvironment,
        tenantId: input.tenantId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        token
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async authenticate(
    deviceId: string | undefined,
    bearerToken: string | undefined
  ): Promise<DevicePrincipal> {
    if (!deviceId || !bearerToken) {
      throw new UnauthorizedException('Device credentials are required')
    }
    const result = await this.pool.query<{
      tenant_id: string
      store_id: string
      device_id: string
      device_name: string
      credential_hash: string | null
    }>(
      `SELECT tenant_id, store_id, id device_id, name device_name,
              credential_hash
       FROM device
       WHERE id = $1 AND status = 'active'`,
      [deviceId]
    )
    const row = result.rows[0]
    if (
      !row?.credential_hash ||
      !deviceTokenMatchesHash(bearerToken, row.credential_hash)
    ) {
      throw new UnauthorizedException('Invalid device credentials')
    }
    await this.pool.query(
      `UPDATE device
       SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [deviceId]
    )
    return {
      tenantId: row.tenant_id,
      storeId: row.store_id,
      deviceId: row.device_id,
      deviceName: row.device_name
    }
  }

  async getOfflineFinancialLease(
    principal: DevicePrincipal
  ): Promise<OfflineFinancialLeaseStatus> {
    const result = await this.pool.query<{
      device_id: string
      device_name: string
      lease_version: string | number
      expires_at: Date
    }>(
      `SELECT lease.device_id, device.name device_name,
              lease.lease_version, lease.expires_at
       FROM cloud_offline_writer_lease lease
       JOIN device ON device.id = lease.device_id
       WHERE lease.tenant_id = $1 AND lease.store_id = $2`,
      [principal.tenantId, principal.storeId]
    )
    const row = result.rows[0]
    return {
      ownerDeviceId: row?.device_id ?? null,
      ownerDeviceName: row?.device_name ?? null,
      expiresAt: row?.expires_at.toISOString() ?? null,
      leaseVersion: Number(row?.lease_version ?? 0),
      currentDeviceOwnsLease:
        row?.device_id === principal.deviceId &&
        row.expires_at.getTime() > Date.now()
    }
  }

  async claimOfflineFinancialLease(
    principal: DevicePrincipal,
    body: unknown
  ): Promise<OfflineFinancialLeaseStatus> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('lease body must be an object')
    }
    const actorId = (body as Record<string, unknown>).actorId
    if (typeof actorId !== 'string') {
      throw new BadRequestException('actorId is required')
    }
    const actor = await this.pool.query<{ role: string; status: string }>(
      `SELECT access.role, access.status
       FROM cloud_employee employee
       JOIN cloud_employee_store_access access
         ON access.employee_id = employee.id
        AND access.tenant_id = employee.tenant_id
       WHERE employee.id = $1 AND employee.tenant_id = $2
         AND employee.status = 'active' AND access.store_id = $3`,
      [actorId, principal.tenantId, principal.storeId]
    )
    if (
      actor.rows[0]?.role !== 'manager' ||
      actor.rows[0]?.status !== 'active'
    ) {
      throw new UnauthorizedException(
        'Only an active manager can designate the offline cashier'
      )
    }
    await this.pool.query(
      `INSERT INTO cloud_offline_writer_lease
       (tenant_id, store_id, device_id, lease_version, expires_at, updated_at)
       VALUES ($1, $2, $3, 1, CURRENT_TIMESTAMP + INTERVAL '24 hours',
               CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, store_id) DO UPDATE SET
         device_id = EXCLUDED.device_id,
         lease_version = cloud_offline_writer_lease.lease_version + 1,
         expires_at = EXCLUDED.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      [principal.tenantId, principal.storeId, principal.deviceId]
    )
    return this.getOfflineFinancialLease(principal)
  }

  async renewOfflineFinancialLease(
    principal: DevicePrincipal
  ): Promise<OfflineFinancialLeaseStatus> {
    await this.pool.query(
      `UPDATE cloud_offline_writer_lease
       SET expires_at = CURRENT_TIMESTAMP + INTERVAL '24 hours',
           lease_version = lease_version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND store_id = $2 AND device_id = $3`,
      [principal.tenantId, principal.storeId, principal.deviceId]
    )
    return this.getOfflineFinancialLease(principal)
  }
}
