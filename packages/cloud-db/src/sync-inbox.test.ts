import { describe, expect, it } from 'vitest'
import { parseStoreBootstrapPayload } from './sync-inbox'

describe('cloud sync inbox', () => {
  it('parses the immutable store bootstrap payload', () => {
    expect(
      parseStoreBootstrapPayload({
        tenantId: 'tenant-1',
        storeId: 'store-1',
        deviceId: 'device-1',
        managerId: 'manager-1',
        storeName: 'Board Game Store',
        deviceName: 'Cashier 01'
      })
    ).toEqual({
      tenantId: 'tenant-1',
      storeId: 'store-1',
      deviceId: 'device-1',
      managerId: 'manager-1',
      storeName: 'Board Game Store',
      deviceName: 'Cashier 01'
    })
  })

  it('rejects incomplete bootstrap facts', () => {
    expect(() =>
      parseStoreBootstrapPayload({
        tenantId: 'tenant-1',
        storeId: 'store-1'
      })
    ).toThrow('deviceId')
  })
})
