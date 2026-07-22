import { describe, expect, it } from 'vitest'
import {
  createMiniappToken,
  extractBearerToken,
  hashMiniappToken,
  validateDevelopmentSessionRequest
} from './miniapp-auth'

describe('miniapp authentication primitives', () => {
  it('validates development session input and hashes opaque tokens', () => {
    expect(
      validateDevelopmentSessionRequest({
        storeId: '11111111-1111-4111-8111-111111111111',
        providerSubject: ' local-user-1 '
      })
    ).toEqual({
      storeId: '11111111-1111-4111-8111-111111111111',
      providerSubject: 'local-user-1'
    })
    const token = createMiniappToken()
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hashMiniappToken(token)).toHaveLength(64)
    expect(hashMiniappToken(token)).not.toContain(token)
  })

  it('extracts only bearer tokens and rejects malformed store ids', () => {
    expect(extractBearerToken('Bearer token-value')).toBe('token-value')
    expect(extractBearerToken('Basic token-value')).toBeUndefined()
    expect(() =>
      validateDevelopmentSessionRequest({
        storeId: 'invalid',
        providerSubject: 'local-user-1'
      })
    ).toThrow('storeId')
  })
})
