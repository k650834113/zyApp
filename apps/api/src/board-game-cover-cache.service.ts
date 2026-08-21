import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import type {
  CacheBoardGameCoverResult,
  UploadBoardGameCoverResult
} from '@zyapp/contracts'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiConfig } from './config'
import { API_CONFIG } from './infrastructure.module'

const MAX_COVER_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3
const DOWNLOAD_TIMEOUT_MILLISECONDS = 10_000
const ALLOWED_HOSTS = new Set(['cf.geekdo-images.com'])
const FILE_NAME_PATTERN = /^[0-9a-f]{64}\.(jpg|png|webp|gif)$/
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type CoverContentType = CacheBoardGameCoverResult['contentType']
type LocalCoverContentType = UploadBoardGameCoverResult['contentType']

export type BoardGameCoverUpload = {
  buffer: Buffer
  originalname: string
  mimetype: string
  size: number
}

type DetectedImage = {
  extension: 'jpg' | 'png' | 'webp' | 'gif'
  contentType: LocalCoverContentType
}

function validateExternalId(value: string): string {
  const normalized = value?.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new BadRequestException('BGG board-game id is invalid')
  }
  return normalized
}

function allowedUrl(value: string | URL): URL {
  let url: URL
  try {
    url = value instanceof URL ? value : new URL(value)
  } catch {
    throw new BadRequestException('BGG cover URL is invalid')
  }
  if (
    url.protocol !== 'https:' ||
    !ALLOWED_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  ) {
    throw new BadRequestException('BGG cover URL is not allowed')
  }
  return url
}

function detectImage(buffer: Buffer, allowGif = false): DetectedImage {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return { extension: 'png', contentType: 'image/png' }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' }
  }
  if (
    allowGif &&
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return { extension: 'gif', contentType: 'image/gif' }
  }
  throw new BadGatewayException('BGG cover is not a supported image')
}

function declaredContentType(response: Response): CoverContentType {
  const raw = response.headers.get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  const normalized = raw === 'image/jpg' ? 'image/jpeg' : raw
  if (
    normalized !== 'image/jpeg' &&
    normalized !== 'image/png' &&
    normalized !== 'image/webp'
  ) {
    throw new BadGatewayException('BGG cover media type is not supported')
  }
  return normalized
}

async function boundedBody(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) {
    throw new BadGatewayException('BGG cover exceeds 10 MiB')
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_COVER_BYTES) {
      throw new BadGatewayException('BGG cover exceeds 10 MiB')
    }
    return buffer
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_COVER_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new BadGatewayException('BGG cover exceeds 10 MiB')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size)
}

@Injectable()
export class BoardGameCoverCacheService {
  private readonly directory: string
  private readonly publicBaseUrl: string

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.directory =
      config.boardGameCoverDirectory ??
      `./var/board-game-covers/${config.deploymentEnvironment}`
    this.publicBaseUrl =
      (config.miniappPublicBaseUrl ?? 'https://localhost').replace(/\/+$/, '')
  }

  async cacheFromBgg(
    externalIdValue: string,
    sourceUrl: string
  ): Promise<CacheBoardGameCoverResult> {
    const externalId = validateExternalId(externalIdValue)
    const response = await this.download(allowedUrl(sourceUrl))
    const declaredType = declaredContentType(response)
    const buffer = await boundedBody(response)
    const detected = detectImage(buffer)
    if (declaredType !== detected.contentType) {
      throw new BadGatewayException(
        'BGG cover content does not match its media type'
      )
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const fileName = `${sha256}.${detected.extension}`
    await this.store(fileName, buffer)
    return {
      source: 'bgg',
      externalId,
      cachedUrl:
        `${this.publicBaseUrl}/v1/public/board-game-covers/${fileName}`,
      contentType: detected.contentType,
      sha256
    }
  }

  async cacheLocal(
    file: BoardGameCoverUpload
  ): Promise<UploadBoardGameCoverResult> {
    if (
      !Buffer.isBuffer(file?.buffer) ||
      file.buffer.length === 0 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Local board-game cover upload is invalid')
    }
    if (file.size > MAX_COVER_BYTES) {
      throw new BadRequestException('Board-game cover exceeds 10 MiB')
    }
    const detected = detectImage(file.buffer, true)
    const declaredType = file.mimetype === 'image/jpg'
      ? 'image/jpeg'
      : file.mimetype
    if (declaredType !== detected.contentType) {
      throw new BadRequestException(
        'Board-game cover content does not match its media type'
      )
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex')
    const fileName = `${sha256}.${detected.extension}`
    await this.store(fileName, file.buffer)
    return {
      source: 'local',
      cachedUrl:
        `${this.publicBaseUrl}/v1/public/board-game-covers/${fileName}`,
      contentType: detected.contentType,
      sha256
    }
  }

  async read(fileName: string): Promise<{
    buffer: Buffer
    contentType: LocalCoverContentType
  }> {
    const match = FILE_NAME_PATTERN.exec(fileName)
    if (!match) {
      throw new NotFoundException('Board game cover was not found')
    }
    const extension = match[1]
    const contentType = extension === 'jpg'
      ? 'image/jpeg'
      : extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : 'image/gif'
    try {
      return {
        buffer: await readFile(join(this.directory, fileName)),
        contentType
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Board game cover was not found')
      }
      throw error
    }
  }

  private async download(initialUrl: URL): Promise<Response> {
    let currentUrl = initialUrl
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      let response: Response
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MILLISECONDS),
          headers: { Accept: 'image/jpeg,image/png,image/webp' }
        })
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
          throw new GatewayTimeoutException('BGG cover download timed out')
        }
        throw new BadGatewayException('BGG cover download failed')
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects === MAX_REDIRECTS) {
          throw new BadGatewayException('BGG cover has too many redirects')
        }
        const location = response.headers.get('location')
        if (!location) {
          throw new BadGatewayException('BGG cover redirect is invalid')
        }
        let redirected: URL
        try {
          redirected = new URL(location, currentUrl)
        } catch {
          throw new BadGatewayException('BGG cover redirect is invalid')
        }
        currentUrl = allowedUrl(redirected)
        continue
      }

      if (!response.ok) {
        throw new BadGatewayException('BGG cover download failed')
      }
      return response
    }
    throw new BadGatewayException('BGG cover has too many redirects')
  }

  private async store(fileName: string, buffer: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const destination = join(this.directory, fileName)
    try {
      await readFile(destination)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, buffer, { flag: 'wx' })
      await rename(temporary, destination)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || code === 'EPERM') {
        try {
          await readFile(destination)
          await rm(temporary, { force: true })
          return
        } catch {
          // The destination does not exist; preserve the original rename error.
        }
      }
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
