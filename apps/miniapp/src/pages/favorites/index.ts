import {
  toBoardGameCardView,
  withLikeResult,
  type BoardGameCardView
} from '../../services/board-game-library'
import { getMiniappClient } from '../../services/client'

type GameEvent = { detail: { gameId: string } }

function requestId(): string {
  return `favorite-like-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

Page({
  data: {
    loading: true,
    loadFailed: false,
    games: [] as BoardGameCardView[]
  },

  onShow() {
    void this.loadFavorites()
  },

  async loadFavorites() {
    this.setData({ loading: true })
    try {
      const result = await getMiniappClient().listFavoriteGames()
      const existing = new Map(this.data.games.map((game) => [game.id, game]))
      this.setData({
        games: result.map((game) => {
          const previous = existing.get(game.id)
          return toBoardGameCardView(game, {
            expanded: previous?.expanded ?? false,
            imageFailed: previous?.imageFailed ?? false,
            likeBusy: false
          })
        }),
        loadFailed: false
      })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({
        title: error instanceof Error ? error.message : '收藏加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  retry() {
    void this.loadFavorites()
  },

  toggleGame(event: GameEvent) {
    const gameId = event.detail.gameId
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId ? { ...game, expanded: !game.expanded } : game
      )
    })
  },

  imageError(event: GameEvent) {
    const gameId = event.detail.gameId
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId ? { ...game, imageFailed: true } : game
      )
    })
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
    }
  },

  goLibrary() {
    wx.reLaunch({ url: '/pages/games/index' })
  }
})
