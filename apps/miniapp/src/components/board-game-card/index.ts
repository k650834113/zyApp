import type { BoardGameCardView } from '../../services/board-game-library'

Component({
  properties: {
    game: { type: Object, value: null },
    showExpansionAction: { type: Boolean, value: false }
  },

  methods: {
    toggle() {
      const game = this.data.game as BoardGameCardView | null
      if (game) this.triggerEvent('toggle', { gameId: game.id })
    },
    like() {
      const game = this.data.game as BoardGameCardView | null
      if (game && !game.likeBusy) {
        this.triggerEvent('like', { gameId: game.id })
      }
    },
    viewExpansions() {
      const game = this.data.game as BoardGameCardView | null
      if (game) {
        this.triggerEvent('viewexpansions', {
          gameId: game.id,
          gameName: game.name
        })
      }
    },
    selectCategory(event: {
      currentTarget: { dataset: { category?: string } }
    }) {
      const category = event.currentTarget.dataset.category?.trim()
      if (!category) return
      wx.reLaunch({
        url: `/pages/games/index?category=${encodeURIComponent(category)}`
      })
    },
    imageError() {
      const game = this.data.game as BoardGameCardView | null
      if (game) this.triggerEvent('imageerror', { gameId: game.id })
    }
  }
})
