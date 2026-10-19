import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {createPostgresPool,runCloudMigrations} from '@zyapp/cloud-db'
import {DEFAULT_ROLE_PERMISSIONS} from '@zyapp/auth'
import type {ApiConfig} from './config'
import type Redis from 'ioredis'
import type {MiniappPrincipal} from './miniapp-auth'
import {StaffWorkspaceService} from './staff-workspace.service'
import {MiniappNoticeService,enqueueMemberNotice} from './miniapp-notice.service'
import {ActivityLotteryService} from './activity-lottery.service'
import {StaffWorkspaceController} from './staff-workspace.controller'
import {MiniappAuthGuard} from './miniapp-auth.guard'
import {MiniappSessionService} from './miniapp-session.service'
import {hashMiniappToken} from './miniapp-auth'
import {Test} from '@nestjs/testing'
import supertest from 'supertest'
vi.mock('./wechat-miniapp-provider',async original=>({...await original<typeof import('./wechat-miniapp-provider')>(),createCommunityMiniappCode:vi.fn(async()=> 'data:image/png;base64,aGVsbG8='),getWechatAccessToken:vi.fn(async()=> 'isolated-test-token')}))
const url=process.env.ZYAPP_WORKSPACE_TEST_DATABASE_URL
if(url){const u=new URL(url);if(u.protocol!=='postgres:'||u.hostname!=='127.0.0.1'||u.port!=='54329'||!u.pathname.startsWith('/zyapp_miniapp_audit_'))throw Error('Use an isolated local workspace audit database')}
describe.skipIf(!url)('staff workspace PostgreSQL integration',()=>{
 const pool=createPostgresPool(url??'postgres://unused'),tenant=randomUUID(),store=randomUUID(),actor=randomUUID(),device=randomUUID()
 const members=Array.from({length:8},()=>randomUUID()),identities=members.map(()=>randomUUID())
 const service=new StaffWorkspaceService(pool,{} as ApiConfig,{} as Redis),notices=new MiniappNoticeService(pool,{} as ApiConfig,{} as Redis),lottery=new ActivityLotteryService(pool)
 function principal(i=0,employee=false):MiniappPrincipal{return {tenantId:tenant,storeId:store,identityId:identities[i]!,provider:'wechat',providerSubject:'openid:audit-'+i,memberId:members[i]!,memberStatus:'active',employeeId:employee?actor:null,employeeStatus:employee?'active':null,employeeRole:employee?'manager':null,identity:employee?{role:'manager',employeeId:actor,displayName:'审计店长',permissions:DEFAULT_ROLE_PERMISSIONS.manager}:{role:'member',memberId:members[i]!,nickname:'测试'+i,phoneMasked:'138****0000',tier:'ordinary'}}}
 const staff=()=>principal(0,true),devicePrincipal={tenantId:tenant,storeId:store,deviceId:device,deviceName:'audit'}
 beforeAll(async()=>{
  await runCloudMigrations(pool,join(import.meta.dirname,'../../../packages/cloud-db/migrations'))
  await pool.query('INSERT INTO tenant(id,name) VALUES($1,\'工作台隔离测试\')',[tenant]);await pool.query('INSERT INTO store(id,tenant_id,name) VALUES($1,$2,\'隔离门店\')',[store,tenant]);await pool.query("INSERT INTO device(id,tenant_id,store_id,name,status) VALUES($1,$2,$3,'audit','active')",[device,tenant,store])
  await pool.query(`INSERT INTO cloud_employee(id,tenant_id,store_id,username,display_name,role,status,server_version,created_at,updated_at) VALUES($1,$2,$3,'audit','audit','manager','active',1,NOW(),NOW())`,[actor,tenant,store]);await pool.query("INSERT INTO cloud_employee_store_access(employee_id,tenant_id,store_id,role,status) VALUES($1,$2,$3,'manager','active')",[actor,tenant,store])
  for(let i=0;i<members.length;i++){
   await pool.query(`INSERT INTO cloud_member(id,tenant_id,store_id,member_number,phone,nickname,tier,status,source,server_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ordinary','active','audit',1,NOW(),NOW())`,[members[i],tenant,store,String(i+1001),'audit-'+i,'测试'+i]);await pool.query(`INSERT INTO miniapp_identity(id,tenant_id,store_id,provider,provider_subject,member_id) VALUES($1,$2,$3,'wechat',$4,$5)`,[identities[i],tenant,store,'openid:audit-'+i,members[i]])
  }
 })
 afterAll(async()=>pool.end());afterEach(()=>vi.unstubAllGlobals())
 async function setup(capacity=2){
  const activityId=randomUUID(),now=Date.now(),startsAt=new Date(now-3600000).toISOString(),closesAt=new Date(now+3600000).toISOString()
  await pool.query(`INSERT INTO cloud_activity_campaign(id,tenant_id,store_id,title,summary,content,activity_type,status,starts_at,ends_at,server_version,created_at,updated_at) VALUES($1,$2,$3,'工作台抽奖','抽奖','抽奖','general','published',$4,$5,1,NOW(),NOW())`,[activityId,tenant,store,startsAt,closesAt])
  await lottery.execute(devicePrincipal,actor,{action:'configure',requestId:randomUUID(),activityId,expectedRevision:null,config:{startsAt,closesAt,drawAt:closesAt,multipleEntries:true,repeatWinners:false,rules:'规则',prizes:[{id:'p',name:'月卡',description:'奖品',count:1}]}})
  const input={requestId:randomUUID(),activityId,capacity,envVersion:'develop' as const},batch=await service.createBatch(staff(),input);return {activityId,input,batch}
 }
 it('migrates the complete schema and admits only the available number under concurrent scans',async()=>{
  const {batch}=await setup(2),attempts=await Promise.allSettled(members.slice(0,6).map((_,i)=>service.admission(principal(i),batch.scene)))
  expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(2)
  const indices=attempts.flatMap((r,i)=>r.status==='fulfilled'?[i]:[])
  await Promise.all(indices.map(i=>service.admission(principal(i),batch.scene,true)))
  const list=await service.batches(staff(),batch.activityId);expect(list[0]?.registered).toBe(2);expect(list[0]?.reserved).toBe(0)
  await Promise.all(Array.from({length:5},()=>service.admission(principal(indices[0]!),batch.scene,true)))
  expect((await service.batches(staff(),batch.activityId))[0]?.registered).toBe(2)
 })
 it('retries batch creation idempotently and cancels old codes on regeneration',async()=>{
  const {batch,input}=await setup(3);expect((await service.createBatch(staff(),input)).id).toBe(batch.id)
  await expect(service.createBatch(staff(),{...input,capacity:4})).rejects.toThrow('请求编号')
  const fresh=await service.createBatch(staff(),{...input,requestId:randomUUID()});expect(fresh.id).not.toBe(batch.id)
  await expect(service.admission(principal(1),batch.scene)).rejects.toThrow('作废')
  await expect(service.batches({...staff(),storeId:randomUUID()},batch.activityId)).rejects.toThrow('不存在')
  await expect(service.admission(principal(1),fresh.scene)).resolves.toMatchObject({registered:false})
 })
 it('keeps a scanned reservation through code expiry but denies expired registration holds',async()=>{
  const {batch}=await setup(2);await service.admission(principal(1),batch.scene)
  await pool.query("UPDATE miniapp_registration_batch SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[batch.id])
  await expect(service.admission(principal(1),batch.scene,true)).resolves.toMatchObject({registered:true})
  await expect(service.admission(principal(2),batch.scene)).rejects.toThrow('过期')
  const other=await setup(1);await service.admission(principal(3),other.batch.scene)
  await pool.query("UPDATE miniapp_registration_admission SET expires_at=clock_timestamp()-interval '1 second' WHERE batch_id=$1",[other.batch.id]);await pool.query("UPDATE miniapp_registration_batch SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[other.batch.id]);await expect(service.admission(principal(3),other.batch.scene,true)).rejects.toThrow('过期')
 })
 it('releases cancelled seats and audits changes without deleting historical entries',async()=>{
  const {batch}=await setup(1);await service.admission(principal(1),batch.scene,true);const entry=(await service.batches(staff(),batch.activityId))[0]!.entries[0]!
  await service.cancel(staff(),batch.id,entry.id,'不符合消费资格');await service.admission(principal(2),batch.scene,true)
  const current=(await service.batches(staff(),batch.activityId))[0]!;expect(current.registered).toBe(1);expect(current.entries).toHaveLength(2);expect(current.entries.find(e=>e.id===entry.id)?.active).toBe(false)
  const audits=await pool.query("SELECT * FROM cloud_audit_log WHERE aggregate_id=$1 AND action='lottery.entry_cancelled'",[batch.id]);expect(audits.rows[0]?.metadata_json.reason).toBe('不符合消费资格')
 })
 it('registers the same member once across different codes even when PC rules permit multiple entries',async()=>{
  const {batch,input}=await setup(2);await service.admission(principal(1),batch.scene,true)
  const next=await service.createBatch(staff(),{...input,requestId:randomUUID()});await service.admission(principal(1),next.scene,true)
  const state=await lottery.read(devicePrincipal,actor,batch.activityId);expect(state.entries.filter(e=>e.memberId===members[1])).toHaveLength(1)
 })
 it('reads all consumption line items with member names and isolates the store',async()=>{
  const id=randomUUID(),number='TEST-'+id,now=new Date().toISOString()
  await pool.query(`INSERT INTO cloud_sales_order(id,tenant_id,store_id,order_number,visit_batch_id,customer_member_id,payment_method,status,total_fen,completed_at,payload_json,server_version) VALUES($1,$2,$3,$4,$5,$6,'cash','completed',12000,$7,'{}',1)`,[id,tenant,store,number,randomUUID(),members[1],now])
  await pool.query(`INSERT INTO cloud_sales_order_item(id,tenant_id,store_id,order_id,catalog_item_id,item_name,item_type,regular_price_fen,advanced_price_fen,applied_unit_price_fen,pricing_tier,quantity,line_total_fen,benefit_type) VALUES($1,$2,$3,$4,$5,'多人门票','admission',4000,4000,4000,'regular',3,12000,'none')`,[randomUUID(),tenant,store,id,randomUUID()])
  const result=await service.transactions(staff(),{query:'测试1'});expect(result.items.find(i=>i.id==='order:'+id)).toMatchObject({memberName:'测试1',title:'多人门票 ×3',amountFen:12000})
  expect((await service.transactions({...staff(),storeId:randomUUID()},{})).items).toHaveLength(0)
 })
 it('rejects anonymous/member requests and rechecks revoked staff access on every HTTP request',async()=>{
  const module=await Test.createTestingModule({controllers:[StaffWorkspaceController],providers:[MiniappAuthGuard,{provide:StaffWorkspaceService,useValue:service},{provide:MiniappNoticeService,useValue:notices},{provide:MiniappSessionService,useValue:new MiniappSessionService(pool,{} as ApiConfig)}]}).compile()
  const app=module.createNestApplication();app.setGlobalPrefix('v1');await app.init()
  const employeeToken=randomUUID(),memberToken=randomUUID()
  try{
   await pool.query('UPDATE miniapp_identity SET employee_id=$1 WHERE id=$2',[actor,identities[0]])
   await pool.query(`INSERT INTO cloud_employee_mobile_credential(employee_id,tenant_id,store_id,enabled,password_hash,updated_at) VALUES($1,$2,$3,true,'not-used-in-this-test',NOW())`,[actor,tenant,store])
   for(const [id,token] of [[identities[0],employeeToken],[identities[1],memberToken]])await pool.query("INSERT INTO miniapp_session(id,identity_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+interval '1 hour')",[randomUUID(),id,hashMiniappToken(token!)])
   await supertest(app.getHttpServer()).get('/v1/workspace/transactions').expect(401)
   await supertest(app.getHttpServer()).get('/v1/workspace/transactions').set('Authorization','Bearer '+memberToken).expect(403)
   await supertest(app.getHttpServer()).get('/v1/workspace/transactions').set('Authorization','Bearer '+employeeToken).expect(200)
   await pool.query("UPDATE cloud_employee_store_access SET status='disabled' WHERE employee_id=$1 AND store_id=$2",[actor,store])
   await supertest(app.getHttpServer()).get('/v1/workspace/transactions').set('Authorization','Bearer '+employeeToken).expect(403)
  }finally{await pool.query("UPDATE cloud_employee_store_access SET status='active' WHERE employee_id=$1 AND store_id=$2",[actor,store]);await app.close()}
 })
 it('enqueues one personalized result per member within the draw transaction and does not leak others results',async()=>{
  const {batch}=await setup(2);await service.admission(principal(1),batch.scene,true);await service.admission(principal(2),batch.scene,true)
  await pool.query(`UPDATE activity_lottery SET state_json=jsonb_set(jsonb_set(state_json,'{config,closesAt}',to_jsonb((clock_timestamp()-interval '1 hour')::text)),'{config,drawAt}',to_jsonb((clock_timestamp()-interval '1 hour')::text)) WHERE activity_id=$1`,[batch.activityId])
  const state=await lottery.read(devicePrincipal,actor,batch.activityId);const drawn=await lottery.execute(devicePrincipal,actor,{action:'draw',requestId:randomUUID(),activityId:batch.activityId,expectedRevision:state.revision})
  await lottery.execute(devicePrincipal,actor,{action:'draw',requestId:randomUUID(),activityId:batch.activityId,expectedRevision:state.revision})
  const rows=await pool.query('SELECT * FROM miniapp_notice WHERE business_id=$1',[batch.activityId]);expect(rows.rows).toHaveLength(2)
  const n=rows.rows.find(r=>r.member_id===members[1])!;await expect(notices.read(principal(2),n.id)).rejects.toThrow('不存在')
  expect((await service.result(principal(1),batch.activityId)).result?.prizes).toHaveLength(drawn.result!.prizes[0]!.winners[0]?.memberId===members[1]?1:0)
  const entry=(await service.batches(staff(),batch.activityId))[0]!.entries[0]!;await expect(service.cancel(staff(),batch.id,entry.id,'取消')).rejects.toThrow()
 })
 it('records one grant per ticket and sends each queued notice once across competing dispatchers',async()=>{
  await notices.save(staff(),{key:'test.result',title:'测试结果',description:'隔离测试',enabled:true,templateId:'template_12345',fields:{thing1:'title'}})
  const ticket=(await notices.prepare(principal(4),'test.result'))!;await Promise.all([notices.receipt(principal(4),ticket.id,'accept'),notices.receipt(principal(4),ticket.id,'accept')])
  const key='test:'+randomUUID();await enqueueMemberNotice(pool,{tenantId:tenant,storeId:store,memberId:members[4]!,scene:'test.result',eventKey:key,businessId:null,title:'测试',body:'隔离测试',data:{title:'测试'}})
  const fetch=vi.fn(async()=>new Response(JSON.stringify({errcode:0}),{status:200}));vi.stubGlobal('fetch',fetch)
  await Promise.all([notices.dispatch(),new MiniappNoticeService(pool,{} as ApiConfig,{} as Redis).dispatch()]);await notices.dispatch();expect(fetch).toHaveBeenCalledTimes(1)
  const job=(await pool.query('SELECT * FROM miniapp_notice WHERE event_key=$1',[key])).rows[0];expect(job.delivery).toBe('sent');expect((await pool.query('SELECT * FROM miniapp_subscription_ticket WHERE id=$1',[ticket.id])).rows[0].used_at).toBeTruthy()
 })
 it('keeps an in-app notice and avoids automatic resend after an uncertain platform response',async()=>{
  const ticket=(await notices.prepare(principal(5),'test.result'))!;await notices.receipt(principal(5),ticket.id,'accept')
  const key='uncertain:'+randomUUID();await enqueueMemberNotice(pool,{tenantId:tenant,storeId:store,memberId:members[5]!,scene:'test.result',eventKey:key,businessId:null,title:'测试',body:'隔离测试',data:{title:'测试'}})
  const fetch=vi.fn(async()=>{throw Error('network lost after send')});vi.stubGlobal('fetch',fetch);await notices.dispatch();await notices.dispatch();expect(fetch).toHaveBeenCalledTimes(1)
  const row=(await pool.query('SELECT * FROM miniapp_notice WHERE event_key=$1',[key])).rows[0];expect(row.delivery).toBe('uncertain');expect((await notices.read(principal(5),row.id)).body).toBe('隔离测试')
 })
 it('retries definitive platform busy rejections while preserving the same authorization',async()=>{
  const ticket=(await notices.prepare(principal(6),'test.result'))!;await notices.receipt(principal(6),ticket.id,'accept')
  const key='busy:'+randomUUID();await enqueueMemberNotice(pool,{tenantId:tenant,storeId:store,memberId:members[6]!,scene:'test.result',eventKey:key,businessId:null,title:'测试',body:'重试测试',data:{title:'测试'}})
  const fetch=vi.fn(async()=>new Response(JSON.stringify({errcode:-1}),{status:200}));vi.stubGlobal('fetch',fetch);await notices.dispatch();let row=(await pool.query('SELECT * FROM miniapp_notice WHERE event_key=$1',[key])).rows[0];expect(row.delivery).toBe('pending');expect((await pool.query('SELECT used_at FROM miniapp_subscription_ticket WHERE id=$1',[ticket.id])).rows[0].used_at).toBeNull()
  fetch.mockImplementation(async()=>new Response(JSON.stringify({errcode:0}),{status:200}));await pool.query('UPDATE miniapp_notice SET next_attempt_at=clock_timestamp() WHERE id=$1',[row.id]);await notices.dispatch();row=(await pool.query('SELECT * FROM miniapp_notice WHERE event_key=$1',[key])).rows[0];expect(row.delivery).toBe('sent');expect(fetch).toHaveBeenCalledTimes(2)
 })
})
