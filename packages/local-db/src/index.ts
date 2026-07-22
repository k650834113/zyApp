import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from './migrations'
export { LATEST_SCHEMA_VERSION, migrateDatabase } from './migrations'

export * from './bootstrap'
export * from './identity'
export * from './pc-credential'
export * from './member'
export * from './wallet'
export * from './monthly-card'
export * from './catalog'
export * from './activity'
export * from './announcement'
export * from './board-game'
export * from './store-profile'
export * from './cloud-baseline'
export * from './cloud-runtime'
export * from './cloud-mirror-materialization'
export * from './order'
export * from './refund'
export * from './financial-refund'
export * from './legacy-import'
export * from './sync'
export * from './inbound-sync'
export * from './reporting'
export * from './system-operation'
export * from './cashier-command'
export * from './employee-financial-command'

export type LocalDatabase = {
  connection: DatabaseSync
  schemaVersion: number
  sqliteVersion: string
  journalMode: string
  backupTo(destinationPath: string): Promise<{
    destinationPath: string
    sha256: string
  }>
  close(): void
}

export function openLocalDatabase(filePath: string): LocalDatabase {
  mkdirSync(dirname(filePath), { recursive: true })

  const connection = new DatabaseSync(filePath)
  connection.exec('PRAGMA foreign_keys = ON')
  connection.exec('PRAGMA busy_timeout = 5000')
  const journalResult = connection.prepare('PRAGMA journal_mode = WAL').get() as {
    journal_mode: string
  }
  const schemaVersion = migrateDatabase(connection)
  const versionRow = connection.prepare('SELECT sqlite_version() AS version').get() as {
    version: string
  }

  return {
    connection,
    schemaVersion,
    sqliteVersion: versionRow.version,
    journalMode: journalResult.journal_mode,
    backupTo: async (destinationPath) => {
      mkdirSync(dirname(destinationPath), { recursive: true })
      await backup(connection, destinationPath)
      const sha256 = createHash('sha256').update(readFileSync(destinationPath)).digest('hex')
      return { destinationPath, sha256 }
    },
    close: () => connection.close()
  }
}
