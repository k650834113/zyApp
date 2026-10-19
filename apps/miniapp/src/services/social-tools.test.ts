import {afterEach,expect,it,vi} from 'vitest'
const remote=vi.hoisted(()=>({getMemberSummary:vi.fn(),community:{getTable:vi.fn()}}))
vi.mock('./client',()=>({getMiniappClient:()=>remote}))
vi.mock('./tool-feedback',()=>({playToolTone:vi.fn()}))
vi.mock('./community-page',()=>({openCommunityPage:vi.fn().mockResolvedValue(undefined)}))
afterEach(()=>{vi.useRealTimers();vi.resetModules();vi.unstubAllGlobals();vi.clearAllMocks()})
async function scorer(stored?:unknown){
  let p:any
  vi.stubGlobal('wx',{getStorageSync:()=>stored,setStorageSync:vi.fn(),showModal:vi.fn(),showToast:vi.fn()})
  vi.stubGlobal('Page',(value:any)=>{p=value;p.setData=(patch:any)=>{
    for(const [key,val] of Object.entries(patch)){const m=/^players\[(\d+)\]\.name$/.exec(key);if(m)p.data.players[Number(m[1])].name=val;else p.data[key]=val}
  }})
  await import('../pages/tool-score/index');p.onLoad();return p
}
it('defaults the first player to the member, but does not replace a restored sheet',async()=>{
  remote.getMemberSummary.mockResolvedValue({memberId:'me',nickname:'当前会员',avatarUrl:'avatar'})
  const p=await scorer();p.visible=true;await p.initializeMember()
  expect(p.data.players).toHaveLength(1);expect(p.data.rows[0].values).toEqual([''])
  expect(p.data.players[0]).toMatchObject({memberId:'me',name:'当前会员',avatarUrl:'avatar'})
  p.onUnload();vi.resetModules()
  const restored=await scorer({players:[{id:1,name:'旧玩家'}],rows:[{id:1,values:['5']}]});restored.visible=true;await restored.initializeMember()
  expect(restored.data.players[0].name).toBe('旧玩家');expect(restored.data.totals).toEqual(['5']);restored.onUnload()
})
it('imports members only once and stops table polling when hidden',async()=>{
  vi.useFakeTimers()
  const p=await scorer();p.setData({tableId:'table'});p.visible=true
  remote.community.getTable.mockResolvedValue({owned:true,closed:false,members:[{memberId:'one',name:'甲',avatarUrl:null},{memberId:'two',name:'乙',avatarUrl:null}]})
  await p.pollTable();expect(p.data.players.map((v:any)=>v.memberId)).toEqual(['one','two'])
  await p.pollTable();expect(p.data.players).toHaveLength(2)
  p.onHide();const count=remote.community.getTable.mock.calls.length
  await vi.advanceTimersByTimeAsync(10000);expect(remote.community.getTable.mock.calls).toHaveLength(count)
})
it('keeps removed table members removed and reports a full local sheet',async()=>{
  const p=await scorer();const m={memberId:'one',name:'甲',memberNumber:'1',avatarUrl:null}
  p.addMember(m);p.addPlayer();p.removePlayer({currentTarget:{dataset:{index:0}}})
  expect(p.suppressed.has('one')).toBe(true)
  p.setData({players:Array.from({length:8},(_,i)=>({id:i,name:'临时'+i})),rows:[{id:1,values:Array(8).fill('1')}]})
  p.addMember(m);expect(p.data.players).toHaveLength(8);expect(p.data.socialError).toContain('已满');p.onUnload()
})
it('clears scores only after confirmation and preserves linked names and avatars',async()=>{
  const p=await scorer();p.setSheet([{id:1,name:'甲',memberId:'one',avatarUrl:'avatar'}],[{id:1,values:['9']}])
  p.resetScores();const options=vi.mocked(wx.showModal).mock.calls[0]![0]
  options.success?.({confirm:false,cancel:true,errMsg:'',content:''});expect(p.data.totals).toEqual(['9'])
  options.success?.({confirm:true,cancel:false,errMsg:'',content:''});expect(p.data.totals).toEqual(['0']);expect(p.data.players[0].memberId).toBe('one');expect(p.data.players[0].avatarUrl).toBe('avatar');p.onUnload()
})
it('offers saving or direct reset and retains the score until saving succeeds',async()=>{
  remote.getMemberSummary.mockResolvedValue({memberId:'me',nickname:'本人',avatarUrl:'my-avatar'})
  const p=await scorer();p.visible=true;await p.initializeMember();p.addPlayer()
  p.setSheet(p.data.players,[{id:1,values:['9','4']}]);p.setData({tableId:'old-table',codePath:'code'})
  p.finishGame();const options=vi.mocked(wx.showModal).mock.calls[0]![0]
  expect(options.confirmText).toBe('保存对局');expect(options.cancelText).toBe('直接重置')
  options.success?.({confirm:true,cancel:false,errMsg:'',content:''})
  const {consumeScoreDraft}=await import('./community-model');const draft=consumeScoreDraft()!
  expect(draft.players.map(v=>v.score)).toEqual(['9','4']);expect(draft.tableId).toBe('old-table')
  expect(p.data.totals).toEqual(['9','4'])
  draft.onSaved?.();expect(p.data.players).toEqual([{id:1,name:'本人',memberId:'me',avatarUrl:'my-avatar'}])
  expect(p.data.rows[0].values).toEqual(['']);expect(p.data.tableId).toBe('');expect(p.data.codePath).toBe('')
  p.addPlayer();p.finishGame();vi.mocked(wx.showModal).mock.calls[1]![0].success?.({confirm:false,cancel:true,errMsg:'',content:''})
  expect(p.data.players).toHaveLength(1);expect(consumeScoreDraft()).toBeNull();p.onUnload()
})
it('retains the selected color after fingers lift and resets the locked result',async()=>{
  let p:any
  vi.stubGlobal('Page',(value:any)=>{p=value;p.setData=(patch:any)=>Object.assign(p.data,patch)})
  vi.stubGlobal('wx',{vibrateShort:vi.fn(),showToast:vi.fn()})
  await import('../pages/tool-first-player/index')
  p.data.markers=[{id:1,left:0,top:0,label:1,tone:'cyan',selected:false},{id:2,left:50,top:50,label:2,tone:'rose',selected:false}]
  p.selectFromMarkers();const color=p.data.winnerColor;expect(['#50d8ef','#ff718d']).toContain(color)
  p.handleTouchEnd({touches:[]});expect(p.data.selected).toBe(true);expect(p.data.winnerColor).toBe(color)
  p.reset();expect(p.data.winnerColor).toBe('');expect(p.data.markers).toEqual([])
})
