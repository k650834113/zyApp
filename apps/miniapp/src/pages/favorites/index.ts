import {
  toBoardGameCardView,
  withLikeResult,
  type BoardGameCardView
} from '../../services/board-game-library'
import { getMiniappClient } from '../../services/client'
import { createShareAppMessage } from '../../services/share'

type GameEvent = { detail: { gameId: string } }

function requestId(): string {
  return `favorite-like-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

Page({
  sequence:0,
  searchTimer:null as ReturnType<typeof setTimeout>|null,
  onUnload(){this.sequence++;if(this.searchTimer)clearTimeout(this.searchTimer)},
  onReachBottom(){if(!this.data.loading&&this.data.hasMore)void this.loadFavorites(true)},
  onShareAppMessage() {
    return createShareAppMessage('我喜欢的桌游')
  },

  data: {
    query: '',
    visibleGames: [] as BoardGameCardView[],
    loading: true,
    loadFailed: false,
    hasMore:false,
    games: [] as BoardGameCardView[]
  },

  onShow() {
    void this.loadFavorites()
  },
  onQueryInput(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value }); this.applySearch()
    if(this.searchTimer)clearTimeout(this.searchTimer)
    this.searchTimer=setTimeout(()=>{this.searchTimer=null;void this.loadFavorites()},300)
  },
  applySearch() {
    const query = this.data.query.trim().toLocaleLowerCase('zh-CN')
    this.setData({ visibleGames: this.data.games.filter(game => game.name.toLocaleLowerCase('zh-CN').includes(query)) })
  },

  async loadFavorites(append=false) {
    const sequence=++this.sequence
    this.setData({ loading: true })
    try {
      const result = await getMiniappClient().listFavoriteGames({query:this.data.query,limit:24,offset:append?this.data.games.length:0})
      if(sequence!==this.sequence)return
      const existing = new Map(this.data.games.map((game) => [game.id, game]))
      this.setData({
        hasMore:result.length===24,
        games: [...(append?this.data.games:[]),...result.map((game) => {
          const previous = existing.get(game.id)
          return toBoardGameCardView(game, {
            expanded: previous?.expanded ?? false,
            imageFailed: previous?.imageFailed ?? false,
            likeBusy: false
          })
        })],
        loadFailed: false
      })
    } catch (error) {
      if(sequence!==this.sequence)return
      this.setData({ loadFailed: true })
      wx.showToast({
        title: error instanceof Error ? error.message : '收藏加载失败',
        icon: 'none'
      })
    } finally {
      if(sequence!==this.sequence)return
      this.setData({ loading: false })
      this.applySearch()
    }
  },

  retry() {
    void this.loadFavorites()
  },

  imageError(event: GameEvent) {
    const gameId = event.detail.gameId
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId ? { ...game, imageFailed: true } : game
      )
    })
    this.applySearch()
  },

  async likeGame(event: GameEvent) {
    const gameId = event.detail.gameId
    const original = this.data.games.find((game) => game.id === gameId)
    if (!original || original.likeBusy) return
    const liked = !original.likedByViewer
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId
          ? {
              ...game,
              likedByViewer: liked,
              likeCount: Math.max(0, game.likeCount + (liked ? 1 : -1)),
              likeBusy: true
            }
          : game
      )
    })
    this.applySearch()
    try {
      const result = await getMiniappClient().setGameLiked(gameId, {
        liked,
        requestId: requestId()
      })
      const reconciled = withLikeResult(this.data.games, result)
      this.setData({
        games: result.likedByViewer
          ? reconciled
          : reconciled.filter((game) => game.id !== gameId)
      })
    } catch {
      this.setData({
        games: this.data.games.map((game) =>
          game.id === gameId ? { ...original, likeBusy: false } : game
        )
      })
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    } finally { this.applySearch() }
  },

  goLibrary() {
    wx.reLaunch({ url: '/pages/games/index' })
  }
})
