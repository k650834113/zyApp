import { fileURLToPath } from 'node:url'
import { createPostgresPool } from './client'
import { runCloudMigrations } from './migrations'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run cloud migrations')
}

const migrationDirectory = fileURLToPath(new URL('../migrations', import.meta.url))
const pool = createPostgresPool(databaseUrl)

try {
  const result = await runCloudMigrations(pool, migrationDirectory)
  console.log(
    JSON.stringify({
      event: 'cloud_migrations_complete',
      ...result
    })
  )
} finally {
  await pool.end()
}
