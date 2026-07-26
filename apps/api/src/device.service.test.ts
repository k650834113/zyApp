import { describe, expect, it, vi } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import { DeviceService } from './device.service'

describe('device enrollment', () => {
  const config = {
    nodeEnv: 'test' as const,
    deploymentEnvironment: 'test' as const,
    port: 3100,
    databaseUrl: 'postgres://test',
    redisUrl: 'redis://test',
    deviceEnrollmentSecret: 'enrollment-secret',
    desktopUpdateDirectory: '/tmp/updates',
    phoneVerificationMode: 'mock' as const,
    phoneVerificationSecret: 'phone-secret',
    wechatPaymentMode: 'disabled' as const,
    wechatPayMerchantId: null,
    wechatPayMerchantCertificateSerial: null,
    wechatPayMerchantPrivateKeyPath: null,
    wechatPayPublicKeyId: null,
    wechatPayPublicKeyPath: null,
    wechatPayApiV3KeyPath: null,
    wechatPayNotifyUrl: null,
    wechatPayOutTradeNoPrefix: 'ZY-',
    miniappDevelopmentAuthEnabled: false
  }

  it('creates a short-lived first-device registration code without storing plaintext', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }))
    const service = new DeviceService({ query } as unknown as Pool, config)

    const result = await service.createRegistrationCode(
      { expiresInMinutes: 45 },
      config.deviceEnrollmentSecret
    )

    expect(result.code).toMatch(/^[23456789A-HJ-NP-Z]{32}$/)
    expect(result.environment).toBe('test')
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO device_registration_code')
    )
    expect(insert).toBeDefined()
    expect(insert?.flat().join(' ')).not.toContain(result.code)
  })

  it('consumes a one-time registration code when enrolling the first device', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111'
    const storeId = '22222222-2222-4222-8222-222222222222'
    const deviceId = '33333333-3333-4333-8333-333333333333'
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string, _parameters?: unknown[]) => {
        queries.push(sql)
        if (sql.includes('FROM device_registration_code')) {
          return { rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] }
        }
        if (sql.includes('SELECT tenant_id FROM store')) {
          return { rows: [{ tenant_id: tenantId }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new DeviceService(
      { connect: vi.fn(async () => client) } as unknown as Pool,
      config
    )

    await service.enroll(
      {
        environment: 'test',
        tenantId,
        storeId,
        deviceId,
        storeName: 'Test Store',
        deviceName: 'First Cashier'
      },
      '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    )

    expect(
      queries.some((sql) => sql.includes('consumed_by_device_id = $2'))
    ).toBe(true)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('creates a short-lived pairing code only after an active manager has a cloud epoch', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM cloud_employee employee')) {
        return {
          rows: [{
            role: 'manager',
            status: 'active',
            store_name: 'Shared Store',
            epoch_id: '55555555-5555-4555-8555-555555555555'
          }]
        }
      }
      return { rows: [] }
    })
    const service = new DeviceService({ query } as unknown as Pool, config)
    const result = await service.createPairingCode(
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        storeId: '22222222-2222-4222-8222-222222222222',
        deviceId: '33333333-3333-4333-8333-333333333333',
        deviceName: 'Primary Cashier'
      },
      { actorId: '44444444-4444-4444-8444-444444444444' }
    )
    expect(result.code).toMatch(/^[23456789A-HJ-NP-Z]{4}(?:-[23456789A-HJ-NP-Z]{4}){3}$/)
    expect(result.storeName).toBe('Shared Store')
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO device_pairing_code'))).toBe(true)
    expect(query.mock.calls.flat().join(' ')).not.toContain(result.code)
  })

  it('consumes a pairing code while enrolling an independent device into the existing store', async () => {
    const createdAt = new Date('2026-06-30T08:00:00.000Z')
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string, _parameters?: unknown[]) => {
        queries.push(sql)
        if (sql.includes('FROM device_pairing_code pairing')) {
          return { rows: [{
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            tenant_id: '11111111-1111-4111-8111-111111111111',
            store_id: '22222222-2222-4222-8222-222222222222',
            store_name: 'Shared Store',
            employee_id: '44444444-4444-4444-8444-444444444444',
            username: 'manager',
            display_name: 'Manager',
            employee_status: 'active',
            employee_created_at: createdAt,
            employee_updated_at: createdAt,
            epoch_id: '55555555-5555-4555-8555-555555555555',
            consumed_at: null
          }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new DeviceService({ connect: vi.fn(async () => client) } as unknown as Pool, config)
    const result = await service.enrollPaired({
      environment: 'test',
      pairingCode: '2345-6789-ABCD-EFGH',
      deviceId: '66666666-6666-4666-8666-666666666666',
      deviceName: 'Second Cashier',
      requestId: 'onboarding-request-1'
    })
    expect(result).toMatchObject({
      storeId: '22222222-2222-4222-8222-222222222222',
      deviceId: '66666666-6666-4666-8666-666666666666',
      epochId: '55555555-5555-4555-8555-555555555555',
      manager: { id: '44444444-4444-4444-8444-444444444444' }
    })
    expect(queries.some((sql) => sql.includes('consumed_by_device_id'))).toBe(true)
    expect(client.query.mock.calls.some(([sql, parameters]) =>
      String(sql).includes('enrollment_request_id') &&
      Array.isArray(parameters) && parameters.includes('onboarding-request-1')
    )).toBe(true)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('activates only the tenant and store bound to a merchant-authorized code', async () => {
    const createdAt = new Date('2026-07-01T00:00:00.000Z')
    const queries: Array<{ sql: string; parameters: unknown[] | undefined }> = []
    const client = {
      query: vi.fn(async (sql: string, parameters?: unknown[]) => {
        queries.push({ sql, parameters })
        if (sql.includes('FROM device_registration_code registration')) {
          return {
            rows: [{
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              tenant_id: '11111111-1111-4111-8111-111111111111',
              store_id: '55555555-5555-4555-8555-555555555555',
              store_name: 'Second Store',
              employee_id: '44444444-4444-4444-8444-444444444444',
              username: 'manager',
              display_name: 'Manager',
              employee_created_at: createdAt,
              employee_updated_at: createdAt,
              epoch_id: '77777777-7777-4777-8777-777777777777'
            }]
          }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new DeviceService(
      { connect: vi.fn(async () => client) } as unknown as Pool,
      config
    )
    const result = await service.enrollAuthorizedStore({
      environment: 'test',
      activationCode: '2345-6789-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
      deviceId: '66666666-6666-4666-8666-666666666666',
      deviceName: 'Second Store Cashier',
      requestId: 'activate-store-request-1'
    })

    expect(result).toMatchObject({
      tenantId: '11111111-1111-4111-8111-111111111111',
      storeId: '55555555-5555-4555-8555-555555555555',
      storeName: 'Second Store',
      deviceId: '66666666-6666-4666-8666-666666666666'
    })
    expect(queries.some(({ sql }) =>
      sql.includes("registration.action = 'activate_store'")
    )).toBe(true)
    expect(queries.some(({ sql, parameters }) =>
      sql.includes('INSERT INTO device') &&
      parameters?.includes('55555555-5555-4555-8555-555555555555')
    )).toBe(true)
    expect(queries.some(({ sql }) =>
      sql.includes('enrollment_request_id = COALESCE')
    )).toBe(true)
  })

  it('casts the device UUID when reusing it as a text audit aggregate id', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111'
    const storeId = '22222222-2222-4222-8222-222222222222'
    const deviceId = '33333333-3333-4333-8333-333333333333'
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql.includes('SELECT tenant_id FROM store')) {
          return { rows: [{ tenant_id: tenantId }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const pool = {
      connect: vi.fn(async () => client)
    } as unknown as Pool
    const service = new DeviceService(pool, {
      ...config
    })

    await service.enroll(
      {
        environment: 'test',
        tenantId,
        storeId,
        deviceId,
        storeName: 'Test Store',
        deviceName: 'Test Device'
      },
      'enrollment-secret'
    )

    const auditSql = queries.find((sql) =>
      sql.includes('INSERT INTO cloud_audit_log')
    )
    expect(auditSql).toContain('$4::uuid::text')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rejects enrollment for a different deployment environment', async () => {
    const pool = { connect: vi.fn() } as unknown as Pool
    const service = new DeviceService(pool, {
      ...config
    })

    await expect(
      service.enroll({ environment: 'production' }, 'enrollment-secret')
    ).rejects.toThrow('server is test')
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('lets an active manager designate the current device for offline finance', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT access.role, access.status')) {
        return { rows: [{ role: 'manager', status: 'active' }] }
      }
      if (sql.includes('FROM cloud_offline_writer_lease lease')) {
        return {
          rows: [
            {
              device_id: '33333333-3333-4333-8333-333333333333',
              device_name: 'Primary Cashier',
              lease_version: 4,
              expires_at: expiresAt
            }
          ]
        }
      }
      return { rows: [] }
    })
    const service = new DeviceService({ query } as unknown as Pool, {
      ...config
    })
    await expect(
      service.claimOfflineFinancialLease(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          storeId: '22222222-2222-4222-8222-222222222222',
          deviceId: '33333333-3333-4333-8333-333333333333',
          deviceName: 'Primary Cashier'
        },
        { actorId: '44444444-4444-4444-8444-444444444444' }
      )
    ).resolves.toMatchObject({
      ownerDeviceName: 'Primary Cashier',
      leaseVersion: 4,
      currentDeviceOwnsLease: true
    })
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INTERVAL '24 hours'")
      )
    ).toBe(true)
  })
})
