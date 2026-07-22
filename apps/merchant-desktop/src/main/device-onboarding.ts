import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { DataEnvironment } from '@zyapp/contracts'

type CredentialCipher = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export type PendingDeviceOnboarding = {
  version: 1
  phase: 'requested' | 'enrolled'
  environment: DataEnvironment
  requestId: string
  baseUrl: string
  deviceId: string
  deviceName: string
  tenantId?: string
  storeId?: string
  storeName?: string
  epochId?: string
  token?: string
  updatedAt: string
  lastError?: string
}

export function loadPendingDeviceOnboarding(
  filePath: string,
  cipher: CredentialCipher,
  environment: DataEnvironment
): PendingDeviceOnboarding | null {
  if (!existsSync(filePath) || !cipher.isEncryptionAvailable()) return null
  try {
    const encrypted = Buffer.from(readFileSync(filePath, 'utf8'), 'base64')
    const value = JSON.parse(cipher.decryptString(encrypted)) as PendingDeviceOnboarding
    if (
      value.version !== 1 ||
      value.environment !== environment ||
      (value.phase !== 'requested' && value.phase !== 'enrolled') ||
      typeof value.requestId !== 'string' ||
      typeof value.deviceId !== 'string'
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function savePendingDeviceOnboarding(
  filePath: string,
  cipher: CredentialCipher,
  value: PendingDeviceOnboarding
): void {
  if (!cipher.isEncryptionAvailable()) {
    throw new Error('Current Windows environment cannot encrypt onboarding state')
  }
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    const encrypted = cipher.encryptString(JSON.stringify(value)).toString('base64')
    writeFileSync(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, filePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function clearPendingDeviceOnboarding(filePath: string): void {
  rmSync(filePath, { force: true })
}
