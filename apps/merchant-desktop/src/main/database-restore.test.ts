import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapStore, openLocalDatabase, type LocalDatabase } from '@zyapp/local-db'
import { replaceDatabaseFromBackup } from './database-restore'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function createStoreDatabase(filePath: string, storeName: string): LocalDatabase {
  const database = openLocalDatabase(filePath)
  bootstrapStore(database.connection, {
    storeName,
    managerUsername: 'manager',
    managerPasswordHash: 'scrypt$manager',
    managerDisplayName: 'Owner',
    deviceName: 'Cashier 01'
  })
  return database
}

describe('atomic database restore', () => {
  it('replaces the active database with a verified backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-restore-'))
    temporaryDirectories.push(directory)
    const activePath = join(directory, 'active.db')
    const backupPath = join(directory, 'backup.db')
    let active: LocalDatabase | null = createStoreDatabase(activePath, 'Current Store')
    const backupSource = createStoreDatabase(
      join(directory, 'backup-source.db'),
      'Restored Store'
    )
    await backupSource.backupTo(backupPath)
    backupSource.close()

    active = replaceDatabaseFromBackup({
      sourcePath: backupPath,
      activePath,
      activeDatabase: active,
      onDatabaseUnavailable: () => {
        active = null
      },
      onDatabaseReady: (database) => {
        active = database
      }
    })

    expect(
      active.connection.prepare('SELECT name FROM store').get()
    ).toEqual({ name: 'Restored Store' })
    active.close()
  })

  it('reopens the original database when opening the replacement fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-restore-'))
    temporaryDirectories.push(directory)
    const activePath = join(directory, 'active.db')
    const backupPath = join(directory, 'backup.db')
    let active: LocalDatabase | null = createStoreDatabase(activePath, 'Current Store')
    const backupSource = createStoreDatabase(
      join(directory, 'backup-source.db'),
      'Restored Store'
    )
    await backupSource.backupTo(backupPath)
    backupSource.close()
    let openAttempts = 0

    expect(() =>
      replaceDatabaseFromBackup({
        sourcePath: backupPath,
        activePath,
        activeDatabase: active as LocalDatabase,
        openDatabase: (filePath) => {
          openAttempts += 1
          if (openAttempts === 1) throw new Error('simulated replacement open failure')
          return openLocalDatabase(filePath)
        },
        onDatabaseUnavailable: () => {
          active = null
        },
        onDatabaseReady: (database) => {
          active = database
        }
      })
    ).toThrow('simulated replacement open failure')

    expect(active).not.toBeNull()
    expect(
      (active as LocalDatabase).connection.prepare('SELECT name FROM store').get()
    ).toEqual({ name: 'Current Store' })
    ;(active as LocalDatabase).close()
  })
})
