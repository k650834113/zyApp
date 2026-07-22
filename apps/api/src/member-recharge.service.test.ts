import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappPrincipal } from './miniapp-auth'
import { MemberRechargeService } from './member-recharge.service'
import { MockWechatPaymentProvider } from './wechat-payment-provider'

type QueryCall = { sql: string; parameters: unknown[] }

function principal(): MiniappPrincipal {
  return {
    identityId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    storeId: '33333333-3333-4333-8333-333333333333',
    provider: 'development',
    providerSubject: 'member-openid',
    memberId: '44444444-4444-4444-8444-444444444444',
    memberStatus: 'active',
    employeeId: null,
    employeeStatus: null,
    employeeRole: null,
    identity: {
      role: 'member',
      memberId: '44444444-4444-4444-8444-444444444444',
      nickname: 'Member',
      phoneMasked: '138****8000',
      tier: 'ordinary'
    }
  }
}

function fakePool(
  handler: (sql: string, parameters: unknown[], calls: QueryCall[]) => unknown[]
): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  const query = async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters })
    const rows = handler(sql, parameters, calls)
    return { rows, rowCount: rows.length }
  }
  return {
    pool: {
      connect: async () => ({ query, release() {} }),
      query
    } as unknown as Pool,
    calls
  }
}

function orderRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tenant_id: principal().tenantId,
    store_id: principal().storeId,
    member_id: principal().memberId,
    identity_id: principal().identityId,
    request_id: 'recharge-request-1',
    request_hash: 'request-hash',
    out_trade_no: '55555555555545558555555555555555',
    provider_mode: 'mock',
    principal_fen: 130_000,
    gift_fen: 22_000,
    gift_rule_snapshot_json: { tiers: [] },
    client_payment_json: { package: 'prepay_id=mock' },
    status: 'pending_payment',
    error_message: null,
    expires_at: new Date(Date.now() + 60_000),
    settled_at: null,
    created_at: new Date('2026-06-14T00:00:00.000Z'),
    ...overrides
  }
}

describe('member WeChat recharge orders', () => {
  it('freezes the maximum gift calculation into a pending payment order', async () => {
    const { pool, calls } = fakePool((sql, parameters) => {
      if (
        sql.includes('FROM wechat_recharge_order') &&
        !sql.includes('FOR UPDATE')
      ) {
        return []
      }
      if (sql.includes('SELECT status, age_gate_status')) {
        return [
          {
            status: 'active',
            age_gate_status: 'confirmed_at_least_14'
          }
        ]
      }
      if (sql.includes('FROM cloud_recharge_gift_tier')) {
        return [
          { id: 'tier-300', principal_fen: 30_000, gift_fen: 2_000 },
          { id: 'tier-500', principal_fen: 50_000, gift_fen: 5_000 },
          { id: 'tier-1000', principal_fen: 100_000, gift_fen: 20_000 }
        ]
      }
      if (sql.includes('INSERT INTO wechat_recharge_order')) {
        return [{ id: parameters[0] }]
      }
      if (
        sql.includes('UPDATE wechat_recharge_order') &&
        sql.includes("status = 'pending_payment'")
      ) {
        return [
          orderRow({
            id: parameters[0],
            request_hash: 'ignored',
            client_payment_json: JSON.parse(String(parameters[3]))
          })
        ]
      }
      return []
    })
    const service = new MemberRechargeService(
      pool,
      new MockWechatPaymentProvider()
    )

    const order = await service.createOrder(principal(), {
      requestId: 'recharge-request-1',
      principalFen: 130_000
    })

    expect(order).toMatchObject({
      status: 'pending_payment',
      principalFen: 130_000,
      giftFen: 22_000,
      totalCreditFen: 152_000,
      providerMode: 'mock'
    })
    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO wechat_recharge_order')
    )
    expect(insert?.parameters[9]).toBe(22_000)
    expect(String(insert?.parameters[10])).toContain('"gift":22000')
    const memberLock = calls.find((call) =>
      call.sql.includes('SELECT status, age_gate_status')
    )
    expect(memberLock?.parameters).toEqual([
      principal().tenantId,
      principal().memberId
    ])
  })

  it('blocks order creation for a recharge-disabled member', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('FROM wechat_recharge_order')) return []
      if (sql.includes('SELECT status, age_gate_status')) {
        return [{ status: 'active', age_gate_status: 'recharge_disabled' }]
      }
      return []
    })
    const service = new MemberRechargeService(
      pool,
      new MockWechatPaymentProvider()
    )

    await expect(
      service.createOrder(principal(), {
        requestId: 'recharge-request-disabled',
        principalFen: 30_000
      })
    ).rejects.toThrow('暂不能储值')
  })

  it('returns the concurrent idempotent order without creating a second provider payment', async () => {
    let reservedHash = ''
    const { pool, calls } = fakePool((sql, parameters) => {
      if (
        sql.includes('FROM wechat_recharge_order') &&
        !sql.includes('FOR UPDATE')
      ) {
        return []
      }
      if (sql.includes('SELECT status, age_gate_status')) {
        return [
          {
            status: 'active',
            age_gate_status: 'confirmed_at_least_14'
          }
        ]
      }
      if (sql.includes('FROM cloud_recharge_gift_tier')) return []
      if (sql.includes('INSERT INTO wechat_recharge_order')) {
        reservedHash = String(parameters[6])
        return []
      }
      if (
        sql.includes('FROM wechat_recharge_order') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          orderRow({
            request_hash: reservedHash,
            principal_fen: 10_000,
            gift_fen: 0,
            status: 'creating',
            client_payment_json: null
          })
        ]
      }
      return []
    })
    const service = new MemberRechargeService(
      pool,
      new MockWechatPaymentProvider()
    )

    const order = await service.createOrder(principal(), {
      requestId: 'recharge-request-1',
      principalFen: 10_000
    })

    expect(order.status).toBe('creating')
    expect(
      calls.some(
        (call) =>
          call.sql.includes('UPDATE wechat_recharge_order') &&
          call.sql.includes("status = 'pending_payment'")
      )
    ).toBe(false)
  })

  it('settles one callback into one ledger event and reuses the result', async () => {
    let settled = false
    let callbackReserved = false
    let cloudEventWrites = 0
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('INSERT INTO payment_callback_inbox')) {
        if (callbackReserved) return []
        callbackReserved = true
        return [{ event_id: 'reserved' }]
      }
      if (sql.includes('SELECT payload_hash')) {
        return [
          {
            payload_hash:
              calls.find((call) =>
                call.sql.includes('INSERT INTO payment_callback_inbox')
              )?.parameters[2]
          }
        ]
      }
      if (
        sql.includes('FROM wechat_recharge_order') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          orderRow(
            settled
              ? {
                  status: 'settled',
                  settled_at: '2026-06-14T01:00:00.000Z'
                }
              : {}
          )
        ]
      }
      if (sql.includes('SELECT id FROM cloud_member')) {
        return [{ id: principal().memberId }]
      }
      if (sql.includes('FROM cloud_wallet_account')) {
        return [
          {
            id: '66666666-6666-4666-8666-666666666666',
            status: 'active',
            principal_balance_fen: 20_000,
            gift_balance_fen: 1_000
          }
        ]
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        cloudEventWrites += 1
        return [{ sequence: 91 }]
      }
      if (
        sql.includes('UPDATE wechat_recharge_order') &&
        sql.includes("status = 'settled'")
      ) {
        settled = true
        return [
          orderRow({
            status: 'settled',
            settled_at: '2026-06-14T01:00:00.000Z'
          })
        ]
      }
      return []
    })
    const service = new MemberRechargeService(
      pool,
      new MockWechatPaymentProvider()
    )

    const first = await service.settleMockOrder(
      principal(),
      '55555555-5555-4555-8555-555555555555'
    )
    const second = await service.settleMockOrder(
      principal(),
      '55555555-5555-4555-8555-555555555555'
    )

    expect(first.status).toBe('settled')
    expect(second.status).toBe('settled')
    expect(cloudEventWrites).toBe(1)
    expect(
      calls.filter((call) =>
        call.sql.includes('INSERT INTO cloud_wallet_ledger')
      )
    ).toHaveLength(1)
    expect(
      calls.filter((call) =>
        call.sql.includes('INSERT INTO cloud_membership_grant')
      )
    ).toHaveLength(1)
    const accountWrite = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_wallet_account')
    )
    expect(accountWrite?.parameters[4]).toBe(150_000)
    expect(accountWrite?.parameters[5]).toBe(23_000)
    const memberLock = calls.find((call) =>
      call.sql.includes('SELECT id FROM cloud_member')
    )
    expect(memberLock?.parameters).toEqual([
      principal().tenantId,
      principal().memberId
    ])
  })

  it('persists expiry without writing a wallet ledger', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('INSERT INTO payment_callback_inbox')) {
        return [{ event_id: 'reserved' }]
      }
      if (
        sql.includes('FROM wechat_recharge_order') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          orderRow({
            expires_at: '2026-06-01T00:00:00.000Z'
          })
        ]
      }
      if (
        sql.includes('UPDATE wechat_recharge_order') &&
        sql.includes("status = 'expired'")
      ) {
        return [
          orderRow({
            status: 'expired',
            expires_at: '2026-06-01T00:00:00.000Z'
          })
        ]
      }
      return []
    })
    const service = new MemberRechargeService(
      pool,
      new MockWechatPaymentProvider()
    )

    const order = await service.settleMockOrder(
      principal(),
      '55555555-5555-4555-8555-555555555555'
    )

    expect(order.status).toBe('expired')
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(1)
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_wallet_ledger'))
    ).toBe(false)
  })
})
