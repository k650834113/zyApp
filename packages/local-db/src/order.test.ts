import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  cashRecharge,
  correctMemberBirthday,
  createCatalogItem,
  createMember,
  createSalesOrder,
  findEmployeeRecordById,
  getStoreContext,
  getWalletDetails,
  listCatalogItems,
  listRecentOrders,
  openLocalDatabase,
  pauseMonthlyCard,
  purchaseMonthlyCard,
  updateCatalogItem
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedOrders() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-order-'))
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
  const member = createMember(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      phone: '13800138000',
      nickname: 'Order Member',
      confirmedAtLeast14: true
    }
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
  return { localDatabase, store, manager, member, admission, drink }
}

describe('sales order repository', () => {
  it('preserves catalog price snapshots after a manager changes the current price', () => {
    const { localDatabase, store, manager, admission } = initializedOrders()
    const order = createSalesOrder(
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
        ]
      }
    )
    updateCatalogItem(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        itemId: admission.id,
        name: admission.name,
        itemType: admission.itemType,
        regularPriceFen: 5000,
        advancedPriceFen: 4000,
        reason: 'New season price'
      }
    )

    const saved = listRecentOrders(localDatabase.connection, store, 10)[0]
    expect(order.totalFen).toBe(8000)
    expect(saved?.items[0]).toMatchObject({
      regularPriceFen: 4000,
      advancedPriceFen: 3000,
      appliedUnitPriceFen: 4000,
      quantity: 2,
      lineTotalFen: 8000
    })
    localDatabase.close()
  })

  it('debits gift balance first, is idempotent, and rolls back an insufficient order', () => {
    const { localDatabase, store, manager, member, drink } = initializedOrders()
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
    const requestId = randomUUID()
    const first = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        customerMemberId: member.id,
        paymentMethod: 'stored_value',
        walletMemberId: member.id,
        lines: [
          {
            catalogItemId: drink.id,
            quantity: 15,
            pricingTier: 'regular'
          }
        ]
      }
    )
    const repeated = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        customerMemberId: member.id,
        paymentMethod: 'stored_value',
        walletMemberId: member.id,
        lines: [
          {
            catalogItemId: drink.id,
            quantity: 15,
            pricingTier: 'regular'
          }
        ]
      }
    )
    expect(repeated.id).toBe(first.id)
    expect(getWalletDetails(localDatabase.connection, store, member.id).wallet).toMatchObject({
      principalBalanceFen: 49_000,
      giftBalanceFen: 0,
      totalBalanceFen: 49_000
    })

    const beforeCount = (
      localDatabase.connection.prepare('SELECT COUNT(*) count FROM sales_order').get() as {
        count: number
      }
    ).count
    expect(() =>
      createSalesOrder(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          paymentMethod: 'stored_value',
          walletMemberId: member.id,
          lines: [
            {
              catalogItemId: drink.id,
              quantity: 999,
              pricingTier: 'regular'
            }
          ]
        }
      )
    ).toThrow('用户余额不足')
    expect(
      (
        localDatabase.connection.prepare('SELECT COUNT(*) count FROM sales_order').get() as {
          count: number
        }
      ).count
    ).toBe(beforeCount)
    expect(getWalletDetails(localDatabase.connection, store, member.id).wallet.totalBalanceFen).toBe(
      49_000
    )
    localDatabase.close()
  })

  it('applies birthday and same-day repeat benefits but treats the next natural day separately', () => {
    const { localDatabase, store, manager, member, admission } = initializedOrders()
    correctMemberBirthday(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        memberId: member.id,
        month: 6,
        day: 11,
        reason: 'Confirmed birthday'
      }
    )
    const birthday = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        customerMemberId: member.id,
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular',
            personalAdmissionBenefit: true
          }
        ],
        now: new Date('2026-06-11T05:00:00.000Z')
      }
    )
    const repeat = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        customerMemberId: member.id,
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular',
            personalAdmissionBenefit: true
          }
        ],
        now: new Date('2026-06-11T10:00:00.000Z')
      }
    )
    const afterMidnight = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        customerMemberId: member.id,
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular',
            personalAdmissionBenefit: true
          }
        ],
        now: new Date('2026-06-11T16:30:00.000Z')
      }
    )

    expect(birthday.items[0]).toMatchObject({
      appliedUnitPriceFen: 0,
      benefitType: 'birthday'
    })
    expect(repeat.items[0]).toMatchObject({
      appliedUnitPriceFen: 0,
      benefitType: 'repeat_admission'
    })
    expect(afterMidnight.items[0]).toMatchObject({
      appliedUnitPriceFen: 4000,
      benefitType: 'none'
    })
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) count FROM birthday_benefit_usage')
          .get() as { count: number }
      ).count
    ).toBe(1)
    localDatabase.close()
  })

  it('uses an active monthly card but charges the normal price while it is paused', () => {
    const { localDatabase, store, manager, member, admission } = initializedOrders()
    const purchasedAt = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        reason: 'Cash monthly card purchase',
        now: purchasedAt
      }
    )
    const freeOrder = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        customerMemberId: member.id,
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular',
            personalAdmissionBenefit: true
          }
        ],
        now: new Date('2026-06-02T05:00:00.000Z')
      }
    )
    expect(freeOrder.items[0]?.benefitType).toBe('monthly_card')
    expect(freeOrder.totalFen).toBe(0)
    expect(
      (
        localDatabase.connection
          .prepare(
            `SELECT COUNT(*) count FROM outbox_operation
             WHERE operation_type = 'monthly_card.used'
               AND aggregate_id = ?`
          )
          .get(card.id) as { count: number }
      ).count
    ).toBe(1)

    pauseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        cardId: card.id,
        reason: 'Customer requested pause',
        now: new Date('2026-06-03T05:00:00.000Z')
      }
    )
    const chargedOrder = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        customerMemberId: member.id,
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular',
            personalAdmissionBenefit: true
          }
        ],
        now: new Date('2026-06-03T06:00:00.000Z')
      }
    )
    expect(chargedOrder.items[0]?.benefitType).toBe('none')
    expect(chargedOrder.totalFen).toBe(4000)
    localDatabase.close()
  })

  it('creates an independent internal visit record for every sales order', () => {
    const { localDatabase, store, manager, member, admission, drink } = initializedOrders()
    cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        principalFen: 10_000,
        reason: 'Cash recharge'
      }
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
            quantity: 1,
            pricingTier: 'regular'
          }
        ]
      }
    )
    const storedOrder = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'stored_value',
        walletMemberId: member.id,
        lines: [
          {
            catalogItemId: drink.id,
            quantity: 1,
            pricingTier: 'regular'
          }
        ]
      }
    )
    expect(storedOrder.visitBatchId).not.toBe(cashOrder.visitBatchId)
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) count FROM visit_batch')
          .get() as { count: number }
      ).count
    ).toBe(2)
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) count FROM sales_order WHERE visit_batch_id = ?')
          .get(cashOrder.visitBatchId) as { count: number }
      ).count
    ).toBe(1)
    localDatabase.close()
  })

  it('records a custom collection as a refundable order item without exposing its placeholder', () => {
    const { localDatabase, store, manager } = initializedOrders()
    const order = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        paymentMethod: 'cash',
        lines: [
          {
            customName: '包场补差价',
            customUnitPriceFen: 12_300,
            quantity: 1,
            pricingTier: 'regular'
          }
        ]
      }
    )

    expect(order).toMatchObject({
      totalFen: 12_300,
      items: [
        {
          itemName: '包场补差价',
          itemType: 'service',
          appliedUnitPriceFen: 12_300,
          lineTotalFen: 12_300
        }
      ]
    })
    expect(
      listCatalogItems(localDatabase.connection, store).some(
        (item) => item.name === '自定义收款'
      )
    ).toBe(false)
    localDatabase.close()
  })
})
