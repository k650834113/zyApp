import { describe, expect, it, vi } from 'vitest'
import {
  BggBoardGameMetadataAdapter,
  BggMetadataError
} from './bgg-adapter'

const searchXml = `
  <items><item type="boardgame" id="13">
    <name type="primary" value="Catan"/>
    <yearpublished value="1995"/>
  </item></items>
`

describe('BGG XML API adapter', () => {
  it('distinguishes Cloudflare blocking from invalid authorization without exposing the block page', async () => {
    const adapter = new BggBoardGameMetadataAdapter({
      token: 'server-only-token',
      imagesEnabled: false,
      fetch: async () => new Response('<title>Attention Required! | Cloudflare</title>Sorry, you have been blocked. private diagnostic details', {
        status: 403,
        headers: { server: 'cloudflare', 'content-type': 'text/html' }
      })
    })
    const error = await adapter.search('Catan').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'blocked' })
    expect(String(error)).not.toContain('private diagnostic details')
  })

  it('uses only the fixed search endpoint with bearer authentication', async () => {
    const request = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) => new Response(searchXml, {
      status: 200,
      headers: { 'content-type': 'application/xml' }
    }))
    const adapter = new BggBoardGameMetadataAdapter({
      token: 'server-only-token',
      imagesEnabled: false,
      fetch: request as typeof fetch
    })

    await expect(adapter.search('卡坦岛')).resolves.toMatchObject([
      { externalId: '13', primaryName: 'Catan' }
    ])
    const [url, init] = request.mock.calls[0] ?? []
    expect(String(url)).toBe(
      'https://boardgamegeek.com/xmlapi2/search?query=%E5%8D%A1%E5%9D%A6%E5%B2%9B&type=boardgame'
    )
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer server-only-token',
      Accept: 'application/xml'
    })
  })

  it.each([
    [401, 'unauthorized'],
    [429, 'throttled'],
    [503, 'unavailable']
  ] as const)('maps HTTP %s to %s without exposing response bodies', async (status, code) => {
    const adapter = new BggBoardGameMetadataAdapter({
      token: 'server-only-token',
      imagesEnabled: false,
      fetch: async () => new Response('secret upstream body', { status })
    })

    const error = await adapter.search('Catan').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(BggMetadataError)
    expect(error).toMatchObject({ code })
    expect(String(error)).not.toContain('secret upstream body')
  })

  it('rejects responses larger than one MiB', async () => {
    const adapter = new BggBoardGameMetadataAdapter({
      token: 'server-only-token',
      imagesEnabled: false,
      fetch: async () => new Response('x', {
        headers: { 'content-length': String(1024 * 1024 + 1) }
      })
    })

    await expect(adapter.search('Catan')).rejects.toMatchObject({
      code: 'malformed'
    })
  })
})
