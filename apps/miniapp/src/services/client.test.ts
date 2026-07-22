import { describe, expect, it } from 'vitest'
import { accessTokenStorageKey } from './session-storage'

describe('miniapp session storage', () => {
  it('isolates access tokens by API environment and store', () => {
    expect(
      accessTokenStorageKey(
        'https://api.example.com/test/',
        '11111111-1111-4111-8111-111111111111'
      )
    ).toBe(
      'zyapp_access_token:https://api.example.com/test:11111111-1111-4111-8111-111111111111'
    )
    expect(
      accessTokenStorageKey('https://api.example.com', 'production-store')
    ).not.toBe(
      accessTokenStorageKey(
        'https://api.example.com/test',
        'production-store'
      )
    )
  })
})
