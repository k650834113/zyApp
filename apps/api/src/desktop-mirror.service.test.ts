import type { Pool } from '@zyapp/cloud-db'
import { describe, expect, it, vi } from 'vitest'
import { DesktopMirrorService } from './desktop-mirror.service'

const principal = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
  deviceName: 'Cashier'
}

describe('desktop cloud mirror read model', () => {
  it('mirrors tenant-wide member rows while retaining the authenticated store context', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { id: 'member-1', payload: { id: 'member-1', nickname: 'A' } }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ sequence: 12 }] })
    const service = new DesktopMirrorService({ query } as unknown as Pool)
    await expect(
      service.page(principal, 'members', undefined, '20')
    ).resolves.toMatchObject({
      resource: 'members',
      eventCursor: '12',
      rows: [{ id: 'member-1' }]
    })
    expect(query.mock.calls[0]?.[0]).toContain('cloud_member')
    expect(query.mock.calls[0]?.[0]).not.toContain('model.store_id = $2')
    expect(query.mock.calls[0]?.[0]).toContain('$2::uuid IS NOT NULL')
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $4::integer')
    expect(query.mock.calls[0]?.[1]).toEqual([
      principal.tenantId,
      principal.storeId,
      null,
      21
    ])
    expect(query.mock.calls[1]?.[0]).toContain('$2::uuid IS NOT NULL')
    expect(query.mock.calls[1]?.[1]).toEqual([
      principal.tenantId,
      principal.storeId
    ])
  })

  it('rejects arbitrary table names', async () => {
    const service = new DesktopMirrorService({} as Pool)
    await expect(
      service.page(principal, 'sync_operation', undefined, undefined)
    ).rejects.toThrow('Unsupported')
  })

  it('mirrors complete WeChat recharge orders for desktop reconciliation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sequence: 42 }] })
    const service = new DesktopMirrorService({ query } as unknown as Pool)

    await expect(
      service.page(
        principal,
        'wechat_recharge_orders',
        undefined,
        '200'
      )
    ).resolves.toMatchObject({
      resource: 'wechat_recharge_orders',
      eventCursor: '42'
    })
    expect(query.mock.calls[0]?.[0]).toContain('wechat_recharge_order')
    expect(query.mock.calls[0]?.[0]).not.toContain(
      'model.store_id = $2'
    )
  })

  it('refuses an empty-epoch cutover when cloud business rows exist', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id FROM device')) {
          return { rows: [{ id: principal.deviceId }], rowCount: 1 }
        }
        if (sql.includes('FROM cloud_mirror_epoch')) {
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('FROM cloud_member')) {
          return { rows: [{ count: 1 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    }
    const service = new DesktopMirrorService({
      connect: vi.fn(async () => client)
    } as unknown as Pool)
    await expect(
      service.activateEmptyEpoch(principal, {
        epochId: '44444444-4444-4444-8444-444444444444',
        archiveSha256: 'a'.repeat(64)
      })
    ).rejects.toThrow('not empty')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
