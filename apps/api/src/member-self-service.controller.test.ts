import { describe, expect, it, vi } from 'vitest'
import { MemberSelfServiceController } from './member-self-service.controller'
import type { MemberRechargeService } from './member-recharge.service'
import type { MemberSelfService } from './member-self-service.service'

describe('member self-service controller', () => {
  it('updates the authenticated member profile', async () => {
    const summary = {
      memberId: '55555555-5555-4555-8555-555555555555',
      nickname: '林小满',
      avatarUrl: null,
      profileCompleted: true
    }
    const members = {
      updateProfile: vi.fn(async () => summary)
    } as unknown as MemberSelfService
    const controller = new MemberSelfServiceController(
      members,
      {} as MemberRechargeService
    )
    const principal = {
      identityId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      storeId: '33333333-3333-4333-8333-333333333333',
      memberId: summary.memberId,
      memberStatus: 'active'
    }
    const body = {
      requestId: 'profile-20260725-1',
      nickname: '林小满'
    }

    await expect(
      controller.updateProfile(
        { zyappMiniapp: principal } as never,
        body
      )
    ).resolves.toBe(summary)
    expect(members.updateProfile).toHaveBeenCalledWith(principal, body)
  })
})
