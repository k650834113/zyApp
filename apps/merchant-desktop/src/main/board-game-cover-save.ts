import type {
  BoardGameCoverSource,
  CacheBoardGameCoverResult,
  UploadBoardGameCoverResult
} from '@zyapp/contracts'

type CoverAwareBoardGameRequest = {
  bggId?: number
  imageUrl?: string
  localImagePath?: string
  coverSource?: BoardGameCoverSource
}

export function isBggCdnImageUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase() === 'cf.geekdo-images.com'
  } catch {
    return false
  }
}

function validatedCachedUrl(
  result: CacheBoardGameCoverResult,
  externalId: string
): string {
  if (result.source !== 'bgg' || result.externalId !== externalId) {
    throw new Error('BGG 封面缓存响应与请求不一致')
  }
  let url: URL
  try {
    url = new URL(result.cachedUrl)
  } catch {
    throw new Error('BGG 封面缓存返回了无效地址')
  }
  if (
    url.protocol !== 'https:' ||
    isBggCdnImageUrl(url.toString()) ||
    !/\/v1\/public\/board-game-covers\/[0-9a-f]{64}\.(jpg|png|webp)$/.test(
      url.pathname
    )
  ) {
    throw new Error('BGG 封面缓存返回了不受信任的地址')
  }
  return url.toString()
}

function validatedLocalCachedUrl(
  result: UploadBoardGameCoverResult
): string {
  let url: URL
  try {
    url = new URL(result.cachedUrl)
  } catch {
    throw new Error('本地封面缓存返回了无效地址')
  }
  if (
    result.source !== 'local' ||
    url.protocol !== 'https:' ||
    !/\/v1\/public\/board-game-covers\/[0-9a-f]{64}\.(jpg|png|webp|gif)$/.test(
      url.pathname
    )
  ) {
    throw new Error('本地封面缓存返回了不受信任的地址')
  }
  return url.toString()
}

export async function persistBoardGameWithResolvedCover<
  TRequest extends CoverAwareBoardGameRequest,
  TResult
>(
  request: TRequest,
  cache: (externalId: string) => Promise<CacheBoardGameCoverResult>,
  persist: (request: TRequest) => TResult | Promise<TResult>,
  uploadLocal?: (
    managedPath: string
  ) => Promise<UploadBoardGameCoverResult | null>
): Promise<TResult> {
  if (request.coverSource === 'local' && request.localImagePath && uploadLocal) {
    const cached = await uploadLocal(request.localImagePath)
    if (cached) {
      return await persist({
        ...request,
        imageUrl: validatedLocalCachedUrl(cached),
        coverSource: 'cached'
      })
    }
  }
  if (request.coverSource !== 'bgg') {
    return await persist(request)
  }
  if (!Number.isInteger(request.bggId) || (request.bggId ?? 0) < 1) {
    throw new TypeError('保存 BGG 封面需要有效的 BGG 编号')
  }
  const externalId = String(request.bggId)
  const cached = await cache(externalId)
  return await persist({
    ...request,
    imageUrl: validatedCachedUrl(cached, externalId),
    coverSource: 'cached'
  })
}
