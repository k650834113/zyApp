import {openCommunityPage} from '../../services/community-page'
import type { MiniappHomeSnapshot } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'
import { getUiDemo } from '../../services/ui-demo'
import { rememberGameDetail } from '../../services/game-detail-context'
import { createShareAppMessage } from '../../services/share'
import { publicActivityView, type PublicActivityView } from '../../services/public-content-display'
Page({
  data: { loading: true, errorMessage: '', demo: false, heroUrl:'', heroTitle:'', heroSubtitle:'', likeBusy: false, home: null as MiniappHomeSnapshot | null, activities: [] as PublicActivityView[], bannerActivities: [] as PublicActivityView[] },
  onShareAppMessage() { return { ...createShareAppMessage('一起玩桌游'), path: '/pages/home/index' } },
  onShow() { void this.load() },
  async load() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const fetched = await getMiniappClient().getHome()
      const demo = getUiDemo()
      const home = demo?.home ?? fetched
      const content = home.content?.schemaVersion === 1 ? home.content : null
      this.setData({heroUrl:demo ? '/assets/images/tabletop-hero-v1.png' : content?.homeHeroUrl || '',heroTitle:content?.homeHeroTitle || home.store.name,heroSubtitle:content?.homeHeroSubtitle || ''})
      const activities = home.activities.map(activity => publicActivityView(activity))
      this.setData({ demo: !!demo, home: { ...home, recommendedGames: home.recommendedGames.slice(0, 2) }, activities, bannerActivities: activities.filter(activity => activity.statusText === '进行中') })
    } catch {
      this.setData({ home: null, activities: [], bannerActivities: [], heroUrl: '', heroTitle: '', heroSubtitle: '', errorMessage: '门店内容暂时加载失败，桌游工具仍可使用。' })
    } finally { this.setData({ loading: false }) }
  },
  goActivity(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/activity-detail/index?id=' + encodeURIComponent(id) })
  },
  goRecommendations() { wx.navigateTo({ url: '/pages/recommendations/index' }) },
  goPricing() { wx.navigateTo({url:'/pages/pricing/index'}) },
  goRecord() { void openCommunityPage('play-create') },
  async likeRecommendation(event: { currentTarget: { dataset: { id: string } } }) {
    const game = this.data.home?.recommendedGames.find(item => item.id === event.currentTarget.dataset.id)
    if(!game || this.data.likeBusy) return
    this.setData({likeBusy:true})
    try {
      const result = await getMiniappClient().setGameLiked(game.id,{liked:!game.likedByViewer,requestId:'home-like-'+Date.now()})
      const home = this.data.home
      if(home) this.setData({home:{...home,recommendedGames:home.recommendedGames.map(item => item.id === game.id ? {...item,...result} : item)}})
    } catch { wx.showToast({title:'操作失败，请重试',icon:'none'}) }
    finally { this.setData({likeBusy:false}) }
  },
  imageError(event: { currentTarget: { dataset: { id: string } } }) {
    const home = this.data.home
    if (home) this.setData({ home: { ...home, recommendedGames: home.recommendedGames.map(game => game.id === event.currentTarget.dataset.id ? { ...game, imageUrl: null } : game) } })
  },
  goActivities() { wx.navigateTo({ url: '/pages/activities/index' }) },
  goAbout() { wx.navigateTo({ url: '/pages/about/index' }) },
  goGameDetail(event: { currentTarget: { dataset: { id: string } } }) {
    const game = this.data.home?.recommendedGames.find(game => game.id === event.currentTarget.dataset.id)
    if (!game) return
    rememberGameDetail(game)
    wx.navigateTo({ url: '/pages/game-detail/index?id=' + encodeURIComponent(game.id) })
  },
  goGames() { wx.reLaunch({ url: '/pages/games/index' }) },
  goTools() { wx.reLaunch({ url: '/pages/tools/index' }) },
  goScore() { wx.navigateTo({ url: '/pages/tool-score/index' }) },
  goHistory() { wx.reLaunch({ url: '/pages/history/index' }) },
  goProfile() { wx.reLaunch({ url: '/pages/member/index' }) },
  goHome() {}
})
