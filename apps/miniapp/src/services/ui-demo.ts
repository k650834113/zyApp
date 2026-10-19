import type { MiniappHomeSnapshot, PublicBoardGameSummary, PublicActivitySummary } from '@zyapp/contracts'

// Development-only presentation fixtures. Production build replaces this module
// with a null provider and removes its source map.
export function getUiDemo(): {home: MiniappHomeSnapshot, pricing: {rows: {label:string,regular:string,member:string}[],extras:{icon:string,label:string,value:string,note:string}[],memberNote:string}, extraActivities: PublicActivitySummary[], recommendationCopy: Record<string, {reason:string,audience:string}>} | null {
  if (typeof __ZYAPP_MINIAPP_BUILD_CONFIG__ === 'undefined' || !__ZYAPP_MINIAPP_BUILD_CONFIG__.useMock) return null
  const game = (id:string,name:string,imageUrl:string,customerNote:string):PublicBoardGameSummary => ({
    id,name,imageUrl,customerNote,baseGameId:null,expansionCount:0,
    introduction:'收集资源，发展策略，在轻松的互动中享受桌游时光。',
    categories:['策略','家庭'],minPlayers:2,maxPlayers:4,minMinutes:30,maxMinutes:45,
    complexityRating:1.8,likeCount:0,likedByViewer:false,
    sourceAttribution:{label:'Powered by BGG',url:'https://boardgamegeek.com'}
  })
  return {pricing:{rows:[{label:'单人按时计价',regular:'20元/2小时',member:'15元/2小时'},{label:'营业时间内畅玩',regular:'40元/位',member:'30元/位'}],extras:[{icon:'user',label:'学生证优惠',value:'35元/位',note:''},{icon:'people',label:'儿童价',value:'20元/位',note:'1.5m及以下，需大人陪同'},{icon:'games',label:'血染钟楼',value:'另收10元说书人费',note:'在原基础收费上加收'},{icon:'clock',label:'夜间加收',value:'23:00后每小时每人加收10元',note:''}],memberNote:'单次充值满500元成为永久会员，享会员价。'},extraActivities:[{id:'activity-two',title:'双人桌游体验',summary:'精选适合两人的经典桌游，轻松上手，享受专属的桌游时光。',content:'适合两人一起参加的桌游体验。现场提供规则讲解，根据玩家喜好选择游戏。',activityType:'recharge',startsAt:'2026-09-20T07:00:00Z',endsAt:'2026-09-20T09:00:00Z',pinned:false,regularPriceFen:null,advancedPriceFen:null,allowStoredValue:false,allowWechat:false,rechargeTiers:[]}],recommendationCopy: {
    'game-splendor': {reason:'规则简单但充满策略，每一局都能体验从积累到爆发的爽快感，非常适合新手入门。',audience:'桌游新手 · 喜欢策略的玩家\n2–4人的小团体'},
    'game-cascadia': {reason:'规则直观，拼出属于自己的自然栖息地。过程轻松有趣，适合和朋友一起享受悠闲的桌游时光。',audience:'家庭玩家 · 朋友聚会\n喜欢轻松策略的玩家'}
  },home:{
    content:{schemaVersion:1,revision:'demo-1',publishedAt:'2026-09-13T00:00:00+08:00',contacts:[{id:'wechat',label:'微信',value:'zeroser999',action:'copy'},{id:'qq',label:'QQ群',value:'850737917',action:'copy'}],storeCaption:'在这里，遇见同好，一起玩桌游。',storeFooter:'让桌游连接更多有趣的人'},
    store:{id:'ui-demo-store',name:'据点桌游',address:null,contactPhone:null,businessHours:'工作日 19:00–23:00\n节假日 13:00–23:00\n白天请联系老板',isOpen:true,statusText:''},
    announcements:[],
    recommendedGames:[
      game('game-splendor','璀璨宝石','https://judian.icu/v1/public/board-game-covers/68234f85034ee24fb5a609c8a20823b7a98a01c3d628e75df2cbbeac272e9db8.png','入门轻策略'),
      game('game-cascadia','卡斯卡迪亚','https://judian.icu/v1/public/board-game-covers/1c311df4a56c57bfbd2233253a98dda032db4fbd358ad7cfb90113b1e94a0dc2.jpg','轻松拼地图')
    ],
    activities:[{id:'activity-summer',title:'周末新手局',summary:'适合新手 · 店内组织 · 认识新朋友',content:'面向新手的友好体验局，提供规则讲解，一起享受桌游时光。',activityType:'recharge',startsAt:'2026-09-19T06:00:00Z',endsAt:'2026-09-19T09:00:00Z',pinned:true,regularPriceFen:null,advancedPriceFen:null,allowStoredValue:false,allowWechat:false,rechargeTiers:[]}]
  }}
}
// These fixtures are exported only by the development provider.
export function getCommunityDemo(): import('./community-model').CommunitySnapshot | null {
  const demo=getUiDemo()
  if(!demo) return null
  const games=demo.home.recommendedGames
  const game=(index:number)=>{const item=games[index];if(!item)throw new Error('Demo game fixture missing');return {id:item.id,name:item.name,imageUrl:item.imageUrl}}
  return {
    meetups:[
      {id:'demo-meetup-1',game:game(0),title:'璀璨宝石轻松局',date:'2026-09-19',time:'14:00',duration:180,capacity:4,deadline:'2026-09-19 12:00',location:'据点桌游',description:'一起来玩璀璨宝石吧！规则简单，上手快，适合新手。希望能认识更多喜欢桌游的朋友～',tags:['新手友好','策略','轻松'],players:['小林','阿杰','小雨'],joined:false,owned:false},
      {id:'demo-meetup-2',game:game(1),title:'卡斯卡迪亚朋友局',date:'2026-09-20',time:'15:00',duration:120,capacity:5,deadline:'2026-09-20 12:00',location:'据点桌游',description:'轻松的拼图桌游，欢迎喜欢自然主题的朋友一起玩！',tags:['家庭','新手友好'],players:['小林','朋友'],joined:true,owned:true}
    ],
    plays:[
      {id:'demo-play-1',game:game(0),date:'2026-09-19',duration:30,mode:'个人',players:[{name:'小林',score:'16',rank:1},{name:'阿澄',score:'14',rank:2},{name:'临时玩家',score:'12',rank:3}],note:'第一次带新朋友玩，大家都很投入！',visibility:'仅自己'},
      {id:'demo-play-2',game:game(1),date:'2026-09-10',duration:45,mode:'个人',players:[{name:'小林',score:'65',rank:1},{name:'朋友',score:'60',rank:2}],note:'',visibility:'仅自己'}
    ]
  }
}
