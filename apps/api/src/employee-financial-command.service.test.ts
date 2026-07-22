import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappPrincipal } from './miniapp-auth'
import { EmployeeFinancialCommandService } from './employee-financial-command.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

const employeeId = '44444444-4444-4444-8444-444444444444'
const commandId = '55555555-5555-4555-8555-555555555555'
const memberId = '66666666-6666-4666-8666-666666666666'
const activityId = '99999999-9999-4999-8999-999999999999'

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
      permissions: ['wallet.recharge.cash', 'monthly-card.manage']
    }
  }
}

function managerPrincipal(): MiniappPrincipal {
  return {
    ...principal(),
    employeeRole: 'manager',
    identity: {
      role: 'manager',
      employeeId,
      displayName: 'Manager',
      permissions: ['activity.manage']
    }
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: commandId,
    request_id: 'mobile-finance-1',
    request_hash: 'hash',
    command_type: 'cash_recharge',
    status: 'pending',
    requested_by: employeeId,
    command_json: {
      requestId: 'mobile-finance-1',
      type: 'cash_recharge',
      memberId,
      principalFen: 50_000,
      reason: 'Mobile cash recharge'
    },
    claimed_by_device: null,
    lease_expires_at: null,
    result_json: null,
    error_message: null,
    expires_at: '2026-06-14T08:10:00.000Z',
    created_at: '2026-06-14T08:00:00.000Z',
    completed_at: null,
    ...overrides
  }
}

describe('employee financial command service', () => {
  it('creates a validated command without calculating gift value in cloud', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('FROM cloud_member')) {
        return {
          rows: [{ age_gate_status: 'confirmed_adult' }],
          rowCount: 1
        }
      }
      if (sql.includes('INSERT INTO employee_financial_command')) {
        return {
          rows: [
            row({
              id: parameters[0],
              request_hash: parameters[5],
              command_json: JSON.parse(String(parameters[7]))
            })
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeFinancialCommandService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const created = await service.create(principal(), {
      requestId: 'mobile-finance-1',
      type: 'cash_recharge',
      memberId,
      principalFen: 50_000,
      reason: 'Mobile cash recharge'
    })

    expect(created).toMatchObject({
      type: 'cash_recharge',
      status: 'pending',
      requestedBy: employeeId
    })
    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO employee_financial_command')
    )
    expect(insert?.parameters[7]).toContain('"principalFen":50000')
    expect(insert?.parameters[7]).not.toContain('giftFen')
  })

  it('lets a manager submit a recharge activity reference without copying tiers into the command', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('FROM cloud_activity_campaign')) {
        return { rows: [{ id: activityId }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO employee_financial_command')) {
        return {
          rows: [
            row({
              id: parameters[0],
              request_id: parameters[4],
              request_hash: parameters[5],
              command_type: parameters[6],
              command_json: JSON.parse(String(parameters[7]))
            })
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeFinancialCommandService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const created = await service.create(managerPrincipal(), {
      requestId: 'activity-tiers-1',
      type: 'apply_activity_recharge_tiers',
      activityId,
      reason: 'Apply approved holiday tiers'
    })

    expect(created).toMatchObject({
      type: 'apply_activity_recharge_tiers',
      status: 'pending',
      requestedBy: employeeId
    })
    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO employee_financial_command')
    )
    expect(JSON.parse(String(insert?.parameters[7]))).toEqual({
      requestId: 'activity-tiers-1',
      type: 'apply_activity_recharge_tiers',
      activityId,
      reason: 'Apply approved holiday tiers'
    })
    expect(String(insert?.parameters[7])).not.toContain('principalFen')
    expect(
      calls.find((call) => call.sql.includes('FROM cloud_activity_campaign'))
        ?.parameters
    ).toEqual([
      activityId,
      managerPrincipal().tenantId,
      managerPrincipal().storeId
    ])
  })

  it('does not let a staff account apply recharge activity tiers', async () => {
    const query = async () => ({ rows: [], rowCount: 0 })
    const service = new EmployeeFinancialCommandService({
      connect: async () => ({ query, release() {} }),
      query
    } as unknown as Pool)

    await expect(
      service.create(principal(), {
        requestId: 'activity-tiers-2',
        type: 'apply_activity_recharge_tiers',
        activityId,
        reason: 'Staff should not apply this'
      })
    ).rejects.toThrow('当前身份没有此财务操作权限')
  })

  it('claims atomically and replaces the external request id with command id', async () => {
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
    const service = new EmployeeFinancialCommandService({
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
      request: { requestId: commandId, type: 'cash_recharge' }
    })
  })

  it('accepts delayed completion after command expiry when PC already executed', async () => {
    const deviceId = '77777777-7777-4777-8777-777777777777'
    const operationId = '88888888-8888-4888-8888-888888888888'
    const result = {
      type: 'cash_recharge' as const,
      wallet: {
        operationId,
        wallet: {
          memberId,
          principalBalanceFen: 50_000,
          giftBalanceFen: 5_000,
          totalBalanceFen: 55_000,
          updatedAt: '2026-06-14T08:00:10.000Z'
        },
        principalDeltaFen: 50_000,
        giftDeltaFen: 5_000
      }
    }
    const query = async (sql: string) => {
      if (sql.includes('SELECT * FROM employee_financial_command')) {
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
      if (
        sql.includes('UPDATE employee_financial_command') &&
        sql.includes('RETURNING *')
      ) {
        return {
          rows: [
            row({
              status: 'completed',
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
    const service = new EmployeeFinancialCommandService({
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
        { result }
      )
    ).resolves.toMatchObject({
      status: 'completed',
      result: { type: 'cash_recharge' }
    })
  })
})
