import type { BoardGameSourceAttribution } from '@zyapp/contracts'
import {
  toBoardGameCardView,
  withLikeResult,
  type BoardGameCardView
} from '../../services/board-game-library'
import { getMiniappClient } from '../../services/client'
import { createShareAppMessage } from '../../services/share'
import { getGameDetailContext } from '../../services/game-detail-context'

type GameEvent = { detail: { gameId: string } }

const PAGE_SIZE = 24
let loadSequence = 0

function requestId(): string {
  return `expansion-like-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function decodedPageOption(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('桌游扩展')
  },

  data: {
    baseCover: '',
    searchOpen: false,
    baseGameId: '',
    baseGameName: '基础游戏',
    query: '',
    games: [] as BoardGameCardView[],
    resultCount: 0,
    loading: true,
    loadingMore: false,
    hasMore: true,
    loadFailed: false,
    sourceAttribution: null as BoardGameSourceAttribution | null
  },

  onLoad(options: { baseGameId?: string; baseGameName?: string }) {
    const baseGameId = options.baseGameId ?? ''
    const baseGameName = decodedPageOption(options.baseGameName, '基础游戏')
    const base = getGameDetailContext(baseGameId)
    this.setData({ baseGameId, baseGameName: base?.name || baseGameName, baseCover: base?.imageUrl || '' })
    wx.setNavigationBarTitle({ title: '游戏扩展' })
    void this.loadGames()
  },

  onReachBottom() {
    void this.loadMore()
  },

  async loadGames(append = false) {
    if (!this.data.baseGameId) { this.setData({ loading: false, hasMore: false }); return }
    const sequence = ++loadSequence
    const previous = this.data.games
    this.setData(append ? { loadingMore: true } : { loading: true })
    try {
      const query = this.data.query.trim()
      const result = await getMiniappClient().listGames({
        baseGameId: this.data.baseGameId,
        ...(query ? { query } : {}),
        limit: PAGE_SIZE,
        offset: append ? previous.length : 0
      })
      if (sequence !== loadSequence) return
      const linkedResult = result.filter(
        (game) => game.baseGameId === this.data.baseGameId
      )
      const existing = new Map(previous.map((game) => [game.id, game]))
      const next = linkedResult.map((game) => {
        const current = existing.get(game.id)
        return toBoardGameCardView(game, {
          expanded: current?.expanded ?? false,
          likeBusy: false,
          imageFailed: current?.imageFailed ?? false
        })
      })
      const games = append ? [...previous, ...next] : next
      this.setData({
        games,
        resultCount: games.length,
        hasMore:
          result.length === PAGE_SIZE && linkedResult.length === result.length,
        loadFailed: false,
        sourceAttribution:
          games.find((game) => game.sourceAttribution !== null)
            ?.sourceAttribution ?? null
      })
    } catch (error) {
      if (sequence !== loadSequence) return
      if (!append) this.setData({ loadFailed: true })
      wx.showToast({
        title: error instanceof Error ? error.message : '扩展加载失败',
        icon: 'none'
      })
    } finally {
      if (sequence === loadSequence) {
        this.setData(append ? { loadingMore: false } : { loading: false })
      }
    }
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    return this.loadGames(true)
  },

  onQueryInput(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value })
  },
  toggleSearch() { this.setData({ searchOpen: !this.data.searchOpen }) },
  baseImageError() { this.setData({ baseCover: '' }) },
  goBase() {
    wx.navigateTo({ url: '/pages/game-detail/index?id=' + encodeURIComponent(this.data.baseGameId) })
  },

  search() {
    void this.loadGames()
  },

  retry() {
    void this.loadGames()
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
      this.setData({ games: withLikeResult(this.data.games, result) })
    } catch {
      this.setData({
        games: this.data.games.map((game) =>
          game.id === gameId ? { ...original, likeBusy: false } : game
        )
      })
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    }
  },

  copyBggSource() {
    const attribution = this.data.sourceAttribution
    if (!attribution) return
    wx.setClipboardData({ data: attribution.url })
  }
})
