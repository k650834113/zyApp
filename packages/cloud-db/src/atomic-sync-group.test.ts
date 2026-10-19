import { describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'
import type { ReceivedOperation } from './sync-operation-handler'
import { processAtomicSyncGroup } from './atomic-sync-group'

const groupId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function operations() {
  return [0,1].map(index=>({operation_id:`op-${index}`,device_id:'device',device_seq:index+1,
    tenant_id:'tenant',store_id:'store',actor_id:'actor',operation_type:index?'sales_order.created':'wallet.debited',
    aggregate_id:`aggregate-${index}`,occurred_at:new Date(),status:'received',
    payload_json:{atomicGroup:{id:groupId,size:2,index}}}))
}
describe('cloud financial transaction groups',()=>{
  it('does not execute a group while a network interruption left its upload incomplete',async()=>{
    const rows=operations()
    const query=vi.fn(async()=>({rows:[rows[0]],rowCount:1}))
    const process=vi.fn(async()=> 'confirmed' as const)
    expect(await processAtomicSyncGroup({query} as unknown as PoolClient,rows[0]!,process)).toEqual({status:'unsupported',count:0})
    expect(process).not.toHaveBeenCalled()
  })
  it('rolls back an earlier successful debit if the order fails, then records rejection for every part',async()=>{
    const rows=operations()
    let debits=0
    const rejected:string[]=[]
    const query=vi.fn(async(sql:string,args?:unknown[])=>{
      if(sql.startsWith('SELECT * FROM sync_operation')) return {rows,rowCount:2}
      if(sql==='ROLLBACK TO SAVEPOINT financial_group') debits=0
      if(sql.startsWith('INSERT INTO sync_conflict')) rejected.push(String(args?.[1]))
      if(sql.includes('RETURNING sequence')) return {rows:[{sequence:10}],rowCount:1}
      return {rows:[],rowCount:0}
    })
    const process=vi.fn(async(row:ReceivedOperation)=>{
      if(row.operation_id==='op-0') {debits++;return 'confirmed' as const}
      return 'conflict' as const
    })
    expect(await processAtomicSyncGroup({query} as unknown as PoolClient,rows[0]!,process)).toEqual({status:'conflict',count:2})
    expect(debits).toBe(0)
    expect(rejected).toEqual(['op-0','op-1'])
  })
  it('commits the complete group only after all operations succeed',async()=>{
    const rows=operations()
    const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT *')?rows:[],rowCount:2}))
    const process=vi.fn(async()=> 'confirmed' as const)
    expect(await processAtomicSyncGroup({query} as unknown as PoolClient,rows[0]!,process)).toEqual({status:'confirmed',count:2})
    expect(process).toHaveBeenCalledTimes(2)
    expect(query.mock.calls.some(([sql])=>sql.startsWith('ROLLBACK'))).toBe(false)
  })
})

it('rolls back a constraint violation and leaves transient failures retryable',async()=>{
  const rows=operations()
  const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT *')?rows:sql.includes('RETURNING sequence')?[{sequence:1}]:[],rowCount:2}))
  const client={query} as unknown as PoolClient
  expect(await processAtomicSyncGroup(client,rows[0]!,async()=>{throw Object.assign(new Error('constraint'),{code:'23514'})})).toEqual({status:'conflict',count:2})
  expect(query.mock.calls.some(([sql])=>sql==='ROLLBACK TO SAVEPOINT financial_group')).toBe(true)
  await expect(processAtomicSyncGroup(client,rows[0]!,async()=>{throw Object.assign(new Error('retry'),{code:'40001'})})).rejects.toThrow('retry')
})

it('finishes a phone order atomically and refuses a later attempt to execute it again',async()=>{
  const rows=operations().map(row=>({...row,payload_json:{...row.payload_json,mobileCommand:{kind:'mobile_cashier',commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',localOrderId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',result:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}}}))
  let status='claimed'
  const query=vi.fn(async(sql:string,_params?:unknown[])=>{
    if(sql.startsWith('SELECT * FROM sync_operation')) return {rows,rowCount:2}
    if(sql.startsWith('SELECT * FROM cashier_command')) return {rows:[{status,claimed_by_device:'device',requested_by:'actor'}],rowCount:1}
    if(sql.startsWith("UPDATE cashier_command SET status='completed'")) status='completed'
    if(sql.includes('RETURNING sequence')) return {rows:[{sequence:1}],rowCount:1}
    return {rows:[],rowCount:0}
  })
  const process=vi.fn(async()=> 'confirmed' as const)
  const client={query} as unknown as PoolClient
  expect(await processAtomicSyncGroup(client,rows[0]!,process)).toEqual({status:'confirmed',count:2})
  expect(status).toBe('completed')
  expect(await processAtomicSyncGroup(client,rows[0]!,process)).toEqual({status:'conflict',count:2})
  expect(process).toHaveBeenCalledTimes(2)
  const conflict=query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO sync_conflict'))
  expect(JSON.parse(String(conflict?.[1]?.[7])).serverPayload.detail.retryAllowed).toBe(false)
})

it('marks a phone command failed only after rolling back its entire failed financial transaction',async()=>{
  const rows=operations().map(row=>({...row,payload_json:{...row.payload_json,mobileCommand:{kind:'mobile_cashier',commandId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',result:{}}}}))
  const calls:string[]=[]
  const query=vi.fn(async(sql:string)=>{
    calls.push(sql)
    return {rows:sql.startsWith('SELECT * FROM sync_operation')?rows:sql.startsWith('SELECT * FROM cashier_command')?[{status:'claimed',claimed_by_device:'device',requested_by:'actor'}]:sql.includes('RETURNING sequence')?[{sequence:1}]:[],rowCount:1}
  })
  await processAtomicSyncGroup({query} as unknown as PoolClient,rows[0]!,async row=>row===rows[0]?'confirmed':'conflict')
  const rollback=calls.indexOf('ROLLBACK TO SAVEPOINT financial_group')
  const fail=calls.findIndex(sql=>sql.startsWith("UPDATE cashier_command SET status='failed'"))
  expect(rollback).toBeGreaterThan(0)
  expect(fail).toBeGreaterThan(rollback)
  expect(calls.some(sql=>sql.startsWith("UPDATE cashier_command SET status='completed'"))).toBe(false)
})
