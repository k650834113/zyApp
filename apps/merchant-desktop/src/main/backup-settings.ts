import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve } from 'node:path'

type StoredBackupSettings = {
  version: 1
  secondaryDirectory: string | null
}

export function loadSecondaryBackupDirectory(configPath: string): string | null {
  if (!existsSync(configPath)) return null
  const stored = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<StoredBackupSettings>
  if (
    stored.version !== 1 ||
    (stored.secondaryDirectory !== null &&
      typeof stored.secondaryDirectory !== 'string')
  ) {
    throw new Error('备份设置文件损坏')
  }
  return stored.secondaryDirectory ? resolve(stored.secondaryDirectory) : null
}

export function saveSecondaryBackupDirectory(
  configPath: string,
  directory: string | null
): void {
  mkdirSync(dirname(configPath), { recursive: true })
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`
  try {
    const stored: StoredBackupSettings = {
      version: 1,
      secondaryDirectory: directory ? resolve(directory) : null
    }
    writeFileSync(temporaryPath, JSON.stringify(stored), {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temporaryPath, configPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}
