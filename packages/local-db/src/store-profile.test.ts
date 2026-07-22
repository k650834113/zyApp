import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  findEmployeeRecordById,
  getStoreContext,
  getStoreProfile,
  openLocalDatabase,
  updateStoreProfile
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('store public profile', () => {
  it('updates public settings with audit and outbox in one transaction', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-store-profile-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Original Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')

    expect(getStoreProfile(local.connection, context)).toMatchObject({
      businessOpenMinute: 780,
      businessCloseMinute: 1380,
      statusOverride: 'automatic'
    })
    const updated = updateStoreProfile(
      local.connection,
      { ...context, actor },
      {
        name: 'Night Store',
        address: 'Road 1',
        contactPhone: '13800138000',
        businessOpenMinute: 18 * 60,
        businessCloseMinute: 2 * 60,
        statusOverride: 'open',
        customStatusText: 'Holiday late opening',
        reason: 'Holiday schedule'
      }
    )
    expect(updated).toMatchObject({
      name: 'Night Store',
      businessOpenMinute: 1080,
      businessCloseMinute: 120,
      statusOverride: 'open'
    })
    expect(
      local.connection
        .prepare(
          `SELECT action, aggregate_type FROM audit_log
           WHERE action = 'store.profile.updated'`
        )
        .get()
    ).toEqual({
      action: 'store.profile.updated',
      aggregate_type: 'store'
    })
    expect(
      local.connection
        .prepare(
          `SELECT operation_type, sync_status FROM outbox_operation
           WHERE operation_type = 'store.profile.updated'`
        )
        .get()
    ).toEqual({
      operation_type: 'store.profile.updated',
      sync_status: 'pending'
    })

    local.close()
  })
})
