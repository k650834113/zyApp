import { createHash, randomUUID } from 'node:crypto'
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

for (const [operationType,role,allowed] of [
  ['order.completed','staff',true], ['wallet.reconciled','staff',false],
  ['wallet.reconciled','manager',true], ['wallet.debited',null,false]
] as const) {
  it(`enforces cloud command permission through batch upload: ${operationType}/${role}`,async()=>{
    const principal={tenantId:randomUUID(),storeId:randomUUID(),deviceId:randomUUID(),deviceName:'Test'}
    const payloadJson=JSON.stringify({cloudCommand:true})
    const client={query:vi.fn(async(sql:string)=>({rows:sql.includes('SELECT id FROM device')?[{id:principal.deviceId}]:[],rowCount:sql.includes('SELECT id FROM device')?1:0})),release:vi.fn()}
    const pool={query:vi.fn(async()=>({rows:role?[{role}]:[],rowCount:role?1:0})),connect:vi.fn(async()=>client)}
    const service=new SyncService(pool as unknown as Pool)
    const work=service.receive(principal,{protocolVersion:1,deviceId:principal.deviceId,firstDeviceSeq:1,lastDeviceSeq:1,operations:[{
      operationId:randomUUID(),deviceId:principal.deviceId,deviceSeq:1,tenantId:principal.tenantId,storeId:principal.storeId,
      actorId:randomUUID(),operationType,aggregateId:randomUUID(),baseVersion:null,occurredAt:new Date().toISOString(),payloadJson,
      payloadHash:createHash('sha256').update(payloadJson).digest('hex')
    }]})
    if(allowed) await expect(work).resolves.toBeDefined()
    else {await expect(work).rejects.toThrow(role?'manager':'active');expect(pool.connect).not.toHaveBeenCalled()}
  })
}

it('preserves whole-command rejection codes in both immediate and recovery receipts',async()=>{
  const principal={tenantId:randomUUID(),storeId:randomUUID(),deviceId:randomUUID(),deviceName:'Test'}
  const row={operation_id:randomUUID(),device_seq:1,status:'conflict',server_version:null,conflict_type:'atomic_group_rejected',server_payload_json:{reason:'整笔未执行'},received_at:new Date()}
  const pool={query:vi.fn(async()=>({rows:[row],rowCount:1}))}
  const service=new SyncService(pool as unknown as Pool)
  expect((await service.results(principal,undefined,undefined)).receipts[0]).toMatchObject({conflictType:'atomic_group_rejected'})
  expect((await service.operation(principal,row.operation_id)).outcome).toMatchObject({conflictType:'atomic_group_rejected'})
})
