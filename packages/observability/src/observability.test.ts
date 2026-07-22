import { describe, expect, it } from 'vitest'
import { redactLogValue, shanghaiDateStamp } from './index'

describe('redactLogValue', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      redactLogValue({
        username: 'staff',
        password: 'plain-text',
        nested: { apiKey: 'key-value' }
      })
    ).toEqual({
      username: 'staff',
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]' }
    })
  })

  it('masks phone-like values in ordinary text', () => {
    expect(redactLogValue('member 13800138000 failed')).toBe('member 138****8000 failed')
  })

  it('uses the Shanghai calendar date for log files', () => {
    expect(shanghaiDateStamp(new Date('2026-06-10T18:00:00.000Z'))).toBe('2026-06-11')
  })
})
