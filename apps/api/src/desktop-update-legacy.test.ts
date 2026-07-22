import { describe, expect, it, vi } from 'vitest'
import { redirectLegacyDesktopUpdate } from './desktop-update-legacy'

describe('redirectLegacyDesktopUpdate', () => {
  it('preserves the update filename and query string', () => {
    const redirect = vi.fn()

    redirectLegacyDesktopUpdate(
      { url: '/latest.yml?channel=latest' },
      { redirect },
    )

    expect(redirect).toHaveBeenCalledWith(
      307,
      '/v1/desktop-updates/windows/latest.yml?channel=latest',
    )
  })
})
