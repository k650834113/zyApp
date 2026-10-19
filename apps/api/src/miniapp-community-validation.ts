import { BadRequestException } from '@nestjs/common'
import { rankPlayPlayers, playFieldErrors, type CreateMeetup, type SavePlay, type CommunityFilters, type PlayPlayer } from '@zyapp/contracts'
import { normalizeBoardGameId } from './board-game-library'

function invalid(message: string): never { throw new BadRequestException(message) }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请求格式无效')
  return value as Record<string, unknown>
}
export function text(value: unknown, max: number, optional = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) invalid('文本为空或过长')
  return value.trim()
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`数字须为 ${min}–${max} 的整数`)
  return value
}
export function requestId(value: unknown): string {
  const id = text(value, 100)
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(id)) invalid('请求编号无效')
  return id
}
function date(value: unknown): string {
  const v = text(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v) invalid('日期无效')
  return v
}
export function validateMeetup(value: unknown, now = Date.now()): CreateMeetup {
  const v=object(value)
  const at=<T>(path:string,label:string,run:()=>T):T=>{try{return run()}catch(e){throw new BadRequestException({message:label+'：'+(e instanceof Error?e.message:'填写无效'),fieldErrors:{[path]:label+'填写无效，请检查是否为空、过长或格式错误'}})}}
  const d=at('date','日期',()=>date(v.date)),time=at('time','开始时间',()=>text(v.time,5)),deadline=at('deadline','报名截止',()=>text(v.deadline,16)).replace('T',' ')
  const fail=(path:string,message:string):never=>{throw new BadRequestException({message,fieldErrors:{[path]:message}})}
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('time','开始时间无效')
  if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(deadline)) fail('deadline','截止时间格式为 YYYY-MM-DD HH:mm')
  at('deadline','报名截止日期',()=>date(deadline.slice(0,10)))
  const startMs = Date.parse(`${d}T${time}:00+08:00`), dueMs = Date.parse(deadline.replace(' ','T')+':00+08:00')
  if (dueMs <= now || dueMs > startMs || startMs > now + 366 * 86400000) fail('deadline','截止时间须在当前时间之后且不晚于开始时间，约局须在一年内')
  if (typeof v.friendly !== 'boolean') invalid('新手友好设置无效')
  return {requestId:requestId(v.requestId),gameId:at('gameId','桌游',()=>normalizeBoardGameId(v.gameId)),title:at('title','约局标题',()=>text(v.title,40)),date:d,time,
    duration:at('duration','预计时长',()=>integer(v.duration,1,1440)),capacity:at('capacity','总人数',()=>integer(v.capacity,2,20)),deadline,description:at('description','约局说明',()=>text(v.description,200)),friendly:v.friendly}
}
export function validatePlay(value: unknown, now = Date.now()): SavePlay {
  const v=object(value)
  const field=(path:string,message:string):never=>{throw new BadRequestException({message,fieldErrors:{[path]:message}})}
  let d:string
  try{d=date(v.date)}catch{field('date','对局日期无效')}
  if(d!>new Date(now+8*3600000).toISOString().slice(0,10))field('date','对局日期不能在未来')
  if(!['个人','团队','合作'].includes(String(v.mode)))field('mode','对局模式无效')
  if(!['high','low','manual'].includes(String(v.ranking)))field('ranking','排名方式无效')
  if(v.recordScores!==undefined&&typeof v.recordScores!=='boolean')field('recordScores','记分设置无效')
  if(v.resultType!==undefined&&!['single','multiple','ranking'].includes(String(v.resultType)))field('resultType','结果形式无效')
  if(v.result!==null&&!['win','loss','draw'].includes(String(v.result)))field('result','合作结果无效')
  if(!Array.isArray(v.players)||!v.players.length||v.players.length>8)field('players','玩家人数为1–8人')
  const recordScores=v.recordScores!==false,resultType=(v.resultType??'ranking') as NonNullable<SavePlay['resultType']>
  let players:PlayPlayer[]=(v.players as unknown[]).map((raw,i)=>{
    const p=object(raw)
    if(typeof p.name!=='string')field(`players.${i}.name`,`玩家${i+1}的姓名不能为空`)
    if(recordScores&&typeof p.score!=='string')field(`players.${i}.score`,`玩家${i+1}请输入得分`)
    if(p.team!==undefined&&typeof p.team!=='string')field(`players.${i}.team`,`玩家${i+1}的队伍无效`)
    if(p.outcome!==undefined&&!['win','loss','draw'].includes(String(p.outcome)))field(`players.${i}.outcome`,`玩家${i+1}的结果无效`)
    return {name:(p.name as string).trim(),score:recordScores?String(p.score):'',rank:typeof p.rank==='number'?p.rank:0,
      ...(v.mode==='团队'?{team:String(p.team??'').trim()}:{}),
      ...(p.memberId?{memberId:normalizeBoardGameId(p.memberId)}:{}),
      ...(p.outcome?{outcome:p.outcome as NonNullable<PlayPlayer['outcome']>}:{})}
  })
  // Legacy cooperative records had independent scores. New submissions enforce the shared score.
  if(v.mode==='合作'&&v.recordScores===undefined)players=players.map(p=>({...p,score:players[0]!.score}))
  const note=typeof v.note==='string'?v.note.trim():field('note','备注格式无效')
  const ranking=(!recordScores&&resultType==='ranking'?'manual':v.ranking) as SavePlay['ranking']
  const errors=playFieldErrors({players,mode:String(v.mode),ranking,result:v.result as SavePlay['result'],note,recordScores,resultType})
  if(Object.keys(errors).length)throw new BadRequestException({message:Object.values(errors)[0],fieldErrors:errors})
  players=rankPlayPlayers(players,String(v.mode),ranking,recordScores)
  if(resultType==='ranking'){players=players.map(p=>{const {outcome,...rest}=p;return rest});players.sort((a,b)=>a.rank-b.rank)}
  else players=players.map(p=>({...p,rank:0}))
  if(v.mode==='合作')players=players.map(p=>({...p,rank:1,outcome:v.result as NonNullable<PlayPlayer['outcome']>}))
  let duration:number
  try{duration=integer(v.duration,1,1440)}catch{field('duration','时长须为1–1440分钟的整数')}
  let gameId:string
  try{gameId=normalizeBoardGameId(v.gameId)}catch{field('gameId','请选择有效桌游')}
  return {requestId:requestId(v.requestId),...(v.id?{id:normalizeBoardGameId(v.id),expectedRevision:normalizeBoardGameId(v.expectedRevision)}:{}),
    gameId:gameId!,date:d!,duration:duration!,mode:String(v.mode),players,note,ranking,result:v.result as SavePlay['result'],recordScores,resultType,
    ...(v.tableId?{tableId:normalizeBoardGameId(v.tableId)}:{})}
}
export function filters(v: Record<string,unknown>): CommunityFilters & {limit:number;offset:number} {
  const limit = v.limit === undefined ? 20 : integer(Number(v.limit),1,50)
  const offset = v.offset === undefined ? 0 : integer(Number(v.offset),0,10000)
  if (v.mine!==undefined && v.mine!=='owned' && v.mine!=='joined') invalid('筛选条件无效')
  return {limit,offset,...(v.mine?{mine:v.mine as 'owned'|'joined'}:{}),...(v.date?{date:date(v.date)}:{})}
}
