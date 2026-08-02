import type { BoardGameCardView } from '../../services/board-game-library'

Component({
  properties: {
    game: { type: Object, value: null }
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
    imageError() {
      const game = this.data.game as BoardGameCardView | null
      if (game) this.triggerEvent('imageerror', { gameId: game.id })
    }
  }
})
