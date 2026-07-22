import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import type { ReadStream } from 'node:fs'
import { API_CONFIG } from './infrastructure.module'
import type { ApiConfig } from './config'

export type DesktopUpdateFile = {
  stream: ReadStream
  statusCode: 200 | 206
  contentType: string
  contentLength: number
  contentRange: string | null
  cacheControl: string
}

function contentType(fileName: string): string {
  if (fileName === 'latest.yml') return 'text/yaml; charset=utf-8'
  if (fileName === 'release-manifest.json') {
    return 'application/json; charset=utf-8'
  }
  if (fileName.endsWith('.blockmap')) return 'application/octet-stream'
  if (extname(fileName).toLowerCase() === '.exe') {
    return 'application/vnd.microsoft.portable-executable'
  }
  return 'application/octet-stream'
}

function allowedFileName(fileName: string): boolean {
  return (
    fileName === 'latest.yml' ||
    fileName === 'release-manifest.json' ||
    fileName.endsWith('.exe') ||
    fileName.endsWith('.exe.blockmap')
  )
}

function byteRange(
  header: string,
  size: number
): { start: number; end: number } {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) {
    throw new HttpException(
      'Requested range is not satisfiable',
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE
    )
  }
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) {
    throw new HttpException(
      'Requested range is not satisfiable',
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE
    )
  }
  let start: number
  let end: number
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      throw new HttpException(
        'Requested range is not satisfiable',
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE
      )
    }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText ? Number(endText) : size - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new HttpException(
      'Requested range is not satisfiable',
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE
    )
  }
  return { start, end: Math.min(end, size - 1) }
}

@Injectable()
export class DesktopUpdateService {
  private readonly directory: string

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.directory = resolve(config.desktopUpdateDirectory)
  }

  open(fileNameInput: string, rangeHeader?: string): DesktopUpdateFile {
    const fileName = fileNameInput.trim()
    if (
      !fileName ||
      basename(fileName) !== fileName ||
      !allowedFileName(fileName)
    ) {
      throw new NotFoundException('Update file was not found')
    }
    const filePath = resolve(this.directory, fileName)
    if (!filePath.startsWith(this.directory) || !existsSync(filePath)) {
      throw new NotFoundException('Update file was not found')
    }
    const stat = statSync(filePath)
    if (!stat.isFile()) throw new NotFoundException('Update file was not found')
    const cacheControl =
      fileName === 'latest.yml' || fileName === 'release-manifest.json'
        ? 'no-store'
        : 'public, max-age=31536000, immutable'
    if (!rangeHeader) {
      return {
        stream: createReadStream(filePath),
        statusCode: 200,
        contentType: contentType(fileName),
        contentLength: stat.size,
        contentRange: null,
        cacheControl
      }
    }
    const range = byteRange(rangeHeader, stat.size)
    return {
      stream: createReadStream(filePath, range),
      statusCode: 206,
      contentType: contentType(fileName),
      contentLength: range.end - range.start + 1,
      contentRange: `bytes ${range.start}-${range.end}/${stat.size}`,
      cacheControl
    }
  }
}
