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
import {
  configuredCloudBaseUrl,
  type PublicEndpointConfiguration
} from '../shared/public-endpoints'

type CredentialCipher = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export type CloudConnection = {
  environment: DataEnvironment
  baseUrl: string
  deviceId: string
  token: string
}

export function defaultCloudBaseUrl(
  environment: DataEnvironment,
  configuration?: PublicEndpointConfiguration
): string {
  return configuredCloudBaseUrl(environment, configuration)
}

type StoredCloudConnection = {
  version: 2
  environment: DataEnvironment
  baseUrl: string
  deviceId: string
  encryptedToken: string
}

export function normalizeCloudBaseUrl(value: string): string {
  const url = new URL(value.trim())
  const local =
    url.hostname === '127.0.0.1' ||
    url.hostname === 'localhost' ||
    url.hostname === '::1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Cloud service URL must use HTTPS')
  }
  url.username = ''
  url.password = ''
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

export function loadCloudConnection(
  filePath: string,
  cipher: CredentialCipher,
  expectedEnvironment: DataEnvironment
): CloudConnection | null {
  if (!existsSync(filePath) || !cipher.isEncryptionAvailable()) return null
  try {
    const stored = JSON.parse(
      readFileSync(filePath, 'utf8')
    ) as Partial<StoredCloudConnection>
    if (
      stored.version !== 2 ||
      stored.environment !== expectedEnvironment ||
      typeof stored.baseUrl !== 'string' ||
      typeof stored.deviceId !== 'string' ||
      typeof stored.encryptedToken !== 'string'
    ) {
      return null
    }
    return {
      environment: expectedEnvironment,
      baseUrl: normalizeCloudBaseUrl(stored.baseUrl),
      deviceId: stored.deviceId,
      token: cipher.decryptString(Buffer.from(stored.encryptedToken, 'base64'))
    }
  } catch {
    return null
  }
}

export function saveCloudConnection(
  filePath: string,
  cipher: CredentialCipher,
  connection: CloudConnection
): void {
  if (!cipher.isEncryptionAvailable()) {
    throw new Error('Current Windows environment cannot encrypt cloud credentials')
  }
  const stored: StoredCloudConnection = {
    version: 2,
    environment: connection.environment,
    baseUrl: normalizeCloudBaseUrl(connection.baseUrl),
    deviceId: connection.deviceId,
    encryptedToken: cipher.encryptString(connection.token).toString('base64')
  }
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

export function clearCloudConnection(filePath: string): void {
  rmSync(filePath, { force: true })
}
