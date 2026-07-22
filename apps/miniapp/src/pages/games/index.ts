import type { PublicBoardGameSummary } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'

const difficultyLabels = {
  light: '轻度',
  medium: '中度',
  heavy: '重度'
} as const

type GameView = PublicBoardGameSummary & {
  difficultyText: string
  durationText: string
}

function toView(game: PublicBoardGameSummary): GameView {
  return {
    ...game,
    difficultyText: difficultyLabels[game.difficulty],
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
      const games = await getMiniappClient().listGames(query)
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
