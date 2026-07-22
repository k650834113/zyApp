import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approveFinancialRefund,
  bootstrapStore,
  cashRecharge,
  createEmployee,
  createFinancialRefundRequest,
  createMember,
  debitWallet,
  directFinancialRefund,
  findEmployeeRecordById,
  getMonthlyCardDetails,
  getStoreContext,
  getWalletDetails,
  listFinancialRefunds,
  openLocalDatabase,
  purchaseMonthlyCard,
  rejectFinancialRefund,
  searchMembers,
  useMonthlyCard
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedFinancialRefunds() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-financial-refund-'))
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
  const member = createMember(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      phone: '13800138000',
      nickname: 'Refund Member',
      confirmedAtLeast14: true
    }
  )
  return { localDatabase, store, manager, staff, member }
}

describe('financial refund approval repository', () => {
  it('lets staff request a standard monthly-card refund and manager approve it idempotently', () => {
    const { localDatabase, store, manager, staff, member } =
      initializedFinancialRefunds()
    const purchasedAt = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        reason: '现金购买',
        now: purchasedAt
      }
    )
    const requestId = randomUUID()
    const pending = createFinancialRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId,
        targetType: 'monthly_card',
        targetId: card.id,
        reason: '顾客线下申请',
        now: new Date(purchasedAt.getTime() + 60 * 60 * 1000)
      }
    )
    expect(pending).toMatchObject({
      targetType: 'monthly_card',
      status: 'pending',
      memberNickname: 'Refund Member',
      memberPhone: '13800138000',
      refundPrincipalFen: 20_000,
      reclaimGiftFen: 0,
      requiresSpecialOverride: false
    })
    expect(
      createFinancialRefundRequest(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          requestId,
          targetType: 'monthly_card',
          targetId: card.id
        }
      ).id
    ).toBe(pending.id)
    expect(() =>
      approveFinancialRefund(
        localDatabase.connection,
        { ...store, actor: staff },
        { requestId: randomUUID(), financialRefundId: pending.id }
      )
    ).toThrow('Only managers')

    const approvalRequestId = randomUUID()
    const completed = approveFinancialRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: approvalRequestId,
        financialRefundId: pending.id,
        now: new Date(purchasedAt.getTime() + 2 * 60 * 60 * 1000)
      }
    )
    expect(completed.status).toBe('completed')
    expect(
      approveFinancialRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        { requestId: approvalRequestId, financialRefundId: pending.id }
      ).id
    ).toBe(completed.id)
    expect(
      getMonthlyCardDetails(
        localDatabase.connection,
        store,
        member.id,
        new Date(purchasedAt.getTime() + 2 * 60 * 60 * 1000)
      ).history[0]?.status
    ).toBe('refunded')
    localDatabase.close()
  })

  it('requires manager override and a reason for a used monthly card without extending 24 hours', () => {
    const { localDatabase, store, manager, staff, member } =
      initializedFinancialRefunds()
    const purchasedAt = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        reason: '现金购买',
        now: purchasedAt
      }
    )
    useMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        cardId: card.id,
        reason: '本人入场',
        now: new Date(purchasedAt.getTime() + 1_000)
      }
    )
    const pending = createFinancialRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId: randomUUID(),
        targetType: 'monthly_card',
        targetId: card.id,
        now: new Date(purchasedAt.getTime() + 60 * 60 * 1000)
      }
    )
    expect(pending.requiresSpecialOverride).toBe(true)
    expect(() =>
      approveFinancialRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          financialRefundId: pending.id,
          now: new Date(purchasedAt.getTime() + 2 * 60 * 60 * 1000)
        }
      )
    ).toThrow('special refund override')
    expect(() =>
      approveFinancialRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          financialRefundId: pending.id,
          specialOverride: true,
          now: new Date(purchasedAt.getTime() + 2 * 60 * 60 * 1000)
        }
      )
    ).toThrow('requires a reason')
    expect(
      approveFinancialRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          financialRefundId: pending.id,
          specialOverride: true,
          reason: '门店异常补偿',
          now: new Date(purchasedAt.getTime() + 2 * 60 * 60 * 1000)
        }
      )
    ).toMatchObject({
      status: 'completed',
      specialOverride: true,
      completionReason: '门店异常补偿'
    })

    const second = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        reason: '再次购买',
        now: new Date(purchasedAt.getTime() + 3 * 60 * 60 * 1000)
      }
    )
    expect(() =>
      createFinancialRefundRequest(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          requestId: randomUUID(),
          targetType: 'monthly_card',
          targetId: second.id,
          now: new Date(purchasedAt.getTime() + 28 * 60 * 60 * 1000)
        }
      )
    ).toThrow('expired')
    localDatabase.close()
  })

  it('refunds only the remaining cash recharge principal and reclaims unused gift', () => {
    const { localDatabase, store, manager, staff, member } =
      initializedFinancialRefunds()
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
        reason: '先消费赠送再消费本金'
      }
    )
    const pending = createFinancialRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId: randomUUID(),
        targetType: 'cash_recharge',
        targetId: recharge.operationId,
        reason: '错误充值'
      }
    )
    expect(pending).toMatchObject({
      status: 'pending',
      refundPrincipalFen: 59_000,
      reclaimGiftFen: 0
    })
    const completed = approveFinancialRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        financialRefundId: pending.id,
        reason: '核对后确认错误充值'
      }
    )
    expect(completed.status).toBe('completed')
    expect(getWalletDetails(localDatabase.connection, store, member.id).wallet.totalBalanceFen).toBe(
      0
    )
    expect(
      searchMembers(localDatabase.connection, store.tenantId, member.phone, 10)[0]?.tier
    ).toBe('ordinary')
    localDatabase.close()
  })

  it('blocks approval when recharge balance changed, then allows rejection and a new request', () => {
    const { localDatabase, store, manager, staff, member } =
      initializedFinancialRefunds()
    const recharge = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 30_000,
        reason: '现金充值'
      }
    )
    const pending = createFinancialRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId: randomUUID(),
        targetType: 'cash_recharge',
        targetId: recharge.operationId,
        reason: '顾客申请'
      }
    )
    debitWallet(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        amountFen: 1_000,
        reason: '申请后发生消费'
      }
    )
    expect(() =>
      approveFinancialRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          financialRefundId: pending.id,
          reason: '审批'
        }
      )
    ).toThrow('balance changed')
    expect(
      rejectFinancialRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          financialRefundId: pending.id,
          reason: '余额已变化，请重新申请'
        }
      ).status
    ).toBe('rejected')
    const direct = directFinancialRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        targetType: 'cash_recharge',
        targetId: recharge.operationId,
        reason: '按最新余额直接退款'
      }
    )
    expect(direct).toMatchObject({
      status: 'completed',
      refundPrincipalFen: 30_000,
      reclaimGiftFen: 1_000
    })
    expect(listFinancialRefunds(localDatabase.connection, store, { limit: 10 })).toHaveLength(2)
    localDatabase.close()
  })
})
