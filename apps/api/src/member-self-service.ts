import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual
} from 'node:crypto'
import type {
  FillMemberBirthdayRequest,
  RegisterMiniappMemberRequest,
  RequestPhoneVerificationRequest,
  UpdateMemberProfileRequest,
  WechatOneTapMemberLoginRequest
} from '@zyapp/contracts'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PHONE_PATTERN = /^1\d{10}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
const DEFAULT_WECHAT_NICKNAME = '微信用户'

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  name: string,
  options: { min: number; max: number }
): string {
  if (typeof value !== 'string') throw new Error(`${name} must be text`)
  const normalized = value.trim()
  if (
    normalized.length < options.min ||
    normalized.length > options.max
  ) {
    throw new Error(
      `${name} must contain ${options.min} to ${options.max} characters`
    )
  }
  return normalized
}

function optionalText(
  value: unknown,
  name: string,
  options: { min: number; max: number }
): string | null {
  if (value === null || value === undefined) return null
  const normalized = text(value, name, options)
  return normalized.length === 0 ? null : normalized
}

function phone(value: unknown): string {
  const normalized = text(value, 'phone', { min: 11, max: 11 })
  if (!PHONE_PATTERN.test(normalized)) {
    throw new Error('phone must be a mainland China mobile number')
  }
  return normalized
}

function uuid(value: unknown, name: string): string {
  const normalized = text(value, name, { min: 36, max: 36 }).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${name} must be a UUID`)
  return normalized
}

export function validatePhoneVerificationRequest(
  value: unknown
): RequestPhoneVerificationRequest {
  const input = object(value, 'Phone verification request')
  return { phone: phone(input.phone) }
}

export function validateMemberRegistrationRequest(
  value: unknown
): RegisterMiniappMemberRequest {
  const input = object(value, 'Member registration request')
  const requestId = text(input.requestId, 'requestId', { min: 8, max: 100 })
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('requestId contains unsupported characters')
  }
  const verificationCode = text(
    input.verificationCode,
    'verificationCode',
    { min: 6, max: 6 }
  )
  if (!/^\d{6}$/.test(verificationCode)) {
    throw new Error('verificationCode must contain 6 digits')
  }
  if (typeof input.confirmedAtLeast14 !== 'boolean') {
    throw new Error('confirmedAtLeast14 must be boolean')
  }
  return {
    requestId,
    challengeId: uuid(input.challengeId, 'challengeId'),
    verificationCode,
    phone: phone(input.phone),
    nickname: text(input.nickname, 'nickname', { min: 1, max: 30 }),
    confirmedAtLeast14: input.confirmedAtLeast14
  }
}

export function validateWechatOneTapMemberLoginRequest(
  value: unknown
): WechatOneTapMemberLoginRequest & {
  nickname: string
  avatarUrl: string | null
} {
  const input = object(value, 'WeChat one-tap login request')
  const requestId = text(input.requestId, 'requestId', { min: 8, max: 100 })
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('requestId contains unsupported characters')
  }
  if (typeof input.confirmedAtLeast14 !== 'boolean') {
    throw new Error('confirmedAtLeast14 must be boolean')
  }
  const nickname =
    optionalText(input.nickname, 'nickname', { min: 1, max: 30 }) ??
    DEFAULT_WECHAT_NICKNAME
  return {
    requestId,
    phoneCode: text(input.phoneCode, 'phoneCode', { min: 8, max: 512 }),
    nickname,
    avatarUrl: optionalText(input.avatarUrl, 'avatarUrl', {
      min: 1,
      max: 2048
    }),
    confirmedAtLeast14: input.confirmedAtLeast14
  }
}

export function validateUpdateMemberProfileRequest(
  value: unknown
): UpdateMemberProfileRequest {
  const input = object(value, 'Member profile request')
  const requestId = text(input.requestId, 'requestId', { min: 8, max: 100 })
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('requestId contains unsupported characters')
  }
  return {
    requestId,
    nickname: text(input.nickname, 'nickname', { min: 2, max: 12 })
  }
}

export function validateFillBirthdayRequest(
  value: unknown
): FillMemberBirthdayRequest {
  const input = object(value, 'Birthday request')
  const requestId = text(input.requestId, 'requestId', { min: 8, max: 100 })
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('requestId contains unsupported characters')
  }
  if (
    !Number.isInteger(input.month) ||
    !Number.isInteger(input.day)
  ) {
    throw new Error('Birthday month and day must be integers')
  }
  const month = Number(input.month)
  const day = Number(input.day)
  const date = new Date(Date.UTC(2000, month - 1, day))
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Birthday month and day are invalid')
  }
  return { requestId, month, day }
}

export function createPhoneVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashPhoneVerificationCode(
  secret: string,
  challengeId: string,
  code: string
): string {
  return createHmac('sha256', secret)
    .update(`${challengeId}:${code}`)
    .digest('hex')
}

export function phoneVerificationCodeMatches(
  expectedHash: string,
  secret: string,
  challengeId: string,
  code: string
): boolean {
  const actual = Buffer.from(
    hashPhoneVerificationCode(secret, challengeId, code),
    'hex'
  )
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function maskPhone(phoneValue: string): string {
  return `${phoneValue.slice(0, 3)}****${phoneValue.slice(-4)}`
}

export function registrationRequestHash(
  input: RegisterMiniappMemberRequest
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        challengeId: input.challengeId,
        phone: input.phone,
        nickname: input.nickname,
        confirmedAtLeast14: input.confirmedAtLeast14
      })
    )
    .digest('hex')
}

export function wechatOneTapLoginRequestHash(
  input: WechatOneTapMemberLoginRequest
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        phoneCode: input.phoneCode,
        nickname: input.nickname ?? null,
        avatarUrl: input.avatarUrl ?? null,
        confirmedAtLeast14: input.confirmedAtLeast14
      })
    )
    .digest('hex')
}

export function birthdayRequestHash(
  input: FillMemberBirthdayRequest
): string {
  return createHash('sha256')
    .update(JSON.stringify({ month: input.month, day: input.day }))
    .digest('hex')
}

export function nextCloudMemberNumber(memberId: string): string {
  return `M${memberId.replaceAll('-', '').slice(0, 10).toUpperCase()}`
}
