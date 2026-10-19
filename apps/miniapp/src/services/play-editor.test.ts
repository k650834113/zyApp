import {afterEach,expect,it,vi} from 'vitest'
const remote=vi.hoisted(()=>({getMemberSummary:vi.fn(),community:{savePlay:vi.fn()}}))
vi.mock('./client',()=>({getMiniappClient:()=>remote}))
afterEach(()=>{vi.resetModules();vi.unstubAllGlobals();vi.clearAllMocks()})
async function editor(){
  let p:any
  vi.stubGlobal('Page',(value:any)=>{p=value;p.setData=(patch:any)=>Object.assign(p.data,patch)})
  vi.stubGlobal('wx',{pageScrollTo:vi.fn(),redirectTo:vi.fn()})
  const {registerCloudCommunityPage}=await import('./community-cloud-page');registerCloudCommunityPage('play-create');p.onLoad({})
  return p
}
function input(p:any,index:number,field:string,value:string){p.inputPlayer({detail:{value},currentTarget:{dataset:{index,field}}})}
it('recomputes ranks while typing and after changing direction or removing a player',async()=>{
  const p=await editor();p.setData({players:[{name:'甲',score:'',rank:0},{name:'乙',score:'',rank:0},{name:'丙',score:'',rank:0}]})
  input(p,0,'score','10');input(p,1,'score','5');input(p,2,'score','10')
  expect(p.data.players.map((x:any)=>x.rank)).toEqual([1,3,1])
  p.toggleRank();expect(p.data.players.map((x:any)=>x.rank)).toEqual([2,1,2])
  p.removePlayer({currentTarget:{dataset:{index:0}}});expect(p.data.players.map((x:any)=>x.rank)).toEqual([1,2])
})
it('edits a shared team score and cooperative outcome in the player table',async()=>{
  const p=await editor();p.setData({mode:'团队',players:[{name:'甲',team:'A',score:'1',rank:1},{name:'乙',team:'A',score:'1',rank:1},{name:'丙',team:'B',score:'5',rank:2}]})
  input(p,0,'score','9');expect(p.data.players.map((x:any)=>x.score)).toEqual(['9','9','5']);expect(p.data.players.map((x:any)=>x.rank)).toEqual([1,1,2])
  p.setMode({currentTarget:{dataset:{mode:'合作'}}});input(p,0,'score','-2.5');p.chooseResult({detail:{value:'1'}})
  expect(p.data.players.every((x:any)=>x.score==='-2.5'&&x.outcome==='loss'&&x.rank===1)).toBe(true)
})
it('saves scoreless multiple winners and pinpoints empty names before contacting the API',async()=>{
  const p=await editor();p.setData({game:{id:'game'},players:[{name:'',score:'',rank:0,outcome:'win'},{name:'乙',score:'',rank:0,outcome:'win'}],resultType:'multiple',recordScores:false})
  await p.savePlay();expect(remote.community.savePlay).not.toHaveBeenCalled();expect(p.data.playerErrors[0].name).toContain('玩家1')
  expect(wx.pageScrollTo).toHaveBeenCalledWith({selector:'#field-players-0-name',duration:200})
  input(p,0,'name','甲');expect(p.data.playerErrors[0].name).toBeUndefined()
  remote.community.savePlay.mockResolvedValue({id:'saved'});await p.savePlay()
  expect(remote.community.savePlay.mock.calls[0]![0]).toMatchObject({recordScores:false,resultType:'multiple'})
})
it('preserves indexed server errors and retry identity',async()=>{
  const p=await editor();p.setData({game:{id:'game'},players:[{name:'甲',score:'1',rank:1}]})
  remote.community.savePlay.mockRejectedValue(Object.assign(new Error('时长无效'),{fieldErrors:{duration:'时长无效'}}))
  await p.savePlay();const id=remote.community.savePlay.mock.calls[0]![0].requestId
  expect(p.data.fieldErrors.duration).toBe('时长无效');await p.savePlay();expect(remote.community.savePlay.mock.calls[1]![0].requestId).toBe(id)
})
it('resets the source scorer only after a successful save, including a failed retry',async()=>{
  const {rememberScoreDraft}=await import('./community-model');const onSaved=vi.fn()
  rememberScoreDraft({players:[{name:'本人',score:'9',rank:1}],onSaved})
  const p=await editor();p.setData({game:{id:'game'}})
  remote.community.savePlay.mockRejectedValueOnce(new Error('保存失败'))
  await p.savePlay();expect(onSaved).not.toHaveBeenCalled();expect(p.data.players[0].score).toBe('9')
  remote.community.savePlay.mockResolvedValue({id:'saved'});await p.savePlay()
  expect(onSaved).toHaveBeenCalledTimes(1);expect(p.scoreSaved).toBeNull()
})
