import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import type { BackupOverview, SystemStatus } from '@zyapp/contracts'
import type { LocalDatabase } from '@zyapp/local-db'
import { redactLogValue } from '@zyapp/observability'

const DIAGNOSTIC_TABLES = [
  'store',
  'device',
  'employee',
  'member',
  'wallet_account',
  'wallet_ledger',
  'monthly_card',
  'sales_order',
  'refund_request',
  'financial_refund_request',
  'audit_log',
  'outbox_operation',
  'sync_conflict'
] as const

function readRecentRedactedLogs(logDirectory: string): unknown[] {
  if (!existsSync(logDirectory)) return []
  const files = readdirSync(logDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => ({
      name: entry.name,
      path: join(logDirectory, entry.name),
      modifiedAt: statSync(join(logDirectory, entry.name)).mtimeMs
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, 5)
  const records: unknown[] = []
  for (const file of files) {
    const lines = readFileSync(file.path, 'utf8').split(/\r?\n/).filter(Boolean).slice(-500)
    for (const line of lines) {
      try {
        records.push(redactLogValue(JSON.parse(line)))
      } catch {
        records.push(redactLogValue({ event: 'unparsed_log_line', value: line }))
      }
    }
  }
  return records
}

export function exportDiagnosticPackage(input: {
  destinationPath: string
  system: SystemStatus
  database: LocalDatabase
  databasePath: string
  dataRoot: string
  logDirectory: string
  backupOverview: BackupOverview
  now?: Date
}): { sha256: string } {
  const integrity = input.database.connection
    .prepare('PRAGMA integrity_check')
    .get() as { integrity_check: string } | undefined
  const tableCounts = Object.fromEntries(
    DIAGNOSTIC_TABLES.map((table) => [
      table,
      Number(
        (
          input.database.connection
            .prepare(`SELECT COUNT(*) count FROM ${table}`)
            .get() as { count: number }
        ).count
      )
    ])
  )
  const migrations = input.database.connection
    .prepare(
      `SELECT version, name, applied_at
       FROM schema_migrations
       ORDER BY version`
    )
    .all()
  const payload = redactLogValue({
    formatVersion: 1,
    generatedAt: (input.now ?? new Date()).toISOString(),
    app: {
      version: input.system.appVersion,
      modules: input.system.modules.map((module) => ({
        id: module.id,
        version: module.version
      }))
    },
    database: {
      fileName: input.databasePath.split(/[\\/]/).at(-1),
      storedUnderDataRoot: input.databasePath
        .toLowerCase()
        .startsWith(input.dataRoot.toLowerCase()),
      sizeBytes: existsSync(input.databasePath) ? statSync(input.databasePath).size : null,
      sqliteVersion: input.system.sqliteVersion,
      schemaVersion: input.system.schemaVersion,
      journalMode: input.system.journalMode,
      integrity: integrity?.integrity_check ?? 'missing',
      tableCounts,
      migrations
    },
    backup: {
      primaryDirectoryConfigured: Boolean(input.backupOverview.settings.primaryDirectory),
      secondaryDirectoryConfigured: Boolean(
        input.backupOverview.settings.secondaryDirectory
      ),
      files: input.backupOverview.backups.map((backup) => ({
        fileName: backup.fileName,
        kind: backup.kind,
        createdAt: backup.createdAt,
        sizeBytes: backup.sizeBytes,
        sha256: backup.sha256,
        schemaVersion: backup.schemaVersion,
        integrityOk: backup.integrityOk,
        secondaryCopy: backup.secondaryCopy
      }))
    },
    logs: readRecentRedactedLogs(input.logDirectory)
  })
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), {
    level: 9
  })
  writeFileSync(input.destinationPath, compressed)
  return {
    sha256: createHash('sha256').update(compressed).digest('hex')
  }
}
