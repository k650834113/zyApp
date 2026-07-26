import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  cashRecharge,
  createCatalogItem,
  createMember,
  createSalesOrder,
  directFinancialRefund,
  directRefund,
  findEmployeeRecordById,
  getBusinessReport,
  getStoreContext,
  listCatalogItems,
  openLocalDatabase,
  purchaseMonthlyCard,
  recordBusinessReportExport,
  resolveBusinessReportRange,
  useMonthlyCard
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedReporting() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-reporting-'))
  temporaryDirectories.push(directory)
  const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
  const bootstrap = bootstrapStore(localDatabase.connection, {
    storeName: 'Reporting Store',
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
  const members = ['13800138001', '13800138002', '13800138003'].map(
    (phone, index) =>
      createMember(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          phone,
          nickname: `Member ${index + 1}`,
          confirmedAtLeast14: true
        }
      )
  )
  const admission = listCatalogItems(localDatabase.connection, store)[0]
  if (!admission) throw new Error('Missing admission item')
  const drink = createCatalogItem(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      name: 'Cola',
      itemType: 'product',
      regularPriceFen: 400,
      advancedPriceFen: 350
    }
  )
  return { localDatabase, store, manager, members, admission, drink }
}

describe('business reporting repository', () => {
  it('keeps current-store reporting isolated and includes occurrence-store wallet entries tenant-wide', () => {
    const { localDatabase, store, manager, members } = initializedReporting()
    const member = members[0]
    if (!member) throw new Error('Missing member')
    cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, principalFen: 10_000, reason: 'Seed wallet' }
    )
    const otherStoreId = randomUUID()
    const timestamp = '2026-06-10T08:00:00.000Z'
    localDatabase.connection.prepare(
      `INSERT INTO store
       (id, tenant_id, name, timezone, business_open_minute,
        business_close_minute, status_override, created_at, updated_at)
       VALUES (?, ?, 'Other Store', 'Asia/Shanghai', 780, 1380, 'automatic', ?, ?)`
    ).run(otherStoreId, store.tenantId, timestamp, timestamp)
    localDatabase.connection.prepare(
      `INSERT INTO wallet_ledger
       (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
        principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
        gift_balance_after_fen, source_id, related_ledger_id, request_id,
        actor_id, device_id, reason, metadata_json, occurred_at)
       SELECT ?, tenant_id, ?, wallet_account_id, member_id, 'consumption_debit',
              -1000, 0, principal_balance_after_fen - 1000,
              gift_balance_after_fen, ?, NULL, ?, actor_id, device_id,
              'Cross-store use', '{}', ?
       FROM wallet_ledger WHERE tenant_id = ? LIMIT 1`
    ).run(
      randomUUID(), otherStoreId, randomUUID(), randomUUID(), timestamp,
      store.tenantId
    )
    const currentStore = getBusinessReport(localDatabase.connection, store, {
      fromDate: '2026-06-10', toDate: '2026-06-10', scope: 'store'
    })
    const tenant = getBusinessReport(localDatabase.connection, store, {
      fromDate: '2026-06-10', toDate: '2026-06-10', scope: 'tenant'
    })
    expect(currentStore.wallet.consumptionDebitFen).toBe(0)
    expect(tenant.wallet.consumptionDebitFen).toBe(1_000)
    localDatabase.close()
  })

  it('reconciles orders, refunds, wallet, monthly cards and actual cash inflow', () => {
    const { localDatabase, store, manager, members, admission, drink } =
      initializedReporting()
    const [walletMember, activeCardMember, refundedCardMember] = members
    if (!walletMember || !activeCardMember || !refundedCardMember) {
      throw new Error('Missing members')
    }
    const recharge = cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: walletMember.id,
        principalFen: 50_000,
        reason: 'Cash recharge'
      }
    )
    localDatabase.connection
      .prepare(
        `UPDATE wallet_recharge
         SET occurred_at = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        '2026-06-10T02:00:00.000Z',
        '2026-06-10T02:00:00.000Z',
        store.tenantId,
        recharge.operationId
      )

    const cashOrder = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 2,
            pricingTier: 'regular'
          }
        ],
        now: new Date('2026-06-10T08:00:00.000Z')
      }
    )
    createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        customerMemberId: walletMember.id,
        paymentMethod: 'stored_value',
        walletMemberId: walletMember.id,
        lines: [
          {
            catalogItemId: drink.id,
            quantity: 10,
            pricingTier: 'regular'
          }
        ],
        now: new Date('2026-06-10T09:00:00.000Z')
      }
    )
    const cashOrderItem = cashOrder.items[0]
    if (!cashOrderItem) throw new Error('Missing cash order item')
    directRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        orderId: cashOrder.id,
        items: [{ orderItemId: cashOrderItem.id, quantity: 1 }],
        reason: 'Admission refund',
        now: new Date('2026-06-10T10:00:00.000Z')
      }
    )
    directFinancialRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        targetType: 'cash_recharge',
        targetId: recharge.operationId,
        reason: 'Recharge reversal',
        now: new Date('2026-06-10T11:00:00.000Z')
      }
    )

    const activeCard = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: activeCardMember.id,
        reason: 'Monthly card',
        now: new Date('2026-06-10T03:00:00.000Z')
      }
    )
    localDatabase.connection
      .prepare(
        `UPDATE monthly_card
         SET payment_method = 'wechat', source = 'cloud'
         WHERE id = ?`
      )
      .run(activeCard.id)
    useMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        cardId: activeCard.id,
        reason: 'Admission',
        now: new Date('2026-06-10T04:00:00.000Z')
      }
    )
    const refundedCard = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: refundedCardMember.id,
        reason: 'Monthly card',
        now: new Date('2026-06-10T05:00:00.000Z')
      }
    )
    directFinancialRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        targetType: 'monthly_card',
        targetId: refundedCard.id,
        reason: 'Customer changed mind',
        now: new Date('2026-06-10T06:00:00.000Z')
      }
    )

    const report = getBusinessReport(
      localDatabase.connection,
      store,
      { fromDate: '2026-06-10', toDate: '2026-06-10' },
      new Date('2026-06-10T12:00:00.000Z')
    )

    expect(report.order).toEqual({
      orderCount: 2,
      grossSalesFen: 12_000,
      refundCount: 1,
      refundFen: 4_000,
      netSalesFen: 8_000,
      averageOrderFen: 6_000,
      admissionQuantity: 2
    })
    expect(report.payment).toEqual({
      cashSalesFen: 8_000,
      cashRefundFen: 4_000,
      cashNetFen: 4_000,
      storedValueSalesFen: 4_000,
      storedValueRefundFen: 0,
      storedValueNetFen: 4_000
    })
    expect(report.wallet).toEqual({
      rechargeCount: 1,
      rechargePrincipalFen: 50_000,
      rechargeGiftFen: 5_000,
      rechargeRefundCount: 1,
      rechargeRefundPrincipalFen: 50_000,
      reclaimedGiftFen: 1_000,
      consumptionDebitFen: 4_000,
      orderRefundCreditFen: 0
    })
    expect(report.monthlyCard).toEqual({
      soldCount: 2,
      grossSalesFen: 40_000,
      refundCount: 1,
      refundFen: 20_000,
      netSalesFen: 20_000,
      usageCount: 1,
      activeCount: 1
    })
    expect(report.actualCashInflowFen).toBe(4_000)
    expect(report.items).toEqual([
      {
        itemName: admission.name,
        itemType: 'admission',
        soldQuantity: 2,
        refundedQuantity: 1,
        netQuantity: 1,
        grossSalesFen: 8_000,
        refundFen: 4_000,
        netSalesFen: 4_000
      },
      {
        itemName: 'Cola',
        itemType: 'product',
        soldQuantity: 10,
        refundedQuantity: 0,
        netQuantity: 10,
        grossSalesFen: 4_000,
        refundFen: 0,
        netSalesFen: 4_000
      }
    ])
    recordBusinessReportExport(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: 'report-export-20260610',
        report,
        fileName: 'report.xls',
        fileSha256: 'a'.repeat(64)
      }
    )
    recordBusinessReportExport(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: 'report-export-20260610',
        report,
        fileName: 'report.xls',
        fileSha256: 'a'.repeat(64)
      }
    )
    expect(
      (
        localDatabase.connection
          .prepare(
            `SELECT COUNT(*) count FROM audit_log
             WHERE action = 'report.business.exported'`
          )
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(
      (
        localDatabase.connection
          .prepare(
            `SELECT COUNT(*) count FROM outbox_operation
             WHERE operation_type = 'report.business.exported'`
          )
          .get() as { count: number }
      ).count
    ).toBe(1)
    localDatabase.close()
  })

  it('uses Shanghai natural-day boundaries and rejects invalid ranges', () => {
    expect(
      resolveBusinessReportRange({
        fromDate: '2026-06-10',
        toDate: '2026-06-11'
      })
    ).toEqual({
      fromDate: '2026-06-10',
      toDate: '2026-06-11',
      fromTimestamp: '2026-06-09T16:00:00.000Z',
      toExclusiveTimestamp: '2026-06-11T16:00:00.000Z'
    })
    expect(() =>
      resolveBusinessReportRange({
        fromDate: '2026-02-30',
        toDate: '2026-03-01'
      })
    ).toThrow('valid calendar date')
    expect(() =>
      resolveBusinessReportRange({
        fromDate: '2026-06-12',
        toDate: '2026-06-11'
      })
    ).toThrow('cannot be later')
  })
})
