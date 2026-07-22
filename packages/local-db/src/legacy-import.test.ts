import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  createCatalogItem,
  createFinancialRefundRequest,
  createMember,
  findEmployeeRecordById,
  getMonthlyCardDetails,
  getStoreContext,
  getWalletDetails,
  ensureLegacyImportCloudSyncOutbox,
  importLegacyDatabase,
  inspectLegacyDatabase,
  openLocalDatabase
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function createLegacyDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath)
  database.exec(`
    CREATE TABLE members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      birthday TEXT,
      joinDate TEXT,
      balance REAL NOT NULL,
      status TEXT NOT NULL,
      subscription_plan_name TEXT,
      subscription_start_date TEXT,
      subscription_end_date TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT,
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE activity_logs (
      id TEXT PRIMARY KEY,
      member_id TEXT,
      member_name TEXT,
      action_type TEXT NOT NULL,
      amount REAL,
      description TEXT,
      created_at TEXT
    );
    CREATE TABLE quick_deduct_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      priceRegular REAL NOT NULL,
      priceVip REAL NOT NULL,
      created_at TEXT
    );

    INSERT INTO members VALUES
      ('legacy-1', '旧库昵称', '13800138000', '01-02', '2025-01-01',
       50, 'vip', '标准月卡', '2026-06-01', '2026-07-01',
       '2025-01-01 10:00:00.000000', '2026-06-10 10:00:00.000000'),
      ('legacy-2', '新增会员', '13900139000', NULL, '2025-02-01',
       100, 'active', NULL, NULL, NULL,
       '2025-02-01T02:00:00.000Z', '2026-06-10T02:00:00.000Z');

    INSERT INTO transactions VALUES
      ('transaction-1', 'legacy-1', 'top-up', 40, '2025-01-01 10:00:00',
       '旧充值', '2025-01-01 10:00:00'),
      ('transaction-2', 'legacy-2', 'top-up', 100, '2025-02-01T02:00:00.000Z',
       '旧充值', '2025-02-01T02:00:00.000Z');

    INSERT INTO activity_logs VALUES
      ('activity-1', 'legacy-1', '旧库昵称', 'member-update', 0,
       '旧系统操作日志', '2025-03-01 12:00:00.123456');

    INSERT INTO quick_deduct_items VALUES
      ('quick-1', '包场费', 10, 8, '2025-01-01 10:00:00');
  `)
  return database
}

function createTarget(directory: string) {
  const local = openLocalDatabase(join(directory, 'zyapp.db'))
  const bootstrap = bootstrapStore(local.connection, {
    storeName: 'Legacy Test Store',
    managerUsername: 'manager',
    managerPasswordHash: 'scrypt$test',
    managerDisplayName: 'Manager',
    deviceName: 'Cashier'
  })
  const store = getStoreContext(local.connection)
  if (!store) throw new Error('Missing store')
  const actor = findEmployeeRecordById(
    local.connection,
    store.tenantId,
    bootstrap.managerId
  )
  if (!actor) throw new Error('Missing manager')
  const context = { ...store, actor }
  const currentMember = createMember(local.connection, context, {
    phone: '13800138000',
    nickname: '当前昵称',
    confirmedAtLeast14: true
  })
  createCatalogItem(local.connection, context, {
    name: '包场费',
    itemType: 'service',
    regularPriceFen: 1200,
    advancedPriceFen: 1000
  })
  return { local, context, currentMember }
}

describe('legacy database import', () => {
  it('preflights conflicts and imports members, opening balances and history atomically', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-legacy-'))
    temporaryDirectories.push(directory)
    const source = createLegacyDatabase(join(directory, 'members.db'))
    const { local, context, currentMember } = createTarget(directory)
    const metadata = {
      sourceName: 'members.db',
      sourceSha256: 'a'.repeat(64),
      sourceSizeBytes: 1234
    }
    const now = new Date('2026-06-12T04:00:00.000Z')

    const inspection = inspectLegacyDatabase(
      source,
      local.connection,
      context,
      metadata,
      now
    )

    expect(inspection.alreadyImported).toBe(false)
    expect(inspection.summary).toMatchObject({
      members: 2,
      transactions: 2,
      activityLogs: 1,
      quickDeductItems: 1,
      storedBalanceFen: 15_000,
      activeMonthlyCards: 1,
      newMembers: 1,
      matchedMembers: 1,
      memberConflicts: 1,
      catalogConflicts: 1,
      reconciliationIssues: 1
    })
    expect(inspection.memberConflicts[0]?.conflicts).toEqual([
      'nickname',
      'balance'
    ])

    const result = importLegacyDatabase(
      source,
      local.connection,
      context,
      metadata,
      {
        now,
        memberResolutions: [
          {
            legacyId: 'legacy-1',
            nickname: 'use_legacy',
            birthday: 'use_legacy',
            balance: 'add_legacy',
            monthlyCard: 'use_legacy'
          }
        ],
        catalogResolutions: [
          { legacyId: 'quick-1', choice: 'import_as_new' }
        ],
        prepareCloudSync: true
      }
    )

    expect(result.importedMembers).toBe(1)
    expect(result.mergedMembers).toBe(1)
    expect(result.openingBalanceFen).toBe(15_000)
    expect(result.importedFinancialHistory).toBe(3)
    expect(result.importedMonthlyCards).toBe(1)
    expect(result.importedCatalogItems).toBe(1)
    expect(
      local.connection
        .prepare(
          `SELECT nickname, birthday_month, birthday_day
           FROM member WHERE id = ?`
        )
        .get(currentMember.id)
    ).toEqual({
      nickname: '旧库昵称',
      birthday_month: 1,
      birthday_day: 2
    })
    expect(
      local.connection
        .prepare(
          `SELECT principal_balance_fen, gift_balance_fen
           FROM wallet_account WHERE member_id = ?`
        )
        .get(currentMember.id)
    ).toEqual({ principal_balance_fen: 5000, gift_balance_fen: 0 })
    expect(
      local.connection
        .prepare(
          `SELECT COUNT(*) count FROM membership_grant
           WHERE member_id = ? AND source_type = 'legacy'`
        )
        .get(currentMember.id)
    ).toEqual({ count: 1 })
    expect(
      local.connection
        .prepare('SELECT COUNT(*) count FROM legacy_raw_row')
        .get()
    ).toEqual({ count: 6 })
    expect(
      local.connection
        .prepare('SELECT COUNT(*) count FROM legacy_financial_history')
        .get()
    ).toEqual({ count: 3 })
    expect(
      getWalletDetails(
        local.connection,
        context,
        currentMember.id
      ).legacyHistory
    ).toHaveLength(2)
    expect(
      local.connection
        .prepare('SELECT COUNT(*) count FROM legacy_reconciliation_issue')
        .get()
    ).toEqual({ count: 1 })
    expect(
      local.connection
        .prepare(
          `SELECT status, source, legacy_import_batch_id
           FROM monthly_card WHERE member_id = ?`
        )
        .get(currentMember.id)
    ).toEqual({
      status: 'active',
      source: 'legacy',
      legacy_import_batch_id: result.batchId
    })
    expect(
      getMonthlyCardDetails(
        local.connection,
        context,
        currentMember.id,
        now
      ).legacyHistory
    ).toMatchObject([
      {
        planName: '标准月卡',
        status: 'active'
      }
    ])
    const importedCard = local.connection
      .prepare(
        `SELECT id FROM monthly_card
         WHERE member_id = ? AND source = 'legacy'`
      )
      .get(currentMember.id) as { id: string }
    expect(() =>
      createFinancialRefundRequest(local.connection, context, {
        requestId: 'legacy-monthly-refund-request',
        targetType: 'monthly_card',
        targetId: importedCard.id,
        reason: '测试旧月卡退款保护'
      })
    ).toThrow('原支付渠道未知')
    expect(
      local.connection
        .prepare(
          `SELECT COUNT(*) count FROM catalog_item
           WHERE name IN ('包场费', '包场费（旧库）')`
        )
        .get()
    ).toEqual({ count: 2 })
    expect(
      local.connection
        .prepare(
          `SELECT operation_type, COUNT(*) count
           FROM outbox_operation
           WHERE json_extract(payload_json, '$.legacyImportBatchId') = ?
           GROUP BY operation_type ORDER BY operation_type`
        )
        .all(result.batchId)
    ).toEqual([
      { operation_type: 'catalog.snapshot', count: 1 },
      { operation_type: 'member.snapshot', count: 2 },
      { operation_type: 'monthly_card.snapshot', count: 1 },
      { operation_type: 'wallet.snapshot', count: 2 }
    ])
    expect(
      ensureLegacyImportCloudSyncOutbox(local.connection, context, now)
    ).toEqual({ batches: 0, created: 0, byType: {} })

    expect(
      inspectLegacyDatabase(
        source,
        local.connection,
        context,
        metadata,
        now
      ).alreadyImported
    ).toBe(true)
    expect(() =>
      importLegacyDatabase(
        source,
        local.connection,
        context,
        metadata,
        { memberResolutions: [], catalogResolutions: [], now }
      )
    ).toThrow('已经完成过旧库导入')

    source.close()
    local.close()
  })

  it('repairs a pre-update import into idempotent cloud snapshot operations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-legacy-cloud-repair-'))
    temporaryDirectories.push(directory)
    const source = createLegacyDatabase(join(directory, 'members.db'))
    const { local, context } = createTarget(directory)
    const now = new Date('2026-06-12T04:00:00.000Z')
    const result = importLegacyDatabase(
      source,
      local.connection,
      context,
      {
        sourceName: 'members.db',
        sourceSha256: 'c'.repeat(64),
        sourceSizeBytes: 1234
      },
      {
        memberResolutions: [{
          legacyId: 'legacy-1',
          nickname: 'use_legacy',
          birthday: 'use_legacy',
          balance: 'add_legacy',
          monthlyCard: 'use_legacy'
        }],
        catalogResolutions: [{ legacyId: 'quick-1', choice: 'import_as_new' }],
        now
      }
    )

    expect(
      local.connection
        .prepare(
          `SELECT COUNT(*) count FROM outbox_operation
           WHERE json_extract(payload_json, '$.legacyImportBatchId') = ?`
        )
        .get(result.batchId)
    ).toEqual({ count: 0 })
    expect(
      ensureLegacyImportCloudSyncOutbox(local.connection, context, now)
    ).toMatchObject({
      batches: 1,
      created: 6,
      byType: {
        'member.snapshot': 2,
        'wallet.snapshot': 2,
        'monthly_card.snapshot': 1,
        'catalog.snapshot': 1
      }
    })
    expect(
      ensureLegacyImportCloudSyncOutbox(local.connection, context, now)
    ).toEqual({ batches: 0, created: 0, byType: {} })

    source.close()
    local.close()
  })

  it('does not write a partial batch when a conflict resolution is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-legacy-'))
    temporaryDirectories.push(directory)
    const source = createLegacyDatabase(join(directory, 'members.db'))
    const { local, context } = createTarget(directory)
    const metadata = {
      sourceName: 'members.db',
      sourceSha256: 'b'.repeat(64),
      sourceSizeBytes: 1234
    }

    expect(() =>
      importLegacyDatabase(
        source,
        local.connection,
        context,
        metadata,
        {
          memberResolutions: [],
          catalogResolutions: [],
          now: new Date('2026-06-12T04:00:00.000Z')
        }
      )
    ).toThrow('冲突尚未选择处理方式')
    expect(
      local.connection
        .prepare('SELECT COUNT(*) count FROM legacy_import_batch')
        .get()
    ).toEqual({ count: 0 })
    expect(
      local.connection
        .prepare('SELECT COUNT(*) count FROM legacy_raw_row')
        .get()
    ).toEqual({ count: 0 })

    source.close()
    local.close()
  })

  it('preflights and imports the private February format sample when available', () => {
    const samplePath = join(
      process.cwd(),
      'legacy-data',
      'private',
      'members.db'
    )
    if (!existsSync(samplePath)) return
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-legacy-sample-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Sample Import Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const store = getStoreContext(local.connection)
    if (!store) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      store.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    const context = { ...store, actor }
    const source = new DatabaseSync(samplePath, { readOnly: true })
    const metadata = {
      sourceName: 'members.db',
      sourceSha256: createHash('sha256')
        .update(readFileSync(samplePath))
        .digest('hex'),
      sourceSizeBytes: statSync(samplePath).size
    }
    const now = new Date('2026-06-12T04:00:00.000Z')

    const inspection = inspectLegacyDatabase(
      source,
      local.connection,
      context,
      metadata,
      now
    )
    expect(inspection.summary).toMatchObject({
      members: 34,
      transactions: 277,
      activityLogs: 202,
      quickDeductItems: 9,
      storedBalanceFen: 647_300,
      activeMonthlyCards: 0,
      expiredMonthlyCards: 10,
      newMembers: 34,
      memberConflicts: 0,
      reconciliationIssues: 5
    })

    const result = importLegacyDatabase(
      source,
      local.connection,
      context,
      metadata,
      {
        memberResolutions: [],
        catalogResolutions: [],
        now
      }
    )
    expect(result).toMatchObject({
      importedMembers: 34,
      mergedMembers: 0,
      openingBalanceFen: 647_300,
      importedFinancialHistory: 479,
      importedMonthlyCards: 10,
      importedCatalogItems: 9
    })
    expect(
      local.connection
        .prepare('SELECT COUNT(*) count FROM legacy_raw_row')
        .get()
    ).toEqual({ count: 522 })
    expect(
      local.connection
        .prepare(
          `SELECT COALESCE(SUM(principal_balance_fen), 0) principal,
                  COALESCE(SUM(gift_balance_fen), 0) gift
           FROM wallet_account`
        )
        .get()
    ).toEqual({ principal: 647_300, gift: 0 })

    source.close()
    local.close()
  })
})
