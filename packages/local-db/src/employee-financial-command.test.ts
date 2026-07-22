import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  cashRecharge,
  createMember,
  findEmployeeFinancialCommandExecution,
  findEmployeeRecordById,
  getStoreContext,
  listPendingEmployeeFinancialCommandReports,
  markEmployeeFinancialCommandReported,
  openLocalDatabase,
  pauseMonthlyCard,
  purchaseMonthlyCard,
  recordFailedEmployeeFinancialCommand,
  resumeMonthlyCard,
  updateRechargeGiftTiers
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedStore() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-financial-command-'))
  temporaryDirectories.push(directory)
  const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
  const bootstrap = bootstrapStore(localDatabase.connection, {
    storeName: 'Test Store',
    managerUsername: 'manager',
    managerPasswordHash: 'scrypt$manager',
    managerDisplayName: 'Owner',
    deviceName: 'Cashier 01'
  })
  const store = getStoreContext(localDatabase.connection)
  if (!store) throw new Error('Missing store')
  const manager = findEmployeeRecordById(
    localDatabase.connection,
    store.tenantId,
    bootstrap.managerId
  )
  if (!manager) throw new Error('Missing manager')
  const member = createMember(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      phone: '13800138000',
      nickname: 'Mobile finance member',
      confirmedAtLeast14: true
    }
  )
  return { localDatabase, store, manager, member }
}

describe('employee financial command execution', () => {
  it('commits cash recharge and its report record in the same transaction', () => {
    const { localDatabase, store, manager, member } = initializedStore()
    const commandId = randomUUID()
    const result = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: commandId,
        memberId: member.id,
        principalFen: 50_000,
        reason: 'Mobile cash recharge',
        sourceFinancialCommand: {
          commandId,
          requestedByEmployeeId: manager.id
        }
      }
    )

    expect(result).toMatchObject({
      principalDeltaFen: 50_000,
      giftDeltaFen: 5_000
    })
    expect(
      findEmployeeFinancialCommandExecution(
        localDatabase.connection,
        store,
        commandId
      )
    ).toMatchObject({
      commandType: 'cash_recharge',
      status: 'completed',
      result: {
        type: 'cash_recharge',
        wallet: { operationId: result.operationId }
      }
    })
    expect(
      listPendingEmployeeFinancialCommandReports(
        localDatabase.connection,
        store
      )
    ).toHaveLength(1)

    markEmployeeFinancialCommandReported(
      localDatabase.connection,
      store,
      commandId
    )
    expect(
      listPendingEmployeeFinancialCommandReports(
        localDatabase.connection,
        store
      )
    ).toHaveLength(0)
    localDatabase.close()
  })

  it('records purchase, pause and resume outcomes without duplicating card events', () => {
    const { localDatabase, store, manager, member } = initializedStore()
    const purchaseCommandId = randomUUID()
    const purchased = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: purchaseCommandId,
        memberId: member.id,
        reason: 'Mobile monthly card purchase',
        sourceFinancialCommand: {
          commandId: purchaseCommandId,
          requestedByEmployeeId: manager.id
        }
      }
    )
    const repeated = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: purchaseCommandId,
        memberId: member.id,
        reason: 'Repeated mobile purchase',
        sourceFinancialCommand: {
          commandId: purchaseCommandId,
          requestedByEmployeeId: manager.id
        }
      }
    )
    expect(repeated.id).toBe(purchased.id)

    const pauseCommandId = randomUUID()
    const paused = pauseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: pauseCommandId,
        cardId: purchased.id,
        reason: 'Customer requested pause',
        sourceFinancialCommand: {
          commandId: pauseCommandId,
          requestedByEmployeeId: manager.id
        }
      }
    )
    expect(paused.status).toBe('paused')

    const resumeCommandId = randomUUID()
    const resumed = resumeMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: resumeCommandId,
        cardId: purchased.id,
        reason: 'Customer requested resume',
        sourceFinancialCommand: {
          commandId: resumeCommandId,
          requestedByEmployeeId: manager.id
        }
      }
    )
    expect(resumed.status).toBe('active')
    expect(
      (
        localDatabase.connection
          .prepare(
            `SELECT COUNT(*) count FROM monthly_card_event
             WHERE card_id = ?`
          )
          .get(purchased.id) as { count: number }
      ).count
    ).toBe(3)
    expect(
      listPendingEmployeeFinancialCommandReports(
        localDatabase.connection,
        store
      ).map((record) => record.commandType)
    ).toEqual([
      'monthly_card_purchase',
      'monthly_card_pause',
      'monthly_card_resume'
    ])
    localDatabase.close()
  })

  it('applies activity recharge tiers with audit, outbox and command result atomically', () => {
    const { localDatabase, store, manager } = initializedStore()
    const commandId = randomUUID()
    const count = (table: 'audit_log' | 'outbox_operation') =>
      (
        localDatabase.connection
          .prepare(
            `SELECT COUNT(*) count FROM ${table}
             WHERE action = 'wallet.gift_tiers.updated'`
              .replace(
                'action =',
                table === 'audit_log' ? 'action =' : 'operation_type ='
              )
          )
          .get() as { count: number }
      ).count
    const auditBefore = count('audit_log')
    const outboxBefore = count('outbox_operation')

    const result = updateRechargeGiftTiers(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        tiers: [
          { principalFen: 30_000, giftFen: 3_000 },
          { principalFen: 50_000, giftFen: 8_000 }
        ],
        reason: 'Apply holiday recharge activity',
        sourceFinancialCommand: {
          commandId,
          requestedByEmployeeId: manager.id
        }
      }
    )

    expect(result.filter((tier) => tier.active)).toMatchObject([
      { principalFen: 30_000, giftFen: 3_000 },
      { principalFen: 50_000, giftFen: 8_000 }
    ])
    expect(
      findEmployeeFinancialCommandExecution(
        localDatabase.connection,
        store,
        commandId
      )
    ).toMatchObject({
      commandType: 'apply_activity_recharge_tiers',
      status: 'completed',
      result: {
        type: 'apply_activity_recharge_tiers',
        rechargeGiftTiers: result
      }
    })
    expect(count('audit_log')).toBe(auditBefore + 1)
    expect(count('outbox_operation')).toBe(outboxBefore + 1)

    const repeated = updateRechargeGiftTiers(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        tiers: [
          { principalFen: 30_000, giftFen: 3_000 },
          { principalFen: 50_000, giftFen: 8_000 }
        ],
        reason: 'Retry after delayed cloud acknowledgement',
        sourceFinancialCommand: {
          commandId,
          requestedByEmployeeId: manager.id
        }
      }
    )
    expect(repeated).toEqual(result)
    expect(count('audit_log')).toBe(auditBefore + 1)
    expect(count('outbox_operation')).toBe(outboxBefore + 1)
    localDatabase.close()
  })

  it('stores a failed command without changing financial ledgers', () => {
    const { localDatabase, store, manager } = initializedStore()
    const before = (
      localDatabase.connection
        .prepare('SELECT COUNT(*) count FROM wallet_ledger')
        .get() as { count: number }
    ).count
    const commandId = randomUUID()
    const failure = recordFailedEmployeeFinancialCommand(
      localDatabase.connection,
      store,
      {
        commandId,
        requestedByEmployeeId: manager.id,
        commandType: 'cash_recharge',
        errorMessage: 'Member is not eligible for recharge'
      }
    )

    expect(failure).toMatchObject({
      status: 'failed',
      errorMessage: 'Member is not eligible for recharge'
    })
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) count FROM wallet_ledger')
          .get() as { count: number }
      ).count
    ).toBe(before)
    localDatabase.close()
  })
})
