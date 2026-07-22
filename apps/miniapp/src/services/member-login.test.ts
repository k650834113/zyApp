import { describe, expect, it } from 'vitest'
import {
  normalizeNickname,
  normalizePhone,
  normalizeVerificationCode,
  phoneAuthorizationFailure,
  phoneCodeFromEvent,
  phoneVerificationHint
} from './member-login'

describe('member login helpers', () => {
  it('extracts the phone authorization code from a successful event', () => {
    expect(
      phoneCodeFromEvent({
        detail: { code: 'phone-code', errMsg: 'getPhoneNumber:ok' }
      })
    ).toBe('phone-code')
  })

  it('turns missing phone jsapi permission into an actionable message', () => {
    expect(
      phoneAuthorizationFailure({
        detail: {
          errMsg:
            'getPhoneNumber:fail operateWXData:fail jsapi has no permission'
        }
      })
    ).toContain('没有微信手机号授权能力')
  })

  it('normalizes fallback phone verification inputs', () => {
    expect(normalizePhone(' 13800138000 ')).toBe('13800138000')
    expect(normalizePhone('123')).toBeNull()
    expect(normalizeVerificationCode(' 123456 ')).toBe('123456')
    expect(normalizeVerificationCode('abc')).toBeNull()
    expect(normalizeNickname('')).toBe('微信用户')
  })

  it('shows the mock verification code when available', () => {
    expect(
      phoneVerificationHint({
        challengeId: 'challenge',
        expiresAt: new Date().toISOString(),
        resendAfterSeconds: 60,
        mockCode: '123456'
      })
    ).toBe('测试验证码：123456')
  })
})
