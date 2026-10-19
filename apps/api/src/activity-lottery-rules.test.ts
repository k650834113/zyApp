import {describe,it,expect} from 'vitest'
import type {LotteryConfig,LotteryWorkspace,LotteryMember} from '@zyapp/contracts'
import {configureLottery,registerLotteryEntry,setLotteryEntryStatus,drawLottery,validateLotteryConfig} from './activity-lottery-rules'
const start=Date.parse('2026-10-01T00:00:00+08:00'),close=start+86400000,draw=close+3600000
const config=(multipleEntries=false,repeatWinners=false):LotteryConfig=>({startsAt:new Date(start).toISOString(),closesAt:new Date(close).toISOString(),drawAt:new Date(draw).toISOString(),multipleEntries,repeatWinners,rules:'线下报名',prizes:[{id:'p1',name:'一等奖',description:'奖品',count:2},{id:'p2',name:'二等奖',description:'奖品',count:2}]})
function state(multiple=false,repeat=false):LotteryWorkspace{return {activityId:'a',revision:null,rulesLocked:false,config:config(multiple,repeat),entries:[],result:null}}
const member=(id:string):LotteryMember=>({memberId:id,memberNumber:id,name:id,phone:'13800000000'})
describe('lottery business rules',()=>{
  it.each([[false,false],[false,true],[true,false],[true,true]])('enforces entry/repeat combination %s/%s',(multiple,repeat)=>{
    const s=state(multiple,repeat);registerLotteryEntry(s,member('a'),'staff',start)
    if(multiple){registerLotteryEntry(s,member('a'),'staff',start);registerLotteryEntry(s,member('a'),'staff',start)}else expect(()=>registerLotteryEntry(s,member('a'),'staff',start)).toThrow('限一次')
    registerLotteryEntry(s,member('b'),'staff',start)
    const r=drawLottery(s,'manager',draw,()=>0),w=r.prizes.flatMap(p=>p.winners)
    expect(w.map(x=>x.memberId)).toEqual(multiple&&repeat?['a','a','a','b']:['a','b'])
    expect(new Set(w.map(x=>x.entryId)).size).toBe(w.length)
    expect(r.prizes.reduce((n,p)=>n+p.vacancies,0)).toBe(4-w.length)
  })
  it('weights repeated registrations as separate chances and removes all losing chances of a winner',()=>{
    const s=state(true,false);for(const id of ['a','a','a','b'])registerLotteryEntry(s,member(id),'staff',start)
    const winners=[]
    for(let i=0;i<4;i++){const copy=structuredClone(s);let first=true;const r=drawLottery(copy,'manager',draw,max=>{if(first){first=false;expect(max).toBe(4);return i}expect(max).toBe(i===3?3:1);return 0});winners.push(r.prizes[0]!.winners[0]!.memberId)}
    expect(winners).toEqual(['a','a','a','b'])
  })
  it('preserves audit history, enforces restore limit and locks rules even when all entries are void',()=>{
    const s=state();registerLotteryEntry(s,member('a'),'staff',start)
    const id=s.entries[0]!.id;setLotteryEntryStatus(s,id,false,'误录','staff',start+1)
    registerLotteryEntry(s,member('a'),'staff',start+2)
    expect(()=>setLotteryEntryStatus(s,id,true,'恢复','staff',start+3)).toThrow('已有有效报名')
    expect(s.entries[0]!.changes).toEqual([{active:false,reason:'误录',actorId:'staff',at:new Date(start+1).toISOString()}])
    expect(()=>configureLottery(s,config(true),start)).toThrow('已锁定')
    expect(()=>configureLottery(s,{...config(),closesAt:new Date(close+1).toISOString()},start)).toThrow('时间已锁定')
  })
  it('rejects early/late registration, late modifications and premature draw',()=>{
    const s=state();expect(()=>configureLottery(s,{...config(),closesAt:new Date(close+1000).toISOString(),drawAt:new Date(draw+1000).toISOString()},close)).toThrow('配置已冻结');expect(()=>registerLotteryEntry(s,member('a'),'staff',start-1)).toThrow('报名时间')
    registerLotteryEntry(s,member('a'),'staff',start)
    expect(()=>registerLotteryEntry(s,member('b'),'staff',close)).toThrow('报名时间')
    expect(()=>setLotteryEntryStatus(s,s.entries[0]!.id,false,'误录','staff',close)).toThrow('报名时间')
    expect(()=>drawLottery(s,'manager',draw-1)).toThrow('尚未')
    const r=drawLottery(s,'manager',draw,()=>0)
    expect(drawLottery(s,'manager',draw+1,()=>{throw Error('must not reroll')})).toBe(r)
    expect(()=>registerLotteryEntry(s,member('b'),'staff',draw)).toThrow()
    expect(()=>configureLottery(s,config(),start)).toThrow('已开奖')
    const restored=JSON.parse(JSON.stringify(s));expect(drawLottery(restored,'other',draw+1)).toEqual(r)
  })
  it('keeps result snapshots independent and records all vacancies for empty pools',()=>{
    const s=state();registerLotteryEntry(s,member('a'),'staff',start);const r=drawLottery(s,'manager',draw,()=>0)
    s.entries[0]!.name='changed';expect(r.entries[0]!.name).toBe('a')
    expect(drawLottery(state(),'manager',draw).prizes.map(p=>p.vacancies)).toEqual([2,2])
  })
  it('rejects invalid config, timezones, duplicate prizes and invalid random indexes',()=>{
    for(const c of [{...config(),startsAt:'2026-10-01T00:00'}, {...config(),drawAt:new Date(start).toISOString()},{...config(),prizes:[{...config().prizes[0]!,count:0}]},{...config(),prizes:[config().prizes[0]!,config().prizes[0]!]}])expect(()=>validateLotteryConfig(c)).toThrow()
    const s=state();registerLotteryEntry(s,member('a'),'staff',start);expect(()=>drawLottery(s,'manager',draw,()=>1)).toThrow('随机源');expect(s.result).toBeNull()
  })
})
