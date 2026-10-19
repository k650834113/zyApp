import { rememberMeetupReturn } from './meetup-return'
import {rankPlayPlayers,playFieldErrors} from './play-rules'
import type {FieldErrors} from '@zyapp/contracts'
import type {CommunityClient} from './types'
import type {CommunitySnapshot} from './community-model'
import {chooseFriend} from './social'
import type { CommunityGame, MeetupSummary, PlaySummary, PlayPlayer, SavePlay } from '@zyapp/contracts'
import { getMiniappClient } from './client'
import { consumeScoreDraft } from './community-model'
type Surface='meetups'|'meetup-detail'|'meetup-create'|'meetup-success'|'my-meetups'|'plays'|'play-create'|'play-detail'
function cloudApi(){const c=getMiniappClient().community;if(!c)throw new Error('云端服务暂不可用');return c}
function key(){return 'community-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
function today(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10)}
function errorMessage(error:unknown){return error instanceof Error?error.message:'加载失败，请重试'}
export function registerCloudCommunityPage(surface:Surface,demo?:{api:CommunityClient;snapshot:CommunitySnapshot}){
const api=()=>demo?.api??cloudApi()
Page({
  data:{ready:false,demo:false,loading:true,loadingMore:false,hasMore:false,tab:'all',dateFilter:'all',
    items:[] as MeetupSummary[],plays:[] as PlaySummary[],selected:null as MeetupSummary|null,play:null as PlaySummary|null,
    games:[] as CommunityGame[],gameIndex:0,game:null as CommunityGame|null,gameQuery:'',
    deadlineDate:today(),deadlineTime:'13:00',gameSearching:false,
    title:'',date:today(),time:'14:00',duration:120,capacity:4,deadline:'',description:'',friendly:true,location:'',
    recordScores:true,resultType:'ranking' as 'single'|'multiple'|'ranking',tableId:'',fieldErrors:{} as FieldErrors,playerErrors:[] as FieldErrors[],errorAnchor:'',
    mode:'个人',modes:['个人','团队','合作'],modeIndex:0,visibility:'仅自己',note:'',ascending:false,manualRank:false,
    resultLabels:['胜利','失败','平局'],result:'win' as SavePlay['result'],players:[{name:'',score:'',rank:0,outcome:'loss'},{name:'',score:'',rank:0,outcome:'loss'}] as PlayPlayer[],
    error:'',busy:false,joinedCount:0,gameCount:0,dates:[] as string[]},
  recordId:'', searchSequence:0, sequence:0, mutationKey:'', mutationPayload:'', initialized:false,scoreSaved:null as (()=>void)|null,
  onLoad(options:{id?:string}){this.recordId=options.id??'';if(surface==='play-create'){const draft=consumeScoreDraft();if(draft){this.setData({players:draft.players,tableId:draft.tableId??''});this.scoreSaved=draft.onSaved??null}this.recompute()}},
  onShow(){void this.load()},
  onUnload(){this.sequence++;this.searchSequence++},
  onReachBottom(){if(this.data.hasMore&&!this.data.loading&&!this.data.loadingMore)void this.load(true)},
  onPullDownRefresh(){void this.load().finally(()=>wx.stopPullDownRefresh())},
  async load(append=false){
    if(this.data.busy)return
    const sequence=++this.sequence
    this.setData(append?{loadingMore:true,error:''}:{loading:true,error:''})
    try {
      const member=demo?true:surface==='meetup-detail'?await getMiniappClient().getMemberSummary().catch(()=>null):await getMiniappClient().getMemberSummary()
      if(!member&&surface!=='meetup-detail'){
        this.setData({ready:false,items:[],plays:[],selected:null,play:null})
        wx.navigateTo({url:'/pages/login/index'});return
      }
      if(sequence!==this.sequence)return
      this.setData({ready:!!member,demo:!!demo})
      if(surface==='meetups'||surface==='my-meetups'){
        const mine=surface==='my-meetups'?(this.data.tab==='owned'?'owned':'joined'):this.data.tab==='joined'?'joined':undefined
        const page=await api().listMeetups({limit:20,offset:append?this.data.items.length:0,...(mine?{mine}:{}),...(this.data.dateFilter==='all'?{}:{date:this.data.dateFilter})})
        if(sequence!==this.sequence)return
        const items=append?[...this.data.items,...page.items]:page.items
        this.setData({items,hasMore:page.hasMore,dates:[...new Set(items.map(i=>i.date))]})
      }else if(surface==='plays'){
        const page=await api().listPlays({limit:20,offset:append?this.data.plays.length:0})
        if(sequence!==this.sequence)return
        const rows=append?[...this.data.plays,...page.items]:page.items
        const plays=rows.map((p,i)=>({...p,monthLabel:Number(p.date.slice(5,7))+'月',showMonth:i===0||p.date.slice(0,7)!==rows[i-1]?.date.slice(0,7)}))
        this.setData({plays,hasMore:page.hasMore,joinedCount:plays.length,gameCount:new Set(plays.map(i=>i.game.id)).size})
      }else if(surface==='meetup-detail'||surface==='meetup-success'){
        const selected=await api().getMeetup(this.recordId);if(sequence===this.sequence)this.setData({selected})
      }else if(surface==='play-detail'){
        const play=await api().getPlay(this.recordId);if(sequence===this.sequence)this.setData({play})
      }else if(!this.initialized){
        const [games,home,play]=await Promise.all([demo?Promise.resolve([...new Map([...demo.snapshot.plays,...demo.snapshot.meetups].map(p=>[p.game.id,p.game])).values()]):getMiniappClient().listGames({limit:24}),getMiniappClient().getHome(),
          surface==='play-create'&&this.recordId?api().getPlay(this.recordId):Promise.resolve(null)])
        if(sequence!==this.sequence)return
        this.setData({games,game:play?.game??(surface==='meetup-create'?null:games[0]??null),location:home.store.name,
          ...(play?{play,date:play.date,duration:play.duration,mode:play.mode,players:play.players,note:play.note,
            ascending:play.ranking==='low',manualRank:play.ranking==='manual',result:play.result,recordScores:play.recordScores??true,resultType:play.resultType??'ranking'}:{} )})
        this.initialized=true
        if(surface==='play-create'){if(this.data.mode==='合作'){const score=this.data.players[0]?.score??'';this.setData({players:this.data.players.map(p=>({...p,score,outcome:this.data.result??'win'}))})}this.recompute()}
      }
    }catch(e){if(sequence===this.sequence)this.setData({error:errorMessage(e),...(surface==='meetup-detail'||surface==='meetup-success'?{selected:null}:{}),...(surface==='play-detail'?{play:null}:{})})}
    finally{if(sequence===this.sequence)this.setData({loading:false,loadingMore:false})}
  },
  refresh(){void this.load()},
  setTab(e:{currentTarget:{dataset:{tab:string}}}){this.setData({tab:e.currentTarget.dataset.tab});void this.load()},
  setDateFilter(e:{currentTarget:{dataset:{date:string}}}){this.setData({dateFilter:e.currentTarget.dataset.date});void this.load()},
  openMeetup(e:{currentTarget:{dataset:{id:string}}}){wx.navigateTo({url:'/pages/meetup-detail/index?id='+encodeURIComponent(e.currentTarget.dataset.id)})},
  openPlay(e:{currentTarget:{dataset:{id:string}}}){wx.navigateTo({url:'/pages/play-detail/index?id='+encodeURIComponent(e.currentTarget.dataset.id)})},
  createMeetup(){wx.navigateTo({url:'/pages/meetup-create/index'})},createPlay(){wx.navigateTo({url:'/pages/play-create/index'})},
  goMine(){wx.redirectTo({url:'/pages/my-meetups/index'})},goAbout(){wx.navigateTo({url:'/pages/about/index'})},goPricing(){wx.navigateTo({url:'/pages/pricing/index'})},
  async searchGames(){
    const sequence=++this.searchSequence,query=this.data.gameQuery.trim()
    this.setData({gameSearching:true})
    try {const games=await getMiniappClient().listGames({query,limit:24});if(sequence===this.searchSequence)this.setData({games})}
    catch(e){if(sequence===this.searchSequence)this.setData({error:errorMessage(e)})}
    finally{if(sequence===this.searchSequence)this.setData({gameSearching:false})}
  },
  inputGameQuery(e:WechatMiniprogram.Input){this.setData({gameQuery:e.detail.value,game:null,games:[]});void this.searchGames()},
  selectGame(e:{currentTarget:{dataset:{id:string}}}){const game=this.data.games.find(g=>g.id===e.currentTarget.dataset.id);if(game){this.searchSequence++;this.setData({game,gameQuery:game.name,games:[],gameSearching:false});this.clearField('gameId')}},
  chooseDeadlineDate(e:WechatMiniprogram.PickerChange){const deadlineDate=String(e.detail.value);this.setData({deadlineDate,deadline:deadlineDate+' '+this.data.deadlineTime});this.clearField('deadline')},
  chooseDeadlineTime(e:WechatMiniprogram.PickerChange){const deadlineTime=String(e.detail.value);this.setData({deadlineTime,deadline:this.data.deadlineDate+' '+deadlineTime});this.clearField('deadline')},
  avatarError(e:{currentTarget:{dataset:{memberId:string}}}){const id=e.currentTarget.dataset.memberId
    const update=(m:MeetupSummary)=>({...m,...(m.participants?{participants:m.participants.map(p=>p.memberId===id?{...p,avatarUrl:null}:p)}:{})})
    this.setData({items:this.data.items.map(update),...(this.data.selected?{selected:update(this.data.selected)}:{})})
  },
  onShareAppMessage(){const m=this.data.selected;return {title:m?m.title+'｜一起玩桌游':'据点桌游约局',path:m?'/pages/meetup-detail/index?id='+encodeURIComponent(m.id):'/pages/meetups/index'}},
  chooseGame(e:WechatMiniprogram.PickerChange){const gameIndex=Number(e.detail.value);this.setData({gameIndex,game:this.data.games[gameIndex]??null});this.clearField('gameId')},
  inputTitle(e:WechatMiniprogram.Input){this.setData({title:e.detail.value});this.clearField('title')},inputDescription(e:WechatMiniprogram.Input){this.setData({description:e.detail.value});this.clearField('description')},
  inputDeadline(e:WechatMiniprogram.Input){this.setData({deadline:e.detail.value});this.clearField('deadline')},chooseDate(e:WechatMiniprogram.PickerChange){this.setData({date:String(e.detail.value)});this.clearField('date')},
  chooseTime(e:WechatMiniprogram.PickerChange){this.setData({time:String(e.detail.value)});this.clearField('time')},inputDuration(e:WechatMiniprogram.Input){this.setData({duration:Number(e.detail.value)});this.clearField('duration')},
  inputCapacity(e:WechatMiniprogram.Input){this.setData({capacity:Number(e.detail.value)});this.clearField('capacity')},toggleFriendly(e:WechatMiniprogram.SwitchChange){this.setData({friendly:e.detail.value})},
  setMode(e:{currentTarget:{dataset:{mode:string}}}){
    const mode=e.currentTarget.dataset.mode,first=this.data.players[0]
    const players=this.data.players.map((p,i)=>({...p,...(mode==='团队'?{team:p.team||'队伍'+(i+1)}:{}),
      score:mode==='合作'?(first?.score??''):p.score,outcome:mode==='合作'?(this.data.result??'win'):(p.outcome??'loss')}))
    this.setData({mode,players});this.clearField('mode');this.recompute()
  },
  inputNote(e:WechatMiniprogram.Input){this.setData({note:e.detail.value});this.clearField('note')},
  recompute(){const ranking=this.data.manualRank||!this.data.recordScores?'manual':this.data.ascending?'low':'high'
    this.setData({players:rankPlayPlayers(this.data.players,this.data.mode,ranking,this.data.recordScores)})},
  clearField(path:string){const errors={...this.data.fieldErrors};delete errors[path];delete errors.resultType;this.applyErrors(errors,false)},
  applyErrors(errors:FieldErrors,scroll=true){
    const playerErrors=this.data.players.map((_,i)=>Object.fromEntries(Object.entries(errors).filter(([k])=>k.startsWith('players.'+i+'.')).map(([k,v])=>[k.split('.').pop()!,v])))
    this.setData({fieldErrors:errors,playerErrors,error:Object.values(errors)[0]??'',errorAnchor:Object.keys(errors)[0]?'field-'+Object.keys(errors)[0]!.replace(/\./g,'-'):''})
    if(scroll&&Object.keys(errors).length){const path=Object.keys(errors)[0]!;wx.pageScrollTo?.({selector:'#field-'+path.replace(/\./g,'-'),duration:200})}
  },
  inputPlayer(e:WechatMiniprogram.Input & {currentTarget:{dataset:{index:number;field:'name'|'score'|'rank'|'team'}}}){
    const index=Number(e.currentTarget.dataset.index),field=e.currentTarget.dataset.field,source=this.data.players[index];if(!source)return
    if(field==='name'&&source.memberId)return
    const value=field==='rank'?Number(e.detail.value):e.detail.value
    let players=this.data.players.map((p,i)=>i===index?{...p,[field]:value}:p)
    if(field==='team'){
      const existing=players.find((p,i)=>i!==index&&p.team&&p.team===value)
      if(existing)players=players.map((p,i)=>i===index?{...p,score:existing.score,rank:existing.rank,outcome:existing.outcome??'loss'}:p)
    }else if(field==='score'||field==='rank'){
      players=players.map((p,i)=>(this.data.mode==='合作'||(this.data.mode==='团队'&&source.team&&p.team===source.team))?{...p,[field]:value}:p)
    }
    this.setData({players});this.clearField(`players.${index}.${field}`);this.recompute()
    const current=playFieldErrors({players:this.data.players,mode:this.data.mode,ranking:this.data.manualRank||!this.data.recordScores?'manual':this.data.ascending?'low':'high',result:this.data.result,note:this.data.note,recordScores:this.data.recordScores,resultType:this.data.resultType})
    const remaining=Object.fromEntries(Object.entries(this.data.fieldErrors).filter(([path])=>!path.startsWith('players.')||current[path]))
    this.applyErrors(remaining,false)
  },
  addPlayer(){if(this.data.players.length<8){const first=this.data.players[0];this.setData({players:[...this.data.players,{name:'',score:this.data.mode==='合作'?first?.score??'':'',rank:this.data.manualRank?this.data.players.length+1:0,outcome:this.data.mode==='合作'?this.data.result??'win':'loss',...(this.data.mode==='团队'?{team:'队伍'+(this.data.players.length+1)}:{})}]});this.applyErrors({},false);this.recompute()}},
  async addFriend(){try{if(this.data.players.length>=8)return;const m=await chooseFriend(this.data.players.flatMap(p=>p.memberId?[p.memberId]:[]));if(!m)return
    let i=this.data.players.findIndex(p=>!p.memberId&&!p.name&&!p.score);if(i<0){this.addPlayer();i=this.data.players.length-1}const players=[...this.data.players];players[i]={...players[i]!,name:m.name,memberId:m.memberId,avatarUrl:m.avatarUrl};this.setData({players});this.recompute()
  }catch(e){this.setData({error:errorMessage(e)})}},
  removePlayer(e:{currentTarget:{dataset:{index:number}}}){if(this.data.players.length>1){this.setData({players:this.data.players.filter((_,i)=>i!==Number(e.currentTarget.dataset.index))});this.applyErrors({},false);this.recompute()}},
  toggleScores(e:WechatMiniprogram.SwitchChange){this.setData({recordScores:e.detail.value,manualRank:e.detail.value?this.data.manualRank:true});this.applyErrors({},false);this.recompute()},
  setResultType(e:{currentTarget:{dataset:{type:'single'|'multiple'|'ranking'}}}){this.setData({resultType:e.currentTarget.dataset.type,players:this.data.players.map(p=>({...p,outcome:p.outcome??'loss'}))});this.applyErrors({},false);this.recompute()},
  toggleRank(){this.setData({ascending:!this.data.ascending});this.recompute()},toggleManual(){this.setData({manualRank:!this.data.manualRank});this.recompute()},
  chooseOutcome(e:WechatMiniprogram.PickerChange & {currentTarget:{dataset:{index:number}}}){
    const index=Number(e.currentTarget.dataset.index),source=this.data.players[index];if(!source)return
    const outcome=(['win','loss','draw'] as const)[Number(e.detail.value)]??'loss'
    const players=this.data.players.map((p,i)=>i===index||(this.data.mode==='团队'&&source.team&&p.team===source.team)?{...p,outcome}:p)
    this.setData({players});this.clearField(`players.${index}.outcome`)
  },
  setAllDraw(){this.setData({players:this.data.players.map(p=>({...p,outcome:'draw' as const}))});this.applyErrors({},false)},
  chooseResult(e:WechatMiniprogram.PickerChange){const result=(['win','loss','draw'] as const)[Number(e.detail.value)]??'win';this.setData({result,players:this.data.players.map(p=>({...p,outcome:result}))});this.clearField('result')},
  async mutate(payload:object,run:(requestId:string)=>Promise<void>){
    if(this.data.busy)return
    const serialized=JSON.stringify(payload)
    if(serialized!==this.mutationPayload){this.mutationPayload=serialized;this.mutationKey=key()}
    this.setData({busy:true,error:''})
    try{await run(this.mutationKey);this.mutationPayload='';this.mutationKey=''}catch(e){const fields=(e as {fieldErrors?:FieldErrors}).fieldErrors;if(fields&&Object.keys(fields).length)this.applyErrors(fields);else this.setData({error:errorMessage(e)})}
    finally{this.setData({busy:false})}
  },
  async join(){const m=this.data.selected;if(!m)return
    if(!this.data.ready){rememberMeetupReturn(m.id);wx.navigateTo({url:'/pages/login/index'});return}
    if(!m.joined&&(m.registrationClosed||m.status==='cancelled'||m.players.length>=m.capacity)){wx.showToast({title:'约局已满员或报名已截止',icon:'none'});return}
    if(m.joined){wx.navigateTo({url:'/pages/meetup-success/index?id='+m.id});return}
    await this.mutate({action:'join',id:m.id},async (requestId:string)=>{const selected=await api().actMeetup(m.id,'join',requestId);this.setData({selected});wx.navigateTo({url:'/pages/meetup-success/index?id='+m.id})})
  },
  async leave(){const m=this.data.selected;if(!m)return
    await this.mutate({action:'leave',id:m.id},async (requestId:string)=>{const selected=await api().actMeetup(m.id,'leave',requestId);this.setData({selected});this.goMine()})
  },
  cancelMeetup(){const m=this.data.selected;if(!m)return
    wx.showModal({title:'取消约局',content:'确认取消本次约局？',success:r=>{if(r.confirm)void this.mutate({action:'cancel',id:m.id},async (requestId:string)=>{this.setData({selected:await api().actMeetup(m.id,'cancel',requestId)})})}})
  },
  async publish(){const d=this.data;if(!d.game){this.applyErrors({gameId:'请选择游戏'});return}
    const deadline=d.deadline||d.deadlineDate+' '+d.deadlineTime
    const due=Date.parse(deadline.replace(' ','T')+':00+08:00'),start=Date.parse(d.date+'T'+d.time+':00+08:00')
    if(!Number.isFinite(due)||due<=Date.now()||due>start){this.applyErrors({deadline:'截止时间须晚于当前时间且不晚于开始时间'});return}
    const input={gameId:d.game.id,title:d.title,date:d.date,time:d.time,duration:d.duration,capacity:d.capacity,deadline,description:d.description,friendly:d.friendly}
    await this.mutate(input,async (requestId:string)=>{const m=await api().createMeetup({...input,requestId});wx.redirectTo({url:'/pages/meetup-detail/index?id='+m.id})})
  },
  async savePlay(){const d=this.data;if(!d.game){this.applyErrors({gameId:'请选择游戏'});return}
    const input={...(d.play?{id:d.play.id,expectedRevision:d.play.revision}:{}),gameId:d.game.id,date:d.date,duration:d.duration,mode:d.mode,
      players:d.players,note:d.note,recordScores:d.recordScores,resultType:d.resultType,...(d.tableId?{tableId:d.tableId}:{}),ranking:(d.manualRank||!d.recordScores?'manual':d.ascending?'low':'high') as SavePlay['ranking'],result:d.mode==='合作'?d.result:null}
    const errors=playFieldErrors(input);if(Object.keys(errors).length){this.applyErrors(errors);return}
    await this.mutate(input,async (requestId:string)=>{const p=await api().savePlay({...input,requestId});this.scoreSaved?.();this.scoreSaved=null;wx.redirectTo({url:'/pages/play-detail/index?id='+p.id})})
  },
  editPlay(){if(this.data.play&&this.data.play.owned!==false)wx.navigateTo({url:'/pages/play-create/index?id='+this.data.play.id})},
  deletePlay(){const p=this.data.play;if(!p)return
    wx.showModal({title:'隐藏对局',content:'仅从你的记录中隐藏，其他参与者仍保留此局。',success:r=>{if(r.confirm)void this.mutate({action:'delete',id:p.id,revision:p.revision},async (requestId:string)=>{await api().deletePlay(p.id,p.revision,requestId);wx.redirectTo({url:'/pages/plays/index'})})}})
  },
  imageError(e:{currentTarget:{dataset:{id:string}}}){const id=e.currentTarget.dataset.id
    this.setData({items:this.data.items.map(m=>m.game.id===id?{...m,game:{...m.game,imageUrl:null}}:m),plays:this.data.plays.map(p=>p.game.id===id?{...p,game:{...p.game,imageUrl:null}}:p),
      ...(this.data.selected?.game.id===id?{selected:{...this.data.selected,game:{...this.data.selected.game,imageUrl:null}}}:{}),
      ...(this.data.play?.game.id===id?{play:{...this.data.play,game:{...this.data.play.game,imageUrl:null}}}:{})})
  },
  unavailable(){wx.showToast({title:'私密记录暂不开放分享',icon:'none'})}
})}
