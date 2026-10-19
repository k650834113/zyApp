import {BadRequestException,ConflictException,Inject,Injectable,NotFoundException} from '@nestjs/common'
import {randomBytes,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from '@zyapp/cloud-db'
import type {LotteryWorkspace,RegistrationBatch,LotteryAdmission,TransactionFilters,StaffTransaction} from '@zyapp/contracts'
import type Redis from 'ioredis'
import type {ApiConfig} from './config'
import type {MiniappPrincipal} from './miniapp-auth'
import {API_CONFIG,POSTGRES_POOL,REDIS_CLIENT} from './infrastructure.module'
import {requireWorkspaceEmployee,requireNoticeMember} from './miniapp-notice.service'
import {registerLotteryEntry,requireRegistrationWindow,setLotteryEntryStatus} from './activity-lottery-rules'
import {createCommunityMiniappCode} from './wechat-miniapp-provider'

function uuid(value:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value??''))throw new BadRequestException('编号无效');return value}
function businessError(e:unknown):never{throw new BadRequestException(e instanceof Error?e.message:'报名操作失败')}
function safeFen(value:unknown){const fen=Number(value);if(!Number.isSafeInteger(fen))throw new Error('交易金额超出安全整数范围');return fen}
export function transactionRange(filters:TransactionFilters){
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  const to=filters.toDate??today,from=filters.fromDate??new Date(Date.now()+8*3600000-29*86400000).toISOString().slice(0,10)
  for(const date of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new BadRequestException('日期无效')
  if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new BadRequestException('日期范围最多一年，开始不得晚于结束')
  const kind=filters.kind??'',query=(filters.query??'').trim(),offset=filters.offset??0
  if(!['','consumption','recharge','monthly_card','refund'].includes(kind)||query.length>80||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new BadRequestException('查询条件无效')
  return {from:from+'T00:00:00+08:00',to:new Date(Date.parse(to+'T00:00:00+08:00')+86400000).toISOString(),kind,query,offset}
}
@Injectable()
export class StaffWorkspaceService{
  constructor(@Inject(POSTGRES_POOL) private readonly pool:Pool,@Inject(API_CONFIG) private readonly config:ApiConfig,@Inject(REDIS_CLIENT) private readonly redis:Redis){}
  async activities(p:MiniappPrincipal){requireWorkspaceEmployee(p,'activity.registration.manage');const r=await this.pool.query(`SELECT a.activity_id AS id,c.title,a.state_json->'config'->>'drawAt' AS "drawAt" FROM activity_lottery a JOIN cloud_activity_campaign c ON c.id=a.activity_id AND c.tenant_id=a.tenant_id AND c.store_id=a.store_id WHERE a.tenant_id=$1 AND a.store_id=$2 ORDER BY a.updated_at DESC LIMIT 100`,[p.tenantId,p.storeId]);return r.rows}
  private async audit(db:PoolClient,p:MiniappPrincipal,action:string,id:string,data:unknown){await db.query(`INSERT INTO cloud_audit_log(id,tenant_id,store_id,actor_id,action,aggregate_type,aggregate_id,metadata_json) VALUES($1,$2,$3,$4,$5,'lottery_batch',$6,$7::jsonb)`,[randomUUID(),p.tenantId,p.storeId,p.employeeId,action,id,JSON.stringify(data)])}
  private async state(db:Pool|PoolClient,p:MiniappPrincipal,activity:string):Promise<LotteryWorkspace>{const r=await db.query<{state_json:LotteryWorkspace}>('SELECT state_json FROM activity_lottery WHERE activity_id=$1 AND tenant_id=$2 AND store_id=$3',[activity,p.tenantId,p.storeId]);if(!r.rows[0])throw new NotFoundException('抽奖活动不存在');return r.rows[0].state_json}
  private async lock(db:PoolClient,p:MiniappPrincipal,activity:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.tenantId+':'+p.storeId+':lottery:'+activity])}
  private async clock(db:PoolClient){const r=await db.query<{now:Date}>('SELECT clock_timestamp() AS now');return new Date(r.rows[0]!.now).getTime()}
  async createBatch(p:MiniappPrincipal,input:{requestId:string;activityId:string;capacity:number;envVersion:'release'|'trial'|'develop'}):Promise<RegistrationBatch>{
    const actor=requireWorkspaceEmployee(p,'activity.registration.manage')
    if(!input||!Number.isSafeInteger(input.capacity)||input.capacity<1||input.capacity>100||!/^[-\w:]{8,100}$/.test(input.requestId??'')||!['release','trial','develop'].includes(input.envVersion))throw new BadRequestException('请填写1至100人的名额及有效请求编号')
    uuid(input.activityId);const db=await this.pool.connect();let batch:any
    try{await db.query('BEGIN');await this.lock(db,p,input.activityId)
      const existing=await db.query('SELECT * FROM miniapp_registration_batch WHERE tenant_id=$1 AND store_id=$2 AND actor_id=$3 AND request_id=$4',[p.tenantId,p.storeId,actor,input.requestId]);batch=existing.rows[0]
      if(batch){if(batch.activity_id!==input.activityId||batch.capacity!==input.capacity||batch.env_version!==input.envVersion)throw new ConflictException('请求编号已用于其他报名码')}
      else{
        const state=await this.state(db,p,input.activityId),now=await this.clock(db);try{requireRegistrationWindow(state,now)}catch(e){businessError(e)}
        await db.query('UPDATE miniapp_registration_batch SET revoked_at=clock_timestamp() WHERE tenant_id=$1 AND store_id=$2 AND actor_id=$3 AND activity_id=$4 AND revoked_at IS NULL',[p.tenantId,p.storeId,actor,input.activityId])
        const r=await db.query(`INSERT INTO miniapp_registration_batch(id,tenant_id,store_id,activity_id,actor_id,request_id,capacity,scene,env_version,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),p.tenantId,p.storeId,input.activityId,actor,input.requestId,input.capacity,'l'+randomBytes(15).toString('hex'),input.envVersion,new Date(Math.min(now+30*60000,Date.parse(state.config!.closesAt))).toISOString()]);batch=r.rows[0]
        await this.audit(db,p,'lottery.batch_created',batch.id,{capacity:input.capacity,activityId:input.activityId,expiresAt:batch.expires_at})
      }await db.query('COMMIT')
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
    return this.batchCode(p,batch.id)
  }
  async batchCode(p:MiniappPrincipal,id:string):Promise<RegistrationBatch>{
    requireWorkspaceEmployee(p,'activity.registration.manage');uuid(id)
    const r=await this.pool.query('SELECT * FROM miniapp_registration_batch WHERE id=$1 AND tenant_id=$2 AND store_id=$3',[id,p.tenantId,p.storeId]);const batch=r.rows[0]
    if(!batch)throw new NotFoundException('报名码不存在');if(batch.revoked_at||new Date(batch.expires_at).getTime()<=Date.now())throw new BadRequestException('报名码已过期或作废，请重新生成')
    const value=(await this.batches(p,batch.activity_id)).find(b=>b.id===batch.id);if(!value)throw new NotFoundException('报名码不在近期列表中，请重新生成')
    return {...value,image:await createCommunityMiniappCode(this.config,this.redis,batch.scene,batch.env_version,'pages/lottery-register/index')}
  }
  async batches(p:MiniappPrincipal,activityId:string):Promise<RegistrationBatch[]>{
    requireWorkspaceEmployee(p,'activity.registration.manage');uuid(activityId);const state=await this.state(this.pool,p,activityId)
    const r=await this.pool.query(`SELECT b.*,c.title FROM miniapp_registration_batch b JOIN cloud_activity_campaign c ON c.id=b.activity_id WHERE b.tenant_id=$1 AND b.store_id=$2 AND b.activity_id=$3 ORDER BY b.created_at DESC LIMIT 30`,[p.tenantId,p.storeId,activityId]);if(!r.rows.length)return []
    const admissions=await this.pool.query(`SELECT * FROM miniapp_registration_admission WHERE batch_id=ANY($1::uuid[])`,[r.rows.map(b=>b.id)])
    const now=Date.now();return r.rows.map(b=>{
      const rows=admissions.rows.filter(a=>a.batch_id===b.id),ids=new Set(rows.map(a=>a.entry_id)),entries=state.entries.filter(e=>ids.has(e.id))
      return {id:b.id,activityId:b.activity_id,title:b.title,capacity:b.capacity,registered:entries.filter(e=>e.active).length,reserved:rows.filter(a=>!a.entry_id&&!a.cancelled_at&&new Date(a.expires_at).getTime()>now&&!b.revoked_at).length,expiresAt:new Date(b.expires_at).toISOString(),revoked:!!b.revoked_at,scene:b.scene,entries:entries.map(e=>({id:e.id,name:e.name,memberNumber:e.memberNumber,createdAt:e.createdAt,active:e.active}))}
    })
  }
  async revoke(p:MiniappPrincipal,id:string){requireWorkspaceEmployee(p,'activity.registration.manage');uuid(id);const db=await this.pool.connect();try{await db.query('BEGIN');const r=await db.query(`UPDATE miniapp_registration_batch SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND tenant_id=$2 AND store_id=$3 RETURNING id`,[id,p.tenantId,p.storeId]);if(!r.rows.length)throw new NotFoundException('报名码不存在');await this.audit(db,p,'lottery.batch_revoked',id,{});await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
  async cancel(p:MiniappPrincipal,id:string,entryId:string,reason:string){
    const actor=requireWorkspaceEmployee(p,'activity.registration.manage');uuid(id);uuid(entryId)
    const db=await this.pool.connect();try{await db.query('BEGIN');const b=await db.query('SELECT * FROM miniapp_registration_batch WHERE id=$1 AND tenant_id=$2 AND store_id=$3',[id,p.tenantId,p.storeId]);const batch=b.rows[0];if(!batch)throw new NotFoundException('报名码不存在');await this.lock(db,p,batch.activity_id)
      const admissions=await db.query('SELECT id FROM miniapp_registration_admission WHERE batch_id=$1 AND entry_id=$2',[id,entryId]);if(!admissions.rows.length)throw new NotFoundException('报名记录不属于此报名码')
      const state=await this.state(db,p,batch.activity_id);try{setLotteryEntryStatus(state,entryId,false,reason,actor,await this.clock(db))}catch(e){businessError(e)}
      state.revision=randomUUID();await db.query('UPDATE activity_lottery SET state_json=$1::jsonb,updated_at=clock_timestamp() WHERE activity_id=$2',[JSON.stringify(state),batch.activity_id]);await db.query('UPDATE miniapp_registration_admission SET cancelled_at=clock_timestamp() WHERE batch_id=$1 AND entry_id=$2',[id,entryId]);await this.audit(db,p,'lottery.entry_cancelled',id,{entryId,reason});await db.query('COMMIT')
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  }
  private async batchForScene(db:Pool|PoolClient,p:MiniappPrincipal,scene:string){if(!/^l[a-f0-9]{30}$/.test(scene??''))throw new BadRequestException('报名码无效');const r=await db.query('SELECT b.*,c.title FROM miniapp_registration_batch b JOIN cloud_activity_campaign c ON c.id=b.activity_id WHERE b.scene=$1 AND b.tenant_id=$2 AND b.store_id=$3',[scene,p.tenantId,p.storeId]);if(!r.rows[0])throw new NotFoundException('报名码不存在或不属于当前门店');return r.rows[0]}
  private admissionView(state:LotteryWorkspace,batch:any,registered:boolean,memberId:string|null,expiresAt:string):LotteryAdmission{return {activityId:state.activityId,title:batch.title,rules:state.config?.rules??'',drawAt:state.config?.drawAt??'',expiresAt,registered,result:state.result?{drawnAt:state.result.drawnAt,prizes:state.result.prizes.filter(prize=>prize.winners.some(w=>w.memberId===memberId)).map(prize=>prize.name)}:null}}
  async admission(p:MiniappPrincipal,scene:string,confirm=false):Promise<LotteryAdmission>{
    if(confirm)requireNoticeMember(p)
    const db=await this.pool.connect();try{
      await db.query('BEGIN');const b=await this.batchForScene(db,p,scene);await this.lock(db,p,b.activity_id)
      const locked=await db.query('SELECT * FROM miniapp_registration_batch WHERE id=$1 FOR UPDATE',[b.id]);const batch={...b,...locked.rows[0]},state=await this.state(db,p,b.activity_id),now=await this.clock(db)
      const already=!!p.memberId&&state.entries.some(e=>e.memberId===p.memberId&&e.active)
      if(already){await db.query('UPDATE miniapp_registration_admission SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()) WHERE batch_id=$1 AND identity_id=$2 AND entry_id IS NULL',[batch.id,p.identityId]);await db.query('COMMIT');return this.admissionView(state,batch,true,p.memberId,new Date(batch.expires_at).toISOString())}
      if(batch.revoked_at)throw new BadRequestException('报名码已作废，请联系工作人员')
      try{requireRegistrationWindow(state,now)}catch(e){businessError(e)}
      const prior=await db.query('SELECT * FROM miniapp_registration_admission WHERE batch_id=$1 AND identity_id=$2',[batch.id,p.identityId]);let admission=prior.rows[0]
      if(admission?.entry_id)throw new BadRequestException('本次报名已被取消，请联系工作人员')
      if(admission?.cancelled_at)throw new BadRequestException('报名凭证已取消，请联系工作人员')
      if(!admission||new Date(admission.expires_at).getTime()<=now){
        if(new Date(batch.expires_at).getTime()<=now)throw new BadRequestException('报名码已过期，请联系工作人员重新生成')
        const usage=await db.query(`SELECT entry_id,expires_at,cancelled_at FROM miniapp_registration_admission WHERE batch_id=$1`,[batch.id]);const active=new Set(state.entries.filter(e=>e.active).map(e=>e.id))
        const occupied=usage.rows.filter(a=>a.entry_id?active.has(a.entry_id):!a.cancelled_at&&new Date(a.expires_at).getTime()>now&&(!admission||a!==admission))
        if(occupied.length>=batch.capacity)throw new BadRequestException('本批报名名额已满，请联系工作人员')
        const expires=new Date(Math.min(now+10*60000,Date.parse(state.config!.closesAt))).toISOString()
        const r=await db.query(`INSERT INTO miniapp_registration_admission(id,batch_id,identity_id,expires_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(batch_id,identity_id) DO UPDATE SET expires_at=EXCLUDED.expires_at RETURNING *`,[randomUUID(),batch.id,p.identityId,expires]);admission=r.rows[0]
      }
      if(confirm){
        const m=await db.query('SELECT id,member_number,nickname,phone FROM cloud_member WHERE id=$1 AND tenant_id=$2 AND status=\'active\' FOR SHARE',[p.memberId,p.tenantId]);const member=m.rows[0];if(!member)throw new BadRequestException('会员身份无效')
        try{registerLotteryEntry(state,{memberId:member.id,memberNumber:member.member_number,name:member.nickname,phone:member.phone},batch.actor_id,now)}catch(e){businessError(e)}
        state.revision=randomUUID();const entry=state.entries.at(-1)!
        await db.query('UPDATE activity_lottery SET state_json=$1::jsonb,updated_at=clock_timestamp() WHERE activity_id=$2',[JSON.stringify(state),batch.activity_id]);await db.query('UPDATE miniapp_registration_admission SET member_id=$1,entry_id=$2 WHERE id=$3',[p.memberId,entry.id,admission.id])
        await this.audit(db,{...p,employeeId:batch.actor_id},'lottery.member_registered',batch.id,{entryId:entry.id,memberId:p.memberId,identityId:p.identityId})
      }
      await db.query('COMMIT');return this.admissionView(state,batch,confirm,p.memberId,new Date(admission.expires_at).toISOString())
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  }
  async result(p:MiniappPrincipal,activityId:string){const member=requireNoticeMember(p);uuid(activityId);const state=await this.state(this.pool,p,activityId);if(!state.entries.some(e=>e.memberId===member&&e.active)&&!state.result?.entries.some(e=>e.memberId===member))throw new NotFoundException('你尚未报名此活动');const r=await this.pool.query('SELECT title FROM cloud_activity_campaign WHERE id=$1',[activityId]);return this.admissionView(state,{title:r.rows[0]?.title??'抽奖活动'},true,member,'')}
  async transactions(p:MiniappPrincipal,filters:TransactionFilters):Promise<{items:StaffTransaction[];hasMore:boolean}>{
    requireWorkspaceEmployee(p,'transaction.read');const f=transactionRange(filters)
    const r=await this.pool.query(`WITH transactions AS (
      SELECT 'order:'||s.id AS id,'consumption' AS kind,COALESCE(s.customer_member_id,s.wallet_member_id) AS member_id,s.completed_at AS occurred_at,
        COALESCE((SELECT string_agg(i.item_name||' ×'||i.quantity::text,'、' ORDER BY i.id) FROM cloud_sales_order_item i WHERE i.order_id=s.id AND i.tenant_id=s.tenant_id AND i.store_id=s.store_id),'消费订单') AS title,
        s.total_fen AS amount_fen,0::bigint AS gift_fen,s.status,s.order_number AS business_number,COALESCE(s.note,'') AS details
      FROM cloud_sales_order s WHERE s.tenant_id=$1 AND s.store_id=$2
      UNION ALL SELECT 'wechat-recharge:'||r.id,'recharge',r.member_id,COALESCE(r.settled_at,r.created_at),'微信充值',r.principal_fen,r.gift_fen,r.status,r.out_trade_no,'实付与赠送分别展示'
      FROM wechat_recharge_order r WHERE r.tenant_id=$1 AND r.store_id=$2
      UNION ALL SELECT 'cash-recharge:'||l.operation_id,'recharge',l.member_id,l.occurred_at,CASE WHEN l.event_type='wallet.cash_recharged' THEN '线下充值' ELSE '线下充值冲正' END,
        abs(l.principal_delta_fen),abs(l.gift_delta_fen),CASE WHEN l.event_type='wallet.cash_recharged' THEN 'settled' ELSE 'reversed' END,NULL,COALESCE(l.reason,'')
      FROM cloud_wallet_ledger l WHERE l.tenant_id=$1 AND l.store_id=$2 AND l.event_type IN ('wallet.cash_recharged','wallet.cash_recharge_reversed')
      UNION ALL SELECT 'monthly:'||e.operation_id,'monthly_card',e.member_id,e.occurred_at,c.plan_name||' · '||e.event_type,
        CASE WHEN e.event_type IN ('purchased','renewed') THEN COALESCE((e.payload_json->>'priceFen')::bigint,c.price_fen) ELSE 0 END,0,e.event_type,NULL,COALESCE(e.reason,'')
      FROM cloud_monthly_card_event e JOIN cloud_monthly_card c ON c.id=e.card_id AND c.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1 AND e.store_id=$2 AND e.event_type NOT IN ('snapshot','refunded')
      UNION ALL SELECT 'refund:'||r.id,'refund',COALESCE(s.customer_member_id,r.wallet_member_id),COALESCE(r.completed_at,r.requested_at),'消费退款',r.total_fen,0,r.status,r.refund_number,'原订单：'||r.order_number
      FROM cloud_refund_request r LEFT JOIN cloud_sales_order s ON s.id=r.order_id AND s.tenant_id=r.tenant_id AND s.store_id=r.store_id WHERE r.tenant_id=$1 AND r.store_id=$2
      UNION ALL SELECT 'financial-refund:'||r.id,'refund',r.member_id,COALESCE(r.completed_at,r.requested_at),CASE WHEN r.target_type='monthly_card' THEN '月卡退款' ELSE '充值退款' END,r.refund_principal_fen,r.reclaim_gift_fen,r.status,r.request_number,'赠送金额为收回赠送余额'
      FROM cloud_financial_refund_request r WHERE r.tenant_id=$1 AND r.store_id=$2
    ) SELECT t.*,m.nickname,m.member_number FROM transactions t LEFT JOIN cloud_member m ON m.id=t.member_id AND m.tenant_id=$1
      WHERE t.occurred_at >= $3::timestamptz AND t.occurred_at < $4::timestamptz AND ($5='' OR t.kind=$5)
      AND ($6='' OR strpos(COALESCE(m.nickname,'')||' '||COALESCE(m.phone,'')||' '||COALESCE(m.member_number,''),$6)>0)
      ORDER BY t.occurred_at DESC,t.id DESC LIMIT 31 OFFSET $7`,[p.tenantId,p.storeId,f.from,f.to,f.kind,f.query,f.offset])
    const items:StaffTransaction[]=r.rows.slice(0,30).map(t=>({id:t.id,kind:t.kind,memberName:t.nickname??'散客',memberNumber:t.member_number??null,occurredAt:new Date(t.occurred_at).toISOString(),title:t.title,amountFen:safeFen(t.amount_fen),giftFen:safeFen(t.gift_fen),status:t.status,businessNumber:t.business_number,details:t.details}));return {items,hasMore:r.rows.length>30}
  }
}
