import { randomInt, randomUUID } from 'node:crypto'
import type {LotteryConfig,LotteryWorkspace,LotteryMember,LotteryResult} from '@zyapp/contracts'

export function validateLotteryConfig(raw:unknown):LotteryConfig {
  const c=raw as LotteryConfig
  if(!c||typeof c!=='object'||typeof c.multipleEntries!=='boolean'||typeof c.repeatWinners!=='boolean'||
    typeof c.rules!=='string'||c.rules.length>5000||!Array.isArray(c.prizes)||!c.prizes.length||c.prizes.length>50)throw new Error('抽奖配置无效')
  const times=[c.startsAt,c.closesAt,c.drawAt].map(t=>typeof t==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(t)?Date.parse(t):NaN)
  if(times.some(t=>!Number.isFinite(t))||times[0]!>=times[1]!||times[1]!>times[2]!)throw new Error('报名开始须早于截止时间，开奖不得早于截止时间，请提供带时区的时间')
  const ids=new Set<string>();let total=0
  for(const p of c.prizes){
    if(!p||typeof p.id!=='string'||!p.id||p.id.length>100||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.description!=='string'||p.description.length>500||!Number.isSafeInteger(p.count)||p.count<1||p.count>1000)throw new Error('奖项配置无效')
    ids.add(p.id);total+=p.count
  }
  if(total>5000)throw new Error('总中奖名额不可超过5000')
  return {startsAt:new Date(times[0]!).toISOString(),closesAt:new Date(times[1]!).toISOString(),drawAt:new Date(times[2]!).toISOString(),multipleEntries:c.multipleEntries,repeatWinners:c.repeatWinners,rules:c.rules,prizes:c.prizes.map(p=>({id:p.id,name:p.name.trim(),description:p.description,count:p.count}))}
}
export function configureLottery(state:LotteryWorkspace,raw:unknown,now:number){
  if(state.result)throw new Error('已开奖，配置不可修改')
  if(state.config&&now>=Date.parse(state.config.closesAt))throw new Error('报名已截止，配置已冻结')
  const config=validateLotteryConfig(raw)
  if(state.rulesLocked&&state.config){
    if(config.multipleEntries!==state.config.multipleEntries||config.repeatWinners!==state.config.repeatWinners)throw new Error('已有报名，报名与中奖规则已锁定')
    if(config.startsAt!==state.config.startsAt||config.closesAt!==state.config.closesAt||config.drawAt!==state.config.drawAt)throw new Error('已有报名，活动时间已锁定')
  }
  if(Date.parse(config.closesAt)<=now)throw new Error('报名截止须晚于当前时间')
  state.config=config
}
export function requireRegistrationWindow(state:LotteryWorkspace,now:number){
  if(!state.config)throw new Error('请先配置抽奖')
  if(state.result||now<Date.parse(state.config.startsAt)||now>=Date.parse(state.config.closesAt))throw new Error('不在报名时间内或活动已开奖')
  return state.config
}
export function registerLotteryEntry(state:LotteryWorkspace,member:LotteryMember,actorId:string,now:number){
  const config=requireRegistrationWindow(state,now)
  if(!config.multipleEntries&&state.entries.some(e=>e.active&&e.memberId===member.memberId))throw new Error('该会员已报名，本活动每人限一次')
  if(state.entries.length>=20000)throw new Error('单个活动最多登记20000次，请新建活动')
  state.entries.push({...member,id:randomUUID(),createdAt:new Date(now).toISOString(),actorId,active:true,changes:[]});state.rulesLocked=true
}
export function setLotteryEntryStatus(state:LotteryWorkspace,id:string,active:boolean,reason:string,actorId:string,now:number){
  const config=requireRegistrationWindow(state,now),entry=state.entries.find(e=>e.id===id)
  if(!entry)throw new Error('报名记录不存在')
  if(typeof active!=='boolean'||typeof reason!=='string'||!reason.trim()||reason.length>500)throw new Error('请填写操作原因（最多500字）')
  if(entry.active===active)throw new Error('报名记录状态未变化')
  if(active&&!config.multipleEntries&&state.entries.some(e=>e.active&&e.memberId===entry.memberId))throw new Error('该会员已有有效报名，不能恢复')
  entry.active=active;entry.changes.push({active,reason:reason.trim(),actorId,at:new Date(now).toISOString()})
}
export function drawLottery(state:LotteryWorkspace,actorId:string,now:number,nextInt:(max:number)=>number=randomInt):LotteryResult{
  if(state.result)return state.result
  const c=state.config;if(!c||now<Date.parse(c.drawAt)||now<Date.parse(c.closesAt))throw new Error('尚未到开奖时间')
  const entries=structuredClone(state.entries.filter(e=>e.active));let pool=[...entries]
  const prizes=c.prizes.map(p=>{
    const winners:LotteryResult['prizes'][number]['winners']=[]
    while(winners.length<p.count&&pool.length){
      const index=nextInt(pool.length);if(!Number.isInteger(index)||index<0||index>=pool.length)throw new Error('随机源返回无效位置')
      const e=pool[index]!;winners.push({entryId:e.id,memberId:e.memberId,memberNumber:e.memberNumber,name:e.name,phone:e.phone})
      pool=c.repeatWinners?pool.filter(x=>x.id!==e.id):pool.filter(x=>x.memberId!==e.memberId)
    }
    return {...p,winners,vacancies:p.count-winners.length}
  })
  state.result={drawnAt:new Date(now).toISOString(),actorId,entries,prizes};return state.result
}
