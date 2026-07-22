import { describe, expect, it } from 'vitest'
import {
  createDeviceToken,
  deviceTokenMatchesHash,
  hashDeviceToken,
  secretsEqual,
  validateDeviceEnrollmentInput
} from './device-auth'

describe('device authentication primitives', () => {
  it('validates and normalizes enrollment identifiers', () => {
    expect(
      validateDeviceEnrollmentInput({
        tenantId: '11111111-1111-4111-8111-111111111111',
        storeId: '22222222-2222-4222-8222-222222222222',
        deviceId: '33333333-3333-4333-8333-333333333333',
        storeName: ' Test Store ',
        deviceName: ' Cashier 01 '
      })
    ).toMatchObject({
      storeName: 'Test Store',
      deviceName: 'Cashier 01'
    })
  })

  it('creates high-entropy tokens and compares only their hashes', () => {
    const token = createDeviceToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hashDeviceToken(token)).toHaveLength(64)
    expect(deviceTokenMatchesHash(token, hashDeviceToken(token))).toBe(true)
    expect(deviceTokenMatchesHash(`${token}x`, hashDeviceToken(token))).toBe(
      false
    )
    expect(secretsEqual(token, token)).toBe(true)
    expect(secretsEqual(token, `${token}x`)).toBe(false)
  })

  it('rejects malformed enrollment input', () => {
    expect(() =>
      validateDeviceEnrollmentInput({
        tenantId: 'not-a-uuid',
        storeId: '22222222-2222-4222-8222-222222222222',
        deviceId: '33333333-3333-4333-8333-333333333333',
        storeName: 'Store',
        deviceName: 'Cashier'
      })
    ).toThrow('tenantId')
  })
})
