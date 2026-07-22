import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  environmentSwitchBlockReason,
  loadDataEnvironment,
  resolveEnvironmentDataRoot,
  saveDataEnvironment
} from './data-environment'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('desktop data environment', () => {
  it('defaults to production and persists an explicit selection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-environment-'))
    directories.push(directory)
    const filePath = join(directory, 'config', 'active-environment.json')

    expect(loadDataEnvironment(filePath)).toBe('production')
    saveDataEnvironment(filePath, 'test')
    expect(loadDataEnvironment(filePath)).toBe('test')
  })

  it('keeps the legacy root for production and isolates test data', () => {
    expect(resolveEnvironmentDataRoot('C:/ZyApp', 'production')).toBe('C:/ZyApp')
    expect(resolveEnvironmentDataRoot('C:/ZyApp', 'test')).toBe(
      join('C:/ZyApp', 'environments', 'test')
    )
  })

  it('allows a pre-cloud offline database to switch without uploading old outbox history', () => {
    expect(
      environmentSwitchBlockReason({
        cloudPrimaryActivated: false,
        pendingOperations: 27
      })
    ).toBeNull()
  })

  it('blocks an activated cloud mirror while operations are still pending', () => {
    expect(
      environmentSwitchBlockReason({
        cloudPrimaryActivated: true,
        pendingOperations: 1
      })
    ).toBe('当前环境仍有待同步操作，请先完成云端同步后再切换环境')
  })
})
