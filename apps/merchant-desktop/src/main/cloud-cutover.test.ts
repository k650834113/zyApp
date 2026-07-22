import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  createMember,
  findEmployeeRecordById,
  getStoreContext,
  openLocalDatabase
} from '@zyapp/local-db'
import {
  prepareEmptyLocalCloudMirror,
  prepareFreshJoinedCloudMirror,
  prepareJoinedLocalCloudMirror
} from './cloud-cutover'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true })
  })
})

describe('empty cloud-primary cutover', () => {
  it('creates a fresh joined mirror without a temporary employee identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-fresh-join-'))
    directories.push(directory)
    const mirrorPath = join(directory, 'mirror.db')
    prepareFreshJoinedCloudMirror({
      mirrorDatabasePath: mirrorPath,
      epochId: 'epoch-1',
      identity: {
        tenantId: 'tenant-1',
        storeId: 'store-1',
        storeName: 'Cloud Store',
        deviceId: 'device-1',
        deviceName: 'New Cashier'
      }
    })
    const mirror = openLocalDatabase(mirrorPath)
    expect(getStoreContext(mirror.connection)).toMatchObject({
      tenantId: 'tenant-1',
      storeId: 'store-1',
      deviceId: 'device-1'
    })
    expect((mirror.connection.prepare('SELECT COUNT(*) count FROM employee').get() as { count: number }).count)
      .toBe(0)
    expect(mirror.schemaVersion).toBe(25)
    mirror.close()
  })

  it('archives the old database and creates an identity-only mirror', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-cutover-'))
    directories.push(directory)
    const sourcePath = join(directory, 'source.db')
    const mirrorPath = join(directory, 'mirror.db')
    const source = openLocalDatabase(sourcePath)
    try {
      const bootstrapped = bootstrapStore(source.connection, {
        storeName: 'Archived Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$test',
        managerDisplayName: 'Manager',
        deviceName: 'Cashier'
      })
      const context = getStoreContext(source.connection)
      if (!context) throw new Error('Missing context')
      const manager = findEmployeeRecordById(
        source.connection,
        context.tenantId,
        bootstrapped.managerId
      )
      if (!manager) throw new Error('Missing manager')
      createMember(
        source.connection,
        { ...context, actor: manager },
        {
          phone: '13800138000',
          nickname: 'Must remain archived',
          confirmedAtLeast14: true
        }
      )

      const result = await prepareEmptyLocalCloudMirror({
        source,
        sourceDatabasePath: sourcePath,
        archiveDirectory: join(directory, 'archive'),
        mirrorDatabasePath: mirrorPath,
        epochId: '44444444-4444-4444-8444-444444444444',
        now: new Date('2026-06-30T08:00:00.000Z')
      })
      expect(result.archiveSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(existsSync(`${result.archivePath}.manifest.json`)).toBe(true)

      const mirror = openLocalDatabase(mirrorPath)
      expect(
        mirror.connection.prepare('SELECT COUNT(*) count FROM employee').get()
      ).toEqual({ count: 1 })
      expect(
        mirror.connection.prepare('SELECT COUNT(*) count FROM member').get()
      ).toEqual({ count: 0 })
      expect(
        mirror.connection
          .prepare(
            `SELECT COUNT(*) count FROM outbox_operation
             WHERE operation_type LIKE 'member.%'
                OR operation_type LIKE 'wallet.snapshot%'
                OR operation_type LIKE 'monthly_card.%'
                OR operation_type LIKE 'order.%'
                OR operation_type LIKE 'refund.%'
                OR operation_type LIKE 'financial_refund.%'`
          )
          .get()
      ).toEqual({ count: 0 })
      expect(
        mirror.connection
          .prepare('SELECT mirror_epoch FROM cloud_runtime_state')
          .get()
      ).toEqual({ mirror_epoch: '44444444-4444-4444-8444-444444444444' })
      mirror.close()
    } finally {
      source.close()
    }
  })

  it('archives an unrelated local store and creates an independently identified joined mirror', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-join-'))
    directories.push(directory)
    const sourcePath = join(directory, 'source.db')
    const mirrorPath = join(directory, 'joined.db')
    const source = openLocalDatabase(sourcePath)
    try {
      bootstrapStore(source.connection, {
        storeName: 'Discarded Local Store',
        managerUsername: 'local-manager',
        managerPasswordHash: 'scrypt$local',
        managerDisplayName: 'Local Manager',
        deviceName: 'Unpaired Device'
      })
      const result = await prepareJoinedLocalCloudMirror({
        source,
        sourceDatabasePath: sourcePath,
        archiveDirectory: join(directory, 'archive'),
        mirrorDatabasePath: mirrorPath,
        epochId: '55555555-5555-4555-8555-555555555555',
        identity: {
          tenantId: '11111111-1111-4111-8111-111111111111',
          storeId: '22222222-2222-4222-8222-222222222222',
          storeName: 'Shared Store',
          deviceId: '66666666-6666-4666-8666-666666666666',
          deviceName: 'Second Cashier',
          manager: {
            id: '44444444-4444-4444-8444-444444444444',
            username: 'manager',
            displayName: 'Cloud Manager',
            passwordHash: 'scrypt$local',
            createdAt: '2026-06-30T08:00:00.000Z',
            updatedAt: '2026-06-30T08:00:00.000Z'
          }
        },
        now: new Date('2026-06-30T09:00:00.000Z')
      })
      const mirror = openLocalDatabase(mirrorPath)
      expect(getStoreContext(mirror.connection)).toMatchObject({
        tenantId: '11111111-1111-4111-8111-111111111111',
        storeId: '22222222-2222-4222-8222-222222222222',
        deviceId: '66666666-6666-4666-8666-666666666666'
      })
      expect(mirror.connection.prepare('SELECT username, password_hash FROM employee').get()).toEqual({
        username: 'manager',
        password_hash: 'scrypt$local'
      })
      expect(mirror.connection.prepare('SELECT COUNT(*) count FROM monthly_card_plan').get()).toEqual({ count: 1 })
      expect(mirror.connection.prepare('SELECT COUNT(*) count FROM outbox_operation').get()).toEqual({ count: 0 })
      mirror.close()
      expect(existsSync(result.archivePath)).toBe(true)
    } finally {
      source.close()
    }
  })
})
