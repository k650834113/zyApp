import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { DataEnvironment } from '@zyapp/contracts'

type StoredDataEnvironment = {
  version: 1
  environment: DataEnvironment
}

export function isDataEnvironment(value: unknown): value is DataEnvironment {
  return value === 'production' || value === 'test'
}

export function loadDataEnvironment(filePath: string): DataEnvironment {
  if (!existsSync(filePath)) return 'production'
  try {
    const stored = JSON.parse(
      readFileSync(filePath, 'utf8')
    ) as Partial<StoredDataEnvironment>
    if (stored.version !== 1 || !isDataEnvironment(stored.environment)) {
      throw new Error('Invalid data environment configuration')
    }
    return stored.environment
  } catch (error) {
    throw new Error(
      `Unable to read data environment configuration: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export function saveDataEnvironment(
  filePath: string,
  environment: DataEnvironment
): void {
  const stored: StoredDataEnvironment = { version: 1, environment }
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(stored), {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temporaryPath, filePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function resolveEnvironmentDataRoot(
  installationDataRoot: string,
  environment: DataEnvironment
): string {
  return environment === 'production'
    ? installationDataRoot
    : join(installationDataRoot, 'environments', 'test')
}

export function environmentSwitchBlockReason(input: {
  cloudPrimaryActivated: boolean
  pendingOperations: number
}): string | null {
  if (input.cloudPrimaryActivated && input.pendingOperations > 0) {
    return '当前环境仍有待同步操作，请先完成云端同步后再切换环境'
  }
  return null
}
