import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  ensureCloudBaselineOutbox,
  getStoreContext,
  openLocalDatabase,
  type LocalDatabase
} from '@zyapp/local-db'
import { randomUUID } from 'node:crypto'

type JoinedCloudIdentity = {
  tenantId: string
  storeId: string
  storeName: string
  deviceId: string
  deviceName: string
  manager: {
    id: string
    username: string
    displayName: string
    passwordHash: string
    createdAt: string
    updatedAt: string
  }
}

async function archiveLocalDatabase(input: {
  source: LocalDatabase
  sourceDatabasePath: string
  archiveDirectory: string
  prefix: string
  now: Date
}): Promise<{ archivePath: string; archiveSha256: string }> {
  const timestamp = input.now.toISOString().replace(/[:.]/g, '-')
  mkdirSync(input.archiveDirectory, { recursive: true })
  const archivePath = join(
    input.archiveDirectory,
    `${input.prefix}-${timestamp}-${basename(input.sourceDatabasePath)}`
  )
  const archived = await input.source.backupTo(archivePath)
  chmodSync(archivePath, 0o444)
  return { archivePath, archiveSha256: archived.sha256 }
}

export async function prepareJoinedLocalCloudMirror(input: {
  source: LocalDatabase
  sourceDatabasePath: string
  archiveDirectory: string
  mirrorDatabasePath: string
  epochId: string
  identity: JoinedCloudIdentity
  now?: Date
}): Promise<{
  epochId: string
  archivePath: string
  archiveSha256: string
  mirrorDatabasePath: string
}> {
  if (existsSync(input.mirrorDatabasePath)) {
    throw new Error('Cloud mirror target database already exists')
  }
  const now = input.now ?? new Date()
  const archived = await archiveLocalDatabase({
    source: input.source,
    sourceDatabasePath: input.sourceDatabasePath,
    archiveDirectory: input.archiveDirectory,
    prefix: 'pre-cloud-join',
    now
  })
  mkdirSync(dirname(input.mirrorDatabasePath), { recursive: true })
  const mirror = openLocalDatabase(input.mirrorDatabasePath)
  try {
    const timestamp = now.toISOString()
    const planId = randomUUID()
    mirror.connection.exec('BEGIN IMMEDIATE')
    try {
      mirror.connection.prepare(
        `INSERT INTO store
         (id, tenant_id, name, timezone, created_at, updated_at)
         VALUES (?, ?, ?, 'Asia/Shanghai', ?, ?)`
      ).run(
        input.identity.storeId,
        input.identity.tenantId,
        input.identity.storeName,
        timestamp,
        timestamp
      )
      mirror.connection.prepare(
        `INSERT INTO device
         (id, tenant_id, store_id, name, next_sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(
        input.identity.deviceId,
        input.identity.tenantId,
        input.identity.storeId,
        input.identity.deviceName,
        timestamp,
        timestamp
      )
      mirror.connection.prepare(
        `INSERT INTO employee
         (id, tenant_id, store_id, username, password_hash, display_name,
          role, status, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manager', 'active', ?, ?, ?)`
      ).run(
        input.identity.manager.id,
        input.identity.tenantId,
        input.identity.storeId,
        input.identity.manager.username,
        input.identity.manager.passwordHash,
        input.identity.manager.displayName,
        input.identity.manager.createdAt,
        input.identity.manager.updatedAt,
        timestamp
      )
      mirror.connection.prepare(
        `INSERT INTO monthly_card_plan
         (id, tenant_id, store_id, name, price_fen, duration_days, active,
          created_at, updated_at)
         VALUES (?, ?, ?, '30 天月卡', 20000, 30, 1, ?, ?)`
      ).run(
        planId,
        input.identity.tenantId,
        input.identity.storeId,
        timestamp,
        timestamp
      )
      const insertTier = mirror.connection.prepare(
        `INSERT INTO recharge_gift_tier
         (id, tenant_id, store_id, principal_fen, gift_fen, active,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      const defaultTiers: Array<[number, number]> = [
        [30000, 2000],
        [50000, 5000],
        [100000, 20000]
      ]
      for (const [principalFen, giftFen] of defaultTiers) {
        insertTier.run(
          randomUUID(),
          input.identity.tenantId,
          input.identity.storeId,
          principalFen,
          giftFen,
          timestamp,
          timestamp
        )
      }
      mirror.connection.prepare(
        `INSERT INTO recharge_gift_rule_state
         (tenant_id, store_id, source_type, source_activity_id,
          default_tiers_json, applied_at, updated_at)
         VALUES (?, ?, 'default', NULL, ?, ?, ?)`
      ).run(
        input.identity.tenantId,
        input.identity.storeId,
        JSON.stringify([
          { principalFen: 30000, giftFen: 2000 },
          { principalFen: 50000, giftFen: 5000 },
          { principalFen: 100000, giftFen: 20000 }
        ]),
        timestamp,
        timestamp
      )
      mirror.connection.prepare(
        `INSERT INTO cloud_runtime_state
         (device_id, tenant_id, store_id, mirror_epoch,
          cloud_primary_activated, runtime_mode, updated_at)
         VALUES (?, ?, ?, ?, 1, 'connecting', ?)`
      ).run(
        input.identity.deviceId,
        input.identity.tenantId,
        input.identity.storeId,
        input.epochId,
        timestamp
      )
      mirror.connection.exec('COMMIT')
    } catch (error) {
      mirror.connection.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    mirror.close()
    rmSync(input.mirrorDatabasePath, { force: true })
    throw error
  }
  mirror.close()
  writeFileSync(
    `${archived.archivePath}.manifest.json`,
    JSON.stringify({
      epochId: input.epochId,
      sourceDatabasePath: input.sourceDatabasePath,
      archivePath: archived.archivePath,
      archiveSha256: archived.archiveSha256,
      mirrorDatabasePath: input.mirrorDatabasePath,
      joinedStoreId: input.identity.storeId,
      joinedDeviceId: input.identity.deviceId,
      createdAt: now.toISOString()
    }, null, 2),
    'utf8'
  )
  return {
    epochId: input.epochId,
    archivePath: archived.archivePath,
    archiveSha256: archived.archiveSha256,
    mirrorDatabasePath: input.mirrorDatabasePath
  }
}

export async function prepareEmptyLocalCloudMirror(input: {
  source: LocalDatabase
  sourceDatabasePath: string
  archiveDirectory: string
  mirrorDatabasePath: string
  epochId: string
  seedIdentityOutbox?: boolean
  now?: Date
}): Promise<{
  epochId: string
  archivePath: string
  archiveSha256: string
  mirrorDatabasePath: string
}> {
  if (existsSync(input.mirrorDatabasePath)) {
    throw new Error('Cloud mirror target database already exists')
  }
  const now = input.now ?? new Date()
  mkdirSync(dirname(input.mirrorDatabasePath), { recursive: true })
  const archived = await archiveLocalDatabase({
    source: input.source,
    sourceDatabasePath: input.sourceDatabasePath,
    archiveDirectory: input.archiveDirectory,
    prefix: 'pre-cloud',
    now
  })
  const archivePath = archived.archivePath

  const mirror = openLocalDatabase(input.mirrorDatabasePath)
  try {
    mirror.connection.prepare('ATTACH DATABASE ? AS archived').run(archivePath)
    mirror.connection.exec('BEGIN IMMEDIATE')
    try {
      for (const table of [
        'store',
        'device',
        'employee',
        'catalog_item',
        'recharge_gift_tier',
        'monthly_card_plan'
      ]) {
        mirror.connection.exec(
          `INSERT INTO main.${table} SELECT * FROM archived.${table}`
        )
      }
      mirror.connection.exec(
        `INSERT INTO main.recharge_gift_rule_state
         (tenant_id, store_id, source_type, source_activity_id,
          default_tiers_json, applied_at, updated_at)
         SELECT tenant_id, store_id, 'default', NULL, default_tiers_json,
                applied_at, updated_at
         FROM archived.recharge_gift_rule_state`
      )
      mirror.connection.exec(
        `UPDATE device SET next_sequence = 1, updated_at = CURRENT_TIMESTAMP`
      )
      const device = mirror.connection.prepare(
        `SELECT id, tenant_id, store_id FROM device LIMIT 1`
      ).get() as
        | { id: string; tenant_id: string; store_id: string }
        | undefined
      if (!device) throw new Error('Archived database has no device identity')
      mirror.connection.prepare(
        `INSERT INTO cloud_runtime_state
         (device_id, tenant_id, store_id, mirror_epoch,
          cloud_primary_activated, runtime_mode, updated_at)
         VALUES (?, ?, ?, ?, 1, 'connecting', ?)`
      ).run(
        device.id,
        device.tenant_id,
        device.store_id,
        input.epochId,
        now.toISOString()
      )
      mirror.connection.exec('COMMIT')
    } catch (error) {
      mirror.connection.exec('ROLLBACK')
      throw error
    } finally {
      mirror.connection.exec('DETACH DATABASE archived')
    }
    const mirrorContext = getStoreContext(mirror.connection)
    const manager = mirror.connection.prepare(
      `SELECT id FROM employee
       WHERE role = 'manager' AND status = 'active'
       ORDER BY created_at LIMIT 1`
    ).get() as { id: string } | undefined
    if (!mirrorContext || !manager) {
      throw new Error('Fresh cloud mirror is missing manager identity')
    }
    if (input.seedIdentityOutbox !== false) {
      ensureCloudBaselineOutbox(
        mirror.connection,
        mirrorContext,
        manager.id
      )
    }
    const businessTables = [
      'member',
      'wallet_ledger',
      'monthly_card',
      'sales_order',
      'refund_request',
      'financial_refund_request'
    ]
    for (const table of businessTables) {
      const count = mirror.connection
        .prepare(`SELECT COUNT(*) count FROM ${table}`)
        .get() as { count: number }
      if (Number(count.count) !== 0) {
        throw new Error(`Fresh cloud mirror unexpectedly contains ${table}`)
      }
    }
  } catch (error) {
    mirror.close()
    rmSync(input.mirrorDatabasePath, { force: true })
    throw error
  }
  mirror.close()
  writeFileSync(
    `${archivePath}.manifest.json`,
    JSON.stringify(
      {
        epochId: input.epochId,
        sourceDatabasePath: input.sourceDatabasePath,
        archivePath,
        archiveSha256: archived.archiveSha256,
        mirrorDatabasePath: input.mirrorDatabasePath,
        createdAt: now.toISOString()
      },
      null,
      2
    ),
    'utf8'
  )
  return {
    epochId: input.epochId,
    archivePath,
    archiveSha256: archived.archiveSha256,
    mirrorDatabasePath: input.mirrorDatabasePath
  }
}

export function prepareFreshJoinedCloudMirror(input: {
  mirrorDatabasePath: string
  epochId: string
  identity: {
    tenantId: string
    storeId: string
    storeName: string
    deviceId: string
    deviceName: string
  }
  now?: Date
}): void {
  if (existsSync(input.mirrorDatabasePath)) {
    const existing = openLocalDatabase(input.mirrorDatabasePath)
    try {
      const context = getStoreContext(existing.connection)
      if (
        context?.tenantId !== input.identity.tenantId ||
        context.storeId !== input.identity.storeId ||
        context.deviceId !== input.identity.deviceId
      ) {
        throw new Error('Pending onboarding mirror belongs to another device')
      }
      return
    } finally {
      existing.close()
    }
  }
  mkdirSync(dirname(input.mirrorDatabasePath), { recursive: true })
  const mirror = openLocalDatabase(input.mirrorDatabasePath)
  const timestamp = (input.now ?? new Date()).toISOString()
  try {
    mirror.connection.exec('BEGIN IMMEDIATE')
    try {
      mirror.connection.prepare(
        `INSERT INTO store
         (id, tenant_id, name, timezone, created_at, updated_at)
         VALUES (?, ?, ?, 'Asia/Shanghai', ?, ?)`
      ).run(
        input.identity.storeId,
        input.identity.tenantId,
        input.identity.storeName,
        timestamp,
        timestamp
      )
      mirror.connection.prepare(
        `INSERT INTO device
         (id, tenant_id, store_id, name, next_sequence, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(
        input.identity.deviceId,
        input.identity.tenantId,
        input.identity.storeId,
        input.identity.deviceName,
        timestamp,
        timestamp
      )
      mirror.connection.prepare(
        `INSERT INTO cloud_runtime_state
         (device_id, tenant_id, store_id, mirror_epoch,
          cloud_primary_activated, runtime_mode, updated_at)
         VALUES (?, ?, ?, ?, 1, 'connecting', ?)`
      ).run(
        input.identity.deviceId,
        input.identity.tenantId,
        input.identity.storeId,
        input.epochId,
        timestamp
      )
      mirror.connection.exec('COMMIT')
    } catch (error) {
      mirror.connection.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    mirror.close()
    rmSync(input.mirrorDatabasePath, { force: true })
    throw error
  }
  mirror.close()
}
