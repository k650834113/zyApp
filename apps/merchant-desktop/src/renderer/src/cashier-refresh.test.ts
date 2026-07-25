import { describe, expect, it, vi } from 'vitest'
import { refreshCashierSnapshot } from './cashier-refresh'

describe('cashier manual refresh', () => {
  it('reloads shared lists and the selected member without changing cashier draft state', async () => {
    const member = {
      id: 'member-1',
      memberNumber: 'M0001',
      phone: '13800138000',
      nickname: '现场充值会员',
      tier: 'ordinary' as const,
      status: 'active' as const,
      birthdayMonth: null,
      birthdayDay: null,
      birthdaySource: null,
      note: null,
      source: 'miniapp' as const,
      ageGate: 'confirmed_at_least_14' as const,
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      lastActiveAt: null
    }
    const wallet = {
      wallet: {
        accountId: 'wallet-1',
        memberId: member.id,
        principalBalanceFen: 100,
        giftBalanceFen: 0,
        totalBalanceFen: 100,
        status: 'active' as const,
        updatedAt: '2026-07-25T00:00:00.000Z'
      },
      giftTiers: [],
      ledger: [],
      recharges: [],
      legacyHistory: []
    }
    const monthlyCard = {
      plan: {
        id: 'plan-1',
        name: '月卡',
        durationDays: 30,
        priceFen: 10_000,
        active: true
      },
      current: null,
      events: []
    }
    const api = {
      listCatalogItems: vi.fn().mockResolvedValue([]),
      listRecentOrders: vi.fn().mockResolvedValue([]),
      listCashierMembers: vi.fn().mockResolvedValue([member]),
      getWalletDetails: vi.fn().mockResolvedValue(wallet),
      getMonthlyCardDetails: vi.fn().mockResolvedValue(monthlyCard)
    }

    const result = await refreshCashierSnapshot(api, member.id)

    expect(api.listCatalogItems).toHaveBeenCalledOnce()
    expect(api.listRecentOrders).toHaveBeenCalledWith({ limit: 20 })
    expect(api.listCashierMembers).toHaveBeenCalledOnce()
    expect(api.getWalletDetails).toHaveBeenCalledWith({ memberId: member.id })
    expect(api.getMonthlyCardDetails).toHaveBeenCalledWith({ memberId: member.id })
    expect(result).toMatchObject({
      catalog: [],
      orders: [],
      members: [member],
      selectedMember: member,
      walletDetails: wallet,
      monthlyCard
    })
  })

  it('clears stale selection when the member no longer exists', async () => {
    const api = {
      listCatalogItems: vi.fn().mockResolvedValue([]),
      listRecentOrders: vi.fn().mockResolvedValue([]),
      listCashierMembers: vi.fn().mockResolvedValue([]),
      getWalletDetails: vi.fn(),
      getMonthlyCardDetails: vi.fn()
    }

    const result = await refreshCashierSnapshot(api, 'missing-member')

    expect(api.getWalletDetails).not.toHaveBeenCalled()
    expect(result.selectedMember).toBeNull()
    expect(result.walletDetails).toBeNull()
    expect(result.monthlyCard).toBeNull()
  })
})
