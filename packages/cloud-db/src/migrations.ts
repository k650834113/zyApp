import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Pool, PoolClient } from 'pg'

export type CloudMigration = {
  version: number
  name: string
  filePath: string
  checksum: string
  sql: string
}

const MIGRATION_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/

export function discoverCloudMigrations(directory: string): CloudMigration[] {
  return readdirSync(resolve(directory))
    .map((fileName) => {
      const match = MIGRATION_PATTERN.exec(fileName)
      if (!match) return null
      const version = Number(match[1])
      const sql = readFileSync(join(directory, fileName), 'utf8')
      return {
        version,
        name: match[2] ?? fileName,
        filePath: join(directory, fileName),
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql
      }
    })
    .filter((migration): migration is CloudMigration => migration !== null)
    .sort((left, right) => left.version - right.version)
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cloud_schema_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export async function runCloudMigrations(
  pool: Pool,
  directory: string
): Promise<{ applied: number[]; currentVersion: number }> {
  const migrations = discoverCloudMigrations(directory)
  const client = await pool.connect()
  const applied: number[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [9_174_031])
    await ensureMigrationTable(client)
    const existing = await client.query<{
      version: number
      checksum: string
    }>('SELECT version, checksum FROM cloud_schema_migration ORDER BY version')
    const checksums = new Map(
      existing.rows.map((row) => [Number(row.version), row.checksum])
    )
    for (const migration of migrations) {
      const previousChecksum = checksums.get(migration.version)
      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Cloud migration ${migration.version} checksum does not match`
          )
        }
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          `INSERT INTO cloud_schema_migration (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum]
        )
        await client.query('COMMIT')
        applied.push(migration.version)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    return {
      applied,
      currentVersion: migrations.at(-1)?.version ?? 0
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [9_174_031]).catch(
      () => undefined
    )
    client.release()
  }
}
