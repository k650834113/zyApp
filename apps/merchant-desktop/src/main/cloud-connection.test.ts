import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultCloudBaseUrl,
  loadCloudConnection,
  normalizeCloudBaseUrl,
  saveCloudConnection
} from './cloud-connection'

const directories: string[] = []
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) =>
    value.toString('utf8').replace(/^encrypted:/, '')
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('desktop cloud connection', () => {
  it('loads update and enrollment endpoints from public configuration', () => {
    const configuration = {
      desktopProductionApiBaseUrl: 'https://api.example.com',
      desktopTestApiBaseUrl: 'https://test-api.example.com',
      miniappTestApiBaseUrl: '',
      miniappTestStoreId: ''
    }
    expect(defaultCloudBaseUrl('production', configuration)).toBe(
      'https://api.example.com'
    )
    expect(defaultCloudBaseUrl('test', configuration)).toBe(
      'https://test-api.example.com'
    )
  })

  it('encrypts the device token and restores normalized settings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-credential-'))
    directories.push(directory)
    const filePath = join(directory, 'cloud.json')

    saveCloudConnection(filePath, cipher, {
      environment: 'test',
      baseUrl: 'https://api.example.com/',
      deviceId: 'device-1',
      token: 'device-secret'
    })

    expect(readFileSync(filePath, 'utf8')).not.toContain('device-secret')
    expect(loadCloudConnection(filePath, cipher, 'test')).toEqual({
      environment: 'test',
      baseUrl: 'https://api.example.com',
      deviceId: 'device-1',
      token: 'device-secret'
    })
  })

  it('rejects credentials issued for another environment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-credential-'))
    directories.push(directory)
    const filePath = join(directory, 'cloud.json')

    saveCloudConnection(filePath, cipher, {
      environment: 'test',
      baseUrl: 'https://api.example.com',
      deviceId: 'device-1',
      token: 'device-secret'
    })

    expect(loadCloudConnection(filePath, cipher, 'production')).toBeNull()
  })

  it('permits local HTTP but rejects remote plaintext HTTP', () => {
    expect(normalizeCloudBaseUrl('http://127.0.0.1:3100/')).toBe(
      'http://127.0.0.1:3100'
    )
    expect(() =>
      normalizeCloudBaseUrl('http://api.example.com')
    ).toThrow('HTTPS')
  })
})
