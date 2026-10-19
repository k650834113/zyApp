import { describe, expect, it } from 'vitest'
import { readableError } from './api'

describe('readable desktop errors', () => {
  it('explains metadata outages wrapped by Electron', () => {
    expect(readableError(new Error("Error invoking remote method 'board-game-metadata:search': CloudRequestError: BGG metadata is unavailable")))
      .toContain('可继续手工填写')
    expect(readableError(new Error('BGG authorization failed'))).toContain('BGG 拒绝访问')
    expect(readableError(new Error('BGG access blocked by Cloudflare'))).toContain('安全防护拦截')
    expect(readableError(new Error('BGG request was throttled'))).toContain('过于频繁')
  })

  it('preserves other errors after removing transport prefixes', () => {
    expect(readableError(new Error("Error invoking remote method 'save': Error: 保存失败")))
      .toBe('保存失败')
  })
})
