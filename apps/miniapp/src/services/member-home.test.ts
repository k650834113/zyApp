import type {
  MemberRechargeConfiguration,
  MemberSelfServiceHistory
} from '@zyapp/contracts'
import { describe, expect, it, vi } from 'vitest'
import { loadMemberHomeDetails } from './member-home'

const history: MemberSelfServiceHistory = {
  activities: [],
  orders: [],
  walletEntries: [],
  monthlyCardEvents: []
}

const rechargeConfiguration: MemberRechargeConfiguration = {
  providerMode: 'wechat',
  giftTiers: []
}

describe('member home data loading', () => {
  it('does not request recharge configuration when payments are disabled', async () => {
    const getHistory = vi.fn(async () => history)
    const getRechargeConfiguration = vi.fn(async () => rechargeConfiguration)

    await expect(
      loadMemberHomeDetails(
        { getHistory, getRechargeConfiguration },
        false
      )
    ).resolves.toEqual({
      history,
      rechargeConfiguration: null
    })
    expect(getHistory).toHaveBeenCalledOnce()
    expect(getRechargeConfiguration).not.toHaveBeenCalled()
  })

  it('loads recharge configuration for the payment-enabled experience build', async () => {
    const getHistory = vi.fn(async () => history)
    const getRechargeConfiguration = vi.fn(async () => rechargeConfiguration)

    await expect(
      loadMemberHomeDetails(
        { getHistory, getRechargeConfiguration },
        true
      )
    ).resolves.toEqual({
      history,
      rechargeConfiguration
    })
    expect(getRechargeConfiguration).toHaveBeenCalledOnce()
  })
})
