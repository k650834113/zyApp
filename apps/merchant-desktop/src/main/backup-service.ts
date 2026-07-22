import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type {
  BackupFileSummary,
  BackupKind,
  CreateBackupResult
} from '@zyapp/contracts'
import type { LocalDatabase } from '@zyapp/local-db'

type BackupManifest = {
  version: 1
  kind: BackupKind
  createdAt: string
  sha256: string
  schemaVersion: number
  requestId: string | null
}

const BACKUP_PATTERN = /^zyapp-([a-z_]+)-(.+)\.db$/i

function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function manifestPath(databaseFilePath: string): string {
  return `${databaseFilePath}.backup.json`
}

function timestampForFile(date: Date): string {
  return date.toISOString().replaceAll(':', '-')
}

function parseKind(fileName: string): BackupKind {
  if (fileName.startsWith('before-database-move-')) return 'pre_move'
  if (fileName.startsWith('before-legacy-import-')) return 'pre_import'
  const match = BACKUP_PATTERN.exec(fileName)
  const value = match?.[1]
  return value === 'automatic' ||
    value === 'manual' ||
    value === 'pre_restore' ||
    value === 'pre_upgrade' ||
    value === 'pre_import' ||
    value === 'pre_move' ||
    value === 'pre_environment_switch'
    ? value
    : 'unknown'
}

function readManifest(filePath: string): BackupManifest | null {
  const path = manifestPath(filePath)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Omit<
      BackupManifest,
      'requestId'
    > & { requestId?: string | null }
    if (
      value.version !== 1 ||
      typeof value.createdAt !== 'string' ||
      typeof value.sha256 !== 'string' ||
      typeof value.schemaVersion !== 'number' ||
      (value.requestId !== undefined &&
        value.requestId !== null &&
        typeof value.requestId !== 'string')
    ) {
      return null
    }
    return {
      ...value,
      requestId: value.requestId ?? null
    }
  } catch {
    return null
  }
}

function writeManifest(filePath: string, manifest: BackupManifest): void {
  const path = manifestPath(filePath)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(manifest), {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function inspectDatabaseFile(filePath: string): {
  filePath: string
  sizeBytes: number
  sha256: string
  schemaVersion: number
  sqliteVersion: string
  integrityOk: boolean
  integrityMessage: string
  storeCount: number
} {
  const resolvedPath = resolve(filePath)
  if (!existsSync(resolvedPath)) throw new Error('数据库文件不存在')
  const descriptor = openSync(resolvedPath, 'r')
  const headerBuffer = Buffer.alloc(16)
  try {
    readSync(descriptor, headerBuffer, 0, headerBuffer.length, 0)
  } finally {
    closeSync(descriptor)
  }
  const header = headerBuffer.toString('utf8')
  if (header !== 'SQLite format 3\0') {
    throw new Error('所选文件不是 SQLite 数据库')
  }
  const database = new DatabaseSync(resolvedPath, { readOnly: true })
  try {
    const integrity = database.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined
    const schema = database
      .prepare(
        `SELECT COALESCE(MAX(version), 0) version
         FROM schema_migrations`
      )
      .get() as { version: number }
    const version = database.prepare('SELECT sqlite_version() version').get() as {
      version: string
    }
    const store = database.prepare('SELECT COUNT(*) count FROM store').get() as {
      count: number
    }
    return {
      filePath: resolvedPath,
      sizeBytes: statSync(resolvedPath).size,
      sha256: fileSha256(resolvedPath),
      schemaVersion: Number(schema.version),
      sqliteVersion: version.version,
      integrityOk: integrity?.integrity_check === 'ok',
      integrityMessage: integrity?.integrity_check ?? 'missing integrity result',
      storeCount: Number(store.count)
    }
  } catch (error) {
    throw new Error(
      `数据库结构无法识别：${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    database.close()
  }
}

function backupSummary(
  filePath: string,
  secondaryDirectory: string | null
): BackupFileSummary {
  const inspection = inspectDatabaseFile(filePath)
  const manifest = readManifest(filePath)
  const stat = statSync(filePath)
  const fileName = basename(filePath)
  const secondaryPath = secondaryDirectory
    ? join(secondaryDirectory, fileName)
    : null
  return {
    fileName,
    filePath: resolve(filePath),
    kind: manifest?.kind ?? parseKind(fileName),
    createdAt: manifest?.createdAt ?? stat.mtime.toISOString(),
    sizeBytes: inspection.sizeBytes,
    sha256: inspection.sha256,
    schemaVersion: inspection.schemaVersion,
    integrityOk: inspection.integrityOk,
    secondaryCopy:
      secondaryPath !== null &&
      existsSync(secondaryPath) &&
      statSync(secondaryPath).size === inspection.sizeBytes &&
      fileSha256(secondaryPath) === inspection.sha256
  }
}

export function listDatabaseBackups(
  primaryDirectory: string,
  secondaryDirectory: string | null
): BackupFileSummary[] {
  mkdirSync(primaryDirectory, { recursive: true })
  return readdirSync(primaryDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.db'))
    .map((entry) => join(primaryDirectory, entry.name))
    .map((filePath) => {
      try {
        return backupSummary(filePath, secondaryDirectory)
      } catch {
        return null
      }
    })
    .filter((value): value is BackupFileSummary => value !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function copyBackupVerified(sourcePath: string, directory: string): string {
  mkdirSync(directory, { recursive: true })
  const destinationPath = join(directory, basename(sourcePath))
  const temporaryPath = `${destinationPath}.${randomUUID()}.copying`
  try {
    copyFileSync(sourcePath, temporaryPath)
    if (fileSha256(sourcePath) !== fileSha256(temporaryPath)) {
      throw new Error('第二备份目录复制校验失败')
    }
    rmSync(destinationPath, { force: true })
    renameSync(temporaryPath, destinationPath)
    const sourceManifest = manifestPath(sourcePath)
    if (existsSync(sourceManifest)) {
      copyFileSync(sourceManifest, manifestPath(destinationPath))
    }
    return destinationPath
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function pruneAutomaticBackups(primaryDirectory: string): void {
  const automatic = listDatabaseBackups(primaryDirectory, null).filter(
    (backup) => backup.kind === 'automatic'
  )
  const keep = selectAutomaticBackupsToKeep(automatic)
  for (const backup of automatic) {
    if (keep.has(backup.filePath)) continue
    rmSync(backup.filePath, { force: true })
    rmSync(manifestPath(backup.filePath), { force: true })
  }
}

export function selectAutomaticBackupsToKeep(
  automatic: BackupFileSummary[]
): Set<string> {
  const sorted = [...automatic].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )
  const keep = new Set<string>()
  const daily = new Set<string>()
  const monthly = new Set<string>()
  for (const backup of sorted) {
    const day = backup.createdAt.slice(0, 10)
    if (daily.size < 30 && !daily.has(day)) {
      daily.add(day)
      keep.add(backup.filePath)
    }
  }
  for (const backup of sorted) {
    const month = backup.createdAt.slice(0, 7)
    if (monthly.size < 12 && !monthly.has(month)) {
      monthly.add(month)
      keep.add(backup.filePath)
    }
  }
  return keep
}

export async function createDatabaseBackup(input: {
  database: LocalDatabase
  primaryDirectory: string
  secondaryDirectory: string | null
  kind: Exclude<BackupKind, 'unknown'>
  requestId?: string
  now?: Date
}): Promise<CreateBackupResult> {
  const now = input.now ?? new Date()
  mkdirSync(input.primaryDirectory, { recursive: true })
  const fileName = `zyapp-${input.kind}-${timestampForFile(now)}.db`
  const filePath = join(input.primaryDirectory, fileName)
  const result = await input.database.backupTo(filePath)
  const manifest: BackupManifest = {
    version: 1,
    kind: input.kind,
    createdAt: now.toISOString(),
    sha256: result.sha256,
    schemaVersion: input.database.schemaVersion,
    requestId: input.requestId ?? null
  }
  writeManifest(filePath, manifest)
  const inspection = inspectDatabaseFile(filePath)
  if (!inspection.integrityOk) {
    throw new Error(`备份完整性校验失败：${inspection.integrityMessage}`)
  }
  let secondaryPath: string | null = null
  let secondaryError: string | null = null
  if (input.secondaryDirectory) {
    try {
      secondaryPath = copyBackupVerified(filePath, input.secondaryDirectory)
    } catch (error) {
      secondaryError = error instanceof Error ? error.message : String(error)
    }
  }
  if (input.kind === 'automatic') {
    pruneAutomaticBackups(input.primaryDirectory)
    if (input.secondaryDirectory) {
      pruneAutomaticBackups(input.secondaryDirectory)
    }
  }
  return {
    backup: backupSummary(filePath, input.secondaryDirectory),
    secondaryPath,
    secondaryError
  }
}

export async function createPreUpgradeBackup(input: {
  databasePath: string
  primaryDirectory: string
  secondaryDirectory: string | null
  currentSchemaVersion: number
  now?: Date
}): Promise<CreateBackupResult> {
  const now = input.now ?? new Date()
  mkdirSync(input.primaryDirectory, { recursive: true })
  const filePath = join(
    input.primaryDirectory,
    `zyapp-pre_upgrade-${timestampForFile(now)}.db`
  )
  const connection = new DatabaseSync(input.databasePath)
  try {
    connection.exec('PRAGMA busy_timeout = 5000')
    connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    await backup(connection, filePath)
  } finally {
    connection.close()
  }
  const sha256 = fileSha256(filePath)
  writeManifest(filePath, {
    version: 1,
    kind: 'pre_upgrade',
    createdAt: now.toISOString(),
    sha256,
    schemaVersion: input.currentSchemaVersion,
    requestId: null
  })
  const inspection = inspectDatabaseFile(filePath)
  if (!inspection.integrityOk) {
    throw new Error(`升级前备份完整性校验失败：${inspection.integrityMessage}`)
  }
  let secondaryPath: string | null = null
  let secondaryError: string | null = null
  if (input.secondaryDirectory) {
    try {
      secondaryPath = copyBackupVerified(filePath, input.secondaryDirectory)
    } catch (error) {
      secondaryError = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    backup: backupSummary(filePath, input.secondaryDirectory),
    secondaryPath,
    secondaryError
  }
}

export function findBackupByRequestId(
  primaryDirectory: string,
  secondaryDirectory: string | null,
  requestId: string
): CreateBackupResult | null {
  if (!existsSync(primaryDirectory)) return null
  for (const entry of readdirSync(primaryDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.db')) continue
    const filePath = join(primaryDirectory, entry.name)
    const manifest = readManifest(filePath)
    if (manifest?.requestId !== requestId) continue
    const backup = backupSummary(filePath, secondaryDirectory)
    return {
      backup,
      secondaryPath:
        secondaryDirectory && backup.secondaryCopy
          ? join(secondaryDirectory, backup.fileName)
          : null,
      secondaryError: null
    }
  }
  return null
}

export function isAutomaticBackupDue(
  backups: BackupFileSummary[],
  now = new Date()
): boolean {
  const latest = backups.find((backup) => backup.kind === 'automatic')
  if (!latest) return true
  const latestTime = new Date(latest.createdAt).getTime()
  return !Number.isFinite(latestTime) || now.getTime() - latestTime >= 6 * 60 * 60 * 1000
}

export function stageDatabaseRestore(
  sourcePath: string,
  destinationDatabasePath: string
): { stagedPath: string; sourceSha256: string } {
  const stagedPath = `${destinationDatabasePath}.${randomUUID()}.restoring`
  mkdirSync(dirname(destinationDatabasePath), { recursive: true })
  copyFileSync(sourcePath, stagedPath)
  const sourceSha256 = fileSha256(sourcePath)
  if (sourceSha256 !== fileSha256(stagedPath)) {
    rmSync(stagedPath, { force: true })
    throw new Error('恢复文件复制校验失败')
  }
  return { stagedPath, sourceSha256 }
}
