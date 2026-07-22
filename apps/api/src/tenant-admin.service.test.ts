import { describe, expect, it, vi } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import { TenantAdminService } from './tenant-admin.service'

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
  miniappDevelopmentAuthEnabled: false
}

const principal = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
  deviceName: 'Primary Cashier'
}
const actorId = '44444444-4444-4444-8444-444444444444'

function administratorRow() {
  return {
    administrator_status: 'active',
    employee_status: 'active',
    role: 'manager',
    access_status: 'active'
  }
}

describe('tenant store administration', () => {
  it('creates a store in the existing tenant and stores only the activation-code hash', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters })
        if (sql.includes('FROM tenant_administrator')) {
          return { rows: [administratorRow()] }
        }
        if (sql.includes('INSERT INTO api_idempotency')) {
          return { rows: [{ key: 'reserved' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new TenantAdminService(
      { connect: vi.fn(async () => client) } as unknown as Pool,
      config
    )
    const result = await service.createStore(principal, actorId, {
      requestId: 'create-store-request-1',
      storeName: 'Second Store'
    })

    expect(result.store).toMatchObject({ name: 'Second Store', currentStore: false })
    expect(result.activationCode.replaceAll('-', '')).toMatch(/^[23456789A-HJ-NP-Z]{32}$/)
    expect(calls.some((call) => call.sql.includes('INSERT INTO store'))).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO cloud_employee_store_access'))).toBe(true)
    expect(calls.some((call) => call.sql.includes('INSERT INTO cloud_mirror_epoch'))).toBe(true)
    const registration = calls.find((call) =>
      call.sql.includes('INSERT INTO device_registration_code')
    )
    expect(registration).toBeDefined()
    expect(JSON.stringify(registration?.parameters)).not.toContain(result.activationCode)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('grants the same employee a different role in another store and versions the authorization', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tenant_administrator')) {
          return { rows: [administratorRow()] }
        }
        if (sql.includes('INSERT INTO api_idempotency')) {
          return { rows: [{ key: 'reserved' }] }
        }
        if (sql.includes('SELECT employee.username')) {
          return {
            rows: [{
              username: 'shared-manager',
              display_name: 'Shared Manager',
              created_at: new Date('2026-07-01T00:00:00.000Z'),
              identity_status: 'active',
              store_name: 'Second Store',
              previous_version: '5'
            }]
          }
        }
        if (sql.includes('SELECT COUNT(*) count')) return { rows: [{ count: 1 }] }
        if (sql.includes('INSERT INTO cloud_event')) return { rows: [{ sequence: 18 }] }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new TenantAdminService(
      { connect: vi.fn(async () => client) } as unknown as Pool,
      config
    )
    const result = await service.setEmployeeAccess(principal, actorId, {
      requestId: 'set-access-request-1',
      employeeId: actorId,
      storeId: '55555555-5555-4555-8555-555555555555',
      role: 'staff',
      status: 'active',
      reason: '跨店支援'
    })

    expect(result).toMatchObject({
      employeeId: actorId,
      storeName: 'Second Store',
      role: 'staff',
      status: 'active',
      authorizationVersion: 6
    })
    expect(client.query.mock.calls.some(([sql]) =>
      String(sql).includes('employee.authorization.updated')
    )).toBe(true)
  })

  it('does not allow removing the last active manager from a store', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM tenant_administrator')) return { rows: [administratorRow()] }
        if (sql.includes('INSERT INTO api_idempotency')) return { rows: [{ key: 'reserved' }] }
        if (sql.includes('SELECT employee.username')) {
          return {
            rows: [{
              username: 'manager',
              display_name: 'Manager',
              created_at: new Date(),
              identity_status: 'active',
              store_name: 'Only Store',
              previous_version: '1'
            }]
          }
        }
        if (sql.includes('SELECT COUNT(*) count')) return { rows: [{ count: 0 }] }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new TenantAdminService(
      { connect: vi.fn(async () => client) } as unknown as Pool,
      config
    )
    await expect(service.setEmployeeAccess(principal, actorId, {
      requestId: 'disable-last-manager',
      employeeId: actorId,
      storeId: principal.storeId,
      role: 'staff',
      status: 'active',
      reason: '角色调整'
    })).rejects.toThrow('至少保留一名有效店长')
  })

  it('rejects a store manager who is not a tenant administrator', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] }))
    } as unknown as Pool
    const service = new TenantAdminService(pool, config)
    await expect(service.listStores(principal, actorId)).rejects.toThrow(
      '商户管理员权限'
    )
  })
})
