import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  cashRecharge,
  createMember,
  createSalesOrder,
  findEmployeeRecordById,
  getStoreContext,
  listCatalogItems,
  listRechargeTransactions,
  listSalesTransactions,
  openLocalDatabase
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('transaction record queries', () => {
  it('searches member sales and lists cash plus WeChat recharges without duplicates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-transactions-'))
    temporaryDirectories.push(directory)
    const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))

    try {
      const bootstrap = bootstrapStore(localDatabase.connection, {
        storeName: 'Test Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$manager',
        managerDisplayName: 'Owner',
        deviceName: 'Cashier 01'
      })
      const store = getStoreContext(localDatabase.connection)
      if (!store) throw new Error('Missing store')
      const manager = findEmployeeRecordById(
        localDatabase.connection,
        store.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Missing manager')
      const member = createMember(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          phone: '13800138000',
          nickname: '查询会员',
          confirmedAtLeast14: true
        }
      )
      const catalogItem = listCatalogItems(localDatabase.connection, store)[0]
      if (!catalogItem) throw new Error('Missing catalog item')

      cashRecharge(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          memberId: member.id,
          principalFen: 10_000,
          reason: 'Cash recharge',
          now: new Date('2026-07-24T02:00:00.000Z')
        }
      )
      createSalesOrder(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          customerMemberId: member.id,
          paymentMethod: 'stored_value',
          walletMemberId: member.id,
          lines: [
            {
              catalogItemId: catalogItem.id,
              quantity: 1,
              pricingTier: 'regular'
            }
          ],
          now: new Date('2026-07-24T03:00:00.000Z')
        }
      )
      createSalesOrder(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          paymentMethod: 'cash',
          lines: [
            {
              catalogItemId: catalogItem.id,
              quantity: 1,
              pricingTier: 'regular'
            }
          ],
          now: new Date('2026-07-24T04:00:00.000Z')
        }
      )

      const insertWechatRecharge = localDatabase.connection.prepare(
        `INSERT INTO wechat_recharge_order_mirror
         (id, tenant_id, store_id, member_id, identity_id, request_id, out_trade_no,
          provider_mode, provider_prepay_id, provider_transaction_id,
          principal_fen, gift_fen, status, error_message, expires_at, paid_at,
          settled_at, wallet_operation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'wechat', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      )
      insertWechatRecharge.run(
        randomUUID(),
        store.tenantId,
        store.storeId,
        member.id,
        randomUUID(),
        randomUUID(),
        'WX-SETTLED-001',
        'prepay-settled',
        '4200000000001',
        2_000,
        200,
        'settled',
        '2026-07-24T05:15:00.000Z',
        '2026-07-24T05:00:00.000Z',
        '2026-07-24T05:00:00.000Z',
        randomUUID(),
        '2026-07-24T04:55:00.000Z',
        '2026-07-24T05:00:00.000Z'
      )
      insertWechatRecharge.run(
        randomUUID(),
        store.tenantId,
        store.storeId,
        member.id,
        randomUUID(),
        randomUUID(),
        'WX-PENDING-001',
        'prepay-pending',
        null,
        1_000,
        0,
        'pending_payment',
        '2026-07-24T06:15:00.000Z',
        null,
        null,
        null,
        '2026-07-24T06:00:00.000Z',
        '2026-07-24T06:00:00.000Z'
      )

      const memberSales = listSalesTransactions(localDatabase.connection, store, {
        query: '查询会员',
        from: '2026-07-24',
        to: '2026-07-24'
      })
      expect(memberSales).toHaveLength(1)
      expect(memberSales[0]).toMatchObject({
        customerMemberId: member.id,
        memberNickname: '查询会员',
        paymentMethod: 'stored_value'
      })

      const recharges = listRechargeTransactions(localDatabase.connection, store, {
        query: '8000',
        from: '2026-07-24',
        to: '2026-07-24'
      })
      expect(recharges).toHaveLength(3)
      expect(recharges.map((record) => record.orderNumber)).toEqual([
        'WX-PENDING-001',
        'WX-SETTLED-001',
        expect.stringMatching(/^CR-/)
      ])
      expect(recharges.map((record) => record.channel)).toEqual([
        'wechat',
        'wechat',
        'cash'
      ])
      expect(recharges.map((record) => record.status)).toEqual([
        'pending_payment',
        'settled',
        'settled'
      ])
    } finally {
      localDatabase.close()
    }
  })

  it('validates limits and date boundaries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-transactions-validation-'))
    temporaryDirectories.push(directory)
    const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))

    try {
      bootstrapStore(localDatabase.connection, {
        storeName: 'Test Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$manager',
        managerDisplayName: 'Owner',
        deviceName: 'Cashier 01'
      })
      const store = getStoreContext(localDatabase.connection)
      if (!store) throw new Error('Missing store')

      expect(() =>
        listSalesTransactions(localDatabase.connection, store, { limit: 501 })
      ).toThrow('limit')
      expect(() =>
        listRechargeTransactions(localDatabase.connection, store, {
          from: 'not-a-date'
        })
      ).toThrow('from')
    } finally {
      localDatabase.close()
    }
  })
})
