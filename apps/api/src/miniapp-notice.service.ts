import {BadRequestException,ForbiddenException,Inject,Injectable,Logger,NotFoundException} from '@nestjs/common'
import type {Pool,PoolClient} from '@zyapp/cloud-db'
import type {NoticeScene,MemberNotice,SubscriptionTicket,NoticeTestRequest} from '@zyapp/contracts'
import type Redis from 'ioredis'
import {randomUUID} from 'node:crypto'
import type {MiniappPrincipal} from './miniapp-auth'
import type {ApiConfig} from './config'
import {API_CONFIG,POSTGRES_POOL,REDIS_CLIENT} from './infrastructure.module'
import {getWechatAccessToken,invalidateWechatAccessToken} from './wechat-miniapp-provider'

type DB=Pool|PoolClient
export const defaultNoticeScenes:NoticeScene[]=[
  {key:'lottery.result',title:'开奖结果提醒',description:'开奖后提醒查看结果；拒绝订阅不影响报名。',templateId:null,enabled:false,fields:{}},
  {key:'meetup.changed',title:'约局变更提醒',description:'成局、取消或时间地点变更提醒。',templateId:null,enabled:false,fields:{}},
  {key:'wallet.changed',title:'账户变动提醒',description:'消费、充值或退款提醒，每次授权对应一次发送机会。',templateId:null,enabled:false,fields:{}}
]
export function requireWorkspaceEmployee(p:MiniappPrincipal,permission:string){
  if(!p.employeeId||p.employeeStatus!=='active'||!['staff','manager'].includes(p.identity.role)||!('permissions' in p.identity)||!p.identity.permissions.includes(permission))throw new ForbiddenException('当前账号没有此员工操作权限')
  return p.employeeId
}
export function requireNoticeMember(p:MiniappPrincipal){if(!p.memberId||p.memberStatus!=='active')throw new ForbiddenException('请先注册并登录会员');return p.memberId}
export async function enqueueMemberNotice(db:DB,input:{tenantId:string;storeId:string;memberId:string;scene:string;eventKey:string;businessId:string|null;title:string;body:string;data:Record<string,string>}){
  await db.query(`INSERT INTO miniapp_notice(id,tenant_id,store_id,member_id,scene,event_key,business_id,title,body,data_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(tenant_id,store_id,member_id,event_key) DO NOTHING`,
    [randomUUID(),input.tenantId,input.storeId,input.memberId,input.scene,input.eventKey,input.businessId,input.title,input.body,JSON.stringify(input.data)])
}
export function validateNoticeScene(raw:NoticeScene):NoticeScene{
  if(!raw||!/^[-a-z0-9.]{3,60}$/.test(raw.key)||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>40||typeof raw.description!=='string'||raw.description.length>300||typeof raw.enabled!=='boolean'||(raw.templateId!==null&&(typeof raw.templateId!=='string'||!/^[-\w]{10,200}$/.test(raw.templateId)))||!raw.fields||typeof raw.fields!=='object'||Array.isArray(raw.fields))throw new BadRequestException('通知场景配置无效')
  if(Object.keys(raw.fields).length>20||Object.entries(raw.fields).some(([key,val])=>!/^\w+\d+$/.test(key)||typeof val!=='string'||!/^\w{1,40}$/.test(val)))throw new BadRequestException('模板字段须映射到业务数据字段名称')
  if(raw.enabled&&(!raw.templateId||!Object.keys(raw.fields).length))throw new BadRequestException('启用前请配置微信模板及字段映射')
  return raw
}
function sceneView(r:any):NoticeScene{return {key:r.key,title:r.title,description:r.description,templateId:r.template_id,enabled:r.enabled,fields:r.fields_json}}
function noticeId(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id??''))throw new BadRequestException('消息或订阅编号无效');return id}
function noticeView(r:any):MemberNotice{return {id:r.id,scene:r.scene,title:r.title,body:r.body,createdAt:new Date(r.created_at).toISOString(),read:!!r.read_at,delivery:r.delivery,businessId:r.business_id,test:r.data_json?.kind==='test',errorCode:r.error_code??null}}
@Injectable()
export class MiniappNoticeService{
  private timer?:ReturnType<typeof setInterval>;private running=false
  constructor(@Inject(POSTGRES_POOL) private readonly pool:Pool,@Inject(API_CONFIG) private readonly config:ApiConfig,@Inject(REDIS_CLIENT) private readonly redis:Redis){}
  onModuleInit(){this.timer=setInterval(()=>{void this.dispatch()},15000);this.timer.unref()}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
  async testNotice(p:MiniappPrincipal,input:NoticeTestRequest):Promise<MemberNotice>{
    const employeeId=requireWorkspaceEmployee(p,'transaction.read'),memberId=requireNoticeMember(p)
    if(!input||!['in_app','wechat'].includes(input.channel)||!['release','trial','develop'].includes(input.envVersion)||typeof input.scene!=='string'||!/^[-a-z0-9.]{3,60}$/.test(input.scene))throw new BadRequestException('测试参数无效')
    noticeId(input.requestId)
    const db=await this.pool.connect(),eventKey='notice.test:'+p.identityId+':'+input.requestId
    try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.identityId+':notice-test'])
      const previous=await db.query('SELECT * FROM miniapp_notice WHERE tenant_id=$1 AND store_id=$2 AND member_id=$3 AND event_key=$4',[p.tenantId,p.storeId,memberId,eventKey])
      if(previous.rows[0]){const prior=previous.rows[0];if(prior.scene!==(input.channel==='in_app'?'system.test':input.scene)||prior.data_json?.channel!==input.channel||prior.data_json?.envVersion!==input.envVersion)throw new BadRequestException('请求编号已用于其他测试');await db.query('COMMIT');return noticeView(prior)}
      const recent=await db.query(`SELECT id FROM miniapp_notice WHERE tenant_id=$1 AND store_id=$2 AND member_id=$3 AND data_json->>'kind'='test' AND created_at>clock_timestamp()-interval '1 minute' LIMIT 1`,[p.tenantId,p.storeId,memberId]);if(recent.rows.length)throw new BadRequestException('每分钟最多发送一条测试消息，请稍后重试')
      if(input.channel==='wechat'){
        const configured=(await this.scenes(p)).find(s=>s.key===input.scene&&s.enabled&&s.templateId);if(!configured)throw new BadRequestException('请先配置并启用真实微信订阅模板')
        const grant=await db.query(`SELECT id FROM miniapp_subscription_ticket WHERE tenant_id=$1 AND store_id=$2 AND identity_id=$3 AND scene=$4 AND template_id=$5 AND business_id=$6 AND result='accept' AND used_at IS NULL AND expires_at>clock_timestamp()`,[p.tenantId,p.storeId,p.identityId,input.scene,configured.templateId,input.requestId]);if(!grant.rows.length)throw new BadRequestException('请先点击订阅并允许本次微信提醒')
      }
      const now=new Date(),time=new Date(now.getTime()+8*3600000).toISOString().replace('T',' ').slice(0,19)
      await enqueueMemberNotice(db,{tenantId:p.tenantId,storeId:p.storeId,memberId,scene:input.channel==='in_app'?'system.test':input.scene,eventKey,businessId:input.requestId,title:'消息通知测试',body:'这是一条由你主动发起的测试消息，仅发送给你本人，不代表真实开奖或账户变动。',data:{kind:'test',channel:input.channel,envVersion:input.envVersion,title:'消息通知测试',result:'这是一条测试消息',body:'仅用于员工通知测试',time,status:'测试成功',amount:'0.00'}})
      if(input.channel==='in_app')await db.query("UPDATE miniapp_notice SET delivery='disabled',error_code='in_app_only' WHERE tenant_id=$1 AND store_id=$2 AND member_id=$3 AND event_key=$4",[p.tenantId,p.storeId,memberId,eventKey])
      const result=await db.query('SELECT * FROM miniapp_notice WHERE tenant_id=$1 AND store_id=$2 AND member_id=$3 AND event_key=$4',[p.tenantId,p.storeId,memberId,eventKey])
      await db.query(`INSERT INTO cloud_audit_log(id,tenant_id,store_id,actor_id,action,aggregate_type,aggregate_id,metadata_json) VALUES($1,$2,$3,$4,'notice.test_requested','miniapp_notice',$5,$6::jsonb)`,[randomUUID(),p.tenantId,p.storeId,employeeId,result.rows[0].id,JSON.stringify({identityId:p.identityId,channel:input.channel,scene:input.scene})]);await db.query('COMMIT');return noticeView(result.rows[0])
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  }
  async scenes(p:MiniappPrincipal):Promise<NoticeScene[]>{
    const r=await this.pool.query('SELECT * FROM miniapp_notice_scene WHERE tenant_id=$1 AND store_id=$2 ORDER BY key',[p.tenantId,p.storeId])
    const scenes=new Map(defaultNoticeScenes.map(s=>[s.key,s]));for(const row of r.rows)scenes.set(row.key,sceneView(row));return [...scenes.values()]
  }
  async save(p:MiniappPrincipal,raw:NoticeScene){
    requireWorkspaceEmployee(p,'activity.manage');const c=validateNoticeScene(raw)
    const db=await this.pool.connect();try{await db.query('BEGIN');await db.query(`INSERT INTO miniapp_notice_scene(tenant_id,store_id,key,title,description,template_id,enabled,fields_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(tenant_id,store_id,key) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,template_id=EXCLUDED.template_id,enabled=EXCLUDED.enabled,fields_json=EXCLUDED.fields_json,updated_at=clock_timestamp()`,[p.tenantId,p.storeId,c.key,c.title,c.description,c.templateId,c.enabled,JSON.stringify(c.fields)])
      await db.query(`INSERT INTO cloud_audit_log(id,tenant_id,store_id,actor_id,action,aggregate_type,aggregate_id,metadata_json) VALUES($1,$2,$3,$4,'notice.scene_updated','notice_scene',$5,$6::jsonb)`,[randomUUID(),p.tenantId,p.storeId,p.employeeId,c.key,JSON.stringify(c)])
      await db.query('COMMIT')
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  }
  async prepare(p:MiniappPrincipal,key:string,businessId?:string):Promise<SubscriptionTicket|null>{
    requireNoticeMember(p)
    if(businessId&&!/^[a-f0-9-]{36}$/i.test(businessId))throw new BadRequestException('业务编号无效')
    const scene=(await this.scenes(p)).find(s=>s.key===key&&s.enabled&&s.templateId);if(!scene?.templateId)return null
    const id=randomUUID()
    const r=await this.pool.query(`INSERT INTO miniapp_subscription_ticket(id,tenant_id,store_id,identity_id,scene,template_id,business_id,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '10 minutes' WHERE
      (SELECT count(*) FROM miniapp_subscription_ticket WHERE identity_id=$4 AND created_at>clock_timestamp()-interval '1 minute')<10 RETURNING id`,[id,p.tenantId,p.storeId,p.identityId,key,scene.templateId,businessId??null])
    return r.rows.length?{id,scene:key,templateId:scene.templateId,title:scene.title}:null
  }
  async receipt(p:MiniappPrincipal,id:string,result:string){
    noticeId(id)
    if(!['accept','reject','ban','filter','fail'].includes(result))throw new BadRequestException('订阅结果无效')
    const updated=await this.pool.query(`UPDATE miniapp_subscription_ticket SET result=$1,expires_at=clock_timestamp()+interval '180 days'
      WHERE id=$2 AND tenant_id=$3 AND store_id=$4 AND identity_id=$5 AND result IS NULL AND expires_at>clock_timestamp() RETURNING id`,[result,id,p.tenantId,p.storeId,p.identityId])
    if(!updated.rows.length){const prior=await this.pool.query('SELECT result FROM miniapp_subscription_ticket WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND identity_id=$4',[id,p.tenantId,p.storeId,p.identityId]);if(prior.rows[0]?.result!==result)throw new BadRequestException('订阅凭证已失效，请重新点击开启提醒')}
  }
  async list(p:MiniappPrincipal,offset=0){const member=requireNoticeMember(p);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new BadRequestException('分页无效')
    const r=await this.pool.query(`SELECT * FROM miniapp_notice WHERE tenant_id=$1 AND store_id=$2 AND member_id=$3 ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET $4`,[p.tenantId,p.storeId,member,offset]);return {items:r.rows.slice(0,30).map(noticeView),hasMore:r.rows.length>30}}
  async read(p:MiniappPrincipal,id:string){noticeId(id);const member=requireNoticeMember(p);const r=await this.pool.query(`UPDATE miniapp_notice SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND member_id=$4 RETURNING *`,[id,p.tenantId,p.storeId,member]);if(!r.rows[0])throw new NotFoundException('消息不存在');return noticeView(r.rows[0])}
  async dispatch(){
    if(this.running)return;this.running=true
    try{
      // A crash or network timeout may have delivered a message: do not blindly resend.
      await this.pool.query("UPDATE miniapp_notice SET delivery='uncertain',error_code='worker_interrupted' WHERE delivery='sending' AND sending_at<clock_timestamp()-interval '2 minutes'")
      for(let n=0;n<20;n++){const job=await this.claim();if(!job)break;await this.send(job)}
    }catch{new Logger(MiniappNoticeService.name).error('Notice delivery sweep failed; retrying next interval')}finally{this.running=false}
  }
  private async claim():Promise<any|null>{
    const db=await this.pool.connect();try{
      await db.query('BEGIN');const r=await db.query(`SELECT * FROM miniapp_notice WHERE delivery='pending' AND next_attempt_at<=clock_timestamp() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);const job=r.rows[0];if(!job){await db.query('COMMIT');return null}
      const c=await db.query('SELECT * FROM miniapp_notice_scene WHERE tenant_id=$1 AND store_id=$2 AND key=$3',[job.tenant_id,job.store_id,job.scene]);const scene=c.rows[0]
      if(!scene?.enabled||!scene.template_id){await db.query("UPDATE miniapp_notice SET delivery='disabled' WHERE id=$1",[job.id]);await db.query('COMMIT');return {skip:true}}
      const tickets=await db.query(`SELECT t.id,i.provider_subject FROM miniapp_subscription_ticket t JOIN miniapp_identity i ON i.id=t.identity_id
        JOIN cloud_member m ON m.id=i.member_id AND m.tenant_id=i.tenant_id
        WHERE t.tenant_id=$1 AND t.store_id=$2 AND i.tenant_id=$1 AND i.store_id=$2 AND i.member_id=$3 AND i.status='active' AND m.status='active'
        AND i.provider='wechat' AND i.provider_subject LIKE 'openid:%' AND t.scene=$4 AND t.template_id=$5 AND t.result='accept' AND t.used_at IS NULL
        AND t.expires_at>clock_timestamp() AND (t.business_id IS NULL OR t.business_id=$6)
        ORDER BY (t.business_id IS NOT NULL) DESC,t.created_at LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,[job.tenant_id,job.store_id,job.member_id,job.scene,scene.template_id,job.business_id]);const ticket=tickets.rows[0]
      if(!ticket){await db.query("UPDATE miniapp_notice SET delivery='unsubscribed' WHERE id=$1",[job.id]);await db.query('COMMIT');return {skip:true}}
      await db.query('UPDATE miniapp_subscription_ticket SET used_at=clock_timestamp() WHERE id=$1',[ticket.id])
      await db.query("UPDATE miniapp_notice SET delivery='sending',sending_at=clock_timestamp(),attempts=attempts+1 WHERE id=$1",[job.id]);await db.query('COMMIT');return {...job,sceneConfig:scene,ticket}
    }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  }
  private async send(job:any){
    if(job.skip)return
    let token:string;try{token=await getWechatAccessToken(this.config,this.redis)}catch{
      // Token retrieval precedes sending and can safely be retried with the same grant.
      await this.retry(job,'token_unavailable');return
    }
    const data:Record<string,{value:string}>={}
    for(const [field,key] of Object.entries(job.sceneConfig.fields_json as Record<string,string>))data[field]={value:String(job.data_json[key]??'')}
    let status='uncertain',code='network_unknown'
    try{
      const state=job.data_json.kind==='test'?({release:'formal',trial:'trial',develop:'developer'}[job.data_json.envVersion as 'release'|'trial'|'develop']??'formal'):'formal'
      const response=await fetch('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({touser:job.ticket.provider_subject.slice(7),template_id:job.sceneConfig.template_id,page:'pages/messages/index?id='+job.id,data,miniprogram_state:state,lang:'zh_CN'})})
      if(response.ok){const payload=await response.json() as {errcode?:number};if(typeof payload.errcode==='number'){code=String(payload.errcode);status=payload.errcode===0?'sent':payload.errcode===43101?'unsubscribed':'failed'}}
    }catch{}
    if(['-1','40001','42001','45009','45011'].includes(code)){
      if(code==='40001'||code==='42001')await invalidateWechatAccessToken(this.config,this.redis)
      await this.retry(job,code);return
    }
    await this.pool.query('UPDATE miniapp_notice SET delivery=$2,error_code=$3 WHERE id=$1',[job.id,status,code])
  }
  private async retry(job:any,code:string){
    const db=await this.pool.connect();try{await db.query('BEGIN');await db.query('UPDATE miniapp_subscription_ticket SET used_at=NULL WHERE id=$1',[job.ticket.id]);await db.query(`UPDATE miniapp_notice SET delivery=$2,next_attempt_at=clock_timestamp()+interval '5 minutes',error_code=$3 WHERE id=$1`,[job.id,job.attempts>=4?'failed':'pending',code]);await db.query('COMMIT')}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
  }
}
