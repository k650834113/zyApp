import { createHash } from 'node:crypto'
import type { Pool } from '@zyapp/cloud-db'
import { describe, expect, it, vi } from 'vitest'
import { SyncService } from './sync.service'

describe('sync batch receipt', () => {
  it('casts the device UUID when writing the text audit aggregate id', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111'
    const storeId = '22222222-2222-4222-8222-222222222222'
    const deviceId = '33333333-3333-4333-8333-333333333333'
    const operationId = '44444444-4444-4444-8444-444444444444'
    const actorId = '55555555-5555-4555-8555-555555555555'
    const payloadJson = JSON.stringify({ tenantId, storeId, deviceId })
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql.includes('SELECT id FROM device')) {
          return { rows: [{ id: deviceId }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    }
    const service = new SyncService({
      connect: vi.fn(async () => client)
    } as unknown as Pool)

    await service.receive(
      {
        tenantId,
        storeId,
        deviceId,
        deviceName: 'Test Device'
      },
      {
        protocolVersion: 1,
        deviceId,
        firstDeviceSeq: 1,
        lastDeviceSeq: 1,
        operations: [
          {
            operationId,
            deviceId,
            deviceSeq: 1,
            tenantId,
            storeId,
            actorId,
            operationType: 'store.bootstrapped',
            aggregateId: storeId,
            baseVersion: null,
            occurredAt: '2026-06-28T00:00:00.000Z',
            payloadJson,
            payloadHash: createHash('sha256')
              .update(payloadJson)
              .digest('hex')
          }
        ]
      }
    )

    const auditSql = queries.find((sql) =>
      sql.includes("'sync.batch.received'")
    )
    expect(auditSql).toContain('$4::uuid::text')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
