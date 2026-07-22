import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapStore, openLocalDatabase } from '@zyapp/local-db'
import { exportDiagnosticPackage } from './diagnostic-export'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('diagnostic export', () => {
  it('exports database health and redacted logs without member details', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-diagnostic-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'data', 'zyapp.db')
    const logDirectory = join(directory, 'logs')
    const destinationPath = join(directory, 'diagnostic.json.gz')
    mkdirSync(logDirectory, { recursive: true })
    writeFileSync(
      join(logDirectory, 'zyapp-2026-06-13.log'),
      `${JSON.stringify({
        timestamp: '2026-06-13T01:00:00.000Z',
        event: 'test',
        context: { phone: '13800138000', token: 'secret', note: 'call 13900139000' }
      })}\n`,
      'utf8'
    )
    const database = openLocalDatabase(databasePath)
    bootstrapStore(database.connection, {
      storeName: 'Diagnostic Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$manager',
      managerDisplayName: 'Owner',
      deviceName: 'Cashier 01'
    })
    const result = exportDiagnosticPackage({
      destinationPath,
      database,
      databasePath,
      dataRoot: directory,
      logDirectory,
      system: {
        appVersion: '0.7.0',
        dataEnvironment: 'test',
        activeStoreProfileId: 'profile-test',
        databasePath,
        sqliteVersion: database.sqliteVersion,
        schemaVersion: database.schemaVersion,
        journalMode: database.journalMode,
        modules: []
      },
      backupOverview: {
        settings: {
          primaryDirectory: join(directory, 'backups'),
          secondaryDirectory: null
        },
        backups: []
      },
      now: new Date('2026-06-13T02:00:00.000Z')
    })
    const content = gunzipSync(readFileSync(destinationPath)).toString('utf8')

    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(content).toContain('"integrity": "ok"')
    expect(content).toContain('"member": 0')
    expect(content).not.toContain('13800138000')
    expect(content).not.toContain('13900139000')
    expect(content).not.toContain('"secret"')
    expect(content).toContain('[REDACTED]')
    expect(content).toContain('139****9000')
    database.close()
  })
})
