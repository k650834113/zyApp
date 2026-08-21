import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname, join, resolve } from 'node:path'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

function requireSupportedImage(sourcePath: string): {
  extension: string
  mime: string
} {
  const extension = extname(sourcePath).toLowerCase()
  const mime = MIME_BY_EXTENSION[extension]
  if (!mime) throw new Error('图片只支持 JPG、PNG、WEBP 或 GIF')
  const stat = statSync(sourcePath)
  if (!stat.isFile()) throw new Error('所选图片不是普通文件')
  if (stat.size > 10 * 1024 * 1024) {
    throw new Error('图片大小不能超过 10 MB')
  }
  return { extension, mime }
}

export function importBoardGameImage(
  sourcePath: string,
  dataRoot: string
): { managedPath: string; previewDataUrl: string } {
  const { extension, mime } = requireSupportedImage(sourcePath)
  const directory = join(dataRoot, 'assets', 'board-games')
  mkdirSync(directory, { recursive: true })
  const managedPath = join(directory, `${randomUUID()}${extension}`)
  copyFileSync(sourcePath, managedPath)
  return {
    managedPath,
    previewDataUrl: `data:${mime};base64,${readFileSync(managedPath).toString('base64')}`
  }
}

export function readManagedBoardGameImage(
  managedPath: string,
  dataRoot: string
): string | null {
  const file = readManagedBoardGameImageFile(managedPath, dataRoot)
  return file
    ? `data:${file.contentType};base64,${file.buffer.toString('base64')}`
    : null
}

export function readManagedBoardGameImageFile(
  managedPath: string,
  dataRoot: string
): { buffer: Buffer; contentType: string; fileName: string } | null {
  const root = resolve(dataRoot, 'assets', 'board-games')
  const target = resolve(managedPath)
  if (
    target !== root &&
    !target.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error('图片路径不属于当前程序的数据目录')
  }
  if (!existsSync(target)) return null
  const { mime } = requireSupportedImage(target)
  return {
    buffer: readFileSync(target),
    contentType: mime,
    fileName: basename(target)
  }
}
