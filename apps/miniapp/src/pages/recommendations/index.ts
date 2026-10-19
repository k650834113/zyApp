import { getMiniappClient } from '../../services/client'
import { getUiDemo } from '../../services/ui-demo'
import { rememberGameDetail } from '../../services/game-detail-context'
import { toBoardGameCardView, type BoardGameCardView } from '../../services/board-game-library'
type RecommendationView = BoardGameCardView & { reason: string; audience: string; badge: string; sceneIds:string[] }
Page({
  data: { loading: true, demo: false, heroUrl:'', heroTitle:'', errorMessage: '', games: [] as RecommendationView[], allGames: [] as RecommendationView[], scene: 'all' },
  onShow() { void this.load() },
  async load() {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const home = await getMiniappClient().getHome()
      const demo = getUiDemo()
      const content = home.content?.schemaVersion === 1 ? home.content : null
      this.setData({heroUrl:demo ? '/assets/images/recommendations-hero-v1.png' : content?.recommendationHeroUrl || '',heroTitle:demo ? '好桌游\n让相聚更简单' : content?.recommendationHeroTitle || '店家推荐'})
      const allGames = (demo?.home ?? home).recommendedGames.map(game => ({
        ...toBoardGameCardView(game), sceneIds:game.recommendationSceneIds??[],
        reason: demo?.recommendationCopy[game.id]?.reason || game.recommendationReason || game.customerNote || '',
        audience: demo?.recommendationCopy[game.id]?.audience || game.recommendationAudience || '',
        badge: demo ? game.customerNote || '' : game.recommendationBadge || ''
      }))
      this.setData({ allGames, demo: !!demo }); this.applyScene()
    } catch { this.setData({ games: [], allGames: [], errorMessage: '推荐加载失败，请重试' }) }
    finally { this.setData({ loading: false }) }
  },
  selectScene(event: { currentTarget: { dataset: { scene: string } } }) { this.setData({ scene: event.currentTarget.dataset.scene }); this.applyScene() },
  applyScene() {
    this.setData({ games: this.data.allGames.filter(game => this.data.scene === 'two' ? game.sceneIds.includes('two') : this.data.scene === 'group' ? game.sceneIds.includes('group') : true) })
  },
  goGameDetail(event: { currentTarget: { dataset: { id: string } } }) {
    const game = this.data.allGames.find(game => game.id === event.currentTarget.dataset.id)
    if (!game) return
    rememberGameDetail({ ...game, customerNote: game.reason || game.customerNote })
    wx.navigateTo({ url: '/pages/game-detail/index?id=' + encodeURIComponent(game.id) })
  },
  imageError(event: { currentTarget: { dataset: { id: string } } }) {
    this.setData({ allGames: this.data.allGames.map(game => game.id === event.currentTarget.dataset.id ? { ...game, imageFailed: true } : game) }); this.applyScene()
  },
  goExpansions(event: { currentTarget: { dataset: { id: string, name: string } } }) {
    wx.navigateTo({ url: '/pages/game-expansions/index?baseGameId=' + encodeURIComponent(event.currentTarget.dataset.id) + '&baseGameName=' + encodeURIComponent(event.currentTarget.dataset.name) })
  },
  goGames() { wx.reLaunch({ url: '/pages/games/index' }) }
})
