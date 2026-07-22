import { describe, expect, it } from 'vitest'
import { hashPassword } from '@zyapp/auth'
import type { Pool } from '@zyapp/cloud-db'
import type Redis from 'ioredis'
import type { DevicePrincipal } from './device-auth'
import { DesktopAuthService } from './desktop-auth.service'

function principal(): DevicePrincipal {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    storeId: '22222222-2222-4222-8222-222222222222',
    deviceId: '33333333-3333-4333-8333-333333333333',
    deviceName: 'Cashier'
  }
}

function redis(): Redis {
  return {
    incr: async () => 1,
    expire: async () => 1,
    del: async () => 1
  } as unknown as Redis
}

describe('desktop cloud authentication', () => {
  it('returns a 30-day device-bound authorization without exposing password material', async () => {
    const password = 'DesktopPass123'
    const passwordHash = await hashPassword(password)
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const pool = {
      query: async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters })
        if (sql.includes('FROM cloud_employee employee')) {
          return {
            rows: [{
              id: '44444444-4444-4444-8444-444444444444',
              username: 'manager',
              display_name: 'Manager',
              role: 'manager',
              identity_status: 'active',
              access_status: 'active',
              authorization_version: '9',
              password_hash: passwordHash,
              credential_version: '3',
              tenant_status: 'active',
              store_status: 'active'
            }]
          }
        }
        return { rows: [] }
      }
    } as unknown as Pool
    const service = new DesktopAuthService(pool, redis())
    const result = await service.login(principal(), {
      username: 'MANAGER',
      password
    })
    expect(result).toMatchObject({
      tenantId: principal().tenantId,
      storeId: principal().storeId,
      deviceId: principal().deviceId,
      credentialVersion: 3,
      authorizationVersion: 9,
      employee: { username: 'manager', role: 'manager' }
    })
    expect(
      Date.parse(result.offlineValidUntil) - Date.parse(result.serverTime)
    ).toBe(30 * 24 * 60 * 60 * 1000)
    expect(JSON.stringify(result)).not.toContain(password)
    expect(JSON.stringify(calls.map((call) => call.parameters))).not.toContain(password)
    expect(calls.some((call) =>
      call.sql.includes('JOIN cloud_employee_store_access access') &&
      call.parameters[1] === principal().storeId
    )).toBe(true)
  })

  it('rejects a valid tenant credential when this store authorization is disabled', async () => {
    const password = 'DesktopPass123'
    const passwordHash = await hashPassword(password)
    const pool = {
      query: async (sql: string) => sql.includes('FROM cloud_employee employee')
        ? {
            rows: [{
              id: '44444444-4444-4444-8444-444444444444',
              username: 'manager',
              display_name: 'Manager',
              role: 'staff',
              identity_status: 'active',
              access_status: 'disabled',
              authorization_version: '4',
              password_hash: passwordHash,
              credential_version: '3',
              tenant_status: 'active',
              store_status: 'active'
            }]
          }
        : { rows: [] }
    } as unknown as Pool
    const service = new DesktopAuthService(pool, redis())
    await expect(service.login(principal(), {
      username: 'manager',
      password
    })).rejects.toThrow('账号或密码错误')
  })

  it('rejects invalid credentials instead of issuing an offline authorization', async () => {
    const pool = {
      query: async (sql: string) => sql.includes('FROM cloud_employee employee')
        ? { rows: [] }
        : { rows: [] }
    } as unknown as Pool
    const service = new DesktopAuthService(pool, redis())
    await expect(service.login(principal(), {
      username: 'manager',
      password: 'WrongPass123'
    })).rejects.toThrow('员工账号或密码错误')
  })
})
