import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approveRefund,
  bootstrapStore,
  cashRecharge,
  createCatalogItem,
  createEmployee,
  createMember,
  createRefundRequest,
  createSalesOrder,
  directRefund,
  findEmployeeRecordById,
  findRefundableOrder,
  getStoreContext,
  getWalletDetails,
  listCatalogItems,
  listRefunds,
  openLocalDatabase,
  recordRefundEvidence,
  rejectRefund
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedRefunds() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-refund-'))
  temporaryDirectories.push(directory)
  const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
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
  const staff = createEmployee(
    localDatabase.connection,
    { ...store, actorId: manager.id },
    {
      username: 'staff01',
      passwordHash: 'scrypt$staff',
      displayName: 'Staff',
      role: 'staff'
    }
  )
  const member = createMember(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      phone: '13800138000',
      nickname: 'Refund Member',
      confirmedAtLeast14: true
    }
  )
  const admission = listCatalogItems(localDatabase.connection, store)[0]
  if (!admission) throw new Error('Missing admission')
  const product = createCatalogItem(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      name: 'Cola',
      itemType: 'product',
      regularPriceFen: 400,
      advancedPriceFen: 400
    }
  )
  return { localDatabase, store, manager, staff, member, admission, product }
}

describe('order refund repository', () => {
  it('lets staff request a partial cash refund and manager approve it idempotently', () => {
    const { localDatabase, store, manager, staff, admission } = initializedRefunds()
    const completedAt = new Date('2026-06-01T05:00:00.000Z')
    const order = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 3,
            pricingTier: 'regular'
          }
        ],
        now: completedAt
      }
    )
    const requestId = randomUUID()
    const pending = createRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId,
        orderId: order.id,
        items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
        now: new Date('2026-06-02T05:00:00.000Z')
      }
    )
    expect(pending).toMatchObject({
      status: 'pending',
      totalFen: 4000,
      paymentMethod: 'cash'
    })
    expect(
      createRefundRequest(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          requestId,
          orderId: order.id,
          items: [{ orderItemId: order.items[0]!.id, quantity: 1 }]
        }
      ).id
    ).toBe(pending.id)
    expect(() =>
      approveRefund(
        localDatabase.connection,
        { ...store, actor: staff },
        { requestId: randomUUID(), refundId: pending.id }
      )
    ).toThrow('Only managers')

    const approvalRequestId = randomUUID()
    const completed = approveRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: approvalRequestId,
        refundId: pending.id,
        now: new Date('2026-06-02T06:00:00.000Z')
      }
    )
    const repeated = approveRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: approvalRequestId, refundId: pending.id }
    )
    expect(completed.status).toBe('completed')
    expect(repeated.id).toBe(completed.id)
    expect(
      findRefundableOrder(
        localDatabase.connection,
        store,
        order.orderNumber,
        new Date('2026-06-02T07:00:00.000Z')
      ).items[0]
    ).toMatchObject({
      completedRefundQuantity: 1,
      pendingRefundQuantity: 0,
      refundableQuantity: 2
    })
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) count FROM refund_payment')
          .get() as { count: number }
      ).count
    ).toBe(1)
    const evidenceRequestId = randomUUID()
    const evidence = recordRefundEvidence(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: evidenceRequestId,
        refundId: completed.id,
        evidenceType: 'pdf',
        fileName: `${completed.refundNumber}.pdf`,
        fileSha256: 'a'.repeat(64),
        now: new Date('2026-06-02T07:00:00.000Z')
      }
    )
    expect(evidence).toMatchObject({
      evidenceType: 'pdf',
      fileSha256: 'a'.repeat(64)
    })
    expect(
      recordRefundEvidence(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: evidenceRequestId,
          refundId: completed.id,
          evidenceType: 'pdf',
          fileName: `${completed.refundNumber}.pdf`,
          fileSha256: 'a'.repeat(64)
        }
      ).id
    ).toBe(evidence.id)
    localDatabase.close()
  })

  it('requires manager override and a reason to refund delivered products', () => {
    const { localDatabase, store, manager, staff, product } = initializedRefunds()
    const completedAt = new Date('2026-06-01T05:00:00.000Z')
    const order = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: product.id,
            quantity: 2,
            pricingTier: 'regular'
          }
        ],
        now: completedAt
      }
    )
    const pending = createRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId: randomUUID(),
        orderId: order.id,
        items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
        now: new Date('2026-06-02T05:00:00.000Z')
      }
    )
    expect(() =>
      approveRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          refundId: pending.id,
          now: new Date('2026-06-02T06:00:00.000Z')
        }
      )
    ).toThrow('special refund override')
    expect(() =>
      approveRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          refundId: pending.id,
          specialProductOverride: true,
          now: new Date('2026-06-02T06:00:00.000Z')
        }
      )
    ).toThrow('requires a reason')
    expect(
      approveRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          refundId: pending.id,
          specialProductOverride: true,
          reason: '商品质量异常',
          now: new Date('2026-06-02T06:00:00.000Z')
        }
      )
    ).toMatchObject({
      status: 'completed',
      specialProductOverride: true,
      completionReason: '商品质量异常'
    })
    localDatabase.close()
  })

  it('returns stored value to the original member and restores gift before principal', () => {
    const { localDatabase, store, manager, member, admission } = initializedRefunds()
    cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 50_000,
        reason: 'Cash recharge'
      }
    )
    const order = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'stored_value',
        walletMemberId: member.id,
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 2,
            pricingTier: 'regular'
          }
        ],
        now: new Date('2026-06-01T05:00:00.000Z')
      }
    )
    expect(getWalletDetails(localDatabase.connection, store, member.id).wallet).toMatchObject({
      principalBalanceFen: 47_000,
      giftBalanceFen: 0
    })
    const first = directRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        orderId: order.id,
        items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
        now: new Date('2026-06-02T05:00:00.000Z')
      }
    )
    expect(first.totalFen).toBe(4000)
    expect(getWalletDetails(localDatabase.connection, store, member.id).wallet).toMatchObject({
      principalBalanceFen: 47_000,
      giftBalanceFen: 4_000
    })
    directRefund(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        orderId: order.id,
        items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
        now: new Date('2026-06-02T06:00:00.000Z')
      }
    )
    expect(getWalletDetails(localDatabase.connection, store, member.id).wallet).toMatchObject({
      principalBalanceFen: 50_000,
      giftBalanceFen: 5_000,
      totalBalanceFen: 55_000
    })
    expect(
      (
        localDatabase.connection
          .prepare(
            "SELECT COUNT(*) count FROM wallet_ledger WHERE entry_type = 'order_refund_credit'"
          )
          .get() as { count: number }
      ).count
    ).toBe(2)
    localDatabase.close()
  })

  it('rejects expired refunds and releases quantities after rejection', () => {
    const { localDatabase, store, manager, staff, admission } = initializedRefunds()
    const order = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular'
          }
        ],
        now: new Date('2026-01-01T00:00:00.000Z')
      }
    )
    expect(() =>
      createRefundRequest(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          requestId: randomUUID(),
          orderId: order.id,
          items: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
          now: new Date('2026-02-01T00:00:00.001Z')
        }
      )
    ).toThrow('expired')

    const recentOrder = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'cash',
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
    const pending = createRefundRequest(
      localDatabase.connection,
      { ...store, actor: staff },
      {
        requestId: randomUUID(),
        orderId: recentOrder.id,
        items: [{ orderItemId: recentOrder.items[0]!.id, quantity: 1 }],
        now: new Date('2026-06-02T05:00:00.000Z')
      }
    )
    expect(
      rejectRefund(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          refundId: pending.id,
          reason: '不符合退款条件',
          now: new Date('2026-06-02T06:00:00.000Z')
        }
      ).status
    ).toBe('rejected')
    expect(
      findRefundableOrder(
        localDatabase.connection,
        store,
        recentOrder.id,
        new Date('2026-06-02T07:00:00.000Z')
      ).items[0]?.refundableQuantity
    ).toBe(1)
    expect(listRefunds(localDatabase.connection, store, { limit: 10 })).toHaveLength(1)
    localDatabase.close()
  })
})
