import {afterEach,expect,it,vi} from 'vitest'
import type {CommunitySnapshot} from './community-model'
const state=vi.hoisted(()=>({value:null as CommunitySnapshot|null}))
const remote=vi.hoisted(()=>({getMemberSummary:vi.fn(async()=>null as object|null),listGames:vi.fn(),community:{getMeetup:vi.fn(),savePlay:vi.fn(),createMeetup:vi.fn(),actMeetup:vi.fn()}}))
vi.mock('./ui-demo',()=>({getCommunityDemo:()=>state.value,getUiDemo:()=>null}))
vi.mock('./client',()=>({getMiniappClient:()=>remote}))
afterEach(()=>{vi.resetModules();vi.unstubAllGlobals();vi.clearAllMocks();state.value=null})
async function page(surface:'meetup-detail'|'play-create'){
  let definition:any
  const modal=vi.fn(),navigate=vi.fn()
  vi.stubGlobal('wx',{showModal:modal,navigateTo:navigate,redirectTo:navigate,showToast:vi.fn()})
  vi.stubGlobal('Page',(value:any)=>{definition=value;value.setData=(patch:any)=>Object.assign(value.data,patch)})
  const {registerCommunityPage}=await import('./community-page')
  registerCommunityPage(surface)
  return {definition,modal,navigate}
}
it('never publishes or saves a success when the demo provider is absent',async()=>{
  const {definition,modal,navigate}=await page('play-create')
  definition.onLoad({})
  await definition.publish()
  await definition.savePlay()
  await definition.join()
  expect(modal).not.toHaveBeenCalled()
  expect(definition.data.error).toBe('请选择游戏')
  expect(navigate).not.toHaveBeenCalled()
  expect(definition.data.demo).toBe(false)
})
it('joins once without exceeding capacity and rejects a full meetup',async()=>{
  const game={id:'g',name:'游戏',imageUrl:null}
  state.value={plays:[],meetups:[{id:'m',game,title:'约局',date:'2026-09-19',time:'14:00',duration:60,capacity:2,deadline:'2026-09-19 12:00',location:'门店',description:'说明',tags:[],players:['发起人'],joined:false,owned:false}]}
  const {definition,navigate}=await page('meetup-detail')
  definition.onLoad({id:'m'})
  await definition.join()
  expect(state.value.meetups[0]?.players).toEqual(['发起人','我'])
  await definition.join()
  expect(state.value.meetups[0]?.players).toHaveLength(2)
  state.value.meetups[0]!.joined=false
  definition.onLoad({id:'m'})
  navigate.mockClear()
  await definition.join()
  expect(navigate).not.toHaveBeenCalled()
})
it('carries scorer totals into the draft without modifying its values',async()=>{
  const {rememberScoreDraft}=await import('./community-model')
  rememberScoreDraft({players:[{name:'甲',score:'-1.25',rank:1},{name:'乙',score:'9',rank:2}]})
  const {definition}=await page('play-create')
  definition.onLoad({})
  expect(definition.data.players.map((item:any)=>item.score)).toEqual(['-1.25','9'])
})
it('waits for HTTP persistence and reuses the request id after an uncertain failure',async()=>{
  const {definition,navigate}=await page('play-create')
  definition.onLoad({})
  definition.setData({ready:true,game:{id:'g',name:'桌游',imageUrl:null},players:[{name:'甲',score:'2.5',rank:1}]})
  remote.community.savePlay.mockRejectedValueOnce(new Error('网络中断'))
  await definition.savePlay()
  expect(navigate).not.toHaveBeenCalled()
  expect(definition.data.error).toContain('网络中断')
  const first=remote.community.savePlay.mock.calls[0]![0]
  remote.community.savePlay.mockResolvedValueOnce({id:'persisted'})
  await definition.savePlay()
  expect(remote.community.savePlay.mock.calls[1]![0].requestId).toBe(first.requestId)
  expect(navigate).toHaveBeenCalledWith({url:'/pages/play-detail/index?id=persisted'})
})
it('suppresses duplicate taps while the server has not confirmed a join',async()=>{
  const {definition,navigate}=await page('meetup-detail')
  definition.onLoad({id:'m'})
  definition.setData({ready:true,selected:{id:'m',joined:false,players:['甲'],capacity:2}})
  let resolve!:(value:object)=>void
  remote.community.actMeetup.mockReturnValueOnce(new Promise(r=>{resolve=r}))
  const pending=definition.join();await definition.join()
  expect(remote.community.actMeetup).toHaveBeenCalledTimes(1);expect(navigate).not.toHaveBeenCalled()
  resolve({id:'m',joined:true});await pending
  expect(navigate).toHaveBeenCalledWith({url:'/pages/meetup-success/index?id=m'})
})

it('loads a shared meetup for a guest and returns to it after login',async()=>{
  remote.getMemberSummary.mockResolvedValueOnce(null)
  const m={id:'shared',title:'约局',players:['甲'],capacity:4,status:'open',joined:false,participants:[{memberId:'a',name:'甲',avatarUrl:'https://example/avatar.png'}]}
  remote.community.getMeetup.mockResolvedValueOnce(m)
  const {definition,navigate}=await page('meetup-detail');definition.onLoad({id:'shared'});await definition.load()
  expect(definition.data.selected.id).toBe('shared');expect(definition.data.ready).toBe(false);expect(navigate).not.toHaveBeenCalled()
  expect(definition.onShareAppMessage().path).toBe('/pages/meetup-detail/index?id=shared')
  definition.avatarError({currentTarget:{dataset:{memberId:'a'}}});expect(definition.data.selected.participants[0].avatarUrl).toBeNull()
  await definition.join();expect(navigate).toHaveBeenCalledWith({url:'/pages/login/index'})
  const {consumeMeetupReturn}=await import('./meetup-return');expect(consumeMeetupReturn()).toBe('/pages/meetup-detail/index?id=shared');expect(consumeMeetupReturn()).toBeNull()
})
it('searches by keyword, ignores outdated responses and requires a new selection after editing',async()=>{
  const {definition}=await page('play-create')
  let finish!:(games:object[])=>void
  remote.listGames.mockReturnValueOnce(new Promise(r=>{finish=r})).mockResolvedValueOnce([{id:'b',name:'新版游戏'}])
  definition.inputGameQuery({detail:{value:'旧'}});definition.inputGameQuery({detail:{value:'新版'}})
  await Promise.resolve();finish([{id:'a',name:'旧游戏'}]);await Promise.resolve()
  expect(definition.data.games[0].id).toBe('b')
  definition.selectGame({currentTarget:{dataset:{id:'b'}}});expect(definition.data.game.id).toBe('b')
  remote.listGames.mockResolvedValueOnce([]);definition.inputGameQuery({detail:{value:'别的'}});expect(definition.data.game).toBeNull()
})
it('blocks full and expired meetups before submitting a join',async()=>{
  const {definition}=await page('meetup-detail');definition.setData({ready:true,selected:{id:'m',joined:false,players:['甲'],capacity:2,registrationClosed:true}})
  await definition.join();expect(remote.community.actMeetup).not.toHaveBeenCalled()
})
