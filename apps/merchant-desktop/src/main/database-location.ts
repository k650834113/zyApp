import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'

type StoredDatabaseLocation = {
  version: 1
  databasePath: string
}

export function loadConfiguredDatabasePath(
  configPath: string,
  defaultDatabasePath: string
): string {
  if (!existsSync(configPath)) return resolve(defaultDatabasePath)
  const stored = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<StoredDatabaseLocation>
  if (stored.version !== 1 || typeof stored.databasePath !== 'string') {
    throw new Error('数据库位置配置文件损坏')
  }
  const databasePath = resolve(stored.databasePath)
  if (!existsSync(databasePath)) {
    throw new Error(`配置的数据库不存在：${databasePath}`)
  }
  return databasePath
}

export function saveConfiguredDatabasePath(
  configPath: string,
  databasePath: string
): void {
  mkdirSync(dirname(configPath), { recursive: true })
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`
  try {
    const stored: StoredDatabaseLocation = {
      version: 1,
      databasePath: resolve(databasePath)
    }
    writeFileSync(temporaryPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, configPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function copyDatabaseFileVerified(
  sourcePath: string,
  destinationPath: string
): string {
  if (existsSync(destinationPath)) {
    throw new Error('目标目录已经存在 zyapp.db，请选择空目录')
  }
  mkdirSync(dirname(destinationPath), { recursive: true })
  const temporaryPath = `${destinationPath}.${randomUUID()}.migrating`
  try {
    copyFileSync(sourcePath, temporaryPath)
    const sourceSha256 = fileSha256(sourcePath)
    if (sourceSha256 !== fileSha256(temporaryPath)) {
      throw new Error('数据库复制校验失败')
    }
    if (existsSync(destinationPath)) {
      throw new Error('目标目录在移动过程中出现了 zyapp.db，请重新选择空目录')
    }
    renameSync(temporaryPath, destinationPath)
    return sourceSha256
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}
