import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  cashRecharge,
  createMember,
  createSalesOrder,
  directRefund,
  findEmployeeRecordById,
  getStoreContext,
  isStoreInitialized,
  listCatalogItems,
  openLocalDatabase
} from './index'
import { migrateDatabase } from './migrations'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('local database', () => {
  it('initializes foundation schema in WAL mode', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-'))
    temporaryDirectories.push(directory)

    const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
    const tableNames = localDatabase.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(localDatabase.schemaVersion).toBe(25)
    expect(localDatabase.journalMode.toLowerCase()).toBe('wal')
    expect(tableNames).toContain('audit_log')
    expect(tableNames).toContain('outbox_operation')
    expect(tableNames).toContain('member')
    expect(tableNames).toContain('membership_grant')
    expect(tableNames).toContain('legacy_id_mapping')
    expect(tableNames).toContain('wallet_account')
    expect(tableNames).toContain('wallet_ledger')
    expect(tableNames).toContain('wallet_lot')
    expect(tableNames).toContain('recharge_gift_rule_state')
    expect(tableNames).toContain('monthly_card')
    expect(tableNames).toContain('monthly_card_event')
    expect(tableNames).toContain('catalog_item')
    expect(tableNames).toContain('sales_order')
    expect(tableNames).toContain('sales_order_item')
    expect(tableNames).toContain('order_payment')
    expect(tableNames).toContain('refund_request')
    expect(tableNames).toContain('refund_item')
    expect(tableNames).toContain('refund_payment')
    expect(tableNames).toContain('wallet_refund_allocation')
    expect(tableNames).toContain('financial_refund_request')
    expect(tableNames).toContain('legacy_import_batch')
    expect(tableNames).toContain('legacy_raw_row')
    expect(tableNames).toContain('legacy_financial_history')
    expect(tableNames).toContain('legacy_monthly_card_history')
    expect(tableNames).toContain('legacy_reconciliation_issue')
    expect(tableNames).toContain('sync_state')
    expect(tableNames).toContain('sync_conflict')
    expect(tableNames).toContain('employee_mobile_credential')
    expect(tableNames).toContain('employee_pc_offline_credential')
    expect(tableNames).toContain('employee_pc_credential_migration')
    expect(tableNames).toContain('cashier_command_execution')
    expect(tableNames).toContain('employee_financial_command_execution')
    localDatabase.close()
  })

  it('applies migrations idempotently', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'zyapp.db')

    openLocalDatabase(filePath).close()
    const reopened = openLocalDatabase(filePath)
    const migrationCount = reopened.connection
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number }

    expect(migrationCount.count).toBe(25)
    reopened.close()
  })

  it('upgrades schema v19 financial command history and accepts activity tier commands', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-v20-upgrade-'))
    temporaryDirectories.push(directory)
    const connection = new DatabaseSync(join(directory, 'zyapp.db'))
    connection.exec('PRAGMA foreign_keys = ON')
    expect(migrateDatabase(connection, 19)).toBe(19)
    const bootstrap = bootstrapStore(connection, {
      storeName: 'Schema 20 Upgrade Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Owner',
      deviceName: 'Cashier 01'
    })
    const store = getStoreContext(connection)
    if (!store) throw new Error('Missing store')
    const timestamp = '2026-06-14T10:00:00.000Z'
    const previousCommandId = randomUUID()
    connection
      .prepare(
        `INSERT INTO employee_financial_command_execution
         (command_id, tenant_id, store_id, device_id,
          requested_by_employee_id, command_type, status, result_json,
          error_message, reported_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'cash_recharge', 'completed', ?,
                 NULL, NULL, ?, ?)`
      )
      .run(
        previousCommandId,
        store.tenantId,
        store.storeId,
        store.deviceId,
        bootstrap.managerId,
        JSON.stringify({
          type: 'cash_recharge',
          wallet: { operationId: randomUUID() }
        }),
        timestamp,
        timestamp
      )

    expect(migrateDatabase(connection, 20)).toBe(20)
    expect(
      connection
        .prepare(
          `SELECT command_type, status, result_json
           FROM employee_financial_command_execution
           WHERE command_id = ?`
        )
        .get(previousCommandId)
    ).toMatchObject({
      command_type: 'cash_recharge',
      status: 'completed'
    })

    const activityCommandId = randomUUID()
    expect(() =>
      connection
        .prepare(
          `INSERT INTO employee_financial_command_execution
           (command_id, tenant_id, store_id, device_id,
            requested_by_employee_id, command_type, status, result_json,
            error_message, reported_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'apply_activity_recharge_tiers',
                   'completed', ?, NULL, NULL, ?, ?)`
        )
        .run(
          activityCommandId,
          store.tenantId,
          store.storeId,
          store.deviceId,
          bootstrap.managerId,
          JSON.stringify({
            type: 'apply_activity_recharge_tiers',
            rechargeGiftTiers: []
          }),
          timestamp,
          timestamp
        )
    ).not.toThrow()
    expect(
      (
        connection
          .prepare(
            'SELECT COUNT(*) count FROM employee_financial_command_execution'
          )
          .get() as { count: number }
      ).count
    ).toBe(2)
    connection.close()
  })

  it('upgrades populated schema v20 wallet refund links to v21 without loss', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-v21-upgrade-'))
    temporaryDirectories.push(directory)
    const connection = new DatabaseSync(join(directory, 'zyapp.db'))
    connection.exec('PRAGMA foreign_keys = ON')
    expect(migrateDatabase(connection, 20)).toBe(20)
    const bootstrap = bootstrapStore(connection, {
      storeName: 'Schema 21 Upgrade Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Owner',
      deviceName: 'Cashier 01'
    })
    const store = getStoreContext(connection)
    if (!store) throw new Error('Missing store')
    const manager = findEmployeeRecordById(
      connection,
      store.tenantId,
      bootstrap.managerId
    )
    if (!manager) throw new Error('Missing manager')
    const member = createMember(
      connection,
      { ...store, actor: manager },
      {
        phone: '13800138000',
        nickname: 'Upgrade Member',
        confirmedAtLeast14: true
      }
    )
    cashRecharge(
      connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 50_000,
        reason: 'Upgrade fixture'
      }
    )
    const admission = listCatalogItems(connection, store)[0]
    if (!admission) throw new Error('Missing admission')
    const order = createSalesOrder(
      connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'stored_value',
        walletMemberId: member.id,
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular'
          }
        ],
        now: new Date('2026-06-01T05:00:00.000Z')
      }
    )
    directRefund(
      connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        orderId: order.id,
        items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
        now: new Date('2026-06-02T05:00:00.000Z')
      }
    )
    const before = {
      ledger: (
        connection.prepare('SELECT COUNT(*) count FROM wallet_ledger').get() as {
          count: number
        }
      ).count,
      ledgerAllocation: (
        connection
          .prepare('SELECT COUNT(*) count FROM wallet_ledger_allocation')
          .get() as { count: number }
      ).count,
      refundAllocation: (
        connection
          .prepare('SELECT COUNT(*) count FROM wallet_refund_allocation')
          .get() as { count: number }
      ).count
    }

    expect(before.refundAllocation).toBeGreaterThan(0)
    expect(migrateDatabase(connection, 21)).toBe(21)
    expect(
      connection.prepare('PRAGMA foreign_key_check').all()
    ).toEqual([])
    expect(
      (
        connection.prepare('SELECT COUNT(*) count FROM wallet_ledger').get() as {
          count: number
        }
      ).count
    ).toBe(before.ledger)
    expect(
      (
        connection
          .prepare('SELECT COUNT(*) count FROM wallet_ledger_allocation')
          .get() as { count: number }
      ).count
    ).toBe(before.ledgerAllocation)
    expect(
      (
        connection
          .prepare('SELECT COUNT(*) count FROM wallet_refund_allocation')
          .get() as { count: number }
      ).count
    ).toBe(before.refundAllocation)
    expect(() =>
      connection
        .prepare(
          `INSERT INTO wallet_ledger
           (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
            principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
            gift_balance_after_fen, source_id, related_ledger_id, request_id,
            actor_id, device_id, reason, metadata_json, occurred_at)
           SELECT ?, tenant_id, store_id, wallet_account_id, member_id,
                  'wechat_recharge', 100, 0,
                  principal_balance_after_fen + 100,
                  gift_balance_after_fen, ?, NULL, ?, actor_id, device_id,
                  'schema test', '{}', ?
           FROM wallet_ledger LIMIT 1`
        )
        .run(
          randomUUID(),
          randomUUID(),
          randomUUID(),
          new Date().toISOString()
        )
    ).not.toThrow()
    connection.close()
  })

  it('upgrades populated schema v7 wallet and order data to v9 without loss', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-upgrade-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'zyapp.db')
    const connection = new DatabaseSync(filePath)
    connection.exec('PRAGMA foreign_keys = ON')
    connection.exec('PRAGMA journal_mode = WAL')
    expect(migrateDatabase(connection, 7)).toBe(7)
    const bootstrap = bootstrapStore(connection, {
      storeName: 'Upgrade Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Owner',
      deviceName: 'Cashier 01'
    })
    const store = getStoreContext(connection)
    if (!store) throw new Error('Missing store')
    const managerRow = connection
      .prepare(
        `SELECT id, username, display_name, role, status, created_at, updated_at
         FROM employee WHERE id = ?`
      )
      .get(bootstrap.managerId) as Record<string, unknown> | undefined
    if (!managerRow) throw new Error('Missing manager')
    const manager = {
      id: String(managerRow.id),
      username: String(managerRow.username),
      displayName: String(managerRow.display_name),
      role: 'manager' as const,
      status: 'active' as const,
      mobileAccessEnabled: false,
      createdAt: String(managerRow.created_at),
      updatedAt: String(managerRow.updated_at)
    }
    const member = createMember(
      connection,
      { ...store, actor: manager },
      {
        phone: '13800138000',
        nickname: 'Upgrade Member',
        confirmedAtLeast14: true
      }
    )
    cashRecharge(
      connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 50_000,
        reason: 'Upgrade fixture'
      }
    )
    const admission = listCatalogItems(connection, store)[0]
    if (!admission) throw new Error('Missing admission')
    createSalesOrder(
      connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'stored_value',
        walletMemberId: member.id,
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular'
          }
        ]
      }
    )
    connection.close()

    const upgraded = openLocalDatabase(filePath)
    expect(upgraded.schemaVersion).toBe(25)
    expect(
      upgraded.connection
        .prepare(
          `SELECT principal_balance_fen, gift_balance_fen
           FROM wallet_account WHERE member_id = ?`
        )
        .get(member.id)
    ).toEqual({ principal_balance_fen: 50_000, gift_balance_fen: 1_000 })
    expect(
      (
        upgraded.connection
          .prepare('SELECT COUNT(*) count FROM wallet_ledger')
          .get() as { count: number }
      ).count
    ).toBe(2)
    expect(
      (
        upgraded.connection
          .prepare('SELECT COUNT(*) count FROM wallet_ledger_allocation')
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(
      (
        upgraded.connection
          .prepare('SELECT COUNT(*) count FROM sales_order')
          .get() as { count: number }
      ).count
    ).toBe(1)
    upgraded.close()
  })

  it('creates a consistent backup that can be reopened', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-'))
    temporaryDirectories.push(directory)
    const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
    const backupPath = join(directory, 'backups', 'zyapp-backup.db')

    const result = await localDatabase.backupTo(backupPath)
    const restored = openLocalDatabase(backupPath)

    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(restored.schemaVersion).toBe(25)
    restored.close()
    localDatabase.close()
  })

  it('bootstraps store, device, manager, audit and outbox atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-db-'))
    temporaryDirectories.push(directory)
    const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))

    expect(isStoreInitialized(localDatabase.connection)).toBe(false)
    const result = bootstrapStore(localDatabase.connection, {
      storeName: 'Test Store',
      managerUsername: 'Manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Owner',
      deviceName: 'Cashier 01'
    })

    expect(isStoreInitialized(localDatabase.connection)).toBe(true)
    expect(
      localDatabase.connection
        .prepare('SELECT username, role, status FROM employee WHERE id = ?')
        .get(result.managerId)
    ).toEqual({ username: 'manager', role: 'manager', status: 'active' })
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) AS count FROM audit_log')
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) AS count FROM outbox_operation')
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(() =>
      bootstrapStore(localDatabase.connection, {
        storeName: 'Second Store',
        managerUsername: 'manager2',
        managerPasswordHash: 'scrypt$test',
        managerDisplayName: 'Owner',
        deviceName: 'Cashier 02'
      })
    ).toThrow('already been initialized')

    localDatabase.close()
  })
})
