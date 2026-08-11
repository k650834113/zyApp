import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiConfig } from './config'
import { BoardGameCoverCacheService } from './board-game-cover-cache.service'

const temporaryDirectories: string[] = []

async function service(): Promise<{
  covers: BoardGameCoverCacheService
  directory: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'zyapp-board-game-cover-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    covers: new BoardGameCoverCacheService({
      boardGameCoverDirectory: directory,
      deploymentEnvironment: 'test',
      miniappPublicBaseUrl: 'https://judian.icu/test/'
    } as ApiConfig)
  }
}

function imageResponse(
  buffer: Buffer,
  contentType = 'image/jpeg'
): Response {
  return new Response(Uint8Array.from(buffer), {
    status: 200,
    headers: {
      'content-length': String(buffer.length),
      'content-type': contentType
    }
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('BoardGameCoverCacheService', () => {
  it('stores valid BGG image bytes by SHA-256 and reuses identical content', async () => {
    const { covers, directory } = await service()
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () =>
        imageResponse(jpeg)
      )
    )

    const first = await covers.cacheFromBgg(
      '13',
      'https://cf.geekdo-images.com/catan.jpg'
    )
    const second = await covers.cacheFromBgg(
      '13',
      'https://cf.geekdo-images.com/catan-copy.jpg'
    )
    const sha256 = createHash('sha256').update(jpeg).digest('hex')

    expect(first).toEqual({
      source: 'bgg',
      externalId: '13',
      cachedUrl:
        `https://judian.icu/test/v1/public/board-game-covers/${sha256}.jpg`,
      contentType: 'image/jpeg',
      sha256
    })
    expect(second.cachedUrl).toBe(first.cachedUrl)
    expect(await readdir(directory)).toEqual([`${sha256}.jpg`])
    expect((await covers.read(`${sha256}.jpg`)).buffer).toEqual(jpeg)
  })

  it.each([
    ['non-HTTPS sources', 'http://cf.geekdo-images.com/catan.jpg'],
    ['non-BGG hosts', 'https://example.com/catan.jpg'],
    ['invalid BGG IDs', 'https://cf.geekdo-images.com/catan.jpg', '0']
  ])('rejects %s before downloading', async (_name, url, externalId = '13') => {
    const { covers } = await service()
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)

    await expect(covers.cacheFromBgg(externalId, url)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects redirects that leave the BGG image host', async () => {
    const { covers } = await service()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/redirected.jpg' }
      }))
    )

    await expect(covers.cacheFromBgg(
      '13',
      'https://cf.geekdo-images.com/catan.jpg'
    )).rejects.toThrow(/allowed|redirect/i)
  })

  it('rejects more than three redirects', async () => {
    const { covers } = await service()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: '/another.jpg' }
      }))
    )

    await expect(covers.cacheFromBgg(
      '13',
      'https://cf.geekdo-images.com/catan.jpg'
    )).rejects.toThrow(/redirect/i)
  })

  it.each([
    {
      name: 'declared oversized content',
      response: () => new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: {
          'content-length': String(10 * 1024 * 1024 + 1),
          'content-type': 'image/jpeg'
        }
      })
    },
    {
      name: 'streamed oversized content',
      response: () => imageResponse(
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff]),
          Buffer.alloc(10 * 1024 * 1024 - 2)
        ])
      )
    },
    {
      name: 'non-image bytes',
      response: () => imageResponse(Buffer.from('not-an-image'))
    },
    {
      name: 'media type mismatch',
      response: () => imageResponse(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        'image/png'
      )
    }
  ])('rejects $name', async ({ response }) => {
    const { covers } = await service()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response()))

    await expect(covers.cacheFromBgg(
      '13',
      'https://cf.geekdo-images.com/catan.jpg'
    )).rejects.toThrow()
  })

  it('rejects path traversal and unknown cache file names', async () => {
    const { covers } = await service()

    await expect(covers.read('../secret.key')).rejects.toThrow(
      'Board game cover was not found'
    )
    await expect(covers.read(`${'a'.repeat(64)}.gif`)).rejects.toThrow(
      'Board game cover was not found'
    )
  })
})
