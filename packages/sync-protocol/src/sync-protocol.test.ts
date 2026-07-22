import { describe, expect, it } from 'vitest'
import { buildSyncPushBatch, type SyncOperation } from './index'

function operation(deviceSeq: number, deviceId = 'device-1'): SyncOperation {
  return {
    operationId: `operation-${deviceSeq}`,
    deviceId,
    deviceSeq,
    tenantId: 'tenant-1',
    storeId: 'store-1',
    actorId: null,
    operationType: 'member.created',
    aggregateId: `member-${deviceSeq}`,
    baseVersion: null,
    occurredAt: '2026-06-12T00:00:00.000Z',
    payloadJson: '{}',
    payloadHash: 'a'.repeat(64)
  }
}

describe('sync protocol', () => {
  it('sorts pending operations into a stable device batch', () => {
    expect(buildSyncPushBatch([operation(3), operation(1)])).toMatchObject({
      protocolVersion: 1,
      deviceId: 'device-1',
      firstDeviceSeq: 1,
      lastDeviceSeq: 3,
      operations: [{ deviceSeq: 1 }, { deviceSeq: 3 }]
    })
  })

  it('rejects mixed devices and duplicate sequences', () => {
    expect(() =>
      buildSyncPushBatch([operation(1), operation(2, 'device-2')])
    ).toThrow('multiple devices')
    expect(() =>
      buildSyncPushBatch([operation(1), { ...operation(2), deviceSeq: 1 }])
    ).toThrow('sequences must be unique')
  })
})
