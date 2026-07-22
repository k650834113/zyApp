import type { Pool } from '@zyapp/cloud-db'
import { describe, expect, it, vi } from 'vitest'
import type { DevicePrincipal } from './device-auth'
import { SyncService } from './sync.service'

const principal: DevicePrincipal = {
  deviceId: 'device-1',
  tenantId: 'tenant-1',
  storeId: 'store-1',
  deviceName: 'Cashier'
}

describe('sync event pull', () => {
  it('returns a tenant-scoped cursor page without losing bigint precision', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          sequence: '9007199254740993',
          event_id: 'event-1',
          tenant_id: 'tenant-1',
          store_id: 'store-1',
          origin_device_id: 'device-2',
          aggregate_type: 'announcement',
          aggregate_id: 'announcement-1',
          event_type: 'announcement.updated',
          payload_json: { title: 'Cloud title' },
          occurred_at: new Date('2026-06-14T01:00:00.000Z')
        },
        {
          sequence: '9007199254740994',
          event_id: 'event-2',
          tenant_id: 'tenant-1',
          store_id: 'store-1',
          origin_device_id: 'device-1',
          aggregate_type: 'member',
          aggregate_id: 'member-1',
          event_type: 'member.updated',
          payload_json: { nickname: 'Member' },
          occurred_at: new Date('2026-06-14T01:01:00.000Z')
        }
      ]
    })
    const service = new SyncService({ query } as unknown as Pool)

    await expect(
      service.pull(principal, '9007199254740992', '1')
    ).resolves.toEqual(
      expect.objectContaining({
        protocolVersion: 1,
        deviceId: 'device-1',
        afterCursor: '9007199254740992',
        nextCursor: '9007199254740993',
        hasMore: true,
        events: [
          expect.objectContaining({
            sequence: '9007199254740993',
            originDeviceId: 'device-2',
            payloadJson: '{"title":"Cloud title"}'
          })
        ]
      })
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('event.tenant_id = $1'),
      ['tenant-1', 'store-1', '9007199254740992', 2]
    )
  })

  it('rejects an invalid cursor before querying Postgres', async () => {
    const query = vi.fn()
    const service = new SyncService({ query } as unknown as Pool)

    await expect(service.pull(principal, '1e3', '100')).rejects.toThrow(
      'afterCursor must be a non-negative decimal integer'
    )
    expect(query).not.toHaveBeenCalled()
  })
})
