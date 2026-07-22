import { randomUUID } from 'node:crypto'
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { LocalDatabase } from '@zyapp/local-db'
import { openLocalDatabase } from '@zyapp/local-db'
import { stageDatabaseRestore } from './backup-service'

export function replaceDatabaseFromBackup(input: {
  sourcePath: string
  activePath: string
  activeDatabase: LocalDatabase
  openDatabase?: (filePath: string) => LocalDatabase
  beforeCommit?: (database: LocalDatabase) => void
  onDatabaseUnavailable(): void
  onDatabaseReady(database: LocalDatabase): void
}): LocalDatabase {
  const openDatabase = input.openDatabase ?? openLocalDatabase
  const rollbackPath = `${input.activePath}.${randomUUID()}.before-restore`
  let stagedPath: string | null = null
  let activeClosed = false
  let activeMoved = false
  let replacement: LocalDatabase | null = null
  try {
    stagedPath = stageDatabaseRestore(input.sourcePath, input.activePath).stagedPath
    input.activeDatabase.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    input.activeDatabase.close()
    activeClosed = true
    input.onDatabaseUnavailable()
    rmSync(`${input.activePath}-wal`, { force: true })
    rmSync(`${input.activePath}-shm`, { force: true })
    renameSync(input.activePath, rollbackPath)
    activeMoved = true
    renameSync(stagedPath, input.activePath)
    stagedPath = null

    replacement = openDatabase(input.activePath)
    const integrity = replacement.connection
      .prepare('PRAGMA integrity_check')
      .get() as { integrity_check: string }
    if (integrity.integrity_check !== 'ok') {
      throw new Error(`恢复后完整性校验失败：${integrity.integrity_check}`)
    }
    input.beforeCommit?.(replacement)
    input.onDatabaseReady(replacement)
    const result = replacement
    replacement = null
    rmSync(rollbackPath, { force: true })
    activeMoved = false
    return result
  } catch (error) {
    replacement?.close()
    if (activeClosed) {
      input.onDatabaseUnavailable()
      if (activeMoved) {
        rmSync(input.activePath, { force: true })
        if (!existsSync(rollbackPath)) {
          throw new Error(`恢复失败且保护中的原数据库不存在：${rollbackPath}`)
        }
        try {
          renameSync(rollbackPath, input.activePath)
        } catch (rollbackError) {
          throw new Error(
            `恢复失败，自动回滚也失败。原数据库仍保留在：${rollbackPath}。` +
              `错误：${
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError)
              }`
          )
        }
      }
      if (!existsSync(input.activePath)) {
        throw new Error(`恢复失败，当前数据库文件缺失：${input.activePath}`)
      }
      const recovered = openDatabase(input.activePath)
      input.onDatabaseReady(recovered)
    }
    throw error
  } finally {
    if (stagedPath) rmSync(stagedPath, { force: true })
  }
}
