import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ApiConfig } from './config'
import { DesktopUpdateService } from './desktop-update.service'

function config(directory: string): ApiConfig {
  return {
    nodeEnv: 'test',
    deploymentEnvironment: 'test',
    port: 3100,
    databaseUrl: 'postgres://test',
    redisUrl: 'redis://test',
    deviceEnrollmentSecret: 'a'.repeat(32),
    desktopUpdateDirectory: directory,
    phoneVerificationSecret: 'b'.repeat(32),
    phoneVerificationMode: 'mock',
    wechatPaymentMode: 'mock',
    miniappDevelopmentAuthEnabled: true
  }
}

describe('desktop update file service', () => {
  it('serves the manifest without caching and supports installer ranges', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-updates-'))
    try {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'latest.yml'), 'version: 0.9.0\n')
      writeFileSync(
        join(directory, 'release-manifest.json'),
        '{"version":"0.9.0"}'
      )
      writeFileSync(join(directory, 'ZyApp Setup 0.9.0.exe'), '0123456789')
      const service = new DesktopUpdateService(config(directory))
      const manifest = service.open('latest.yml')
      expect(manifest).toMatchObject({
        statusCode: 200,
        contentType: 'text/yaml; charset=utf-8',
        cacheControl: 'no-store'
      })
      manifest.stream.destroy()
      const releaseManifest = service.open('release-manifest.json')
      expect(releaseManifest).toMatchObject({
        statusCode: 200,
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-store'
      })
      releaseManifest.stream.destroy()
      const partial = service.open('ZyApp Setup 0.9.0.exe', 'bytes=2-5')
      expect(partial).toMatchObject({
        statusCode: 206,
        contentLength: 4,
        contentRange: 'bytes 2-5/10'
      })
      const chunks: Buffer[] = []
      for await (const chunk of partial.stream) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toBe('2345')
      expect(readFileSync(join(directory, 'latest.yml'), 'utf8')).toContain(
        '0.9.0'
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects traversal and unknown files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-updates-'))
    try {
      const service = new DesktopUpdateService(config(directory))
      expect(() => service.open('../latest.yml')).toThrow('not found')
      expect(() => service.open('notes.txt')).toThrow('not found')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
