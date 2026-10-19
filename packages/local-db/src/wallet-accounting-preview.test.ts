import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { bootstrapStore, cashRecharge, createMember, debitWallet,
  findEmployeeRecordById, getStoreContext, openLocalDatabase,
  prepareCloudFinancialCommand } from './index'
import { prepareWalletAccountingPreview } from './wallet-accounting-preview'

for (const entryType of ['cash_recharge', 'manual_adjustment']) {
  it(`rebuilds repeated ${entryType} sources without losing deltas or spending allocations`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-lot-preview-'))
    const database = openLocalDatabase(join(directory, 'test.db'))
    const db = database.connection
    try {
      const setup = bootstrapStore(db, { storeName: 'Test', managerUsername: 'manager',
        managerDisplayName: 'Manager', managerPasswordHash: 'test', deviceName: 'PC' })
      const store = getStoreContext(db)!
      const context = { ...store, actor: findEmployeeRecordById(db, store.tenantId, setup.managerId)! }
      const member = createMember(db, context, { phone: '13800138000', nickname: 'Test', confirmedAtLeast14: true })
      const first = cashRecharge(db, context, { requestId: 'first', memberId: member.id,
        principalFen: 10000, reason: 'cash', now: new Date('2026-09-01T01:00:00Z') })
      debitWallet(db, context, { requestId: 'debit', memberId: member.id,
        amountFen: 3000, reason: 'spend' })
      db.prepare("UPDATE wallet_ledger SET occurred_at='2026-09-01T02:00:00.000Z' WHERE request_id='debit'").run()
      cashRecharge(db, context, { requestId: 'second', memberId: member.id,
        principalFen: 10000, reason: 'cash', now: new Date('2026-09-01T03:00:00Z') })
      db.prepare(`UPDATE wallet_ledger SET source_id=?, entry_type=?, request_id='cloud:' || request_id
        WHERE entry_type='cash_recharge'`).run(first.operationId, entryType)
      db.prepare("UPDATE outbox_operation SET sync_status='confirmed'").run()
      const ledgerBefore = db.prepare('SELECT * FROM wallet_ledger').all()
      const lotsBefore = db.prepare('SELECT * FROM wallet_lot').all()
      db.exec('SAVEPOINT inspect_preview')
      prepareWalletAccountingPreview(db, store.tenantId, member.id)
      expect(db.prepare('SELECT source_id, original_principal_fen, remaining_principal_fen FROM wallet_lot').all())
        .toEqual([{ source_id: first.operationId, original_principal_fen: 20000, remaining_principal_fen: 17000 }])
      expect(db.prepare(`SELECT SUM(a.principal_fen) spent FROM wallet_ledger_allocation a
        JOIN wallet_lot lot ON lot.id=a.lot_id`).get()).toMatchObject({ spent: 3000 })
      db.exec('ROLLBACK TO inspect_preview')
      db.exec('RELEASE inspect_preview')
      const request = { requestId: 'next', memberId: member.id, principalFen: 1000, reason: 'cash' }
      expect(prepareCloudFinancialCommand(db, context, 'recharge', request, () => cashRecharge(db, context, request)))
        .toMatchObject({ wallet: { principalBalanceFen: 18000 } })
      expect(db.prepare('SELECT * FROM wallet_ledger').all()).toEqual(ledgerBefore)
      expect(db.prepare('SELECT * FROM wallet_lot').all()).toEqual(lotsBefore)
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
