import {BadRequestException,ConflictException,ForbiddenException,Inject,Injectable,NotFoundException} from '@nestjs/common'
import {createHash,randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from '@zyapp/cloud-db'
import type {LotteryWorkspace,LotteryMember} from '@zyapp/contracts'
import type {DevicePrincipal} from './device-auth'
import {POSTGRES_POOL} from './infrastructure.module'
import {normalizeBoardGameId} from './board-game-library'
import {configureLottery,registerLotteryEntry,setLotteryEntryStatus,drawLottery} from './activity-lottery-rules'

type DB=Pool|PoolClient
@Injectable()
export class ActivityLotteryService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool:Pool){}
  private async authorize(db:DB,p:DevicePrincipal,actorId:string,activityId:string,manager=false){
    normalizeBoardGameId(actorId);normalizeBoardGameId(activityId)
    const access=await db.query<{role:string}>(`SELECT a.role FROM cloud_employee e
      JOIN cloud_employee_store_access a ON a.employee_id=e.id AND a.tenant_id=e.tenant_id
      JOIN store s ON s.id=a.store_id AND s.tenant_id=a.tenant_id
      WHERE e.id=$1 AND e.tenant_id=$2 AND a.store_id=$3 AND e.status='active' AND a.status='active' AND s.status='active'`,[actorId,p.tenantId,p.storeId])
    if(!access.rows.length||(manager&&access.rows[0]?.role!=='manager'))throw new ForbiddenException('没有此活动的操作权限')
    const activity=await db.query('SELECT id FROM cloud_activity_campaign WHERE id=$1 AND tenant_id=$2 AND store_id=$3',[activityId,p.tenantId,p.storeId])
    if(!activity.rows.length)throw new NotFoundException('活动尚未同步至云端或不存在，请先同步活动')
  }
  private async state(db:DB,p:DevicePrincipal,activityId:string):Promise<LotteryWorkspace>{
    const r=await db.query<{state_json:LotteryWorkspace}>('SELECT state_json FROM activity_lottery WHERE activity_id=$1 AND tenant_id=$2 AND store_id=$3',[activityId,p.tenantId,p.storeId])
    return r.rows[0]?.state_json??{activityId,revision:null,rulesLocked:false,config:null,entries:[],result:null}
  }
  async read(p:DevicePrincipal,actorId:string,activityId:string){await this.authorize(this.pool,p,actorId,activityId);return this.state(this.pool,p,activityId)}
  async findMember(p:DevicePrincipal,actorId:string,activityId:string,phone:string):Promise<LotteryMember|null>{
    await this.authorize(this.pool,p,actorId,activityId)
    if(!/^1[3-9]\d{9}$/.test(phone))throw new BadRequestException('请输入完整会员手机号')
    const r=await this.pool.query<{id:string;member_number:string;nickname:string;phone:string}>(`SELECT id,member_number,nickname,phone FROM cloud_member WHERE tenant_id=$1 AND phone=$2 AND status='active'`,[p.tenantId,phone])
    const m=r.rows[0];return m?{memberId:m.id,memberNumber:m.member_number,name:m.nickname,phone:m.phone}:null
  }
  async execute(p:DevicePrincipal,actorId:string,raw:unknown):Promise<LotteryWorkspace>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new BadRequestException('请求无效')
    const v=raw as Record<string,unknown>,activityId=typeof v.activityId==='string'?v.activityId:'',action=v.action
    if(!['configure','register','entry-status','draw'].includes(String(action))||typeof v.requestId!=='string'||v.requestId.length<8||v.requestId.length>100)throw new BadRequestException('操作或请求编号无效')
    normalizeBoardGameId(activityId)
    const hash=createHash('sha256').update(JSON.stringify(v)).digest('hex'),db=await this.pool.connect()
    try{
      await db.query('BEGIN')
      // Lock both the idempotency key and the activity, including its first configuration.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.tenantId+':'+p.storeId+':lottery-request:'+v.requestId])
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.tenantId+':'+p.storeId+':lottery:'+activityId])
      await this.authorize(db,p,actorId,activityId,action==='configure'||action==='draw')
      const previous=await db.query<{request_hash:string;actor_id:string;result_json:unknown}>('SELECT request_hash,actor_id,result_json FROM activity_lottery_event WHERE tenant_id=$1 AND store_id=$2 AND request_id=$3',[p.tenantId,p.storeId,v.requestId])
      if(previous.rows[0]){
        if(previous.rows[0].request_hash!==hash||previous.rows[0].actor_id!==actorId)throw new ConflictException('请求编号已用于其他操作')
        const latest=await this.state(db,p,activityId);await db.query('COMMIT');return latest
      }
      const state=await this.state(db,p,activityId)
      if(action==='draw'&&state.result){await db.query('COMMIT');return state}
      if(state.revision!==v.expectedRevision)throw new ConflictException('活动报名已更新，请刷新后重试')
      if(state.result)throw new ConflictException('已开奖，名单与配置不可修改')
      const clock=await db.query<{now:Date}>('SELECT clock_timestamp() AS now');const now=new Date(clock.rows[0]!.now).getTime()
      try{
        if(action==='configure')configureLottery(state,v.config,now)
        else if(action==='register'){
          const id=normalizeBoardGameId(v.memberId)
          const r=await db.query<{id:string;member_number:string;nickname:string;phone:string}>(`SELECT id,member_number,nickname,phone FROM cloud_member WHERE id=$1 AND tenant_id=$2 AND status='active' FOR SHARE`,[id,p.tenantId])
          const m=r.rows[0];if(!m)throw new Error('会员不存在或已停用')
          const registrationClock=await db.query<{now:Date}>('SELECT clock_timestamp() AS now')
          registerLotteryEntry(state,{memberId:m.id,memberNumber:m.member_number,name:m.nickname,phone:m.phone},actorId,new Date(registrationClock.rows[0]!.now).getTime())
        }else if(action==='entry-status')setLotteryEntryStatus(state,String(v.entryId),v.active as boolean,v.reason as string,actorId,now)
        else drawLottery(state,actorId,now)
      }catch(e){throw new BadRequestException(e instanceof Error?e.message:'抽奖操作失败')}
      state.revision=randomUUID()
      const drawn=state.result as LotteryWorkspace['result']
      if(action==='draw'&&drawn){
        const recipients=[...new Set(drawn.entries.map(e=>e.memberId))].map(memberId=>{
          const prizes=drawn.prizes.filter(prize=>prize.winners.some(w=>w.memberId===memberId)).map(prize=>prize.name)
          const result=prizes.length?'恭喜中奖：'+prizes.join('、'):'本次未中奖，感谢参与'
          return {id:randomUUID(),memberId,title:'开奖结果已公布',body:result+'。请进入活动结果页查看，中奖者请联系门店领取。',data:{title:'开奖结果已公布',result:result.slice(0,20),body:result,time:new Date(now+8*3600000).toISOString().replace('T',' ').slice(0,19)}}
        })
        await db.query(`INSERT INTO miniapp_notice(id,tenant_id,store_id,member_id,scene,event_key,business_id,title,body,data_json)
          SELECT (r->>'id')::uuid,$1,$2,(r->>'memberId')::uuid,'lottery.result',$3,$4,r->>'title',r->>'body',r->'data'
          FROM jsonb_array_elements($5::jsonb) r ON CONFLICT(tenant_id,store_id,member_id,event_key) DO NOTHING`,[p.tenantId,p.storeId,'lottery.result:'+activityId,activityId,JSON.stringify(recipients)])
      }
      await db.query(`INSERT INTO activity_lottery(activity_id,tenant_id,store_id,state_json) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(activity_id) DO UPDATE SET state_json=EXCLUDED.state_json,updated_at=clock_timestamp()`,[activityId,p.tenantId,p.storeId,JSON.stringify(state)])
      await db.query(`INSERT INTO activity_lottery_event(id,tenant_id,store_id,activity_id,actor_id,device_id,request_id,request_hash,action,result_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[randomUUID(),p.tenantId,p.storeId,activityId,actorId,p.deviceId,v.requestId,hash,action,JSON.stringify({revision:state.revision,command:v})])
      await db.query('COMMIT');return state
    }catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e}finally{db.release()}
  }
}
