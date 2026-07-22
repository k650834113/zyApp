import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  createSalesOrder,
  findCashierCommandExecution,
  findEmployeeRecordById,
  getStoreContext,
  listCatalogItems,
  listPendingCashierCommandReports,
  markCashierCommandReported,
  openLocalDatabase,
  recordFailedCashierCommand
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initialized() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-command-'))
  temporaryDirectories.push(directory)
  const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
  const bootstrap = bootstrapStore(localDatabase.connection, {
    storeName: 'Command Store',
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
  const admission = listCatalogItems(localDatabase.connection, store)[0]
  if (!admission) throw new Error('Missing admission')
  return { localDatabase, store, manager, admission }
}

describe('cashier command execution repository', () => {
  it('commits the command result in the same transaction as the order', () => {
    const { localDatabase, store, manager, admission } = initialized()
    const commandId = randomUUID()
    const order = createSalesOrder(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: commandId,
        paymentMethod: 'cash',
        lines: [
          {
            catalogItemId: admission.id,
            quantity: 1,
            pricingTier: 'regular'
          }
        ],
        sourceCashierCommand: {
          commandId,
          requestedByEmployeeId: manager.id
        }
      }
    )

    expect(
      findCashierCommandExecution(localDatabase.connection, store, commandId)
    ).toMatchObject({
      status: 'completed',
      localOrderId: order.id,
      result: { id: order.id }
    })
    expect(listPendingCashierCommandReports(localDatabase.connection, store)).toHaveLength(1)
    markCashierCommandReported(localDatabase.connection, store, commandId)
    expect(listPendingCashierCommandReports(localDatabase.connection, store)).toHaveLength(0)
    localDatabase.close()
  })

  it('keeps a business failure for later cloud reporting without an order', () => {
    const { localDatabase, store } = initialized()
    const commandId = randomUUID()
    const failed = recordFailedCashierCommand(
      localDatabase.connection,
      store,
      {
        commandId,
        requestedByEmployeeId: randomUUID(),
        errorMessage: '用户余额不足'
      }
    )

    expect(failed).toMatchObject({
      status: 'failed',
      localOrderId: null,
      errorMessage: '用户余额不足'
    })
    expect(
      (
        localDatabase.connection
          .prepare('SELECT COUNT(*) count FROM sales_order')
          .get() as { count: number }
      ).count
    ).toBe(0)
    localDatabase.close()
  })
})
