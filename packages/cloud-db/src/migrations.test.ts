import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverCloudMigrations } from './migrations'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('cloud migrations', () => {
  it('discovers ordered SQL migrations with stable checksums', () => {
    const root = mkdtempSync(join(tmpdir(), 'zyapp-cloud-migrations-'))
    directories.push(root)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, '0002_second.sql'), 'SELECT 2;\n')
    writeFileSync(join(root, '0001_first.sql'), 'SELECT 1;\n')
    writeFileSync(join(root, 'notes.txt'), 'ignored')

    const migrations = discoverCloudMigrations(root)

    expect(migrations.map((migration) => migration.version)).toEqual([1, 2])
    expect(migrations[0]?.name).toBe('first')
    expect(migrations[0]?.checksum).toHaveLength(64)
  })

  it('includes board-game metadata provenance after the miniapp library', () => {
    const migrations = discoverCloudMigrations(
      join(import.meta.dirname, '..', 'migrations')
    ).filter(migration => migration.version <= 21)

    expect(migrations.slice(-5).map((migration) => migration.version)).toEqual([
      17, 18, 19, 20, 21
    ])
    expect(migrations.at(-3)?.name).toBe('miniapp_board_game_library')
    expect(migrations.at(-3)?.sql).toContain(
      'complexity_rating NUMERIC(2,1)'
    )
    expect(migrations.at(-3)?.sql).toContain(
      'UNIQUE (tenant_id, store_id, board_game_id, viewer_id)'
    )
    expect(migrations.at(-2)?.name).toBe('board_game_metadata_import')
    expect(migrations.at(-2)?.sql).toContain('metadata_source TEXT')
    expect(migrations.at(-2)?.sql).toContain(
      'CREATE UNIQUE INDEX uq_cloud_board_game_tenant_bgg_id'
    )
    expect(migrations.at(-1)?.name).toBe('board_game_expansion_parent')
    expect(migrations.at(-1)?.sql).toContain('base_game_id UUID')
  })
})
