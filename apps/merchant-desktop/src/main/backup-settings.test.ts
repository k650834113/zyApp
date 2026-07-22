import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadSecondaryBackupDirectory,
  saveSecondaryBackupDirectory
} from './backup-settings'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('backup settings', () => {
  it('stores and clears the optional secondary directory atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-backup-settings-'))
    temporaryDirectories.push(directory)
    const configPath = join(directory, 'config', 'backup-settings.json')
    const secondary = join(directory, 'secondary')

    expect(loadSecondaryBackupDirectory(configPath)).toBeNull()
    saveSecondaryBackupDirectory(configPath, secondary)
    expect(loadSecondaryBackupDirectory(configPath)).toBe(resolve(secondary))
    saveSecondaryBackupDirectory(configPath, null)
    expect(loadSecondaryBackupDirectory(configPath)).toBeNull()
  })
})
