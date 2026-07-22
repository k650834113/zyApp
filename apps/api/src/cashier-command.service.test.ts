import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappPrincipal } from './miniapp-auth'
import { CashierCommandService } from './cashier-command.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

const employeeId = '44444444-4444-4444-8444-444444444444'
const commandId = '55555555-5555-4555-8555-555555555555'
const itemId = '66666666-6666-4666-8666-666666666666'

function principal(): MiniappPrincipal {
  return {
    identityId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    storeId: '33333333-3333-4333-8333-333333333333',
    provider: 'development',
    providerSubject: 'staff-user',
    memberId: null,
    memberStatus: null,
    employeeId,
    employeeStatus: 'active',
    employeeRole: 'staff',
    identity: {
      role: 'staff',
      employeeId,
      displayName: 'Staff',
      permissions: ['order.create']
    }
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: commandId,
    request_id: 'mobile-order-1',
    request_hash: 'hash',
    status: 'pending',
    requested_by: employeeId,
    command_json: {
      requestId: 'mobile-order-1',
      paymentMethod: 'cash',
      lines: [
        {
          catalogItemId: itemId,
          quantity: 1,
          pricingTier: 'regular'
        }
      ]
    },
    claimed_by_device: null,
    lease_expires_at: null,
    local_order_id: null,
    result_json: null,
    error_message: null,
    expires_at: '2026-06-14T08:10:00.000Z',
    created_at: '2026-06-14T08:00:00.000Z',
    completed_at: null,
    ...overrides
  }
}

describe('cashier command service', () => {
  it('creates a validated employee command and keeps pricing execution on PC', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('FROM cloud_catalog_item')) {
        return { rows: [{ id: itemId }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO cashier_command')) {
        return {
          rows: [
            row({
              id: parameters[0],
              request_hash: parameters[5],
              command_json: JSON.parse(String(parameters[6]))
            })
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new CashierCommandService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const created = await service.create(principal(), {
      requestId: 'mobile-order-1',
      paymentMethod: 'cash',
      lines: [
        {
          catalogItemId: itemId,
          quantity: 1,
          pricingTier: 'regular'
        }
      ]
    })

    expect(created).toMatchObject({
      requestId: 'mobile-order-1',
      status: 'pending',
      requestedBy: employeeId
    })
    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO cashier_command')
    )
    expect(insert?.parameters[6]).toContain('"paymentMethod":"cash"')
    expect(insert?.parameters[6]).not.toContain('totalFen')
  })

  it('claims atomically and replaces the client request id with the command id', async () => {
    const deviceId = '77777777-7777-4777-8777-777777777777'
    const query = async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        return { rows: [row()], rowCount: 1 }
      }
      if (
        sql.includes("SET status = 'claimed'") &&
        sql.includes('RETURNING *')
      ) {
        return {
          rows: [
            row({
              status: 'claimed',
              claimed_by_device: parameters[1],
              lease_expires_at: '2026-06-14T08:00:45.000Z'
            })
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new CashierCommandService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const claimed = await service.claim({
      tenantId: principal().tenantId,
      storeId: principal().storeId,
      deviceId,
      deviceName: 'Cashier'
    })

    expect(claimed).toMatchObject({
      commandId,
      requestedBy: employeeId,
      request: { requestId: commandId }
    })
  })

  it('accepts a delayed completion after command expiry when PC already executed', async () => {
    const deviceId = '77777777-7777-4777-8777-777777777777'
    const orderId = '88888888-8888-4888-8888-888888888888'
    const result = {
      id: orderId,
      orderNumber: 'O20260614-12345678',
      visitBatchId: '99999999-9999-4999-8999-999999999999',
      customerMemberId: null,
      paymentMethod: 'cash' as const,
      walletMemberId: null,
      status: 'completed' as const,
      totalFen: 4000,
      note: null,
      completedAt: '2026-06-14T08:00:10.000Z',
      items: []
    }
    const query = async (sql: string) => {
      if (sql.includes('SELECT * FROM cashier_command')) {
        return {
          rows: [
            row({
              status: 'expired',
              claimed_by_device: deviceId
            })
          ],
          rowCount: 1
        }
      }
      if (sql.includes('UPDATE cashier_command') && sql.includes('RETURNING *')) {
        return {
          rows: [
            row({
              status: 'completed',
              local_order_id: orderId,
              result_json: result,
              completed_at: '2026-06-14T08:00:15.000Z'
            })
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new CashierCommandService({
      connect: async () => client,
      query
    } as unknown as Pool)

    await expect(
      service.complete(
        {
          tenantId: principal().tenantId,
          storeId: principal().storeId,
          deviceId,
          deviceName: 'Cashier'
        },
        commandId,
        { localOrderId: orderId, result }
      )
    ).resolves.toMatchObject({
      status: 'completed',
      localOrderId: orderId
    })
  })
})
