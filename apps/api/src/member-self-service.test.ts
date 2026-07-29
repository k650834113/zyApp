import { describe, expect, it } from 'vitest'
import {
  hashPhoneVerificationCode,
  birthdayRequestHash,
  nextCloudMemberNumber,
  phoneVerificationCodeMatches,
  registrationRequestHash,
  validateWechatOneTapMemberLoginRequest,
  validateUpdateMemberProfileRequest,
  wechatOneTapLoginRequestHash,
  validateMemberRegistrationRequest,
  validateFillBirthdayRequest,
  validatePhoneVerificationRequest
} from './member-self-service'

describe('member self-service primitives', () => {
  it('normalizes registration input and creates a stable request hash', () => {
    const input = validateMemberRegistrationRequest({
      requestId: 'register-request-1',
      challengeId: '11111111-1111-4111-8111-111111111111',
      verificationCode: '123456',
      phone: '13800138000',
      nickname: ' New Member ',
      confirmedAtLeast14: false
    })
    expect(input.nickname).toBe('New Member')
    expect(input.confirmedAtLeast14).toBe(false)
    expect(registrationRequestHash(input)).toHaveLength(64)
  })

  it('hashes verification codes with the challenge id and secret', () => {
    const secret = 'phone-verification-secret-with-32-chars'
    const challengeId = '11111111-1111-4111-8111-111111111111'
    const hash = hashPhoneVerificationCode(secret, challengeId, '123456')
    expect(hash).toHaveLength(64)
    expect(
      phoneVerificationCodeMatches(
        hash,
        secret,
        challengeId,
        '123456'
      )
    ).toBe(true)
    expect(
      phoneVerificationCodeMatches(
        hash,
        secret,
        challengeId,
        '654321'
      )
    ).toBe(false)
  })

  it('validates phone numbers and uses the shared member number format', () => {
    expect(validatePhoneVerificationRequest({ phone: '13800138000' })).toEqual({
      phone: '13800138000'
    })
    expect(
      nextCloudMemberNumber('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    ).toBe('MAAAAAAAABB')
    expect(() =>
      validatePhoneVerificationRequest({ phone: '123' })
    ).toThrow('phone')
  })

  it('normalizes WeChat one-tap login profile input', () => {
    const input = validateWechatOneTapMemberLoginRequest({
      requestId: 'wechat-login-1',
      phoneCode: 'mock-phone:13800138000',
      nickname: ' 微信玩家 ',
      avatarUrl: ' wxfile://avatar ',
      confirmedAtLeast14: true
    })
    expect(input).toMatchObject({
      phoneCode: 'mock-phone:13800138000',
      nickname: '微信玩家',
      avatarUrl: 'wxfile://avatar',
      confirmedAtLeast14: true
    })
    expect(wechatOneTapLoginRequestHash(input)).toHaveLength(64)
    expect(
      validateWechatOneTapMemberLoginRequest({
        requestId: 'wechat-login-2',
        phoneCode: 'mock-phone:13800138000',
        confirmedAtLeast14: true
      }).nickname
    ).toBe('微信用户')
  })

  it('requires a 2 to 12 character member nickname for profile completion', () => {
    expect(
      validateUpdateMemberProfileRequest({
        requestId: 'profile-20260725-1',
        nickname: '  林小满  '
      })
    ).toEqual({
      requestId: 'profile-20260725-1',
      nickname: '林小满'
    })
    expect(() =>
      validateUpdateMemberProfileRequest({
        requestId: 'profile-20260725-2',
        nickname: ' '
      })
    ).toThrow(/nickname/)
    expect(() =>
      validateUpdateMemberProfileRequest({
        requestId: 'profile-20260725-3',
        nickname: '1234567890123'
      })
    ).toThrow(/nickname/)
  })

  it('accepts leap-day birthdays and rejects impossible dates', () => {
    const birthday = validateFillBirthdayRequest({
      requestId: 'birthday-request-1',
      month: 2,
      day: 29
    })
    expect(birthday).toEqual({
      requestId: 'birthday-request-1',
      month: 2,
      day: 29
    })
    expect(birthdayRequestHash(birthday)).toHaveLength(64)
    expect(() =>
      validateFillBirthdayRequest({
        requestId: 'birthday-request-2',
        month: 2,
        day: 30
      })
    ).toThrow('invalid')
  })
})
