import { describe, expect, it, vi } from 'vitest'
import { MemberSelfServiceController } from './member-self-service.controller'
import type { MemberRechargeService } from './member-recharge.service'
import type { MemberSelfService } from './member-self-service.service'
import type { MemberAvatarService } from './member-avatar.service'

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
      {} as MemberRechargeService,
      {} as MemberAvatarService
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

  it('stores an uploaded avatar before updating the authenticated member', async () => {
    const summary = {
      memberId: '55555555-5555-4555-8555-555555555555',
      nickname: '林小满',
      avatarUrl:
        'https://judian.icu/test/v1/public/member-avatars/avatar.jpg',
      profileCompleted: true
    }
    const members = {
      updateProfileWithAvatar: vi.fn(async () => summary)
    } as unknown as MemberSelfService
    const avatars = {
      store: vi.fn(async () => ({
        fileName: 'avatar.jpg',
        publicUrl: summary.avatarUrl,
        contentType: 'image/jpeg'
      }))
    } as unknown as MemberAvatarService
    const controller = new MemberSelfServiceController(
      members,
      {} as MemberRechargeService,
      avatars
    )
    const principal = {
      identityId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      storeId: '33333333-3333-4333-8333-333333333333',
      memberId: summary.memberId,
      memberStatus: 'active'
    }
    const body = { requestId: 'profile-avatar-1', nickname: '林小满' }
    const file = {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      originalname: 'avatar.jpg',
      mimetype: 'image/jpeg',
      size: 3
    }

    await expect(
      controller.updateProfileWithAvatar(
        { zyappMiniapp: principal } as never,
        body,
        file
      )
    ).resolves.toBe(summary)
    expect(avatars.store).toHaveBeenCalledWith(file)
    expect(members.updateProfileWithAvatar).toHaveBeenCalledWith(
      principal,
      body,
      summary.avatarUrl
    )
  })
})
