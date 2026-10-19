import {afterEach,describe,it,expect,vi} from 'vitest'
import {requestNoticeSubscription} from './notice-subscription'
const ticket={id:'ticket',scene:'lottery.result',templateId:'template',title:'开奖提醒'}
afterEach(()=>vi.unstubAllGlobals())
describe('generic subscribe interaction',()=>{
 it('opens the platform prompt synchronously within the user gesture and records the template result',async()=>{
  const record=vi.fn(async()=>{}),prompt=vi.fn(options=>options.success({template:'accept'}));vi.stubGlobal('wx',{requestSubscribeMessage:prompt})
  const pending=requestNoticeSubscription(ticket,record);expect(prompt).toHaveBeenCalledTimes(1);expect(await pending).toBe('accept');expect(record).toHaveBeenCalledWith('ticket','accept')
 })
 it('treats rejection, unavailable configuration and API failure as nonblocking results',async()=>{
  const record=vi.fn(async()=>{});vi.stubGlobal('wx',{requestSubscribeMessage:(options:any)=>options.success({template:'reject'})});expect(await requestNoticeSubscription(ticket,record)).toBe('reject')
  expect(await requestNoticeSubscription(null,record)).toBe('unavailable')
  vi.stubGlobal('wx',{requestSubscribeMessage:(options:any)=>options.fail({errMsg:'unsupported'})});expect(await requestNoticeSubscription(ticket,record)).toBe('fail')
  vi.stubGlobal('wx',{requestSubscribeMessage:()=>{throw Error('unsupported')}});expect(await requestNoticeSubscription(ticket,record)).toBe('fail')
 })
 it('does not report authorization saved when recording fails',async()=>{
  vi.stubGlobal('wx',{requestSubscribeMessage:(options:any)=>options.success({template:'accept'})});expect(await requestNoticeSubscription(ticket,async()=>{throw Error('offline')})).toBe('record_failed')
 })
})
