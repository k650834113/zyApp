import { describe, expect, it } from 'vitest'
import { hashPassword } from '@zyapp/auth'
import type { Pool } from '@zyapp/cloud-db'
import type Redis from 'ioredis'
import type { MiniappPrincipal } from './miniapp-auth'
import { EmployeeMobileService } from './employee-mobile.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

function principal(): MiniappPrincipal {
  return {
    identityId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    storeId: '33333333-3333-4333-8333-333333333333',
    provider: 'development',
    providerSubject: 'test-user',
    memberId: null,
    memberStatus: null,
    employeeId: null,
    employeeStatus: null,
    employeeRole: null,
    identity: { role: 'guest' }
  }
}

function staffPrincipal(): MiniappPrincipal {
  return {
    ...principal(),
    employeeId: '44444444-4444-4444-8444-444444444444',
    employeeStatus: 'active',
    employeeRole: 'staff',
    identity: {
      role: 'staff',
      employeeId: '44444444-4444-4444-8444-444444444444',
      displayName: 'Staff',
      permissions: [
        'member.profile.read',
        'member.profile.write'
      ]
    }
  }
}

function fakeRedis(): Redis {
  return {
    incr: async () => 1,
    expire: async () => 1,
    del: async () => 1
  } as unknown as Redis
}

describe('employee mobile authentication', () => {
  it('binds an enabled employee without storing or logging the plaintext password', async () => {
    const password = 'MobilePass123'
    const passwordHash = await hashPassword(password)
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('FROM cloud_employee e')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              display_name: 'Manager',
              role: 'manager',
              status: 'active',
              enabled: true,
              password_hash: passwordHash
            }
          ],
          rowCount: 1
        }
      }
      if (sql.includes('UPDATE miniapp_identity')) {
        return {
          rows: [{ id: principal().identityId }],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const pool = {
      query,
      connect: async () => client
    } as unknown as Pool
    const service = new EmployeeMobileService(pool, fakeRedis())

    const identity = await service.login(principal(), {
      username: ' MANAGER ',
      password
    })

    expect(identity).toMatchObject({
      role: 'manager',
      displayName: 'Manager'
    })
    expect(
      calls.some((call) => call.sql.includes('UPDATE miniapp_identity'))
    ).toBe(true)
    expect(JSON.stringify(calls)).not.toContain(password)
  })

  it('rejects disabled mobile credentials without binding the identity', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('FROM cloud_employee e')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              display_name: 'Manager',
              role: 'manager',
              status: 'active',
              enabled: false,
              password_hash: null
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const pool = {
      query,
      connect: async () => {
        throw new Error('transaction must not start')
      }
    } as unknown as Pool
    const service = new EmployeeMobileService(pool, fakeRedis())

    await expect(
      service.login(principal(), {
        username: 'manager',
        password: 'MobilePass123'
      })
    ).rejects.toThrow('员工账号或移动端密码不正确')
    expect(
      calls.some((call) => call.sql.includes('UPDATE miniapp_identity'))
    ).toBe(false)
  })

  it('queries only the current store and returns integer-fen member details', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      return {
        rows: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            member_number: 'M0000000001',
            phone: '13800138000',
            nickname: 'Member',
            tier: 'advanced',
            status: 'active',
            birthday_month: 6,
            birthday_day: 14,
            note: null,
            age_gate_status: 'confirmed_at_least_14',
            principal_balance_fen: '50000',
            gift_balance_fen: '5000',
            monthly_card_status: 'active',
            monthly_card_expires_at: '2026-07-14T00:00:00.000Z',
            updated_at: '2026-06-14T00:00:00.000Z'
          }
        ],
        rowCount: 1
      }
    }
    const service = new EmployeeMobileService(
      { query } as unknown as Pool,
      fakeRedis()
    )

    const members = await service.searchMembers(
      staffPrincipal(),
      '1380',
      '20'
    )

    expect(members[0]).toMatchObject({
      nickname: 'Member',
      principalBalanceFen: 50000,
      giftBalanceFen: 5000,
      totalBalanceFen: 55000,
      monthlyCardStatus: 'active'
    })
    expect(calls[0]?.parameters).toEqual([
      staffPrincipal().tenantId,
      staffPrincipal().storeId,
      '1380',
      20
    ])
  })

  it('creates a mobile employee member with idempotency, audit, and a full cloud event', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (sql.includes('SELECT id FROM cloud_member')) {
        return { rows: [], rowCount: 0 }
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return { rows: [{ sequence: 21 }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_member m')) {
        return {
          rows: [
            {
              id: parameters[2],
              member_number: 'M1234567890',
              phone: '13900139000',
              nickname: 'New Member',
              tier: 'ordinary',
              status: 'active',
              birthday_month: null,
              birthday_day: null,
              note: 'front desk',
              age_gate_status: 'confirmed_at_least_14',
              principal_balance_fen: null,
              gift_balance_fen: null,
              monthly_card_status: null,
              monthly_card_expires_at: null,
              updated_at: '2026-06-14T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeMobileService(
      {
        query,
        connect: async () => client
      } as unknown as Pool,
      fakeRedis()
    )

    const created = await service.createMember(staffPrincipal(), {
      requestId: 'employee-create-1',
      phone: '13900139000',
      nickname: 'New Member',
      note: 'front desk'
    })

    expect(created).toMatchObject({
      phone: '13900139000',
      nickname: 'New Member',
      ageGate: 'confirmed_at_least_14',
      totalBalanceFen: 0
    })
    const cloudEvent = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(JSON.parse(String(cloudEvent?.parameters[4]))).toMatchObject({
      action: 'member.created',
      after: {
        phone: '13900139000',
        nickname: 'New Member',
        ageGate: 'confirmed_at_least_14'
      }
    })
    const audit = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_audit_log')
    )
    expect(audit?.parameters[3]).toBe(staffPrincipal().employeeId)
    expect(calls.some((call) => call.sql === 'COMMIT')).toBe(true)
  })
})
