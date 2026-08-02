import type { PublicBoardGameSummary } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'

type GameView = PublicBoardGameSummary & {
  complexityText: string
  durationText: string
}

function toView(game: PublicBoardGameSummary): GameView {
  return {
    ...game,
    complexityText:
      game.complexityRating === null
        ? '复杂度待补充'
        : `复杂度 ${game.complexityRating.toFixed(1)}/5`,
    durationText:
      game.minMinutes === null
        ? '时长待补充'
        : `${game.minMinutes}-${game.maxMinutes ?? game.minMinutes} 分钟`
  }
}

Page({
  data: {
    query: '',
    games: [] as GameView[],
    loading: true
  },

  async onLoad() {
    await this.loadGames('')
  },

  async loadGames(query: string) {
    this.setData({ loading: true })
    try {
      const games = await getMiniappClient().listGames({ query })
      this.setData({ games: games.map(toView) })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  onQueryInput(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value })
  },

  search() {
    void this.loadGames(this.data.query)
  }
})
