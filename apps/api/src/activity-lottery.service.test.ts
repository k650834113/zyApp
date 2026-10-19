import {describe,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import type {Pool} from '@zyapp/cloud-db'
import type {LotteryWorkspace} from '@zyapp/contracts'
import {ActivityLotteryService} from './activity-lottery.service'

// Transactional test double: verifies service transaction/idempotency orchestration.
// PostgreSQL advisory-lock semantics still require the opt-in integration suite.
function fixture(){
  const tenant=randomUUID(),store=randomUUID(),activity=randomUUID(),manager=randomUUID(),staff=randomUUID(),member=randomUUID(),device=randomUUID()
  let state:LotteryWorkspace|null=null,failEvent=false,loseCommit=false
  const events=new Map<string,any>(),locks=new Map<string,Promise<void>>(),trace:string[]=[]
  const principal={tenantId:tenant,storeId:store,deviceId:device,deviceName:'test'}
  function connection(){let staged:LotteryWorkspace|null=null,pending:any=null;const releases:(()=>void)[]=[]
    return {release(){},async query(sql:string,args:any[]=[]):Promise<any>{
      trace.push(sql)
      if(sql==='BEGIN')return {rows:[]}
      if(sql.includes('pg_advisory_xact_lock')){
        const key=args[0],previous=locks.get(key)??Promise.resolve();let release!:()=>void
        const hold=new Promise<void>(r=>{release=r});locks.set(key,previous.then(()=>hold));await previous;releases.push(release);return {rows:[]}
      }
      if(sql==='COMMIT'){
        if(staged)state=structuredClone(staged);if(pending)events.set(pending.key,pending.value)
        releases.splice(0).forEach(r=>r());if(loseCommit){loseCommit=false;throw Error('connection lost after commit')}return {rows:[]}
      }
      if(sql==='ROLLBACK'){staged=null;pending=null;releases.splice(0).forEach(r=>r());return {rows:[]}}
      if(sql.includes('FROM cloud_employee e'))return {rows:args[1]===tenant&&args[2]===store&&(args[0]===staff||args[0]===manager)?[{role:args[0]===manager?'manager':'staff'}]:[]}
      if(sql.includes('FROM cloud_activity_campaign'))return {rows:args[0]===activity&&args[1]===tenant&&args[2]===store?[{id:activity}]:[]}
      if(sql.startsWith('SELECT request_hash'))return {rows:events.has(args[2])?[events.get(args[2])]:[]}
      if(sql.startsWith('SELECT state_json'))return {rows:state&&args[1]===tenant&&args[2]===store?[{state_json:structuredClone(state)}]:[]}
      if(sql.includes('clock_timestamp() AS now'))return {rows:[{now:new Date()}]}
      if(sql.includes('FROM cloud_member'))return {rows:args[0]===member&&args[1]===tenant?[{id:member,member_number:'1001',nickname:'会员',phone:'13800000000'}]:[]}
      if(sql.startsWith('INSERT INTO activity_lottery(')){staged=JSON.parse(args[3]);return {rows:[]}}
      if(sql.startsWith('INSERT INTO activity_lottery_event')){
        if(failEvent){failEvent=false;throw Error('audit write failed')}
        pending={key:args[6],value:{actor_id:args[4],request_hash:args[7],result_json:JSON.parse(args[9])}};return {rows:[]}
      }
      throw Error('Unexpected SQL '+sql)
    }}
  }
  const pool={query:(sql:string,args:any[])=>connection().query(sql,args),connect:async()=>connection()} as unknown as Pool
  const service=new ActivityLotteryService(pool)
  const now=Date.now(),config={startsAt:new Date(now-3600000).toISOString(),closesAt:new Date(now+3600000).toISOString(),drawAt:new Date(now+3600000).toISOString(),multipleEntries:true,repeatWinners:false,rules:'规则',prizes:[{id:'p',name:'奖项',description:'奖品',count:2}]}
  async function setup(){return service.execute(principal,manager,{action:'configure',requestId:randomUUID(),activityId:activity,expectedRevision:null,config})}
  return {principal,service,setup,manager,staff,member,activity,tenant,store,trace,events,config,get state(){return state},failEvent(){failEvent=true},loseCommit(){loseCommit=true},makeDrawable(){state!.config!.closesAt=new Date(now-1000).toISOString();state!.config!.drawAt=new Date(now-1000).toISOString()}}
}
describe('lottery API transaction orchestration',()=>{
  it('registers once under concurrent identical requests and returns the latest state for retries',async()=>{
    const f=fixture(),s=await f.setup(),command={action:'register',requestId:randomUUID(),activityId:f.activity,expectedRevision:s.revision,memberId:f.member}
    const [a,b]=await Promise.all([f.service.execute(f.principal,f.staff,command),f.service.execute(f.principal,f.staff,command)])
    expect(a.entries).toHaveLength(1);expect(b.revision).toBe(a.revision)
    const c=await f.service.execute(f.principal,f.staff,{...command,requestId:randomUUID(),expectedRevision:a.revision})
    expect((await f.service.execute(f.principal,f.staff,command)).revision).toBe(c.revision)
    await expect(f.service.execute(f.principal,f.staff,{...command,memberId:randomUUID()})).rejects.toThrow('请求编号')
    expect(f.events.size).toBe(3)
  })
  it('rejects concurrent stale changes and preserves exactly one successful entry',async()=>{
    const f=fixture(),s=await f.setup(),command={action:'register',activityId:f.activity,expectedRevision:s.revision,memberId:f.member}
    const results=await Promise.allSettled([f.service.execute(f.principal,f.staff,{...command,requestId:randomUUID()}),f.service.execute(f.principal,f.staff,{...command,requestId:randomUUID()})])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.state!.entries).toHaveLength(1)
  })
  it('rolls back state when audit persistence fails and recovers from an uncertain commit',async()=>{
    const f=fixture(),s=await f.setup(),command={action:'register',requestId:randomUUID(),activityId:f.activity,expectedRevision:s.revision,memberId:f.member}
    f.failEvent();await expect(f.service.execute(f.principal,f.staff,command)).rejects.toThrow('audit write');expect(f.state!.entries).toHaveLength(0)
    f.loseCommit();await expect(f.service.execute(f.principal,f.staff,command)).rejects.toThrow('connection lost')
    expect((await f.service.execute(f.principal,f.staff,command)).entries).toHaveLength(1)
  })
  it('allows only manager configuration/draw and isolates tenant/store access',async()=>{
    const f=fixture();await expect(f.service.execute(f.principal,f.staff,{action:'configure',requestId:randomUUID(),activityId:f.activity,expectedRevision:null,config:f.config})).rejects.toThrow('权限')
    await f.setup()
    for(const p of [{...f.principal,tenantId:randomUUID()},{...f.principal,storeId:randomUUID()}])await expect(f.service.read(p,f.manager,f.activity)).rejects.toThrow('权限')
    await expect(f.service.read(f.principal,f.manager,randomUUID())).rejects.toThrow('活动')
    await expect(f.service.execute(f.principal,f.staff,{action:'draw',requestId:randomUUID(),activityId:f.activity,expectedRevision:f.state!.revision})).rejects.toThrow('权限')
  })
  it('draws only once concurrently, never rewrites the result and rejects later mutations',async()=>{
    const f=fixture(),s=await f.setup();const registered=await f.service.execute(f.principal,f.staff,{action:'register',requestId:randomUUID(),activityId:f.activity,expectedRevision:s.revision,memberId:f.member})
    f.makeDrawable();const command={action:'draw',activityId:f.activity,expectedRevision:registered.revision}
    const [a,b]=await Promise.all([f.service.execute(f.principal,f.manager,{...command,requestId:randomUUID()}),f.service.execute(f.principal,f.manager,{...command,requestId:randomUUID()})])
    expect(a.result).toEqual(b.result);expect(a.result!.prizes[0]!.winners).toHaveLength(1);expect(a.result!.prizes[0]!.vacancies).toBe(1)
    expect((await f.service.read(f.principal,f.manager,f.activity)).result).toEqual(a.result)
    await expect(f.service.execute(f.principal,f.staff,{action:'register',requestId:randomUUID(),activityId:f.activity,expectedRevision:a.revision,memberId:f.member})).rejects.toThrow('已开奖')
  })
})
