import type { PhoneVerificationChallenge } from '@zyapp/contracts'

export type PhoneNumberEvent = {
  detail: { code?: string; errMsg?: string }
}

export type WechatProfile = {
  nickname: string
  avatarUrl: string | null
}

export const defaultConfirmedAtLeast14 = true

const mainlandPhonePattern = /^1\d{10}$/

export function phoneCodeFromEvent(event: PhoneNumberEvent): string | null {
  const errMsg = event.detail.errMsg ?? ''
  if (!event.detail.code && errMsg && !errMsg.includes(':ok')) {
    return null
  }
  return event.detail.code || null
}

function isPhoneNumberPermissionError(errMsg: string): boolean {
  const normalized = errMsg.toLowerCase()
  return (
    normalized.includes('jsapi has no permission') ||
    normalized.includes('operatewxdata:fail') ||
    normalized.includes('getphonenumber:fail no permission')
  )
}

export function phoneAuthorizationFailure(event: PhoneNumberEvent): string {
  const errMsg = event.detail.errMsg ?? ''
  if (isPhoneNumberPermissionError(errMsg)) {
    return '当前小程序还没有微信手机号授权能力，已为你展开手机号验证码登录。上线前需要在微信公众平台开通手机号能力并完成隐私保护指引。'
  }
  if (errMsg.includes('privacy')) {
    return '手机号授权被隐私保护拦截，请先在微信后台配置并同意小程序隐私保护指引，也可以改用手机号验证码登录。'
  }
  if (errMsg.includes('user deny') || errMsg.includes('cancel')) {
    return '你取消了手机号授权，可以改用手机号验证码登录。'
  }
  if (errMsg && !errMsg.includes(':ok')) {
    return `微信手机号授权失败，可以改用手机号验证码登录。错误信息：${errMsg}`
  }
  return '微信没有返回手机号授权码，请确认使用已认证 AppID，并在真机预览或体验版中测试，也可以改用手机号验证码登录。'
}

export async function requestWechatProfile(): Promise<WechatProfile | null> {
  try {
    const profile = await wx.getUserProfile({
      desc: '完善会员资料',
      lang: 'zh_CN'
    })
    return {
      nickname: profile.userInfo.nickName?.trim() || '微信用户',
      avatarUrl: profile.userInfo.avatarUrl || null
    }
  } catch {
    return null
  }
}

export function normalizePhone(value: string): string | null {
  const phone = value.trim()
  return mainlandPhonePattern.test(phone) ? phone : null
}

export function normalizeVerificationCode(value: string): string | null {
  const code = value.trim()
  return /^\d{4,8}$/.test(code) ? code : null
}

export function normalizeNickname(value: string): string {
  return value.trim() || '微信用户'
}

export function phoneVerificationHint(
  challenge: PhoneVerificationChallenge
): string {
  if (challenge.mockCode) {
    return `测试验证码：${challenge.mockCode}`
  }
  return '验证码已发送，请在 10 分钟内完成登录。'
}
