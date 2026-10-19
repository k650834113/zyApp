import type { Pool } from '@zyapp/cloud-db'
import { describe, expect, it, vi } from 'vitest'
import type { DevicePrincipal } from '../device-auth'
import type { BoardGameCoverCacheService } from '../board-game-cover-cache.service'
import type { BoardGameMetadataAdapter } from './bgg-adapter'
import { BggMetadataError } from './bgg-adapter'
import { BoardGameMetadataService } from './board-game-metadata.service'
import type { BggRequestGate } from './request-gate'

const principal: DevicePrincipal = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
  deviceName: 'Cashier'
}
const actorId = '44444444-4444-4444-8444-444444444444'

function adapter(overrides: Partial<BoardGameMetadataAdapter> = {}): BoardGameMetadataAdapter {
  return {
    source: 'bgg',
    enabled: true,
    imagesEnabled: false,
    search: vi.fn(async () => [{
      source: 'bgg' as const, externalId: '13', primaryName: 'Catan',
      alternateNames: ['卡坦岛'], yearPublished: 1995
    }]),
    details: vi.fn(async () => ({
      source: 'bgg' as const, externalId: '13', primaryName: 'Catan',
      alternateNames: ['卡坦岛'], yearPublished: 1995,
      minPlayers: 3, maxPlayers: 4, minMinutes: 60, maxMinutes: 120,
      complexityRating: 2.3, categories: ['经营'], mechanics: ['交易'],
      thumbnailUrl: null, imageUrl: null,
      sourceUrl: 'https://boardgamegeek.com/boardgame/13',
      fetchedAt: '2026-08-03T00:00:00.000Z'
    })),
    ...overrides
  }
}

function service(options: {
  authorized?: boolean
  adapter?: BoardGameMetadataAdapter
  coverError?: Error
} = {}) {
  const query = vi.fn(async () => ({
    rows: options.authorized === false ? [] : [{ id: actorId }]
  }))
  const gate = {
    cached: vi.fn(async (_key: string, _ttl: number, load: () => Promise<unknown>) => load())
  } as unknown as BggRequestGate
  const covers = {
    cacheFromBgg: options.coverError
      ? vi.fn().mockRejectedValue(options.coverError)
      : vi.fn().mockResolvedValue({
          source: 'bgg',
          externalId: '13',
          cachedUrl:
            `https://judian.icu/test/v1/public/board-game-covers/${'a'.repeat(64)}.jpg`,
          contentType: 'image/jpeg',
          sha256: 'a'.repeat(64)
        }),
    cacheLocal: vi.fn().mockResolvedValue({
      source: 'local',
      cachedUrl:
        `https://judian.icu/test/v1/public/board-game-covers/${'b'.repeat(64)}.png`,
      contentType: 'image/png',
      sha256: 'b'.repeat(64)
    })
  }
  return {
    query,
    gate,
    covers,
    instance: new BoardGameMetadataService(
      { query } as unknown as Pool,
      gate,
      options.adapter ?? adapter(),
      covers as unknown as BoardGameCoverCacheService
    )
  }
}

describe('board-game metadata service', () => {
  it.each([
    ['blocked', 'BGG access blocked by Cloudflare'],
    ['unauthorized', 'BGG authorization failed'],
    ['throttled', 'BGG request was throttled']
  ] as const)('preserves the %s failure category without upstream details', async (code, message) => {
    const fixture = service({ adapter: adapter({
      search: vi.fn().mockRejectedValue(new BggMetadataError(code, 'private upstream details'))
    }) })
    await expect(fixture.instance.search(principal, actorId, 'Catan'))
      .rejects.toMatchObject({ status: 503, message })
  })
  it('authorizes an active manager in the authenticated tenant and store', async () => {
    const fixture = service()
    await expect(fixture.instance.status(principal, actorId)).resolves.toEqual({
      source: 'bgg', enabled: true, imagesEnabled: false
    })
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringContaining('cloud_employee_store_access'),
      [actorId, principal.tenantId, principal.storeId]
    )
  })

  it('rejects an actor without active manager access', async () => {
    const fixture = service({ authorized: false })
    await expect(fixture.instance.status(principal, actorId)).rejects.toMatchObject({
      status: 403
    })
  })

  it('authorizes and stores a local PC cover without calling BGG', async () => {
    const fixture = service()
    const file = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      originalname: 'cover.png',
      mimetype: 'image/png',
      size: 4
    }

    await expect(
      fixture.instance.uploadLocalCover(principal, actorId, file)
    ).resolves.toMatchObject({ source: 'local' })
    expect(fixture.covers.cacheLocal).toHaveBeenCalledWith(file)
  })

  it('normalizes searches, caps results and caches for 24 hours', async () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      source: 'bgg' as const,
      externalId: String(index + 1),
      primaryName: `Game ${index + 1}`,
      alternateNames: [],
      yearPublished: null
    }))
    const metadata = adapter({ search: vi.fn(async () => candidates) })
    const fixture = service({ adapter: metadata })

    const result = await fixture.instance.search(principal, actorId, '  Catan  ')

    expect(result).toHaveLength(20)
    expect(metadata.search).toHaveBeenCalledWith('Catan')
    expect(fixture.gate.cached).toHaveBeenCalledWith(
      expect.stringMatching(/^zyapp:bgg:search:[a-f0-9]{64}$/),
      86_400,
      expect.any(Function)
    )
    await expect(
      fixture.instance.search(principal, actorId, 'x'.repeat(121))
    ).rejects.toMatchObject({ status: 400 })
  })

  it('validates IDs, caches details for seven days and maps stable errors', async () => {
    const fixture = service()
    await expect(fixture.instance.details(principal, actorId, '13'))
      .resolves.toMatchObject({ externalId: '13' })
    expect(fixture.gate.cached).toHaveBeenCalledWith(
      'zyapp:bgg:details:text:13', 604_800, expect.any(Function)
    )
    await expect(fixture.instance.details(principal, actorId, '1x'))
      .rejects.toMatchObject({ status: 400 })

    const throttled = service({ adapter: adapter({
      search: vi.fn(async () => {
        throw new BggMetadataError('throttled', 'throttled')
      })
    }) })
    await expect(throttled.instance.search(principal, actorId, 'Catan'))
      .rejects.toMatchObject({ status: 503 })
  })

  it('reports disabled status while keeping metadata calls unavailable', async () => {
    const fixture = service({ adapter: adapter({ enabled: false }) })
    await expect(fixture.instance.status(principal, actorId)).resolves
      .toMatchObject({ enabled: false })
    await expect(fixture.instance.search(principal, actorId, 'Catan'))
      .rejects.toMatchObject({ status: 503 })
  })

  it('caches a normalized BGG cover only after manager authorization', async () => {
    const metadata = adapter({
      imagesEnabled: true,
      details: vi.fn(async () => ({
        source: 'bgg' as const,
        externalId: '13',
        primaryName: 'Catan',
        alternateNames: ['卡坦岛'],
        yearPublished: 1995,
        minPlayers: 3,
        maxPlayers: 4,
        minMinutes: 60,
        maxMinutes: 120,
        complexityRating: 2.3,
        categories: ['经营'],
        mechanics: ['交易'],
        thumbnailUrl: 'https://cf.geekdo-images.com/catan-thumb.jpg',
        imageUrl: 'https://cf.geekdo-images.com/catan.jpg',
        sourceUrl: 'https://boardgamegeek.com/boardgame/13',
        fetchedAt: '2026-08-03T00:00:00.000Z'
      }))
    })
    const fixture = service({ adapter: metadata })

    await expect(fixture.instance.cacheCover(principal, actorId, '13'))
      .resolves.toMatchObject({ source: 'bgg', externalId: '13' })
    expect(metadata.details).toHaveBeenCalledWith('13')
    expect(fixture.gate.cached).toHaveBeenCalledWith(
      'zyapp:bgg:details:images:13',
      604_800,
      expect.any(Function)
    )
    expect(fixture.covers.cacheFromBgg).toHaveBeenCalledWith(
      '13',
      'https://cf.geekdo-images.com/catan.jpg'
    )
  })

  it('does not load or cache covers for unauthorized actors', async () => {
    const metadata = adapter()
    const fixture = service({ authorized: false, adapter: metadata })

    await expect(fixture.instance.cacheCover(principal, actorId, '13'))
      .rejects.toMatchObject({ status: 403 })
    expect(metadata.details).not.toHaveBeenCalled()
    expect(fixture.covers.cacheFromBgg).not.toHaveBeenCalled()
  })

  it('rejects missing BGG images and invalid IDs without caching', async () => {
    const fixture = service()

    await expect(fixture.instance.cacheCover(principal, actorId, '13'))
      .rejects.toMatchObject({ status: 502 })
    await expect(fixture.instance.cacheCover(principal, actorId, '1x'))
      .rejects.toMatchObject({ status: 400 })
    expect(fixture.covers.cacheFromBgg).not.toHaveBeenCalled()
  })
})
