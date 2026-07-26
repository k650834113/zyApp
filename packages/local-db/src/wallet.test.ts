import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  adjustMemberTier,
  bootstrapStore,
  cashRecharge,
  createEmployee,
  createMember,
  debitWallet,
  findEmployeeRecordById,
  getStoreContext,
  getWalletDetails,
  openLocalDatabase,
  reconstructWalletBalance,
  reverseCashRecharge,
  searchMembers,
  updateRechargeGiftTiers
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedWallet() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-wallet-'))
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
      nickname: '钱包测试',
      confirmedAtLeast14: true
    }
  )
  return { localDatabase, store, manager, member }
}

describe('wallet repository', () => {
  it('seeds configured tiers and applies the confirmed gift algorithm', () => {
    const { localDatabase, store, manager, member } = initializedWallet()
    const initial = getWalletDetails(localDatabase.connection, store, member.id)
    expect(initial.giftTiers.map((tier) => [tier.principalFen, tier.giftFen])).toEqual([
      [30_000, 2_000],
      [50_000, 5_000],
      [100_000, 20_000]
    ])

    const amounts = [
      [60_000, 5_000],
      [99_900, 5_000],
      [130_000, 22_000]
    ] as const
    for (const [principalFen, expectedGiftFen] of amounts) {
      const extraMember = createMember(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          phone: `139${String(principalFen).padStart(8, '0').slice(-8)}`,
          nickname: String(principalFen),
          confirmedAtLeast14: true
        }
      )
      const result = cashRecharge(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          memberId: extraMember.id,
          principalFen,
          reason: '现金充值'
        }
      )
      expect(result.giftDeltaFen).toBe(expectedGiftFen)
    }
    localDatabase.close()
  })

  it('recharges idempotently and grants advanced membership from principal only', () => {
    const { localDatabase, store, manager, member } = initializedWallet()
    const requestId = randomUUID()
    const first = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        memberId: member.id,
        principalFen: 50_000,
        reason: '现金充值'
      }
    )
    const repeated = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        memberId: member.id,
        principalFen: 50_000,
        reason: '重复提交'
      }
    )

    expect(first.wallet).toMatchObject({
      principalBalanceFen: 50_000,
      giftBalanceFen: 5_000,
      totalBalanceFen: 55_000
    })
    expect(repeated.operationId).toBe(first.operationId)
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM wallet_ledger WHERE entry_type = 'cash_recharge'")
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(searchMembers(localDatabase.connection, store.tenantId, member.phone, 10)[0]?.tier).toBe(
      'advanced'
    )
    expect(
      localDatabase.connection
        .prepare(
          `SELECT operation_type, payload_json
           FROM outbox_operation
           WHERE aggregate_id = ? AND operation_type = 'member.tier.reconciled'`
        )
        .all(member.id)
    ).toHaveLength(1)
    localDatabase.close()
  })

  it('debits gift first, rejects insufficient balance atomically and reconstructs balances', () => {
    const { localDatabase, store, manager, member } = initializedWallet()
    cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 50_000,
        reason: '现金充值'
      }
    )
    const requestId = randomUUID()
    const debited = debitWallet(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        memberId: member.id,
        amountFen: 6_000,
        reason: '前台消费'
      }
    )
    const repeated = debitWallet(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        memberId: member.id,
        amountFen: 6_000,
        reason: '重复提交'
      }
    )
    expect(debited).toMatchObject({
      principalDeltaFen: -1_000,
      giftDeltaFen: -5_000
    })
    expect(debited.wallet).toMatchObject({
      principalBalanceFen: 49_000,
      giftBalanceFen: 0
    })
    expect(repeated.operationId).toBe(debited.operationId)

    const beforeCount = (
      localDatabase.connection
        .prepare('SELECT COUNT(*) count FROM wallet_ledger')
        .get() as { count: number }
    ).count
    expect(() =>
      debitWallet(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          memberId: member.id,
          amountFen: 50_000,
          reason: '余额不足'
        }
      )
    ).toThrow('用户余额不足')
    const afterCount = (
      localDatabase.connection
        .prepare('SELECT COUNT(*) count FROM wallet_ledger')
        .get() as { count: number }
    ).count
    expect(afterCount).toBe(beforeCount)
    expect(reconstructWalletBalance(localDatabase.connection, store.tenantId, member.id)).toEqual({
      principalBalanceFen: 49_000,
      giftBalanceFen: 0
    })
    localDatabase.close()
  })

  it('uses account balance components when stale lot components exceed them', () => {
    const { localDatabase, store, manager, member } = initializedWallet()
    cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 50_000,
        reason: 'Cash recharge'
      }
    )
    debitWallet(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        amountFen: 5_000,
        reason: 'Consume gift balance'
      }
    )
    localDatabase.connection
      .prepare(
        `UPDATE wallet_lot SET remaining_gift_fen = 100
         WHERE wallet_account_id = (
           SELECT id FROM wallet_account WHERE member_id = ?
         )`
      )
      .run(member.id)

    const result = debitWallet(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        amountFen: 1_000,
        reason: 'Cashier payment after mirror refresh'
      }
    )

    expect(result).toMatchObject({
      principalDeltaFen: -1_000,
      giftDeltaFen: 0,
      wallet: { principalBalanceFen: 49_000, giftBalanceFen: 0 }
    })
    localDatabase.close()
  })

  it('lets only managers reverse remaining recharge value and preserves other tier sources', () => {
    const { localDatabase, store, manager, member } = initializedWallet()
    adjustMemberTier(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, tier: 'advanced', reason: '长期活动资格' }
    )
    const recharge = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 60_000,
        reason: '现金充值'
      }
    )
    debitWallet(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        amountFen: 6_000,
        reason: '先消费赠送，再消费本金'
      }
    )
    const staff = createEmployee(
      localDatabase.connection,
      { ...store, actorId: manager.id },
      {
        username: 'staff01',
        passwordHash: 'scrypt$staff',
        displayName: 'Staff',
        role: 'staff'
      }
    )
    expect(() =>
      reverseCashRecharge(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          requestId: randomUUID(),
          rechargeId: recharge.operationId,
          reason: '错误充值'
        }
      )
    ).toThrow('Only managers')

    const reversed = reverseCashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        rechargeId: recharge.operationId,
        reason: '错误充值'
      }
    )
    expect(reversed).toMatchObject({
      principalDeltaFen: -59_000,
      giftDeltaFen: 0
    })
    expect(reversed.wallet.totalBalanceFen).toBe(0)
    expect(reconstructWalletBalance(localDatabase.connection, store.tenantId, member.id)).toEqual({
      principalBalanceFen: 0,
      giftBalanceFen: 0
    })
    expect(searchMembers(localDatabase.connection, store.tenantId, member.phone, 10)[0]?.tier).toBe(
      'advanced'
    )
    const tierProjection = localDatabase.connection
      .prepare(
        `SELECT payload_json FROM outbox_operation
         WHERE aggregate_id = ? AND operation_type = 'member.tier.reconciled'
         ORDER BY device_seq DESC LIMIT 1`
      )
      .get(member.id) as { payload_json: string }
    expect(JSON.parse(tierProjection.payload_json)).toMatchObject({
      action: 'member.tier.reconciled',
      after: { tier: 'advanced' }
    })
    expect(
      getWalletDetails(localDatabase.connection, store, member.id).recharges[0]
    ).toMatchObject({
      status: 'reversed',
      remainingPrincipalFen: 0,
      remainingGiftFen: 0
    })
    localDatabase.close()
  })

  it('lets managers replace active gift tiers without changing historical recharge snapshots', () => {
    const { localDatabase, store, manager, member } = initializedWallet()
    const first = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 30_000,
        reason: '旧活动充值'
      }
    )
    expect(first.giftDeltaFen).toBe(2_000)

    const tiers = updateRechargeGiftTiers(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        tiers: [
          { principalFen: 20_000, giftFen: 1_500 },
          { principalFen: 60_000, giftFen: 8_000 }
        ],
        reason: '新活动档位'
      }
    )
    expect(tiers.filter((tier) => tier.active)).toMatchObject([
      { principalFen: 20_000, giftFen: 1_500 },
      { principalFen: 60_000, giftFen: 8_000 }
    ])

    const secondMember = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138009',
        nickname: '新档位',
        confirmedAtLeast14: true
      }
    )
    const second = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: secondMember.id,
        principalFen: 80_000,
        reason: '新活动充值'
      }
    )
    expect(second.giftDeltaFen).toBe(9_500)

    const snapshots = localDatabase.connection
      .prepare(
        `SELECT gift_rule_snapshot_json snapshot
         FROM wallet_recharge ORDER BY occurred_at, rowid`
      )
      .all() as Array<{ snapshot: string }>
    expect(snapshots[0]?.snapshot).toContain('"principalFen":30000')
    expect(snapshots[0]?.snapshot).toContain('"giftFen":2000')
    expect(snapshots[1]?.snapshot).toContain('"principalFen":20000')
    localDatabase.close()
  })
})
