import { describe, expect, it } from 'vitest'
import { desktopUpdateFeedUrl } from './update-feed'

describe('desktop update feed URL', () => {
  it('derives the Windows release feed from the configured cloud URL', () => {
    expect(desktopUpdateFeedUrl('https://cloud.example.com/')).toBe(
      'https://cloud.example.com/v1/desktop-updates/windows'
    )
    expect(desktopUpdateFeedUrl('http://127.0.0.1:3100')).toBe(
      'http://127.0.0.1:3100/v1/desktop-updates/windows'
    )
  })

  it('rejects unsupported protocols', () => {
    expect(() => desktopUpdateFeedUrl('file:///updates')).toThrow(
      'HTTP or HTTPS'
    )
  })
})
