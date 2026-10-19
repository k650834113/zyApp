import type {
  BoardGameMetadataCandidate,
  BoardGameMetadataDetails
} from '@zyapp/contracts'
import { parseBggSearchXml, parseBggThingXml } from './bgg-xml'

export const BOARD_GAME_METADATA_ADAPTER = Symbol(
  'BOARD_GAME_METADATA_ADAPTER'
)

export type BggMetadataErrorCode =
  | 'disabled'
  | 'unauthorized'
  | 'blocked'
  | 'throttled'
  | 'unavailable'
  | 'timeout'
  | 'not_found'
  | 'malformed'

export class BggMetadataError extends Error {
  constructor(
    readonly code: BggMetadataErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'BggMetadataError'
  }
}

export interface BoardGameMetadataAdapter {
  readonly source: 'bgg'
  readonly enabled: boolean
  readonly imagesEnabled: boolean
  search(query: string): Promise<BoardGameMetadataCandidate[]>
  details(externalId: string): Promise<BoardGameMetadataDetails>
}

export class DisabledBoardGameMetadataAdapter
implements BoardGameMetadataAdapter {
  readonly source = 'bgg' as const
  readonly enabled = false
  readonly imagesEnabled = false

  search(): Promise<BoardGameMetadataCandidate[]> {
    return Promise.reject(
      new BggMetadataError('disabled', 'BGG metadata integration is disabled')
    )
  }

  details(): Promise<BoardGameMetadataDetails> {
    return Promise.reject(
      new BggMetadataError('disabled', 'BGG metadata integration is disabled')
    )
  }
}

type AdapterOptions = {
  token: string
  imagesEnabled: boolean
  fetch?: typeof fetch
  timeoutMilliseconds?: number
}

const MAX_RESPONSE_BYTES = 1024 * 1024
const SEARCH_ENDPOINT = 'https://boardgamegeek.com/xmlapi2/search'
const THING_ENDPOINT = 'https://boardgamegeek.com/xmlapi2/thing'

async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new BggMetadataError('malformed', 'BGG response is too large')
  }
  if (!response.body) return response.text()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new BggMetadataError('malformed', 'BGG response is too large')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function httpError(status: number): BggMetadataError {
  if (status === 401 || status === 403) {
    return new BggMetadataError('unauthorized', 'BGG authorization failed')
  }
  if (status === 429) {
    return new BggMetadataError('throttled', 'BGG request was throttled')
  }
  if (status === 404) {
    return new BggMetadataError('not_found', 'BGG board game was not found')
  }
  return new BggMetadataError('unavailable', 'BGG service is unavailable')
}

export class BggBoardGameMetadataAdapter
implements BoardGameMetadataAdapter {
  readonly source = 'bgg' as const
  readonly enabled = true
  readonly imagesEnabled: boolean
  private readonly token: string
  private readonly request: typeof fetch
  private readonly timeoutMilliseconds: number

  constructor(options: AdapterOptions) {
    if (!options.token.trim()) throw new Error('BGG token is required')
    this.token = options.token.trim()
    this.imagesEnabled = options.imagesEnabled
    this.request = options.fetch ?? fetch
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000
  }

  async search(query: string): Promise<BoardGameMetadataCandidate[]> {
    const url = new URL(SEARCH_ENDPOINT)
    url.searchParams.set('query', query.trim())
    url.searchParams.set('type', 'boardgame')
    const xml = await this.get(url)
    try {
      return parseBggSearchXml(xml)
    } catch {
      throw new BggMetadataError('malformed', 'BGG search XML is malformed')
    }
  }

  async details(externalId: string): Promise<BoardGameMetadataDetails> {
    if (!/^[1-9]\d*$/.test(externalId)) {
      throw new BggMetadataError('malformed', 'BGG board-game id is invalid')
    }
    const url = new URL(THING_ENDPOINT)
    url.searchParams.set('id', externalId)
    url.searchParams.set('stats', '1')
    const xml = await this.get(url)
    try {
      return parseBggThingXml(xml, { imagesEnabled: this.imagesEnabled })
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        throw new BggMetadataError('not_found', 'BGG board game was not found')
      }
      throw new BggMetadataError('malformed', 'BGG details XML is malformed')
    }
  }

  private async get(url: URL): Promise<string> {
    let response: Response
    try {
      response = await this.request(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/xml'
        },
        signal: AbortSignal.timeout(this.timeoutMilliseconds)
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new BggMetadataError('timeout', 'BGG request timed out')
      }
      throw new BggMetadataError('unavailable', 'BGG service is unavailable')
    }
    if (response.status === 403) {
      const body = await boundedBody(response)
      if (
        /cloudflare/i.test(response.headers.get('server') ?? '') &&
        /you have been blocked|challenge-platform|<title>\s*Just a moment/i.test(body)
      ) {
        throw new BggMetadataError('blocked', 'BGG access blocked by Cloudflare')
      }
    }
    if (!response.ok) throw httpError(response.status)
    return boundedBody(response)
  }
}
