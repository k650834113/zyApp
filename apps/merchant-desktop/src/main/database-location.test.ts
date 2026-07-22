import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyDatabaseFileVerified,
  loadConfiguredDatabasePath,
  saveConfiguredDatabasePath
} from './database-location'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('database location configuration', () => {
  it('uses the default path until a verified custom path is saved', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-location-'))
    temporaryDirectories.push(directory)
    const configPath = join(directory, 'config', 'database-location.json')
    const defaultPath = join(directory, 'default', 'zyapp.db')
    expect(loadConfiguredDatabasePath(configPath, defaultPath)).toBe(resolve(defaultPath))

    const customPath = join(directory, 'custom', 'zyapp.db')
    mkdirSync(join(directory, 'custom'), { recursive: true })
    writeFileSync(customPath, 'database')
    saveConfiguredDatabasePath(configPath, customPath)
    expect(loadConfiguredDatabasePath(configPath, defaultPath)).toBe(resolve(customPath))
  })

  it('refuses to silently create a blank database when the configured file is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-location-'))
    temporaryDirectories.push(directory)
    const configPath = join(directory, 'database-location.json')
    saveConfiguredDatabasePath(configPath, join(directory, 'missing', 'zyapp.db'))
    expect(() =>
      loadConfiguredDatabasePath(configPath, join(directory, 'default.db'))
    ).toThrow('不存在')
  })

  it('copies a database byte-for-byte and refuses to overwrite an existing target', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-copy-'))
    temporaryDirectories.push(directory)
    const sourcePath = join(directory, 'source.db')
    const destinationPath = join(directory, 'new-location', 'zyapp.db')
    const contents = Buffer.from('SQLite format 3\0test-database-content')
    writeFileSync(sourcePath, contents)

    expect(copyDatabaseFileVerified(sourcePath, destinationPath)).toMatch(/^[a-f0-9]{64}$/)
    expect(existsSync(sourcePath)).toBe(true)
    expect(readFileSync(destinationPath)).toEqual(contents)
    expect(() => copyDatabaseFileVerified(sourcePath, destinationPath)).toThrow(
      '已经存在'
    )
  })
})
