import {describe,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {transactionRange,StaffWorkspaceService} from './staff-workspace.service'
import {requireWorkspaceEmployee,validateNoticeScene,MiniappNoticeService} from './miniapp-notice.service'
import type {MiniappPrincipal} from './miniapp-auth'
import type {Pool} from '@zyapp/cloud-db'
import type {ApiConfig} from './config'
import type Redis from 'ioredis'
function principal():MiniappPrincipal{return {identityId:randomUUID(),tenantId:randomUUID(),storeId:randomUUID(),provider:'wechat',providerSubject:'openid:test',memberId:randomUUID(),memberStatus:'active',employeeId:randomUUID(),employeeStatus:'active',employeeRole:'staff',identity:{role:'staff',employeeId:randomUUID(),displayName:'员工',permissions:['transaction.read','activity.registration.manage']}}}
describe('staff workspace boundaries',()=>{
 it('requires active employee identity and independent permission',async()=>{
  const p=principal();expect(requireWorkspaceEmployee(p,'transaction.read')).toBe(p.employeeId)
  for(const candidate of [{...p,employeeStatus:'disabled' as const},{...p,employeeId:null},{...p,identity:{role:'guest' as const}}, {...p,identity:{...p.identity,permissions:[]}}])expect(()=>requireWorkspaceEmployee(candidate,'transaction.read')).toThrow('权限')
  const query=vi.fn();const service=new StaffWorkspaceService({query} as unknown as Pool,{} as ApiConfig,{} as Redis)
  await expect(service.transactions({...p,employeeId:null},{})).rejects.toThrow('权限');expect(query).not.toHaveBeenCalled()
 })
 it('validates dates, scope, pagination and filters before querying',()=>{
  const f=transactionRange({fromDate:'2026-10-01',toDate:'2026-10-19',offset:30,kind:'recharge'})
  expect(f.from).toBe('2026-10-01T00:00:00+08:00');expect(f.to).toBe('2026-10-19T16:00:00.000Z')
  for(const filters of [{fromDate:'2026-02-30'},{fromDate:'2026-13-01'},{fromDate:'2020-01-01'},{fromDate:'2026-10-20',toDate:'2026-10-19'},{offset:-1},{offset:1.5},{kind:'arbitrary'}])expect(()=>transactionRange(filters)).toThrow()
 })
 it('isolates transaction reads to tenant/store and uses one source per business',async()=>{
  const query=vi.fn(async()=>({rows:[]})),p=principal(),service=new StaffWorkspaceService({query} as unknown as Pool,{} as ApiConfig,{} as Redis)
  await service.transactions(p,{fromDate:'2026-10-01',toDate:'2026-10-19',query:'138'})
  const [sql,args]=query.mock.calls[0] as unknown as [string,unknown[]];expect(args.slice(0,2)).toEqual([p.tenantId,p.storeId]);expect(sql).toContain("'wallet.cash_recharged','wallet.cash_recharge_reversed'");expect(sql).not.toContain("'wallet.wechat_recharged'");expect(sql).toContain('LIMIT 31 OFFSET $7');expect(args[5]).toBe('138')
 })
 it('refuses invalid batch capacity before acquiring a database connection',async()=>{
  const connect=vi.fn(),service=new StaffWorkspaceService({connect} as unknown as Pool,{} as ApiConfig,{} as Redis)
  for(const capacity of [0,-1,1.5,101])await expect(service.createBatch(principal(),{capacity,requestId:randomUUID(),activityId:randomUUID(),envVersion:'release'})).rejects.toThrow('名额')
  expect(connect).not.toHaveBeenCalled()
 })
 it('never silently rounds a stored amount beyond the JavaScript integer range',async()=>{
  const query=vi.fn(async()=>({rows:[{id:'unsafe',kind:'recharge',occurred_at:new Date(),amount_fen:'9007199254740993',gift_fen:0}]}))
  const service=new StaffWorkspaceService({query} as unknown as Pool,{} as ApiConfig,{} as Redis)
  await expect(service.transactions(principal(),{})).rejects.toThrow('安全整数')
 })
})
describe('reusable notice configuration',()=>{
 it('requires a template and safe property mapping when enabled',()=>{
  const scene={key:'lottery.result',title:'开奖结果',description:'开奖提醒',templateId:'template_12345',enabled:true,fields:{thing1:'title',time2:'time'}}
  expect(validateNoticeScene(scene)).toEqual(scene)
  for(const bad of [{...scene,templateId:null},{...scene,fields:{}},{...scene,fields:{thing1:'process.env.SECRET'}},{...scene,key:'../private'},{...scene,enabled:'yes'}])expect(()=>validateNoticeScene(bad as any)).toThrow()
 })
 it('only lets managers configure templates and keeps failed delivery separate from reading',async()=>{
  const query=vi.fn(async()=>({rows:[{id:randomUUID(),scene:'lottery.result',title:'开奖',body:'结果',created_at:new Date(),delivery:'failed',read_at:new Date(),business_id:randomUUID()}]})),p=principal(),service=new MiniappNoticeService({query} as unknown as Pool,{} as ApiConfig,{} as Redis)
  await expect(service.save(p,{} as any)).rejects.toThrow('权限');expect(query).not.toHaveBeenCalled()
  const notice=await service.read(p,randomUUID());expect(notice.delivery).toBe('failed');expect(notice.read).toBe(true)
  expect((query.mock.calls[0] as unknown as [string,unknown[]])[1].slice(1)).toEqual([p.tenantId,p.storeId,p.memberId])
 })
})
