import { createHash, randomBytes } from 'node:crypto'
import type {
  MiniappDevelopmentSessionRequest,
  MiniappIdentity,
  MiniappWechatSessionRequest
} from '@zyapp/contracts'

export type MiniappPrincipal = {
  identityId: string
  tenantId: string
  storeId: string
  provider: 'wechat' | 'development'
  providerSubject: string
  memberId: string | null
  memberStatus: 'active' | 'disabled' | null
  employeeId: string | null
  employeeStatus: 'active' | 'disabled' | null
  employeeRole: 'manager' | 'staff' | null
  identity: MiniappIdentity
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function uuid(value: unknown, name: string): string {
  const normalized = text(value, name, { min: 36, max: 36 }).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${name} must be a UUID`)
  return normalized
}

export function validateDevelopmentSessionRequest(
  value: unknown
): MiniappDevelopmentSessionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Development session request must be an object')
  }
  const input = value as Record<string, unknown>
  return {
    storeId: uuid(input.storeId, 'storeId'),
    providerSubject: text(input.providerSubject, 'providerSubject', {
      min: 3,
      max: 128
    })
  }
}

export function validateWechatSessionRequest(
  value: unknown
): MiniappWechatSessionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('WeChat session request must be an object')
  }
  const input = value as Record<string, unknown>
  return {
    storeId: uuid(input.storeId, 'storeId'),
    loginCode: text(input.loginCode, 'loginCode', {
      min: 3,
      max: 512
    })
  }
}

export function createMiniappToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashMiniappToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function extractBearerToken(
  authorization: string | string[] | undefined
): string | undefined {
  const value = Array.isArray(authorization)
    ? authorization[0]
    : authorization
  return value?.startsWith('Bearer ')
    ? value.slice('Bearer '.length).trim() || undefined
    : undefined
}
