import type {
  CacheBoardGameCoverResult,
  CreateBoardGameRequest
} from '@zyapp/contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  isBggCdnImageUrl,
  persistBoardGameWithResolvedCover
} from './board-game-cover-save'

const request: CreateBoardGameRequest = {
  name: '卡坦岛',
  introduction: '通过交易与建设发展岛屿。',
  categories: ['经营'],
  minPlayers: 3,
  maxPlayers: 4,
  minMinutes: 60,
  maxMinutes: 120,
  complexityRating: 2.3,
  quantity: 1,
  available: true,
  customerConsigned: false,
  missingPieces: false,
  private: false,
  recommended: true,
  imageUrl: 'https://cf.geekdo-images.com/catan.jpg',
  bggId: 13,
  metadataSource: 'bgg',
  metadataImportedAt: '2026-08-03T00:00:00.000Z',
  missingParts: [],
  coverSource: 'bgg'
}

const cached: CacheBoardGameCoverResult = {
  source: 'bgg',
  externalId: '13',
  cachedUrl:
    `https://judian.icu/test/v1/public/board-game-covers/${'a'.repeat(64)}.jpg`,
  contentType: 'image/jpeg',
  sha256: 'a'.repeat(64)
}

describe('board-game cover save orchestration', () => {
  it('replaces a BGG preview URL before calling local persistence', async () => {
    const cache = vi.fn().mockResolvedValue(cached)
    const persist = vi.fn(async (prepared: CreateBoardGameRequest) => prepared)

    const result = await persistBoardGameWithResolvedCover(
      request,
      cache,
      persist
    )

    expect(cache).toHaveBeenCalledWith('13')
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: cached.cachedUrl,
      coverSource: 'cached'
    }))
    expect(result.imageUrl).toBe(cached.cachedUrl)
  })

  it('never calls local persistence when BGG cover caching fails', async () => {
    const cache = vi.fn().mockRejectedValue(new Error('cache unavailable'))
    const persist = vi.fn()

    await expect(persistBoardGameWithResolvedCover(
      request,
      cache,
      persist
    )).rejects.toThrow('cache unavailable')
    expect(persist).not.toHaveBeenCalled()
  })

  it.each(['none', 'local', 'external', 'cached'] as const)(
    'does not cache cover source %s',
    async (coverSource) => {
      const unchanged = { ...request, coverSource }
      const cache = vi.fn()
      const persist = vi.fn(async (prepared: CreateBoardGameRequest) => prepared)

      await persistBoardGameWithResolvedCover(unchanged, cache, persist)

      expect(cache).not.toHaveBeenCalled()
      expect(persist).toHaveBeenCalledWith(unchanged)
    }
  )

  it('keeps legacy requests without coverSource compatible', async () => {
    const { coverSource: _coverSource, ...legacyRequest } = request
    const cache = vi.fn()
    const persist = vi.fn(async (prepared: CreateBoardGameRequest) => prepared)

    await persistBoardGameWithResolvedCover(legacyRequest, cache, persist)

    expect(cache).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledWith(legacyRequest)
  })

  it('requires a valid BGG ID when the cover source is BGG', async () => {
    const cache = vi.fn()
    const persist = vi.fn()

    await expect(persistBoardGameWithResolvedCover(
      { ...request, bggId: undefined },
      cache,
      persist
    )).rejects.toThrow(/BGG 编号/)
    expect(cache).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('detects only the exact BGG CDN host as an unsafe persisted URL', () => {
    expect(isBggCdnImageUrl('https://cf.geekdo-images.com/catan.jpg')).toBe(true)
    expect(isBggCdnImageUrl('https://cf.geekdo-images.com.evil.test/a.jpg'))
      .toBe(false)
    expect(isBggCdnImageUrl(cached.cachedUrl)).toBe(false)
    expect(isBggCdnImageUrl('not-a-url')).toBe(false)
  })
})
