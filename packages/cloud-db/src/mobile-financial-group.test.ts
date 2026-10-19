import { expect,it,vi } from 'vitest'
import type { PoolClient } from 'pg'
import type { ReceivedOperation } from './sync-operation-handler'
import { completeMobileFinancialGroup } from './mobile-financial-group'

it('publishes the authoritative wallet result when completing a phone recharge',async()=>{
  const query=vi.fn(async(sql:string,_params?:unknown[])=>({rows:sql.includes('FROM cloud_wallet_ledger')?[{
    id:'wallet',member_id:'member',principal_delta_fen:10000,gift_delta_fen:500,principal_balance_fen:15000,gift_balance_fen:700,status:'active',updated_at:'2026-09-21T00:00:00Z'
  }]:[],rowCount:1}))
  await completeMobileFinancialGroup({query} as unknown as PoolClient,{tenant_id:'tenant'} as ReceivedOperation,{
    kind:'mobile_financial',commandId:'command',result:{type:'cash_recharge',wallet:{operationId:'recharge',principalDeltaFen:10000,giftDeltaFen:500,wallet:{totalBalanceFen:10500}}}})
  const update=query.mock.calls.find(([sql])=>sql.startsWith('UPDATE employee_financial_command'))!
  expect(JSON.parse(String(update[1]?.[1]))).toMatchObject({type:'cash_recharge',wallet:{operationId:'recharge',wallet:{totalBalanceFen:15700}}})
})

it('publishes the authoritative card count when completing a phone card action',async()=>{
  const query=vi.fn(async(sql:string,_params?:unknown[])=>({rows:sql.startsWith('SELECT * FROM cloud_monthly_card')?[{status:'paused',usage_count:3,expires_at:'2026-10-21T00:00:00Z',paused_at:'2026-09-21T00:00:00Z'}]:[],rowCount:1}))
  await completeMobileFinancialGroup({query} as unknown as PoolClient,{tenant_id:'tenant'} as ReceivedOperation,{
    kind:'mobile_financial',commandId:'command',result:{type:'monthly_card_pause',monthlyCard:{id:'card',status:'paused',usageCount:2}}})
  const update=query.mock.calls.find(([sql])=>sql.startsWith('UPDATE employee_financial_command'))!
  expect(JSON.parse(String(update[1]?.[1])).monthlyCard).toMatchObject({id:'card',status:'paused',usageCount:3})
})
