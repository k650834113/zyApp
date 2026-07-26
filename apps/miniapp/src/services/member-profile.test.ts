import type { MemberSelfServiceSummary } from '@zyapp/contracts'
import { describe, expect, it } from 'vitest'
import { saveOptionalAvatarProfile } from './member-profile'

function memberSummary(
  nickname: string,
  avatarUrl: string | null
): MemberSelfServiceSummary {
  return {
    memberId: 'member-1',
    nickname,
    avatarUrl,
    profileCompleted: true,
    phoneMasked: '138****8000',
    tier: 'ordinary',
    principalBalanceFen: 0,
    giftBalanceFen: 0,
    monthlyCardStatus: 'none',
    monthlyCardExpiresAt: null,
    birthdayMonth: null,
    birthdayDay: null,
    birthdayCanBeFilled: true,
    ageGate: 'confirmed_at_least_14'
  }
}

describe('member profile saving', () => {
  it('saves a required nickname without an avatar', async () => {
    const calls: string[] = []
    const result = await saveOptionalAvatarProfile(
      {
        updateMemberProfile: async (nickname) => {
          calls.push(`nickname:${nickname}`)
          return memberSummary(nickname, null)
        },
        updateMemberProfileWithAvatar: async () => {
          throw new Error('unexpected upload')
        }
      },
      '林小满',
      '',
      async () => false
    )

    expect(result.avatarUrl).toBeNull()
    expect(calls).toEqual(['nickname:林小满'])
  })

  it('uses the default avatar only after upload failure is confirmed', async () => {
    const calls: string[] = []
    const result = await saveOptionalAvatarProfile(
      {
        updateMemberProfileWithAvatar: async () => {
          calls.push('upload')
          throw new Error('头像上传域名尚未生效')
        },
        updateMemberProfile: async (nickname) => {
          calls.push('default')
          return memberSummary(nickname, null)
        }
      },
      '林小满',
      'wxfile://avatar',
      async () => true
    )

    expect(result.avatarUrl).toBeNull()
    expect(calls).toEqual(['upload', 'default'])
  })

  it('keeps the upload failure when default avatar fallback is declined', async () => {
    const uploadError = new Error('头像上传失败')
    let nicknameSaved = false

    await expect(
      saveOptionalAvatarProfile(
        {
          updateMemberProfileWithAvatar: async () => {
            throw uploadError
          },
          updateMemberProfile: async (nickname) => {
            nicknameSaved = true
            return memberSummary(nickname, null)
          }
        },
        '林小满',
        'wxfile://avatar',
        async () => false
      )
    ).rejects.toBe(uploadError)
    expect(nicknameSaved).toBe(false)
  })
})
