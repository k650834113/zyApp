import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createPostgresPool } from '@zyapp/cloud-db'
import { MiniappCommunityService } from './miniapp-community.service'
import { PublicContentService } from './public-content.service'
import type { MiniappPrincipal } from './miniapp-auth'
import { hashMiniappToken } from './miniapp-auth'
import { MiniappAuthGuard } from './miniapp-auth.guard'
import { MiniappSessionService } from './miniapp-session.service'
import { MiniappCommunityController } from './miniapp-community.controller'
import { MiniappController } from './miniapp.controller'
import type { ApiConfig } from './config'
import {API_CONFIG,REDIS_CLIENT} from './infrastructure.module'
import { Test } from '@nestjs/testing'
import supertest from 'supertest'

// Opt-in, isolated local database only. Never falls back to DATABASE_URL.
const url=process.env.ZYAPP_COMMUNITY_TEST_DATABASE_URL
if(url && (!url.includes('@127.0.0.1:54329/zyapp_miniapp_audit_') || !/^postgres:\/\//.test(url))) throw new Error('Use an isolated local miniapp audit database')
describe.skipIf(!url)('community PostgreSQL integration',()=>{
  const pool=createPostgresPool(url??'postgres://unused'),tenant=randomUUID(),store=randomUUID(),game=randomUUID()
  const members=Array.from({length:4},()=>randomUUID())
  const content=new PublicContentService(pool),service=new MiniappCommunityService(pool,content)
  function principal(index:number):MiniappPrincipal{return {tenantId:tenant,storeId:store,memberId:members[index]!,memberStatus:'active',identityId:randomUUID(),provider:'development',providerSubject:'audit',employeeId:null,employeeStatus:null,employeeRole:null,identity:{role:'guest'}}}
  const future=new Date(Date.now()+86400000).toISOString().slice(0,10)
  const meetup=()=>({requestId:randomUUID(),gameId:game,title:'临时验收约局',date:future,time:'20:00',duration:90,capacity:2,deadline:future+' 19:00',description:'隔离测试数据',friendly:true})
  beforeAll(async()=>{
    await pool.query('INSERT INTO tenant(id,name) VALUES($1,$2)',[tenant,'小程序隔离验收'])
    await pool.query('INSERT INTO store(id,tenant_id,name) VALUES($1,$2,$3)',[store,tenant,'临时测试门店'])
    for (let i=0;i<members.length;i++) await pool.query(`INSERT INTO cloud_member(id,tenant_id,store_id,member_number,phone,nickname,tier,status,source,server_version,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'ordinary','active','audit',1,NOW(),NOW())`,[members[i],tenant,store,String(i),'audit-'+i,'测试玩家'+i])
    await pool.query(`INSERT INTO cloud_board_game(id,tenant_id,store_id,name,introduction,min_players,max_players,difficulty,quantity,record_status,server_version,created_at,updated_at)
      VALUES($1,$2,$3,'测试桌游','隔离环境临时项',1,8,'light',1,'active',1,NOW(),NOW())`,[game,tenant,store])
  })
  afterAll(async()=>{await pool.end()})
  it('creates once, accepts only one concurrent last-seat join, and rejects changed retries',async()=>{
    const input=meetup(),owner=principal(0)
    const [a,b]=await Promise.all([service.createMeetup(owner,input),service.createMeetup(owner,input)])
    expect(a.id).toBe(b.id)
    await expect(service.createMeetup(owner,{...input,title:'different'})).rejects.toThrow('请求编号')
    const results=await Promise.allSettled([service.actMeetup(principal(1),a.id,'join',{requestId:randomUUID()}),service.actMeetup(principal(2),a.id,'join',{requestId:randomUUID()})])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect((await service.getMeetup(owner,a.id)).players).toHaveLength(2)
    await expect(service.actMeetup(principal(3),a.id,'cancel',{requestId:randomUUID()})).rejects.toThrow('发起人')
    await expect(service.actMeetup(owner,a.id,'leave',{requestId:randomUUID()})).rejects.toThrow('发起人')
  })
  it('cancels under-capacity meetups at deadline, preserves full meetups, and prevents late joins',async()=>{
    const owner=principal(0),empty=await service.createMeetup(owner,meetup()),full=await service.createMeetup(owner,meetup())
    await service.actMeetup(principal(1),full.id,'join',{requestId:randomUUID()})
    await pool.query("UPDATE miniapp_meetup SET deadline=NOW()-INTERVAL '1 second' WHERE id=ANY($1::uuid[])",[ [empty.id,full.id] ])
    expect((await service.getMeetup(owner,empty.id)).status).toBe('cancelled')
    expect((await service.getMeetup(owner,full.id)).status).toBe('confirmed')
    await expect(service.actMeetup(principal(2),empty.id,'join',{requestId:randomUUID()})).rejects.toThrow('截止')
  })
  it('keeps plays private, supports tied ranks, optimistic edits, deletion and idempotent retries',async()=>{
    const owner=principal(0),other=principal(1)
    const input={requestId:randomUUID(),gameId:game,date:'2026-09-01',duration:30,mode:'个人',players:[{name:'甲',score:'-1.25',rank:1},{name:'乙',score:'-1.25',rank:2}],note:'',ranking:'high',result:null}
    const saved=await service.savePlay(owner,input)
    expect(saved.players.map(p=>p.rank)).toEqual([1,1])
    expect((await service.savePlay(owner,input)).id).toBe(saved.id)
    await expect(service.getPlay(other,saved.id)).rejects.toThrow('无权')
    const edit={...input,requestId:randomUUID(),id:saved.id,expectedRevision:saved.revision,note:'修改'}
    const edited=await service.savePlay(owner,edit)
    await expect(service.savePlay(owner,{...edit,requestId:randomUUID()})).rejects.toThrow('已修改')
    await expect(service.savePlay(other,{...edit,requestId:randomUUID()})).rejects.toThrow('无权')
    await service.deletePlay(owner,saved.id,{requestId:randomUUID(),expectedRevision:edited.revision})
    await expect(service.getPlay(owner,saved.id)).rejects.toThrow('不存在')
  })
  it('enforces member and store boundaries and paginates SQL before rendering',async()=>{
    const owner=principal(0)
    await expect(service.listMeetups({...owner,memberId:null},{})).rejects.toThrow('注册')
    expect((await service.listMeetups({...owner,storeId:randomUUID()},{})).items).toEqual([])
    const page=await service.listMeetups(owner,{mine:'owned',limit:1})
    expect(page.items).toHaveLength(1);expect(page.hasMore).toBe(true)
    expect((await service.listMeetups(owner,{mine:'owned',limit:1,offset:1})).items[0]?.id).not.toBe(page.items[0]?.id)
  })
  it('loads real game detail by id and never returns unavailable games',async()=>{
    expect((await content.getGame(store,game)).name).toBe('测试桌游')
    await pool.query('UPDATE cloud_board_game SET private=TRUE WHERE id=$1',[game])
    await expect(content.getGame(store,game)).rejects.toThrow('不可用')
    await pool.query('UPDATE cloud_board_game SET private=FALSE WHERE id=$1',[game])
  })
  it('runs HTTP create/read/save/logout through real controllers and session guard',async()=>{
    const sessions=new MiniappSessionService(pool,{} as ApiConfig),identity=randomUUID(),token=randomUUID()
    await pool.query(`INSERT INTO miniapp_identity(id,tenant_id,store_id,provider,provider_subject,member_id)
      VALUES($1,$2,$3,'development',$4,$5)`,[identity,tenant,store,identity,members[0]])
    await pool.query("INSERT INTO miniapp_session(id,identity_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 hour')",[randomUUID(),identity,hashMiniappToken(token)])
    const module=await Test.createTestingModule({controllers:[MiniappCommunityController,MiniappController],providers:[MiniappAuthGuard,{provide:API_CONFIG,useValue:{}},{provide:REDIS_CLIENT,useValue:{}},
      {provide:MiniappCommunityService,useValue:service},{provide:MiniappSessionService,useValue:sessions}]}).compile()
    const app=module.createNestApplication();app.setGlobalPrefix('v1');await app.init()
    try {
      const http=supertest(app.getHttpServer())
      await http.get('/v1/member/community/meetups').expect(401)
      const created=await http.post('/v1/member/community/meetups').set('Authorization','Bearer '+token).send(meetup()).expect(201)
      const read=await http.get('/v1/member/community/meetups/'+created.body.id).set('Authorization','Bearer '+token).expect(200)
      expect(read.body.players).toHaveLength(1)
      await http.post('/v1/miniapp/logout').set('Authorization','Bearer '+token).expect(201)
      await http.get('/v1/member/community/meetups').set('Authorization','Bearer '+token).expect(401)
    }finally{await app.close()}
  },20000)
  it('requires mutual friends before associating a member and trusts only server profiles',async()=>{
    const owner=principal(0),other=principal(1)
    const input={requestId:randomUUID(),gameId:game,date:'2026-09-01',duration:30,mode:'个人',players:[{name:'冒名',memberId:other.memberId!,avatarUrl:'https://forged.example/a',score:'8',rank:1}],note:'',ranking:'high',result:null,recordScores:true,resultType:'ranking'}
    await expect(service.savePlay(owner,input)).rejects.toThrow('已确认好友')
    const request={requestId:randomUUID(),memberId:other.memberId}
    await service.friendCommand(owner,'request',request);await service.friendCommand(owner,'request',request)
    const pending=(await service.friends(other)).requests.find(r=>r.member.memberId===owner.memberId)!
    expect(pending.incoming).toBe(true)
    await expect(service.friendCommand(principal(2),'accept',{requestId:randomUUID(),id:pending.id})).rejects.toThrow('不存在')
    await service.friendCommand(other,'accept',{requestId:randomUUID(),id:pending.id})
    const play=await service.savePlay(owner,{...input,requestId:randomUUID()})
    expect(play.players[0]?.name).toBe('测试玩家1');expect(play.players[0]?.avatarUrl).not.toBe('https://forged.example/a')
    expect((await service.getPlay(other,play.id)).owned).toBe(false)
    await expect(service.getPlay(principal(2),play.id)).rejects.toThrow('无权')
    await expect(service.getPlay({...other,storeId:randomUUID()},play.id)).rejects.toThrow('无权')
    await expect(service.savePlay(other,{...input,id:play.id,expectedRevision:play.revision,requestId:randomUUID()})).rejects.toThrow('无权')
    await service.deletePlay(other,play.id,{requestId:randomUUID()})
    let edited=await service.savePlay(owner,{...input,id:play.id,expectedRevision:play.revision,requestId:randomUUID(),note:'更新'})
    await expect(service.getPlay(other,play.id)).rejects.toThrow('不存在')
    edited=await service.savePlay(owner,{...input,id:play.id,expectedRevision:edited.revision,requestId:randomUUID(),players:[{name:'临时',score:'1',rank:1}]})
    edited=await service.savePlay(owner,{...input,id:play.id,expectedRevision:edited.revision,requestId:randomUUID()})
    await expect(service.getPlay(other,play.id)).rejects.toThrow('不存在')
    expect((await service.getPlay(owner,play.id)).note).toBe('')
  })
  it('uses expiring table invitations, deduplicates joins, and rejects closed or foreign invites',async()=>{
    const owner=principal(0),guest=principal(2),requestId=randomUUID()
    const table=await service.createTable(owner,{requestId})
    expect((await service.createTable(owner,{requestId})).id).toBe(table.id)
    const invite=await service.invite(owner,{requestId:randomUUID(),tableId:table.id})
    await service.joinInvite(guest,invite.token,{requestId:randomUUID()})
    await service.joinInvite(guest,invite.token,{requestId:randomUUID()})
    expect((await service.table(owner,table.id)).members).toHaveLength(2)
    await expect(service.previewInvite({...guest,storeId:randomUUID()},invite.token)).rejects.toThrow('过期')
    const play=await service.savePlay(owner,{requestId:randomUUID(),tableId:table.id,gameId:game,date:'2026-09-01',duration:30,mode:'个人',recordScores:false,resultType:'multiple',ranking:'manual',result:null,note:'',players:[{name:'临时',memberId:guest.memberId!,score:'',rank:0,outcome:'win'}]})
    expect((await service.getPlay(guest,play.id)).id).toBe(play.id)
    await service.closeTable(owner,table.id,{requestId:randomUUID()})
    await expect(service.joinInvite(principal(3),invite.token,{requestId:randomUUID()})).rejects.toThrow('关闭')
    await expect(service.previewInvite(guest,invite.token)).rejects.toThrow('关闭')
    const expired=await service.invite(owner,{requestId:randomUUID()})
    await pool.query("UPDATE miniapp_invite SET expires_at=NOW()-INTERVAL '1 second' WHERE token=$1",[expired.token])
    await expect(service.previewInvite(guest,expired.token)).rejects.toThrow('过期')
  })
})
