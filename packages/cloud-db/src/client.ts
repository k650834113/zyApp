import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export type CloudDatabase = NodePgDatabase<typeof schema>

export function createPostgresPool(databaseUrl: string): Pool {
  if (!databaseUrl.trim()) throw new Error('DATABASE_URL is required')
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  })
}

export function createCloudDatabase(pool: Pool): CloudDatabase {
  return drizzle(pool, { schema })
}

export async function checkCloudDatabase(pool: Pool): Promise<{
  databaseTime: string
  postgresVersion: string
}> {
  const result = await pool.query<{
    database_time: Date
    postgres_version: string
  }>(
    `SELECT CURRENT_TIMESTAMP database_time,
            current_setting('server_version') postgres_version`
  )
  const row = result.rows[0]
  if (!row) throw new Error('PostgreSQL health query returned no row')
  return {
    databaseTime: row.database_time.toISOString(),
    postgresVersion: row.postgres_version
  }
}
