import {createCommunityDemoClient} from './community-demo-client'
import {getMiniappClient} from './client'
import {registerCloudCommunityPage} from './community-cloud-page'
import {getCommunityDemo,getUiDemo} from './ui-demo'
import {type CommunitySnapshot,type CommunityGame,type MeetupView,type PlayView} from './community-model'
let demoState:CommunitySnapshot|null=null
let demoApi:ReturnType<typeof createCommunityDemoClient>|null=null
function snapshot(){if(!demoState)demoState=getCommunityDemo();return demoState}
export async function openCommunityPage(page:string){
  if(!snapshot()){
    try{if(!await getMiniappClient().getMemberSummary()){wx.navigateTo({url:'/pages/login/index'});return}}
    catch{wx.showToast({title:'暂时无法读取账户，请重试',icon:'none'});return}
  }
  wx.navigateTo({url:'/pages/'+page+'/index'})
}
export function registerCommunityPage(surface:'meetups'|'meetup-detail'|'meetup-create'|'meetup-success'|'my-meetups'|'plays'|'play-create'|'play-detail'){
if (!getCommunityDemo()) { registerCloudCommunityPage(surface); return }
if(surface==='play-create'||surface==='play-detail'||surface==='plays'){const state=snapshot()!;demoApi??=createCommunityDemoClient(snapshot);registerCloudCommunityPage(surface,{api:demoApi,snapshot:state});return}
Page({
  data:{
    demo:false,loading:true,tab:'all',dateFilter:'all',items:[] as MeetupView[],plays:[] as PlayView[],
    selected:null as MeetupView|null,play:null as PlayView|null,games:[] as CommunityGame[],gameIndex:0,game:null as CommunityGame|null,
    ready:true,deadlineDate:'',deadlineTime:'13:00',gameQuery:'',gameSearching:false,
    title:'',date:'',time:'14:00',duration:120,capacity:4,deadline:'',description:'',friendly:true,location:'',
    mode:'个人',modes:['个人','团队','合作'],modeIndex:0,visibility:'仅自己',note:'',ascending:false,
    players:[{name:'',score:'',rank:1},{name:'',score:'',rank:2}],error:'',busy:false,
    joinedCount:0,gameCount:0,dates:[] as string[]
  },
  onLoad(options:{id?:string}){
    const state=snapshot()
    const games=getUiDemo()?.home.recommendedGames.map(game=>({id:game.id,name:game.name,imageUrl:game.imageUrl}))??[]
    const selected=state?.meetups.find(item=>item.id===options.id)||null
    const play=state?.plays.find(item=>item.id===options.id)||null
    this.setData({demo:!!state,selected,play,games,game:surface==='meetup-create'?null:games[0]??null,location:getUiDemo()?.home.store.name??'',loading:false})
    if(surface==='meetup-create'){
      const date=new Date(Date.now()+32*3600000).toISOString().slice(0,10)
      this.setData({date,deadlineDate:date,deadlineTime:'13:00',deadline:date+' 13:00'})
    }
    this.refresh()
  },
  onShow(){this.refresh()},
  refresh(){
    const state=snapshot()
    let items=state?.meetups??[]
    if(surface==='my-meetups')items=items.filter(item=>this.data.tab==='owned'?item.owned:item.joined)
    else if(this.data.tab==='joined')items=items.filter(item=>item.joined)
    if(this.data.dateFilter!=='all')items=items.filter(item=>item.date===this.data.dateFilter)
    const ordered=[...(state?.plays??[])].sort((a,b)=>b.date.localeCompare(a.date))
    const plays=ordered.map((item,index)=>({...item,monthLabel:Number(item.date.slice(5,7))+'月',showMonth:index===0||item.date.slice(0,7)!==ordered[index-1]?.date.slice(0,7)}))
    const selected=state?.meetups.find(item=>item.id===this.data.selected?.id)??this.data.selected
    const play=state?.plays.find(item=>item.id===this.data.play?.id)??this.data.play
    this.setData({items,plays,selected,play,dates:[...new Set((state?.meetups??[]).map(item=>item.date))],joinedCount:plays.length,gameCount:new Set(plays.map(item=>item.game.id)).size})
  },
  setTab(event:{currentTarget:{dataset:{tab:string}}}){this.setData({tab:event.currentTarget.dataset.tab});this.refresh()},
  setDateFilter(event:{currentTarget:{dataset:{date:string}}}){this.setData({dateFilter:event.currentTarget.dataset.date});this.refresh()},
  openMeetup(event:{currentTarget:{dataset:{id:string}}}){wx.navigateTo({url:'/pages/meetup-detail/index?id='+encodeURIComponent(event.currentTarget.dataset.id)})},
  openPlay(event:{currentTarget:{dataset:{id:string}}}){wx.navigateTo({url:'/pages/play-detail/index?id='+encodeURIComponent(event.currentTarget.dataset.id)})},
  createMeetup(){void openCommunityPage('meetup-create')},
  createPlay(){void openCommunityPage('play-create')},
  goMine(){wx.redirectTo({url:'/pages/my-meetups/index'})},
  goAbout(){wx.navigateTo({url:'/pages/about/index'})},
  goPricing(){wx.navigateTo({url:'/pages/pricing/index'})},
  imageError(event:{currentTarget:{dataset:{id:string}}}){
    const id=event.currentTarget.dataset.id
    this.setData({items:this.data.items.map(item=>item.game.id===id?{...item,game:{...item.game,imageUrl:null}}:item),plays:this.data.plays.map(item=>item.game.id===id?{...item,game:{...item.game,imageUrl:null}}:item),selected:this.data.selected?.game.id===id?{...this.data.selected,game:{...this.data.selected.game,imageUrl:null}}:this.data.selected,play:this.data.play?.game.id===id?{...this.data.play,game:{...this.data.play.game,imageUrl:null}}:this.data.play})
  },
  avatarError(){},
  onShareAppMessage(){const m=this.data.selected;return {title:m?.title??'据点桌游约局',path:m?'/pages/meetup-detail/index?id='+encodeURIComponent(m.id):'/pages/meetups/index'}},
  inputGameQuery(e:WechatMiniprogram.Input){const query=e.detail.value;const games=getUiDemo()?.home.recommendedGames.filter(g=>g.name.toLowerCase().includes(query.toLowerCase())).map(g=>({id:g.id,name:g.name,imageUrl:g.imageUrl}))??[];this.setData({gameQuery:query,game:null,games})},
  selectGame(e:{currentTarget:{dataset:{id:string}}}){const game=this.data.games.find(g=>g.id===e.currentTarget.dataset.id);if(game)this.setData({game,gameQuery:game.name,games:[]})},
  chooseDeadlineDate(e:WechatMiniprogram.PickerChange){const deadlineDate=String(e.detail.value);this.setData({deadlineDate,deadline:deadlineDate+' '+this.data.deadlineTime})},
  chooseDeadlineTime(e:WechatMiniprogram.PickerChange){const deadlineTime=String(e.detail.value);this.setData({deadlineTime,deadline:this.data.deadlineDate+' '+deadlineTime})},
  chooseGame(event:WechatMiniprogram.PickerChange){const gameIndex=Number(event.detail.value);this.setData({gameIndex,game:this.data.games[gameIndex]??null})},
  inputTitle(event:WechatMiniprogram.Input){this.setData({title:event.detail.value})},
  inputDescription(event:WechatMiniprogram.Input){this.setData({description:event.detail.value})},
  inputDeadline(event:WechatMiniprogram.Input){this.setData({deadline:event.detail.value})},
  chooseDate(event:WechatMiniprogram.PickerChange){this.setData({date:String(event.detail.value)})},
  chooseTime(event:WechatMiniprogram.PickerChange){this.setData({time:String(event.detail.value)})},
  inputDuration(event:WechatMiniprogram.Input){this.setData({duration:Number(event.detail.value)})},
  inputCapacity(event:WechatMiniprogram.Input){this.setData({capacity:Number(event.detail.value)})},
  toggleFriendly(event:WechatMiniprogram.SwitchChange){this.setData({friendly:event.detail.value})},
  setMode(event:{currentTarget:{dataset:{mode:string}}}){this.setData({mode:event.currentTarget.dataset.mode})},
  inputNote(event:WechatMiniprogram.Input){this.setData({note:event.detail.value})},
  inputPlayer(event:WechatMiniprogram.Input & {currentTarget:{dataset:{index:number;field:'name'|'score'}}}){
    const {index,field}=event.currentTarget.dataset
    this.setData({players:this.data.players.map((item,i)=>i===Number(index)?{...item,[field]:event.detail.value}:item)})
  },
  addPlayer(){if(this.data.players.length<8)this.setData({players:[...this.data.players,{name:'',score:'',rank:this.data.players.length+1}]})},
  removePlayer(event:{currentTarget:{dataset:{index:number}}}){if(this.data.players.length>1)this.setData({players:this.data.players.filter((_,i)=>i!==Number(event.currentTarget.dataset.index))})},
  toggleRank(){this.setData({ascending:!this.data.ascending})},
  async join(){
    const state=snapshot(), selected=state?.meetups.find(item=>item.id===this.data.selected?.id)
    if(!state||!selected)return this.unavailable()
    if(selected.joined){wx.navigateTo({url:'/pages/meetup-success/index?id='+selected.id});return}
    if(selected.players.length>=selected.capacity){wx.showToast({title:'约局已满员',icon:'none'});return}
    const joined={...selected,joined:true,players:[...selected.players,'我']}
    state.meetups=state.meetups.map(item=>item.id===joined.id?joined:item)
    this.setData({selected:joined})
    wx.navigateTo({url:'/pages/meetup-success/index?id='+joined.id})
  },
  leave(){
    const state=snapshot(), selected=this.data.selected
    if(!state||!selected)return this.unavailable()
    state.meetups=state.meetups.map(item=>item.id===selected.id?{...item,joined:false,players:item.players.filter(name=>name!=='我')}:item)
    this.goMine()
  },
  publish(){
    const state=snapshot(),game=this.data.game
    if(!state)return this.unavailable()
    if(!game||!this.data.title.trim()||!this.data.date||!this.data.deadline||!this.data.description.trim()||!Number.isInteger(this.data.capacity)||this.data.capacity<2||this.data.capacity>20||this.data.duration<=0){this.setData({error:'请填写完整信息，人数为 2–20 人，时长大于 0'});return}
    const item:MeetupView={id:'demo-meetup-'+Date.now(),game,title:this.data.title.trim(),date:this.data.date,time:this.data.time,duration:this.data.duration,capacity:this.data.capacity,deadline:this.data.deadline,location:this.data.location,description:this.data.description,tags:this.data.friendly?['新手友好']:[],players:['我'],joined:true,owned:true}
    state.meetups=[item,...state.meetups]
    wx.redirectTo({url:'/pages/meetup-detail/index?id='+item.id})
  },
  savePlay(){
    const state=snapshot(),game=this.data.game
    if(!state)return this.unavailable()
    if(!game||!this.data.date||this.data.duration<=0||this.data.players.some(item=>!item.name.trim()||item.score.trim()===''||!Number.isFinite(Number(item.score)))){this.setData({error:'请完整填写游戏、日期、时长和玩家成绩'});return}
    const sorted=[...this.data.players].sort((a,b)=>this.data.ascending?Number(a.score)-Number(b.score):Number(b.score)-Number(a.score))
    const players=sorted.map((item,index)=>({...item,rank:sorted.findIndex(other=>Number(other.score)===Number(item.score))+1}))
    const item:PlayView={id:this.data.play?.id||'demo-play-'+Date.now(),game,date:this.data.date,duration:this.data.duration,mode:this.data.mode,players,note:this.data.note,visibility:'仅自己'}
    state.plays=[item,...state.plays.filter(play=>play.id!==item.id)]
    wx.redirectTo({url:'/pages/play-detail/index?id='+item.id})
  },
  editPlay(){if(this.data.play)wx.navigateTo({url:'/pages/play-create/index?id='+this.data.play.id})},
  unavailable(){wx.showModal({title:'功能尚未开放',content:'当前页面尚未接入云端业务，请联系门店了解开放时间。',showCancel:false})}
})
}
