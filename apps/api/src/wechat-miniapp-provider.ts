import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common'
import type Redis from 'ioredis'
import { createHash } from 'node:crypto'
import type { ApiConfig } from './config'

type WechatCodeSessionResponse = {
  openid?: string
  unionid?: string
  session_key?: string
  errcode?: number
  errmsg?: string
}

type WechatAccessTokenResponse = {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

type WechatPhoneNumberResponse = {
  errcode?: number
  errmsg?: string
  phone_info?: {
    phoneNumber?: string
    purePhoneNumber?: string
    countryCode?: string
  }
}

export const MOCK_WECHAT_PHONE_CODE_PREFIX = 'mock-phone:'
export const TEST_VIRTUAL_WECHAT_PHONE_CODE = 'test-virtual-phone'

const MOBILE_PHONE_PATTERN = /^1\d{10}$/

export function miniappWechatAuthMode(
  config: ApiConfig
): 'mock' | 'wechat' | 'disabled' {
  if (config.miniappWechatAuthMode) return config.miniappWechatAuthMode
  return config.nodeEnv === 'production' ? 'disabled' : 'mock'
}

function requireWechatConfig(config: ApiConfig): {
  appId: string
  appSecret: string
} {
  const appId = config.wechatMiniappAppId?.trim()
  const appSecret = config.wechatMiniappAppSecret?.trim()
  if (!appId || !appSecret) {
    throw new ServiceUnavailableException(
      'WeChat Mini Program credentials are not configured'
    )
  }
  return { appId, appSecret }
}

function wechatErrorMessage(prefix: string, payload: { errcode?: number; errmsg?: string }): string {
  const code = payload.errcode
  const message = payload.errmsg?.trim()
  return `${prefix}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}`
}

async function fetchWechatJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, options)
  } catch {
    throw new ServiceUnavailableException('WeChat platform request failed')
  }
  if (!response.ok) {
    throw new ServiceUnavailableException(
      `WeChat platform request failed: ${response.status}`
    )
  }
  return (await response.json()) as T
}

export async function resolveWechatLoginSubject(
  config: ApiConfig,
  loginCode: string
): Promise<string> {
  const mode = miniappWechatAuthMode(config)
  if (mode === 'disabled') {
    throw new ServiceUnavailableException(
      'WeChat Mini Program authentication is disabled'
    )
  }
  const code = loginCode.trim()
  if (mode === 'mock') {
    if (config.nodeEnv === 'production') {
      throw new ServiceUnavailableException(
        'Mock WeChat Mini Program authentication is not available'
      )
    }
    return `mock:${code}`
  }

  const { appId, appSecret } = requireWechatConfig(config)
  const payload = await fetchWechatJson<WechatCodeSessionResponse>(
    'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code'
  )
  if (payload.errcode && payload.errcode !== 0) {
    throw new UnauthorizedException(
      wechatErrorMessage('WeChat login failed', payload)
    )
  }
  if (!payload.openid?.trim()) {
    throw new ServiceUnavailableException(
      'WeChat login did not return an openid'
    )
  }
  return `openid:${payload.openid.trim()}`
}

async function getWechatAccessToken(
  config: ApiConfig,
  redis: Redis
): Promise<string> {
  const { appId, appSecret } = requireWechatConfig(config)
  const appHash = createHash('sha256').update(appId).digest('hex').slice(0, 16)
  const cacheKey = `zyapp:wechat-miniapp-access-token:${appHash}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) return cached

  const payload = await fetchWechatJson<WechatAccessTokenResponse>(
    'https://api.weixin.qq.com/cgi-bin/token' +
      '?grant_type=client_credential' +
      `&appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}`
  )
  if (payload.errcode && payload.errcode !== 0) {
    throw new ServiceUnavailableException(
      wechatErrorMessage('WeChat access token request failed', payload)
    )
  }
  if (!payload.access_token?.trim()) {
    throw new ServiceUnavailableException(
      'WeChat access token request did not return a token'
    )
  }
  const expiresIn = Number(payload.expires_in ?? 7200)
  const ttl = Number.isFinite(expiresIn)
    ? Math.max(60, Math.min(Math.floor(expiresIn) - 300, 7000))
    : 6900
  await redis.set(cacheKey, payload.access_token, 'EX', ttl).catch(() => undefined)
  return payload.access_token
}

export async function resolveWechatPhoneNumber(
  config: ApiConfig,
  redis: Redis,
  phoneCode: string
): Promise<string> {
  const code = phoneCode.trim()
  const mode = miniappWechatAuthMode(config)
  if (code === TEST_VIRTUAL_WECHAT_PHONE_CODE) {
    const phone = config.miniappTestVirtualPhone?.trim()
    if (config.deploymentEnvironment !== 'test' || !phone) {
      throw new ServiceUnavailableException(
        'Test virtual phone login is not available'
      )
    }
    return phone
  }
  if (code.startsWith(MOCK_WECHAT_PHONE_CODE_PREFIX)) {
    if (config.nodeEnv === 'production' || mode !== 'mock') {
      throw new ServiceUnavailableException(
        'Mock WeChat phone login is not available'
      )
    }
    const phone = code.slice(MOCK_WECHAT_PHONE_CODE_PREFIX.length)
    if (!MOBILE_PHONE_PATTERN.test(phone)) {
      throw new BadRequestException(
        'Mock WeChat phone code must contain a mainland China mobile number'
      )
    }
    return phone
  }
  if (mode !== 'wechat') {
    throw new ServiceUnavailableException(
      'WeChat phone number provider is not configured'
    )
  }

  const accessToken = await getWechatAccessToken(config, redis)
  const payload = await fetchWechatJson<WechatPhoneNumberResponse>(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(
      accessToken
    )}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code })
    }
  )
  if (payload.errcode && payload.errcode !== 0) {
    throw new UnauthorizedException(
      wechatErrorMessage('WeChat phone number verification failed', payload)
    )
  }
  const phone = (
    payload.phone_info?.purePhoneNumber ??
    payload.phone_info?.phoneNumber?.replace(/^\+?86/, '')
  )?.trim()
  if (!phone || !MOBILE_PHONE_PATTERN.test(phone)) {
    throw new BadRequestException(
      'WeChat phone number must be a mainland China mobile number'
    )
  }
  return phone
}
