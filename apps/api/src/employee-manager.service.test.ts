import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappPrincipal } from './miniapp-auth'
import { EmployeeManagerService } from './employee-manager.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

const tenantId = '11111111-1111-4111-8111-111111111111'
const storeId = '22222222-2222-4222-8222-222222222222'
const employeeId = '33333333-3333-4333-8333-333333333333'
const activityId = '44444444-4444-4444-8444-444444444444'

function managerPrincipal(): MiniappPrincipal {
  return {
    identityId: '55555555-5555-4555-8555-555555555555',
    tenantId,
    storeId,
    provider: 'development',
    providerSubject: 'manager-user',
    memberId: null,
    memberStatus: null,
    employeeId,
    employeeStatus: 'active',
    employeeRole: 'manager',
    identity: {
      role: 'manager',
      employeeId,
      displayName: 'Manager',
      permissions: ['activity.manage', 'report.read']
    }
  }
}

function staffPrincipal(): MiniappPrincipal {
  return {
    ...managerPrincipal(),
    employeeRole: 'staff',
    identity: {
      role: 'staff',
      employeeId,
      displayName: 'Staff',
      permissions: ['activity.read']
    }
  }
}

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: activityId,
    title: 'Summer recharge',
    summary: 'Recharge gift campaign',
    content: 'Recharge during the campaign to receive a gift balance.',
    activity_type: 'recharge',
    status: 'draft',
    starts_at: '2026-06-01T00:00:00.000Z',
    ends_at: '2026-07-01T00:00:00.000Z',
    pinned: true,
    regular_price_fen: null,
    advanced_price_fen: null,
    allow_stored_value: false,
    allow_wechat: true,
    recharge_tiers_json: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        principalFen: 30000,
        giftFen: 2000
      }
    ],
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

describe('employee manager service', () => {
  it('creates a draft activity with idempotency, cloud event, and audit', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return { rows: [{ sequence: 42 }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeManagerService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const result = await service.createActivity(managerPrincipal(), {
      requestId: 'activity-create-1',
      title: 'Summer recharge',
      summary: 'Recharge gift campaign',
      content: 'Recharge during the campaign to receive a gift balance.',
      activityType: 'recharge',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-07-01T00:00:00.000Z',
      pinned: true,
      allowStoredValue: false,
      allowWechat: true,
      rechargeTiers: [{ principalFen: 30000, giftFen: 2000 }]
    })

    expect(result).toMatchObject({
      status: 'draft',
      activityType: 'recharge',
      rechargeTiers: [{ principalFen: 30000, giftFen: 2000 }]
    })
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toBe('activity.created')
    expect(event?.parameters[5]).toContain('"status":"draft"')
    const projection = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_activity_campaign')
    )
    expect(projection?.parameters[16]).toBe(42)
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_audit_log'))
    ).toBe(true)
    expect(calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('publishes an activity without changing its configured recharge tiers', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (
        sql.includes('FROM cloud_activity_campaign') &&
        sql.includes('FOR UPDATE')
      ) {
        return { rows: [activityRow()], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return { rows: [{ sequence: 43 }], rowCount: 1 }
      }
      if (sql.includes('UPDATE cloud_activity_campaign')) {
        return { rows: [{ id: activityId }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeManagerService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const result = await service.setActivityStatus(managerPrincipal(), {
      requestId: 'activity-publish-1',
      activityId,
      status: 'published',
      reason: 'Campaign approved'
    })

    expect(result.status).toBe('published')
    expect(result.rechargeTiers).toEqual([
      {
        id: '66666666-6666-4666-8666-666666666666',
        principalFen: 30000,
        giftFen: 2000
      }
    ])
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toBe('activity.published')
    expect(event?.parameters[5]).toContain('Campaign approved')
    expect(
      calls.some((call) => call.sql.includes('cloud_recharge_gift_tier'))
    ).toBe(false)
  })

  it('denies manager-only activity and report operations to staff', async () => {
    const service = new EmployeeManagerService({
      query: async () => ({ rows: [], rowCount: 0 })
    } as unknown as Pool)

    await expect(service.listActivities(staffPrincipal())).rejects.toThrow(
      '当前身份没有店长操作权限'
    )
    await expect(
      service.getBusinessReport(staffPrincipal(), {
        fromDate: '2026-06-01',
        toDate: '2026-06-14'
      })
    ).rejects.toThrow('当前身份没有店长操作权限')
  })

  it('builds a read-only cloud business report with the desktop semantics', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (
        sql.includes('FROM cloud_sales_order') &&
        !sql.includes('GROUP BY') &&
        !sql.includes('JOIN')
      ) {
        return { rows: [{ count: '3', amount_fen: '12000' }], rowCount: 1 }
      }
      if (
        sql.includes('FROM cloud_refund_request') &&
        !sql.includes('GROUP BY') &&
        !sql.includes('jsonb_array_elements')
      ) {
        return { rows: [{ count: '1', amount_fen: '2000' }], rowCount: 1 }
      }
      if (
        sql.includes('FROM cloud_sales_order') &&
        sql.includes('GROUP BY payment_method')
      ) {
        return {
          rows: [
            { payment_method: 'cash', count: '2', amount_fen: '8000' },
            {
              payment_method: 'stored_value',
              count: '1',
              amount_fen: '4000'
            }
          ],
          rowCount: 2
        }
      }
      if (
        sql.includes('FROM cloud_refund_request') &&
        sql.includes('GROUP BY payment_method')
      ) {
        return {
          rows: [
            { payment_method: 'cash', count: '1', amount_fen: '2000' }
          ],
          rowCount: 1
        }
      }
      if (sql.includes("i.item_type = 'admission'")) {
        return { rows: [{ quantity: '2' }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_wallet_ledger')) {
        return {
          rows: [
            {
              event_type: 'wallet.cash_recharged',
              count: '1',
              principal_fen: '50000',
              gift_fen: '5000',
              amount_fen: '55000'
            },
            {
              event_type: 'wallet.debited',
              count: '1',
              principal_fen: '-3000',
              gift_fen: '-1000',
              amount_fen: '4000'
            }
          ],
          rowCount: 2
        }
      }
      if (sql.includes('FROM cloud_financial_refund_request')) {
        return {
          rows: [
            {
              target_type: 'cash_recharge',
              count: '1',
              principal_fen: '10000',
              gift_fen: '2000'
            },
            {
              target_type: 'monthly_card',
              count: '1',
              principal_fen: '20000',
              gift_fen: '0'
            }
          ],
          rowCount: 2
        }
      }
      if (
        sql.includes('FROM cloud_monthly_card') &&
        sql.includes('purchased_at')
      ) {
        return { rows: [{ count: '2', amount_fen: '40000' }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_monthly_card_event')) {
        return { rows: [{ count: '4' }], rowCount: 1 }
      }
      if (
        sql.includes('FROM cloud_monthly_card') &&
        sql.includes("status IN ('active', 'paused')")
      ) {
        return { rows: [{ count: '5' }], rowCount: 1 }
      }
      if (
        sql.includes('FROM cloud_sales_order_item') &&
        sql.includes('GROUP BY i.item_name')
      ) {
        return {
          rows: [
            {
              item_name: 'Admission',
              item_type: 'admission',
              quantity: '2',
              amount_fen: '8000'
            }
          ],
          rowCount: 1
        }
      }
      if (sql.includes('jsonb_array_elements')) {
        return {
          rows: [
            {
              item_name: 'Admission',
              item_type: 'admission',
              quantity: '1',
              amount_fen: '2000'
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    }
    const service = new EmployeeManagerService({
      query
    } as unknown as Pool)

    const report = await service.getBusinessReport(managerPrincipal(), {
      fromDate: '2026-06-01',
      toDate: '2026-06-14'
    })

    expect(report.order).toMatchObject({
      orderCount: 3,
      grossSalesFen: 12000,
      refundFen: 2000,
      netSalesFen: 10000,
      admissionQuantity: 2
    })
    expect(report.wallet).toMatchObject({
      rechargePrincipalFen: 50000,
      rechargeGiftFen: 5000,
      consumptionDebitFen: 4000
    })
    expect(report.monthlyCard).toMatchObject({
      soldCount: 2,
      refundCount: 1,
      netSalesFen: 20000,
      usageCount: 4,
      activeCount: 5
    })
    expect(report.actualCashInflowFen).toBe(66000)
    expect(report.items[0]).toMatchObject({
      itemName: 'Admission',
      soldQuantity: 2,
      refundedQuantity: 1,
      netQuantity: 1,
      netSalesFen: 6000
    })
    expect(
      calls.every((call) => call.parameters[0] === tenantId)
    ).toBe(true)
  })
})
