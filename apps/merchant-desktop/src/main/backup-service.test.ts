import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapStore, migrateDatabase, openLocalDatabase } from '@zyapp/local-db'
import {
  createDatabaseBackup,
  createPreUpgradeBackup,
  inspectDatabaseFile,
  isAutomaticBackupDue,
  listDatabaseBackups,
  selectAutomaticBackupsToKeep,
  stageDatabaseRestore
} from './backup-service'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('desktop backup service', () => {
  it('creates, verifies, mirrors and stages a consistent database backup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-backup-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'data', 'zyapp.db')
    const primary = join(directory, 'backups')
    const secondary = join(directory, 'secondary')
    const localDatabase = openLocalDatabase(databasePath)
    bootstrapStore(localDatabase.connection, {
      storeName: 'Backup Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$manager',
      managerDisplayName: 'Owner',
      deviceName: 'Cashier 01'
    })

    const result = await createDatabaseBackup({
      database: localDatabase,
      primaryDirectory: primary,
      secondaryDirectory: secondary,
      kind: 'manual',
      now: new Date('2026-06-13T01:00:00.000Z')
    })
    const inspection = inspectDatabaseFile(result.backup.filePath)
    const listed = listDatabaseBackups(primary, secondary)
    const staged = stageDatabaseRestore(result.backup.filePath, databasePath)

    expect(result.backup).toMatchObject({
      kind: 'manual',
      createdAt: '2026-06-13T01:00:00.000Z',
      schemaVersion: 25,
      integrityOk: true,
      secondaryCopy: true
    })
    expect(result.secondaryPath).toBeTruthy()
    expect(inspection).toMatchObject({
      schemaVersion: 25,
      integrityOk: true,
      storeCount: 1
    })
    expect(listed).toHaveLength(1)
    expect(staged.sourceSha256).toBe(result.backup.sha256)
    rmSync(staged.stagedPath, { force: true })
    localDatabase.close()
  })

  it('requires an automatic backup after six hours', () => {
    expect(isAutomaticBackupDue([], new Date('2026-06-13T08:00:00.000Z'))).toBe(true)
    expect(
      isAutomaticBackupDue(
        [
          {
            fileName: 'auto.db',
            filePath: 'auto.db',
            kind: 'automatic',
            createdAt: '2026-06-13T03:00:00.000Z',
            sizeBytes: 1,
            sha256: 'a'.repeat(64),
            schemaVersion: 11,
            integrityOk: true,
            secondaryCopy: false
          }
        ],
        new Date('2026-06-13T08:59:59.000Z')
      )
    ).toBe(false)
    expect(
      isAutomaticBackupDue(
        [
          {
            fileName: 'auto.db',
            filePath: 'auto.db',
            kind: 'automatic',
            createdAt: '2026-06-13T03:00:00.000Z',
            sizeBytes: 1,
            sha256: 'a'.repeat(64),
            schemaVersion: 11,
            integrityOk: true,
            secondaryCopy: false
          }
        ],
        new Date('2026-06-13T09:00:00.000Z')
      )
    ).toBe(true)
  })

  it('creates a consistent backup before opening an old schema for migration', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-pre-upgrade-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'zyapp.db')
    const oldDatabase = new DatabaseSync(databasePath)
    migrateDatabase(oldDatabase, 10)
    oldDatabase.close()

    const result = await createPreUpgradeBackup({
      databasePath,
      primaryDirectory: join(directory, 'backups'),
      secondaryDirectory: null,
      currentSchemaVersion: 10,
      now: new Date('2026-06-13T02:00:00.000Z')
    })

    expect(result.backup).toMatchObject({
      kind: 'pre_upgrade',
      integrityOk: true
    })
    expect(inspectDatabaseFile(result.backup.filePath).schemaVersion).toBe(10)
  })

  it('keeps 30 daily representatives and 12 monthly representatives', () => {
    const backups = Array.from({ length: 400 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 11, 31 - index, 12))
      return {
        fileName: `${index}.db`,
        filePath: `${index}.db`,
        kind: 'automatic' as const,
        createdAt: date.toISOString(),
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
        schemaVersion: 11,
        integrityOk: true,
        secondaryCopy: false
      }
    })
    const keep = selectAutomaticBackupsToKeep(backups)
    const kept = backups.filter((backup) => keep.has(backup.filePath))
    const days = new Set(kept.slice(0, 30).map((backup) => backup.createdAt.slice(0, 10)))
    const months = new Set(kept.map((backup) => backup.createdAt.slice(0, 7)))

    expect(days.size).toBe(30)
    expect(months.size).toBe(12)
    expect(keep.size).toBeGreaterThanOrEqual(40)
    expect(keep.size).toBeLessThanOrEqual(42)
  })
})
