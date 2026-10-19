import {openCommunityPage} from '../../services/community-page'
import { getMiniappClient } from '../../services/client'
import { getGameDetailContext, rememberGameDetail } from '../../services/game-detail-context'
import { toBoardGameCardView, withLikeResult, type BoardGameCardView } from '../../services/board-game-library'

Page({
  data: { game: null as BoardGameCardView | null, expansions: [] as BoardGameCardView[], loading: true, errorMessage: '', expansionError: false, likeBusy: false },
  onLoad(options: { id?: string }) { void this.load(options.id || '') },
  async load(id: string) {
    let game = getGameDetailContext(id)
    if (!game) {
      try { game = await getMiniappClient().getGame(id); rememberGameDetail(game) }
      catch { this.setData({ game: null, loading: false, errorMessage: '该游戏资料暂不可用，请返回桌游库重试。' }); return }
    }
    this.setData({ game: toBoardGameCardView(game), loading: false })
    wx.setNavigationBarTitle({ title: game.name })
    if (game.expansionCount) {
      try { this.setData({ expansions: (await getMiniappClient().listGames({ baseGameId: id, limit: 2 })).map(game => toBoardGameCardView(game)) }) }
      catch { this.setData({ expansionError: true }) }
    }
  },
  async likeGame() {
    const game = this.data.game
    if (!game || this.data.likeBusy) return
    this.setData({ likeBusy: true })
    try {
      const result = await getMiniappClient().setGameLiked(game.id, { liked: !game.likedByViewer, requestId: 'detail-like-' + Date.now() + '-' + Math.random().toString(36).slice(2) })
      const updated = withLikeResult([game], result)[0]
      if (!updated) return
      rememberGameDetail(updated); this.setData({ game: updated })
    } catch { wx.showToast({ title: '操作失败，请重试', icon: 'none' }) }
    finally { this.setData({ likeBusy: false }) }
  },
  imageError() { if (this.data.game) this.setData({ game: { ...this.data.game, imageFailed: true } }) },
  expansionImageError(event: {currentTarget:{dataset:{id:string}}}) {
    this.setData({ expansions: this.data.expansions.map(game => game.id === event.currentTarget.dataset.id ? {...game,imageFailed:true} : game) })
  },
  openExpansion(event: {currentTarget:{dataset:{id:string}}}) {
    const game = this.data.expansions.find(game => game.id === event.currentTarget.dataset.id)
    if (!game) return
    rememberGameDetail(game)
    wx.navigateTo({url:'/pages/game-detail/index?id=' + encodeURIComponent(game.id)})
  },
  goGames() { wx.reLaunch({ url: '/pages/games/index' }) },
  selectCategory(event: {currentTarget:{dataset:{category:string}}}) {
    wx.reLaunch({url:'/pages/games/index?category=' + encodeURIComponent(event.currentTarget.dataset.category)})
  },
  goExpansions() {
    const game = this.data.game
    if (game) wx.navigateTo({ url: '/pages/game-expansions/index?baseGameId=' + encodeURIComponent(game.id) + '&baseGameName=' + encodeURIComponent(game.name) })
  },
  goRecord() { void openCommunityPage('play-create') },
  goMeetup() {void openCommunityPage('meetup-create')}
})
