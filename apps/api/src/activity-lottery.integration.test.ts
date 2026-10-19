import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {createPostgresPool,runCloudMigrations} from '@zyapp/cloud-db'
import type {LotteryWorkspace} from '@zyapp/contracts'
import {ActivityLotteryService} from './activity-lottery.service'
const url=process.env.ZYAPP_LOTTERY_TEST_DATABASE_URL
if(url){const u=new URL(url);if(u.protocol!=='postgres:'||u.hostname!=='127.0.0.1'||u.port!=='54329'||!u.pathname.startsWith('/zyapp_miniapp_audit_'))throw Error('Use an isolated local lottery audit database')}
describe.skipIf(!url)('lottery PostgreSQL integration',()=>{
  const pool=createPostgresPool(url??'postgres://unused'),tenant=randomUUID(),store=randomUUID(),actor=randomUUID(),device=randomUUID(),member=randomUUID()
  const principal={tenantId:tenant,storeId:store,deviceId:device,deviceName:'audit'},service=new ActivityLotteryService(pool)
  const now=Date.now(),startsAt=new Date(now-86400000).toISOString(),closesAt=new Date(now+86400000).toISOString()
  beforeAll(async()=>{
    await runCloudMigrations(pool,join(import.meta.dirname,'../../../packages/cloud-db/migrations'))
    await pool.query('INSERT INTO tenant(id,name) VALUES($1,$2)',[tenant,'抽奖隔离测试'])
    await pool.query('INSERT INTO store(id,tenant_id,name) VALUES($1,$2,$3)',[store,tenant,'抽奖隔离门店'])
    await pool.query("INSERT INTO device(id,tenant_id,store_id,name,status) VALUES($1,$2,$3,'audit','active')",[device,tenant,store])
    await pool.query(`INSERT INTO cloud_employee(id,tenant_id,store_id,username,display_name,role,status,server_version,created_at,updated_at) VALUES($1,$2,$3,'audit','audit','manager','active',1,NOW(),NOW())`,[actor,tenant,store])
    await pool.query("INSERT INTO cloud_employee_store_access(employee_id,tenant_id,store_id,role,status) VALUES($1,$2,$3,'manager','active')",[actor,tenant,store])
    await pool.query(`INSERT INTO cloud_member(id,tenant_id,store_id,member_number,phone,nickname,tier,status,source,server_version,created_at,updated_at) VALUES($1,$2,$3,'1001','13800000000','测试会员','ordinary','active','audit',1,NOW(),NOW())`,[member,tenant,store])
  })
  afterAll(async()=>{await pool.end()})
  async function setup(){
    const id=randomUUID()
    await pool.query(`INSERT INTO cloud_activity_campaign(id,tenant_id,store_id,title,summary,content,activity_type,status,starts_at,ends_at,server_version,created_at,updated_at) VALUES($1,$2,$3,'抽奖测试','抽奖测试','抽奖测试','general','published',$4,$5,1,NOW(),NOW())`,[id,tenant,store,startsAt,closesAt])
    return service.execute(principal,actor,{requestId:randomUUID(),action:'configure',activityId:id,expectedRevision:null,config:{startsAt,closesAt,drawAt:closesAt,multipleEntries:true,repeatWinners:false,rules:'规则',prizes:[{id:'p',name:'奖项',description:'奖品',count:2}]}})
  }
  const register=(s:LotteryWorkspace,requestId=randomUUID())=>service.execute(principal,actor,{requestId,activityId:s.activityId,expectedRevision:s.revision,action:'register',memberId:member})
  it('serializes simultaneous duplicate registrations and rejects stale independent writes',async()=>{
    const s=await setup(),key=randomUUID(),[a,b]=await Promise.all([register(s,key),register(s,key)])
    expect(a.entries).toHaveLength(1);expect(a.revision).toBe(b.revision)
    const results=await Promise.allSettled([register(a),register(a)])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect((await service.read(principal,actor,s.activityId)).entries).toHaveLength(2)
    const other={...principal,storeId:randomUUID()};await expect(service.read(other,actor,s.activityId)).rejects.toThrow('权限')
  })
  it('rolls back state when audit insert fails, then retries the same request safely',async()=>{
    const s=await setup(),key=randomUUID()
    // A transaction-local trigger affects only this isolated fixture activity.
    const fn='lottery_fail_'+randomUUID().replaceAll('-',''),trigger=fn+'_trigger'
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.activity_id = '${s.activityId}'::uuid THEN RAISE EXCEPTION 'audit test failure'; END IF; RETURN NEW; END $$`)
    await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON activity_lottery_event FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
    try{await expect(register(s,key)).rejects.toThrow('audit test failure');expect((await service.read(principal,actor,s.activityId)).entries).toHaveLength(0)}finally{await pool.query(`DROP TRIGGER ${trigger} ON activity_lottery_event`);await pool.query(`DROP FUNCTION ${fn}()`)}
    expect((await register(s,key)).entries).toHaveLength(1)
  })
  it('persists only one concurrent draw and a new service instance returns its original result',async()=>{
    const s=await register(await setup())
    // Move the test clock boundary in the isolated fixture without changing production commands.
    await pool.query(`UPDATE activity_lottery SET state_json=jsonb_set(jsonb_set(state_json,'{config,closesAt}',to_jsonb($2::text)),'{config,drawAt}',to_jsonb($2::text)) WHERE activity_id=$1`,[s.activityId,new Date(Date.now()-1000).toISOString()])
    const command={activityId:s.activityId,expectedRevision:s.revision,action:'draw'}
    const [a,b]=await Promise.all([service.execute(principal,actor,{...command,requestId:randomUUID()}),service.execute(principal,actor,{...command,requestId:randomUUID()})])
    expect(a.result).toEqual(b.result);expect(a.result!.prizes[0]!.winners).toHaveLength(1);expect(a.result!.prizes[0]!.vacancies).toBe(1)
    expect((await new ActivityLotteryService(pool).read(principal,actor,s.activityId)).result).toEqual(a.result)
  })
})
