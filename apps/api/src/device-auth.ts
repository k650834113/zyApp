import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type DeviceEnrollmentInput = {
  tenantId: string
  storeId: string
  deviceId: string
  storeName: string
  deviceName: string
}

export type DevicePrincipal = {
  tenantId: string
  storeId: string
  deviceId: string
  deviceName: string
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

export function validateDeviceEnrollmentInput(
  value: unknown
): DeviceEnrollmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Enrollment request must be an object')
  }
  const input = value as Record<string, unknown>
  return {
    tenantId: uuid(input.tenantId, 'tenantId'),
    storeId: uuid(input.storeId, 'storeId'),
    deviceId: uuid(input.deviceId, 'deviceId'),
    storeName: text(input.storeName, 'storeName', { min: 1, max: 120 }),
    deviceName: text(input.deviceName, 'deviceName', { min: 1, max: 120 })
  }
}

export function createDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function secretsEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(hashDeviceToken(left), 'hex')
  const rightHash = Buffer.from(hashDeviceToken(right), 'hex')
  return timingSafeEqual(leftHash, rightHash)
}

export function deviceTokenMatchesHash(
  token: string,
  expectedHash: string
): boolean {
  const actual = Buffer.from(hashDeviceToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
