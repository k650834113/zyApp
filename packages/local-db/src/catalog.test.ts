import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  createCatalogItem,
  createEmployee,
  findEmployeeRecordById,
  getStoreContext,
  listCatalogItems,
  openLocalDatabase,
  setCatalogAvailability,
  setCatalogItemStatus,
  updateCatalogItem
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedCatalog() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-catalog-'))
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
  return { localDatabase, store, manager, staff }
}

describe('catalog repository', () => {
  it('shares catalog masters across stores while keeping prices and availability store-specific', () => {
    const { localDatabase, store, manager } = initializedCatalog()
    const item = createCatalogItem(
      localDatabase.connection,
      { ...store, actor: manager },
      { name: 'Shared drink', itemType: 'product', regularPriceFen: 500, advancedPriceFen: 450 }
    )
    const otherStoreId = randomUUID()
    const now = new Date().toISOString()
    localDatabase.connection.prepare(
      `INSERT INTO store
       (id, tenant_id, name, timezone, business_open_minute,
        business_close_minute, status_override, created_at, updated_at)
       VALUES (?, ?, 'Other Store', 'Asia/Shanghai', 780, 1380, 'automatic', ?, ?)`
    ).run(otherStoreId, store.tenantId, now, now)
    const otherContext = { ...store, storeId: otherStoreId, actor: manager }
    expect(listCatalogItems(localDatabase.connection, otherContext)
      .find((candidate) => candidate.id === item.id)?.regularPriceFen).toBe(500)
    updateCatalogItem(localDatabase.connection, otherContext, {
      itemId: item.id,
      name: item.name,
      itemType: item.itemType,
      regularPriceFen: 600,
      advancedPriceFen: 550,
      reason: 'Other-store pricing'
    })
    setCatalogAvailability(localDatabase.connection, otherContext, {
      itemId: item.id,
      availability: 'sold_out',
      reason: 'Other store sold out'
    })
    const origin = listCatalogItems(localDatabase.connection, store)
      .find((candidate) => candidate.id === item.id)
    const other = listCatalogItems(localDatabase.connection, otherContext)
      .find((candidate) => candidate.id === item.id)
    expect(origin).toMatchObject({ regularPriceFen: 500, availability: 'available' })
    expect(other).toMatchObject({ regularPriceFen: 600, availability: 'sold_out' })
    localDatabase.close()
  })

  it('creates the default admission item with confirmed prices', () => {
    const { localDatabase, store } = initializedCatalog()
    expect(listCatalogItems(localDatabase.connection, store)).toMatchObject([
      {
        name: '入场费',
        itemType: 'admission',
        regularPriceFen: 4000,
        advancedPriceFen: 3000,
        status: 'active',
        availability: 'available'
      }
    ])
    localDatabase.close()
  })

  it('lets managers create, edit and disable items with audit and outbox records', () => {
    const { localDatabase, store, manager } = initializedCatalog()
    const item = createCatalogItem(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        name: '可口可乐',
        itemType: 'product',
        regularPriceFen: 300,
        advancedPriceFen: 300
      }
    )
    const updated = updateCatalogItem(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        itemId: item.id,
        name: '可口可乐',
        itemType: 'product',
        regularPriceFen: 400,
        advancedPriceFen: 350,
        reason: '采购成本变化'
      }
    )
    expect(updated).toMatchObject({ regularPriceFen: 400, advancedPriceFen: 350 })
    expect(
      setCatalogItemStatus(
        localDatabase.connection,
        { ...store, actor: manager },
        { itemId: item.id, status: 'disabled', reason: '停止销售' }
      ).status
    ).toBe('disabled')
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM audit_log WHERE aggregate_type='catalog_item'")
          .get() as { count: number }
      ).count
    ).toBe(3)
    expect(
      (
        localDatabase.connection
          .prepare(
            "SELECT COUNT(*) count FROM outbox_operation WHERE operation_type LIKE 'catalog.%'"
          )
          .get() as { count: number }
      ).count
    ).toBe(3)
    localDatabase.close()
  })

  it('allows staff to change availability but not prices or enabled status', () => {
    const { localDatabase, store, manager, staff } = initializedCatalog()
    const item = createCatalogItem(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        name: '矿泉水',
        itemType: 'product',
        regularPriceFen: 200,
        advancedPriceFen: 200
      }
    )
    expect(
      setCatalogAvailability(
        localDatabase.connection,
        { ...store, actor: staff },
        { itemId: item.id, availability: 'sold_out', reason: '前台已售罄' }
      ).availability
    ).toBe('sold_out')
    expect(() =>
      updateCatalogItem(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          itemId: item.id,
          name: '矿泉水',
          itemType: 'product',
          regularPriceFen: 100,
          advancedPriceFen: 100,
          reason: '无权改价'
        }
      )
    ).toThrow('Only managers')
    expect(() =>
      setCatalogItemStatus(
        localDatabase.connection,
        { ...store, actor: staff },
        { itemId: item.id, status: 'disabled', reason: '无权停用' }
      )
    ).toThrow('Only managers')
    localDatabase.close()
  })
})
