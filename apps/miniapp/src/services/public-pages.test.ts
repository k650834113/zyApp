import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicActivityView } from './public-content-display'
const client = vi.hoisted(() => ({ getPublicPricing:vi.fn(),getGame:vi.fn(),getHome: vi.fn(), listActivities: vi.fn(), listFavoriteGames: vi.fn(), setGameLiked: vi.fn() }))
vi.mock('./client', () => ({ getMiniappClient: () => client }))
type TestPage = {
  data: Record<string, any>
  setData: (patch: Record<string, any>) => void
  load: (id?: string) => Promise<void>
  onLoad: (options: Record<string, string>) => void
  [key: string]: any
}
async function loadPage(name: 'recommendations' | 'home' | 'activity-detail' | 'game-detail' | 'favorites' | 'about' | 'pricing') {
  let page!: TestPage
  vi.stubGlobal('Page', (definition: TestPage) => {
    page = definition
    page.setData = patch => Object.assign(page.data, patch)
  })
  if (name === 'recommendations') await import('../pages/recommendations/index')
  else if (name === 'pricing') await import('../pages/pricing/index')
  else if (name === 'home') await import('../pages/home/index')
  else if (name === 'game-detail') await import('../pages/game-detail/index')
  else if (name === 'favorites') await import('../pages/favorites/index')
  else if (name === 'about') await import('../pages/about/index')
  else await import('../pages/activity-detail/index')
  return page
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })
describe('public page behavior', () => {
  it('uses PC-published covers for any activity without substituting its detail poster', () => {
    const activity = { id: 'any-store-event', title: '活动', startsAt: '2026-10-24T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', posterUrl: 'https://example.com/poster.jpg' } as Parameters<typeof publicActivityView>[0]
    expect(publicActivityView(activity).coverUrl).toBe('')
    expect(publicActivityView({ ...activity, coverUrl: 'https://example.com/cover.jpg' }).coverUrl).toBe('https://example.com/cover.jpg')
    expect(publicActivityView({ ...activity, coverUrl: null }).posterUrl).toBe(activity.posterUrl)
  })
  it('keeps only ongoing events beside the permanent homepage slide and clears them on failure', async () => {
    const now = Date.now()
    const activity = { id: 'anniversary', title: '据点店庆第三弹｜到店登记，抽一年免费畅玩', summary: '完整规则留在详情', posterUrl: '/long-poster.jpg', startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60000).toISOString() }
    client.getHome.mockResolvedValue({ store: { name: '据点' }, content: { schemaVersion: 1, homeHeroUrl: '/store-cover.jpg' }, recommendedGames: [], activities: [activity, { ...activity, id: 'future', startsAt: new Date(now + 30000).toISOString() }, { ...activity, id: 'ended', endsAt: new Date(now - 1).toISOString() }] })
    const page = await loadPage('home')
    await page.load()
    expect(page.data.heroUrl).toBe('/store-cover.jpg')
    expect(page.data.bannerActivities.map((item: any) => item.id)).toEqual(['anniversary'])
    expect(page.data.bannerActivities[0].coverTitle).toBe('据点店庆第三弹')
    expect(page.data.activities).toHaveLength(3)
    client.getHome.mockRejectedValue(new Error('offline'))
    await page.load()
    expect(page.data.bannerActivities).toEqual([])
    expect(page.data.heroUrl).toBe('')
  })
  it('shows only published pricing rows and extras, including an explicitly empty selection', async () => {
    const admission = {label:'入场费',regular:'40元',member:'30元'}
    const selected = {label:'学生价',regular:'20元',member:'20元'}
    const extra = {icon:'receipt',label:'自选说明',value:'到店确认',note:''}
    client.getPublicPricing.mockResolvedValue({rows:[admission,{label:'包场费',regular:'500元',member:'400元'}],monthlyCard:{priceFen:20000,durationDays:30}})
    client.getHome.mockResolvedValue({content:{schemaVersion:1,pricing:{rows:[selected],extras:[extra],memberNote:''}}})
    const page = await loadPage('pricing')
    await page.load()
    expect(page.data.rows).toEqual([selected])
    expect(page.data.extras).toEqual([extra])
    client.getHome.mockResolvedValue({content:{schemaVersion:1,pricing:{rows:[],extras:[],memberNote:''}}})
    await page.load()
    expect(page.data.rows).toEqual([])
    client.getHome.mockResolvedValue({})
    await page.load()
    expect(page.data.rows).toEqual([admission])
  })
  it('reads published store contacts and clears them when an older response omits content', async () => {
    const store = { name: '正式门店', address: null, contactPhone: null }
    const contacts = [{ id: 'contact-1', label: '微信', value: 'pc-published-contact', action: 'copy' }]
    client.getHome.mockResolvedValue({store,content:{schemaVersion:1,revision:'r1',publishedAt:'2026-09-13T00:00:00Z',contacts,storePhotoUrl:'https://example.com/uploaded.jpg'}})
    const page = await loadPage('about')
    await page.load()
    expect(page.data.contacts).toEqual(contacts)
    expect(page.data.content.storePhotoUrl).toBe('https://example.com/uploaded.jpg')
    client.getHome.mockResolvedValue({store})
    await page.load()
    expect(page.data.contacts).toEqual([])
    expect(page.data.content).toBeNull()
  })
  it('searches favorites locally and removes a canceled favorite from both the result and source list', async () => {
    const game = { id: 'game-1', name: 'Test Game', baseGameId: null, categories: ['策略'], minPlayers: 2, maxPlayers: 4, minMinutes: 30, maxMinutes: 45, complexityRating: 2, expansionCount: 0, likedByViewer: true, likeCount: 1 }
    client.listFavoriteGames.mockResolvedValue([game])
    client.setGameLiked.mockResolvedValue({ gameId: game.id, likedByViewer: false, likeCount: 0 })
    const page = await loadPage('favorites')
    await page.loadFavorites()
    page.onQueryInput({ detail: { value: ' TEST ' } })
    expect(page.data.visibleGames.map((item: any) => item.id)).toEqual(['game-1'])
    page.onQueryInput({ detail: { value: '不存在' } })
    expect(page.data.visibleGames).toEqual([])
    expect(page.data.games).toHaveLength(1)
    page.onQueryInput({ detail: { value: '' } })
    await page.likeGame({ detail: { gameId: 'game-1' } })
    expect(page.data.games).toEqual([])
    expect(page.data.visibleGames).toEqual([])
  })
  it('opens any game card through the shared detail route without triggering the description toggle', async () => {
    let component: any
    const navigateTo = vi.fn()
    vi.stubGlobal('wx', { navigateTo })
    vi.stubGlobal('Component', (definition: any) => { component = definition })
    await import('../components/board-game-card/index')
    const game = { id: 'ordinary-game', name: '普通桌游', imageUrl: '/uploaded-cover.png' }
    const triggerEvent = vi.fn()
    component.methods.viewDetail.call({ data: { game }, triggerEvent })
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/game-detail/index?id=ordinary-game' })
    expect(triggerEvent).not.toHaveBeenCalled()
    const { getGameDetailContext } = await import('./game-detail-context')
    expect(getGameDetailContext(game.id)).toEqual(game)
  })
  it('shows an unavailable game detail without substituting demo data or fetching unrelated games', async () => {
    client.getGame.mockRejectedValue(new Error('not found'))
    const page = await loadPage('game-detail')
    await page.load('missing-game')
    expect(page.data.game).toBeNull()
    expect(page.data.loading).toBe(false)
    expect(page.data.errorMessage).toContain('暂不可用')
    expect(client.getHome).not.toHaveBeenCalled()
    expect(client.getGame).toHaveBeenCalledWith('missing-game')
  })
  it('loads the guest homepage through public content only and clears stale content on failure', async () => {
    client.getHome.mockResolvedValue({ store: { name: '门店' }, activities: [], recommendedGames: [] })
    const page = await loadPage('home')
    await page.load()
    expect(page.data.home.store.name).toBe('门店')
    expect(page.data.loading).toBe(false)
    client.getHome.mockRejectedValue(new Error('offline'))
    await page.load()
    expect(page.data.home).toBeNull()
    expect(page.data.errorMessage).toContain('桌游工具仍可使用')
  })
  it('does not share or retain a detail after it is taken down, and distinguishes network failure', async () => {
    const activity = { id: 'event', title: '活动', startsAt: '2026-09-12T11:00:00Z', endsAt: '2026-09-12T15:00:00Z' }
    client.listActivities.mockResolvedValue([activity])
    const page = await loadPage('activity-detail')
    page.onLoad({ id: 'event' }); await page.load()
    expect(page.data.activity.id).toBe('event')
    expect(page.onShareAppMessage().path).toContain('id=event')
    client.listActivities.mockResolvedValue([]); await page.load()
    expect(page.data.activity).toBeNull()
    expect(page.data.unavailable).toBe(true)
    expect(page.onShareAppMessage().path).toBe('/pages/activities/index')
    client.listActivities.mockRejectedValue(new Error('offline')); await page.load()
    expect(page.data.unavailable).toBe(false)
    expect(page.data.errorMessage).not.toBe('')
  })
  it('uses Beijing time and treats start and end as exact state boundaries', () => {
    const activity = { startsAt: '2026-09-12T11:00:00Z', endsAt: '2026-09-12T15:00:00Z' } as Parameters<typeof publicActivityView>[0]
    expect(publicActivityView(activity, Date.parse(activity.startsAt) - 1).statusText).toBe('活动预告')
    expect(publicActivityView(activity, Date.parse(activity.startsAt)).statusText).toBe('进行中')
    expect(publicActivityView(activity, Date.parse(activity.endsAt)).statusText).toBe('已结束')
    expect(publicActivityView(activity).startsAtText).toBe('2026-09-12 19:00')
  })
})

it('filters staff recommendation scenes without inferring from player counts',async()=>{
  vi.stubGlobal('__ZYAPP_UI_DEMO_ENABLED__',false)
  const base={imageUrl:null,categories:[],minPlayers:2,maxPlayers:8,minMinutes:30,maxMinutes:60,complexityRating:1,difficulty:'light'}
  client.getHome.mockResolvedValue({content:{schemaVersion:1},recommendedGames:[
    {...base,id:'unclassified',name:'支持两人但未推荐'},
    {...base,id:'two',name:'双人推荐',recommendationSceneIds:['two']},
    {...base,id:'group',name:'多人推荐',recommendationSceneIds:['group']},
    {...base,id:'both',name:'两个分类',recommendationSceneIds:['two','group']}
  ]})
  const page=await loadPage('recommendations');await page.load();expect(page.data.games).toHaveLength(4)
  page.selectScene({currentTarget:{dataset:{scene:'two'}}});expect(page.data.games.map((g:any)=>g.id)).toEqual(['two','both'])
  page.selectScene({currentTarget:{dataset:{scene:'group'}}});expect(page.data.games.map((g:any)=>g.id)).toEqual(['group','both'])
})
