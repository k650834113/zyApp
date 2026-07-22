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
import type { SavedLoginCredentials } from '@zyapp/contracts'

type CredentialCipher = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

type StoredCredential = {
  version: 1
  username: string
  encryptedPassword: string
}

export function loadRememberedLogin(
  filePath: string,
  cipher: CredentialCipher
): SavedLoginCredentials | null {
  if (!existsSync(filePath) || !cipher.isEncryptionAvailable()) return null
  try {
    const stored = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoredCredential>
    if (
      stored.version !== 1 ||
      typeof stored.username !== 'string' ||
      typeof stored.encryptedPassword !== 'string'
    ) {
      return null
    }
    return {
      username: stored.username,
      password: cipher.decryptString(Buffer.from(stored.encryptedPassword, 'base64'))
    }
  } catch {
    return null
  }
}

export function saveRememberedLogin(
  filePath: string,
  cipher: CredentialCipher,
  credentials: SavedLoginCredentials
): void {
  if (!cipher.isEncryptionAvailable()) {
    throw new Error('当前 Windows 环境无法安全保存登录密码')
  }
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  const stored: StoredCredential = {
    version: 1,
    username: credentials.username,
    encryptedPassword: cipher.encryptString(credentials.password).toString('base64')
  }
  try {
    writeFileSync(temporaryPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, filePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function clearRememberedLogin(filePath: string): void {
  rmSync(filePath, { force: true })
}
