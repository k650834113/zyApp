import { describe, expect, it } from 'vitest'
import type { MiniappContentWorkspace, PublicBoardGameSummary, PublicActivitySummary } from '@zyapp/contracts'
import { currentMiniappDraft } from './miniapp-current-content'

function workspace(): MiniappContentWorkspace {
  return {revision:null,draft:{schemaVersion:1,homeHeroTitle:'未发布草稿'},published:null,current:{
    readAt:'2026-10-05T00:00:00Z',
    home:{store:{id:'store',name:'当前门店',address:null,contactPhone:null,businessHours:'10:00-22:00',isOpen:true,statusText:'营业'},announcements:[],activities:[],recommendedGames:[],content:null},
    pricing:{rows:[{label:'入场费',regular:'¥40',member:'¥30'},{label:'包场费',regular:'¥500',member:'¥400'}],monthlyCard:{planName:'月卡',priceFen:20000,durationDays:30}}
  }}
}
describe('editing current miniapp content', () => {
  it('roundtrips a published cover independently from the detail poster', () => {
    const data = workspace()
    data.current!.home.activities = [{ id:'event', coverUrl:'https://example.com/cover.jpg', posterUrl:'https://example.com/poster.jpg' }] as PublicActivitySummary[]
    expect(currentMiniappDraft(data).activityDisplays?.[0]).toMatchObject({coverUrl:'https://example.com/cover.jpg',posterUrl:'https://example.com/poster.jpg'})
    data.current!.home.activities[0]!.coverUrl = null
    expect(currentMiniappDraft(data).activityDisplays?.[0]?.coverUrl).toBeNull()
  })
  it('loads current public defaults without substituting unpublished drafts or every fee', () => {
    const value = currentMiniappDraft(workspace())
    expect(value.homeHeroTitle).toBe('当前门店')
    expect(value.recommendationHeroTitle).toBe('店家推荐')
    expect(value.pricing?.rows.map(row => row.label)).toEqual(['入场费'])
    expect(value).not.toHaveProperty('revision')
  })
  it('preserves explicit empty pricing and published documents while stripping publication metadata', () => {
    const data = workspace()
    data.current!.home.content = {schemaVersion:1,revision:'published',publishedAt:'2026-10-05T00:00:00Z',homeHeroTitle:'已发布标题',pricing:{rows:[],extras:[],memberNote:''},documents:[{key:'help',title:'帮助',version:'1',body:'正文',updatedAt:'2026-10-05T00:00:00Z'}]}
    const value = currentMiniappDraft(data)
    expect(value.homeHeroTitle).toBe('已发布标题')
    expect(value.pricing?.rows).toEqual([])
    expect(value.documents?.[0]?.body).toBe('正文')
    expect(value).not.toHaveProperty('publishedAt')
  })
  it('loads actual activity and recommendation copy and retains configured items outside the public list', () => {
    const data = workspace()
    data.current!.home.activities = [{id:'activity',posterUrl:null,locationText:'门店',tags:['新手']}] as PublicActivitySummary[]
    data.current!.home.recommendedGames = [{id:'game',customerNote:'当前推荐说明'}] as PublicBoardGameSummary[]
    data.current!.home.content = {schemaVersion:1,revision:'r',publishedAt:'2026-10-05T00:00:00Z',recommendationDisplays:[{gameId:'other',reason:'保留',audience:'',badge:'',sceneIds:[]}]}
    const value = currentMiniappDraft(data)
    expect(value.activityDisplays?.[0]?.locationText).toBe('门店')
    expect(value.recommendationDisplays?.find(row => row.gameId === 'game')?.reason).toBe('当前推荐说明')
    expect(value.recommendationDisplays?.find(row => row.gameId === 'other')?.reason).toBe('保留')
    expect(data.draft?.homeHeroTitle).toBe('未发布草稿')
  })
  it('supports older servers using only published configuration', () => {
    const data = workspace()
    delete data.current
    data.published = {schemaVersion:1,revision:'r',publishedAt:'2026-10-05T00:00:00Z',homeHeroTitle:'已发布'}
    expect(currentMiniappDraft(data)).toEqual({schemaVersion:1,homeHeroTitle:'已发布'})
  })
})
