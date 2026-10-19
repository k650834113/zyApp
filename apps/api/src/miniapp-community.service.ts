import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import type { CommunityPage, MeetupSummary, PlaySummary, CommunityMember, FriendsSnapshot, TableSnapshot } from '@zyapp/contracts'
import type { MiniappPrincipal } from './miniapp-auth'
import { POSTGRES_POOL } from './infrastructure.module'
import { PublicContentService } from './public-content.service'
import { normalizeBoardGameId } from './board-game-library'
import { filters, object, requestId, validateMeetup, validatePlay } from './miniapp-community-validation'

type DB = Pool | PoolClient
type MeetupRow = {id:string;revision:string;owner_id:string;data_json:Omit<MeetupSummary,'players'|'joined'|'owned'>;status:MeetupSummary['status'];deadline:Date|string;capacity:number}
type PlayRow = {id:string;revision:string;owner_id:string;data_json:PlaySummary}
function member(p:MiniappPrincipal): string {
  if (!p.memberId || p.memberStatus!=='active') throw new ForbiddenException('请先注册并登录有效会员账户')
  return p.memberId
}

@Injectable()
export class MiniappCommunityService {
  selfMember(p:MiniappPrincipal):Promise<CommunityMember>{return this.profile(this.pool,p,member(p))}
  private async profile(db:DB,p:MiniappPrincipal,id:string):Promise<CommunityMember> {
    const r=await db.query<{id:string;member_number:string;nickname:string;avatar_url:string|null}>(
      "SELECT id,member_number,nickname,avatar_url FROM cloud_member WHERE tenant_id=$1 AND id=$2 AND status='active'",[p.tenantId,id])
    const m=r.rows[0];if(!m)throw new NotFoundException('会员不存在或已停用')
    return {memberId:m.id,memberNumber:m.member_number,name:m.nickname,avatarUrl:m.avatar_url}
  }
  async findMember(p:MiniappPrincipal,number:string):Promise<CommunityMember> {
    member(p)
    if(!number.trim()||number.length>40)throw new BadRequestException('请输入准确会员编号')
    const r=await this.pool.query<{id:string}>("SELECT id FROM cloud_member WHERE tenant_id=$1 AND member_number=$2 AND status='active' LIMIT 1",[p.tenantId,number.trim()])
    if(!r.rows[0])throw new NotFoundException('未找到该编号的会员')
    return this.profile(this.pool,p,r.rows[0].id)
  }
  async friends(p:MiniappPrincipal):Promise<FriendsSnapshot> {
    const me=member(p)
    const f=await this.pool.query<{id:string}>(`SELECT CASE WHEN member_low=$3 THEN member_high ELSE member_low END AS id FROM miniapp_friend
      WHERE tenant_id=$1 AND store_id=$2 AND (member_low=$3 OR member_high=$3) ORDER BY member_low,member_high`,[p.tenantId,p.storeId,me])
    const r=await this.pool.query<{id:string;sender_id:string;recipient_id:string}>(`SELECT id,sender_id,recipient_id FROM miniapp_friend_request
      WHERE tenant_id=$1 AND store_id=$2 AND status='pending' AND (sender_id=$3 OR recipient_id=$3) ORDER BY created_at DESC`,[p.tenantId,p.storeId,me])
    // Disabled accounts disappear from actionable lists.
    const safe=async(id:string)=>this.profile(this.pool,p,id).catch(e=>{if(e instanceof NotFoundException)return null;throw e})
    const profiles=await Promise.all(f.rows.map(x=>safe(x.id)))
    const requests=await Promise.all(r.rows.map(async x=>{const m=await safe(x.sender_id===me?x.recipient_id:x.sender_id);return m?{id:x.id,member:m,incoming:x.recipient_id===me}:null}))
    return {friends:profiles.filter((m):m is CommunityMember=>m!==null),requests:requests.filter((r):r is NonNullable<typeof r>=>r!==null)}
  }
  friendCommand(p:MiniappPrincipal,action:string,raw:unknown):Promise<{ok:true}> {
    return this.command(p,raw,'friend:'+action,async db=>{
      const me=member(p),v=object(raw)
      if(action==='request'||action==='remove') {
        const other=normalizeBoardGameId(v.memberId);if(me===other)throw new BadRequestException('不能添加自己')
        await this.profile(db,p,other)
        const ids=[me,other].sort()
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.tenantId+':'+p.storeId+':friends:'+ids.join(':')])
        if(action==='remove') {
          await db.query('DELETE FROM miniapp_friend WHERE tenant_id=$1 AND store_id=$2 AND member_low=$3 AND member_high=$4',[p.tenantId,p.storeId,...ids])
          await db.query("UPDATE miniapp_friend_request SET status='cancelled' WHERE tenant_id=$1 AND store_id=$2 AND status='pending' AND LEAST(sender_id,recipient_id)=$3 AND GREATEST(sender_id,recipient_id)=$4",[p.tenantId,p.storeId,...ids])
        } else {
          const exists=await db.query('SELECT 1 FROM miniapp_friend WHERE tenant_id=$1 AND store_id=$2 AND member_low=$3 AND member_high=$4',[p.tenantId,p.storeId,...ids])
          if(!exists.rows.length)await db.query(`INSERT INTO miniapp_friend_request(id,tenant_id,store_id,sender_id,recipient_id,status)
            VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT DO NOTHING`,[randomUUID(),p.tenantId,p.storeId,me,other])
        }
      } else if(action==='accept'||action==='reject') {
        const id=normalizeBoardGameId(v.id)
        // Lock the pair first, consistently with remove and request.
        const found=await db.query<{sender_id:string}>("SELECT sender_id FROM miniapp_friend_request WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND recipient_id=$4",[id,p.tenantId,p.storeId,me])
        if(!found.rows[0])throw new NotFoundException('好友申请不存在')
        const ids=[me,found.rows[0].sender_id].sort()
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.tenantId+':'+p.storeId+':friends:'+ids.join(':')])
        const changed=await db.query("UPDATE miniapp_friend_request SET status=$5 WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND recipient_id=$4 AND status='pending' RETURNING sender_id",[id,p.tenantId,p.storeId,me,action==='accept'?'accepted':'rejected'])
        if(!changed.rows.length)throw new ConflictException('申请已处理，请刷新')
        if(action==='accept') {
          await this.profile(db,p,ids[0]!);await this.profile(db,p,ids[1]!)
          await db.query('INSERT INTO miniapp_friend(tenant_id,store_id,member_low,member_high) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[p.tenantId,p.storeId,...ids])
        }
      } else throw new BadRequestException('好友操作无效')
      return {ok:true}
    })
  }
  createTable(p:MiniappPrincipal,raw:unknown):Promise<TableSnapshot> {
    return this.command(p,raw,'table:create',async db=>{
      const id=randomUUID()
      await db.query("INSERT INTO miniapp_table(id,tenant_id,store_id,owner_id,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '24 hours')",[id,p.tenantId,p.storeId,member(p)])
      await db.query('INSERT INTO miniapp_table_member(table_id,member_id) VALUES($1,$2)',[id,member(p)])
      return this.table(p,id,db)
    })
  }
  async table(p:MiniappPrincipal,id:string,db:DB=this.pool):Promise<TableSnapshot> {
    const me=member(p);normalizeBoardGameId(id)
    const r=await db.query<{id:string;owner_id:string;expires_at:Date;closed:boolean}>(`SELECT * FROM miniapp_table t WHERE id=$1 AND tenant_id=$2 AND store_id=$3
      AND EXISTS(SELECT 1 FROM miniapp_table_member j WHERE j.table_id=t.id AND j.member_id=$4)`,[id,p.tenantId,p.storeId,me])
    const t=r.rows[0];if(!t)throw new NotFoundException('同桌不存在或无权访问')
    const members=await db.query<{member_id:string}>('SELECT member_id FROM miniapp_table_member WHERE table_id=$1 ORDER BY joined_at,member_id',[id])
    return {id,expiresAt:new Date(t.expires_at).toISOString(),closed:t.closed||new Date(t.expires_at).getTime()<=Date.now(),owned:t.owner_id===me,members:await Promise.all(members.rows.map(m=>this.profile(db,p,m.member_id)))}
  }
  closeTable(p:MiniappPrincipal,id:string,raw:unknown):Promise<{ok:true}> {
    normalizeBoardGameId(id)
    return this.command(p,raw,'table:close:'+id,async db=>{
      const r=await db.query('UPDATE miniapp_table SET closed=TRUE WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND owner_id=$4 RETURNING id',[id,p.tenantId,p.storeId,member(p)])
      if(!r.rows.length)throw new NotFoundException('同桌不存在或无权关闭')
      return {ok:true}
    })
  }
  invite(p:MiniappPrincipal,raw:unknown):Promise<{token:string;expiresAt:string}> {
    return this.command(p,raw,'invite:create',async db=>{
      const v=object(raw),tableId=v.tableId?normalizeBoardGameId(v.tableId):null
      if(tableId){const t=await this.table(p,tableId,db);if(!t.owned||t.closed)throw new ConflictException('同桌已关闭或不是发起者')}
      const token=randomBytes(16).toString('hex')
      const r=await db.query<{expires_at:Date}>(`INSERT INTO miniapp_invite(token,tenant_id,store_id,owner_id,table_id,expires_at)
        VALUES($1,$2,$3,$4,$5,LEAST(clock_timestamp()+interval '24 hours',COALESCE((SELECT expires_at FROM miniapp_table WHERE id=$5),clock_timestamp()+interval '24 hours'))) RETURNING expires_at`,[token,p.tenantId,p.storeId,member(p),tableId])
      return {token,expiresAt:new Date(r.rows[0]!.expires_at).toISOString()}
    })
  }
  private async inviteRow(p:MiniappPrincipal,token:string,db:DB) {
    member(p);if(!/^[a-f0-9]{32}$/.test(token))throw new BadRequestException('邀请码无效')
    const r=await db.query<{owner_id:string;table_id:string|null}>(`SELECT owner_id,table_id FROM miniapp_invite WHERE token=$1 AND tenant_id=$2 AND store_id=$3 AND expires_at>clock_timestamp()`,[token,p.tenantId,p.storeId])
    if(!r.rows[0])throw new NotFoundException('邀请码已过期或不属于本门店')
    return r.rows[0]
  }
  async previewInvite(p:MiniappPrincipal,token:string) {
    const r=await this.inviteRow(p,token,this.pool)
    if(r.table_id){const t=await this.pool.query("SELECT 1 FROM miniapp_table WHERE id=$1 AND closed=FALSE AND expires_at>clock_timestamp()",[r.table_id]);if(!t.rows.length)throw new ConflictException('同桌已关闭或过期')}
    return {kind:r.table_id?'table' as const:'friend' as const,member:await this.profile(this.pool,p,r.owner_id)}
  }
  joinInvite(p:MiniappPrincipal,token:string,raw:unknown):Promise<TableSnapshot|{ok:true}> {
    return this.command(p,raw,'invite:join:'+token,async db=>{
      const r=await this.inviteRow(p,token,db),me=member(p)
      if(!r.table_id)throw new BadRequestException('请通过好友申请添加名片中的会员')
      const locked=await db.query<{closed:boolean;expired:boolean}>('SELECT closed,expires_at<=clock_timestamp() AS expired FROM miniapp_table WHERE id=$1 FOR UPDATE',[r.table_id])
      const t=locked.rows[0];if(!t||t.closed||t.expired)throw new ConflictException('同桌已关闭或过期')
      const rows=await db.query<{member_id:string}>('SELECT member_id FROM miniapp_table_member WHERE table_id=$1',[r.table_id])
      if(!rows.rows.some(m=>m.member_id===me)) {
        if(rows.rows.length>=8)throw new ConflictException('同桌已满8人')
        await db.query('INSERT INTO miniapp_table_member(table_id,member_id) VALUES($1,$2)',[r.table_id,me])
      }
      return this.table(p,r.table_id,db)
    })
  }
  private timer:ReturnType<typeof setInterval>|null=null
  private sweeping=false
  onModuleInit(){this.timer=setInterval(()=>{void this.expireDue()},30000);this.timer.unref()}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
  async expireDue():Promise<void>{
    if(this.sweeping)return
    this.sweeping=true
    try {
      const due=await this.pool.query<{store_id:string}>("SELECT DISTINCT store_id FROM miniapp_meetup WHERE status='open' AND deadline<=clock_timestamp() LIMIT 100")
      for(const row of due.rows)await this.expire(this.pool,row.store_id)
    }catch{new Logger(MiniappCommunityService.name).error('Meetup deadline sweep failed; retrying next interval')}
    finally{this.sweeping=false}
  }
  constructor(@Inject(POSTGRES_POOL) private readonly pool:Pool,
    @Inject(PublicContentService) private readonly content:PublicContentService) {}

  private async expire(db:DB, storeId:string) {
    // Every join/leave holds the same meetup row lock. Deadline checks use the database clock.
    await db.query(`WITH changed AS (UPDATE miniapp_meetup m SET status = CASE WHEN
      (SELECT COUNT(*) FROM miniapp_meetup_member j WHERE j.meetup_id=m.id) >= m.capacity
      THEN 'confirmed' ELSE 'cancelled' END, revision=gen_random_uuid()
      WHERE store_id=$1 AND status='open' AND deadline<=clock_timestamp() RETURNING *)
      INSERT INTO miniapp_community_notification(id,tenant_id,store_id,meetup_id,recipient_member_id,event_type,payload_json)
      SELECT gen_random_uuid(),c.tenant_id,c.store_id,c.id,j.member_id,'expired',
        jsonb_build_object('title',c.data_json->>'title','status',c.status)
      FROM changed c JOIN miniapp_meetup_member j ON j.meetup_id=c.id WHERE c.status='cancelled'`,[storeId])
  }

  private async notify(db:PoolClient,p:MiniappPrincipal,id:string,event:string){
    await db.query(`INSERT INTO miniapp_community_notification(id,tenant_id,store_id,meetup_id,recipient_member_id,event_type,payload_json)
      SELECT gen_random_uuid(),$1,$2,m.id,j.member_id,$4,jsonb_build_object('title',m.data_json->>'title','status',m.status)
      FROM miniapp_meetup m JOIN miniapp_meetup_member j ON j.meetup_id=m.id WHERE m.id=$3`,[p.tenantId,p.storeId,id,event])
  }

  private async views(db:DB, rows:MeetupRow[], me:string):Promise<MeetupSummary[]> {
    if (!rows.length) return []
    const participants = await db.query<{meetup_id:string;member_id:string;nickname:string;avatar_url:string|null}>(
      `SELECT j.meetup_id,j.member_id,m.nickname,m.avatar_url FROM miniapp_meetup_member j
       JOIN cloud_member m ON m.id=j.member_id WHERE j.meetup_id=ANY($1::uuid[])
       ORDER BY j.joined_at,j.member_id`,[rows.map(r=>r.id)])
    return rows.map(r=>{
      const joined=participants.rows.filter(j=>j.meetup_id===r.id)
      joined.sort((a,b)=>Number(b.member_id===r.owner_id)-Number(a.member_id===r.owner_id))
      return {...r.data_json,id:r.id,revision:r.revision,status:r.status,players:joined.map(j=>j.nickname),
        participants:joined.map(j=>({memberId:j.member_id,name:j.nickname,avatarUrl:j.avatar_url})),registrationClosed:new Date(typeof r.deadline==='string'&&r.deadline.length===16?r.deadline.replace(' ','T')+':00+08:00':r.deadline).getTime()<=Date.now(),
        owned:r.owner_id===me,joined:joined.some(j=>j.member_id===me)}
    })
  }

  async listMeetups(p:MiniappPrincipal,raw:Record<string,unknown>):Promise<CommunityPage<MeetupSummary>> {
    const me=member(p), f=filters(raw)
    await this.expire(this.pool,p.storeId)
    const result=await this.pool.query<MeetupRow>(`SELECT m.* FROM miniapp_meetup m
      WHERE m.tenant_id=$1 AND m.store_id=$2
      AND ($3::text IS NULL OR ($3='owned' AND m.owner_id=$4) OR ($3='joined' AND EXISTS
        (SELECT 1 FROM miniapp_meetup_member j WHERE j.meetup_id=m.id AND j.member_id=$4)))
      AND ($5::text IS NULL OR m.data_json->>'date'=$5)
      AND ($3::text IS NOT NULL OR (m.status<>'cancelled' AND m.starts_at>CURRENT_TIMESTAMP))
      ORDER BY m.starts_at,m.id LIMIT $6 OFFSET $7`,[p.tenantId,p.storeId,f.mine??null,me,f.date??null,f.limit+1,f.offset])
    return {items:await this.views(this.pool,result.rows.slice(0,f.limit),me),hasMore:result.rows.length>f.limit}
  }

  async getMeetup(p:MiniappPrincipal,id:string):Promise<MeetupSummary> {
    const me=member(p); normalizeBoardGameId(id)
    await this.expire(this.pool,p.storeId)
    const result=await this.pool.query<MeetupRow>('SELECT * FROM miniapp_meetup WHERE id=$1 AND tenant_id=$2 AND store_id=$3',[id,p.tenantId,p.storeId])
    if (!result.rows[0]) throw new NotFoundException('约局不存在')
    return (await this.views(this.pool,result.rows,me))[0]!
  }

  async publicMeetup(storeId:string,id:string,me=''):Promise<MeetupSummary> {
    normalizeBoardGameId(storeId);normalizeBoardGameId(id)
    await this.expire(this.pool,storeId)
    const rows=await this.pool.query<MeetupRow>(`SELECT m.* FROM miniapp_meetup m
      JOIN store s ON s.id=m.store_id AND s.tenant_id=m.tenant_id
      WHERE m.id=$1 AND m.store_id=$2 AND s.status='active'`,[id,storeId])
    if(!rows.rows.length)throw new NotFoundException('约局不存在')
    return (await this.views(this.pool,rows.rows,me))[0]!
  }

  private async command<T>(p:MiniappPrincipal,raw:unknown,action:string,run:(db:PoolClient)=>Promise<T>):Promise<T> {
    const me=member(p), input=object(raw), key=requestId(input.requestId)
    const hash=createHash('sha256').update(JSON.stringify({action,input})).digest('hex')
    const db=await this.pool.connect()
    try {
      await db.query('BEGIN')
      // Serialize retries from the same actor without serializing unrelated members.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.tenantId+':'+p.storeId+':'+me])
      const active=await db.query("SELECT id FROM cloud_member WHERE id=$1 AND tenant_id=$2 AND status='active'",[me,p.tenantId])
      if (!active.rows.length) throw new ForbiddenException('会员已停用')
      const previous=await db.query<{request_hash:string;result_json:T}>(`SELECT request_hash,result_json FROM miniapp_community_event
        WHERE tenant_id=$1 AND store_id=$2 AND actor_id=$3 AND request_id=$4`,[p.tenantId,p.storeId,me,key])
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash!==hash) throw new ConflictException('请求编号已用于其他内容')
        await db.query('COMMIT'); return previous.rows[0].result_json
      }
      const result=await run(db)
      await db.query(`INSERT INTO miniapp_community_event(id,tenant_id,store_id,actor_id,request_id,request_hash,action,result_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[randomUUID(),p.tenantId,p.storeId,me,key,hash,action,JSON.stringify(result)])
      await db.query('COMMIT'); return result
    } catch(e) {await db.query('ROLLBACK').catch(()=>undefined);throw e} finally {db.release()}
  }

  createMeetup(p:MiniappPrincipal,raw:unknown):Promise<MeetupSummary> {
    return this.command(p,raw,'create-meetup',async db=>{
      const input=validateMeetup(raw), game=await this.content.getGame(p.storeId,input.gameId), store=await this.content.getStore(p.storeId)
      const id=randomUUID(),revision=randomUUID()
      const data={id,revision,game:{id:game.id,name:game.name,imageUrl:game.imageUrl},title:input.title,date:input.date,time:input.time,
        duration:input.duration,capacity:input.capacity,deadline:input.deadline,description:input.description,location:store.name,
        tags:input.friendly?['新手友好']:[],status:'open' as const}
      await db.query(`INSERT INTO miniapp_meetup(id,tenant_id,store_id,owner_id,revision,data_json,starts_at,deadline,capacity,status)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'open')`,[id,p.tenantId,p.storeId,member(p),revision,JSON.stringify(data),
        `${input.date}T${input.time}:00+08:00`,input.deadline.replace(' ','T')+':00+08:00',input.capacity])
      await db.query('INSERT INTO miniapp_meetup_member(meetup_id,member_id) VALUES($1,$2)',[id,member(p)])
      await this.notify(db,p,id,'created')
      return (await this.views(db,[{id,revision,owner_id:member(p),data_json:data,status:'open',deadline:input.deadline,capacity:input.capacity}],member(p)))[0]!
    })
  }

  actMeetup(p:MiniappPrincipal,id:string,action:'join'|'leave'|'cancel',raw:unknown):Promise<MeetupSummary> {
    normalizeBoardGameId(id)
    return this.command(p,raw,action+':'+id,async db=>{
      const result=await db.query<MeetupRow & {expired:boolean}>(`SELECT *,deadline<=CURRENT_TIMESTAMP AS expired FROM miniapp_meetup
        WHERE id=$1 AND tenant_id=$2 AND store_id=$3 FOR UPDATE`,[id,p.tenantId,p.storeId])
      const row=result.rows[0]
      if (!row) throw new NotFoundException('约局不存在')
      const clock=await db.query<{expired:boolean}>('SELECT $1::timestamptz<=clock_timestamp() AS expired',[row.deadline])
      row.expired=clock.rows[0]!.expired
      const current=(await this.views(db,[row],member(p)))[0]!
      if (action==='cancel') {
        if (!current.owned) throw new ForbiddenException('仅发起人可取消')
        row.status='cancelled'
      } else {
        if (row.status==='cancelled' || row.expired) throw new ConflictException('约局已取消或报名已截止')
        if (action==='join' && !current.joined) {
          if (current.players.length>=row.capacity) throw new ConflictException('约局已满员')
          await db.query('INSERT INTO miniapp_meetup_member(meetup_id,member_id) VALUES($1,$2)',[id,member(p)])
        }
        if (action==='leave') {
          if (current.owned) throw new BadRequestException('发起人请取消约局')
          await db.query('DELETE FROM miniapp_meetup_member WHERE meetup_id=$1 AND member_id=$2',[id,member(p)])
        }
      }
      row.revision=randomUUID()
      await db.query('UPDATE miniapp_meetup SET status=$2,revision=$3 WHERE id=$1',[id,row.status,row.revision])
      const notifyEvent=action==='cancel'?'cancelled':action==='leave'?'left':current.players.length+1>=row.capacity?'full':'joined'
      if(action==='cancel'?current.status!=='cancelled':action==='join'?!current.joined:current.joined)await this.notify(db,p,id,notifyEvent)
      return (await this.views(db,[row],member(p)))[0]!
    })
  }

  private playView(r:PlayRow,me:string):PlaySummary {
    return {...r.data_json,id:r.id,revision:r.revision,owned:r.owner_id===me,
      recordScores:r.data_json.recordScores??true,resultType:r.data_json.resultType??'ranking'}
  }
  async listPlays(p:MiniappPrincipal,raw:Record<string,unknown>):Promise<CommunityPage<PlaySummary>> {
    const me=member(p),f=filters(raw)
    const result=await this.pool.query<PlayRow>(`SELECT m.id,m.revision,m.owner_id,m.data_json FROM miniapp_play m
      JOIN miniapp_play_member j ON j.play_id=m.id AND j.member_id=$3 AND j.hidden=FALSE AND j.active=TRUE
      WHERE m.tenant_id=$1 AND m.store_id=$2 AND m.deleted_at IS NULL
      ORDER BY m.played_on DESC,m.id LIMIT $4 OFFSET $5`,[p.tenantId,p.storeId,me,f.limit+1,f.offset])
    return {items:result.rows.slice(0,f.limit).map(r=>this.playView(r,me)),hasMore:result.rows.length>f.limit}
  }
  async getPlay(p:MiniappPrincipal,id:string):Promise<PlaySummary> {
    const me=member(p);normalizeBoardGameId(id)
    const result=await this.pool.query<PlayRow>(`SELECT m.id,m.revision,m.owner_id,m.data_json FROM miniapp_play m
      JOIN miniapp_play_member j ON j.play_id=m.id AND j.member_id=$4 AND j.hidden=FALSE AND j.active=TRUE
      WHERE m.id=$1 AND m.tenant_id=$2 AND m.store_id=$3 AND m.deleted_at IS NULL`,[id,p.tenantId,p.storeId,me])
    if(!result.rows[0])throw new NotFoundException('对局不存在或无权访问')
    return this.playView(result.rows[0],me)
  }
  savePlay(p:MiniappPrincipal,raw:unknown):Promise<PlaySummary> {
    return this.command(p,raw,'save-play',async db=>{
      const input=validatePlay(raw),id=input.id??randomUUID(),revision=randomUUID()
      let previousMembers:string[]=[]
      if (input.id) {
        const existing=await db.query<PlayRow>(`SELECT revision FROM miniapp_play WHERE id=$1 AND tenant_id=$2
          AND store_id=$3 AND owner_id=$4 AND deleted_at IS NULL FOR UPDATE`,[id,p.tenantId,p.storeId,member(p)])
        if (!existing.rows[0]) throw new NotFoundException('对局不存在或无权编辑')
        if (existing.rows[0].revision!==input.expectedRevision) throw new ConflictException('对局已修改，请重新打开')
        const prior=await db.query<{member_id:string}>('SELECT member_id FROM miniapp_play_member WHERE play_id=$1 AND active=TRUE',[id])
        previousMembers=prior.rows.map(r=>r.member_id)

      }
      for(const player of input.players) {
        if(!player.memberId) {delete player.avatarUrl;continue}
        const other=player.memberId
        if(other!==member(p)&&!previousMembers.includes(other)) {
          const ids=[member(p),other].sort()
          const allowed=await db.query(`SELECT 1 FROM miniapp_friend WHERE tenant_id=$1 AND store_id=$2 AND member_low=$3 AND member_high=$4
            UNION ALL SELECT 1 FROM miniapp_table t JOIN miniapp_table_member j ON j.table_id=t.id
            WHERE t.id=$5 AND t.tenant_id=$1 AND t.store_id=$2 AND t.owner_id=$6 AND NOT t.closed
            AND t.expires_at>clock_timestamp() AND j.member_id=$7 LIMIT 1`,[p.tenantId,p.storeId,...ids,input.tableId??null,member(p),other])
          if(!allowed.rows.length)throw new ForbiddenException('关联玩家须为已确认好友或有效同桌成员')
        }
        const profile=await this.profile(db,p,other);player.name=profile.name;player.avatarUrl=profile.avatarUrl
      }
      const game=await this.content.getGame(p.storeId,input.gameId)
      const data:PlaySummary={id,revision,game:{id:game.id,name:game.name,imageUrl:game.imageUrl},date:input.date,duration:input.duration,
        mode:input.mode,players:input.players,note:input.note,visibility:input.players.some(player=>player.memberId&&player.memberId!==member(p))?'参与者':'仅自己',ranking:input.ranking,result:input.result,recordScores:input.recordScores??true,resultType:input.resultType??'ranking',owned:true}
      if (input.id) await db.query('UPDATE miniapp_play SET revision=$2,data_json=$3::jsonb,played_on=$4 WHERE id=$1',[id,revision,JSON.stringify(data),input.date])
      else await db.query(`INSERT INTO miniapp_play(id,tenant_id,store_id,owner_id,revision,data_json,played_on)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[id,p.tenantId,p.storeId,member(p),revision,JSON.stringify(data),input.date])
      const participants=[...new Set([member(p),...input.players.flatMap(p=>p.memberId?[p.memberId]:[])])]
      await db.query('UPDATE miniapp_play_member SET active=FALSE WHERE play_id=$1 AND NOT(member_id=ANY($2::uuid[]))',[id,participants])
      for(const participant of participants)await db.query('INSERT INTO miniapp_play_member(play_id,member_id) VALUES($1,$2) ON CONFLICT(play_id,member_id) DO UPDATE SET active=TRUE',[id,participant])
      return data
    })
  }
  deletePlay(p:MiniappPrincipal,id:string,raw:unknown):Promise<{deleted:true}> {
    normalizeBoardGameId(id)
    return this.command(p,raw,'delete-play:'+id,async db=>{
      const r=await db.query(`UPDATE miniapp_play_member j SET hidden=TRUE FROM miniapp_play m
        WHERE j.play_id=m.id AND m.id=$1 AND m.tenant_id=$2 AND m.store_id=$3 AND j.member_id=$4 AND j.active=TRUE AND m.deleted_at IS NULL RETURNING j.play_id`,
        [id,p.tenantId,p.storeId,member(p)])
      if(!r.rows.length)throw new NotFoundException('对局不存在或无权隐藏')
      return {deleted:true}
    })
  }
}
