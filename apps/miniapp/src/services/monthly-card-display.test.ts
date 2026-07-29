import type {
  MemberMonthlyCardConfiguration,
  MemberSelfServiceSummary
} from '@zyapp/contracts'
import { describe, expect, it } from 'vitest'
import { monthlyCardDisplay } from './monthly-card-display'

const plan: MemberMonthlyCardConfiguration = {
  providerMode: 'wechat',
  planName: '30 天月卡',
  priceFen: 20_000,
  durationDays: 30,
  scopeType: 'store',
  purchaseAllowed: true,
  blockedReason: null
}

function member(
  monthlyCardStatus: MemberSelfServiceSummary['monthlyCardStatus'],
  monthlyCardExpiresAt: string | null
): MemberSelfServiceSummary {
  return {
    memberId: 'member-1',
    nickname: '林小满',
    avatarUrl: null,
    profileCompleted: true,
    phoneMasked: '138****8000',
    tier: 'ordinary',
    principalBalanceFen: 0,
    giftBalanceFen: 0,
    monthlyCardStatus,
    monthlyCardExpiresAt,
    birthdayMonth: null,
    birthdayDay: null,
    birthdayCanBeFilled: true,
    ageGate: 'confirmed_at_least_14'
  }
}

describe('monthly card display', () => {
  it('shows the active card expiry and a renewal action', () => {
    const active = member('active', '2026-08-24T15:59:59.000Z')

    expect(
      monthlyCardDisplay(
        active,
        plan,
        new Date('2026-07-26T00:00:00+08:00')
      )
    ).toMatchObject({
      state: 'active',
      expiresOn: '2026-08-24',
      remainingDaysText: '剩余 29 天',
      actionText: '微信续费'
    })
  })

  it('shows the opening action when no card exists', () => {
    const unopened = member('none', null)

    expect(monthlyCardDisplay(unopened, plan)).toMatchObject({
      state: 'unopened',
      expiresOn: null,
      remainingDaysText: null,
      actionText: '微信开通月卡'
    })
  })

  it('shows paused cards as unavailable for renewal', () => {
    const paused = member('paused', '2026-08-24T15:59:59.000Z')

    expect(monthlyCardDisplay(paused, plan)).toMatchObject({
      state: 'paused',
      expiresOn: '2026-08-24',
      actionText: '暂不可续费'
    })
  })

  it('shows zero remaining days on the expiry date', () => {
    const active = member('active', '2026-08-24T15:59:59.000Z')

    expect(
      monthlyCardDisplay(
        active,
        plan,
        new Date('2026-08-24T00:00:00+08:00')
      ).remainingDaysText
    ).toBe('剩余 0 天')
  })

  it('clamps elapsed cards to zero remaining days', () => {
    const active = member('active', '2026-08-24T15:59:59.000Z')

    expect(
      monthlyCardDisplay(
        active,
        plan,
        new Date('2026-08-25T00:00:00+08:00')
      ).remainingDaysText
    ).toBe('剩余 0 天')
  })
})
