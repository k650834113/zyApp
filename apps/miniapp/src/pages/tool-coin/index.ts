import { flipCoin } from '../../services/tabletop-tools'
import { playToolTone } from '../../services/tool-feedback'
import { createShareAppMessage } from '../../services/share'

let flipTimer: ReturnType<typeof setTimeout> | null = null

Page({
  onShareAppMessage() {
    return createShareAppMessage('抛硬币')
  },

  data: {
    result: '正面' as '正面' | '反面',
    flipping: false,
    headsCount: 0,
    tailsCount: 0
  },

  onUnload() {
    if (flipTimer) clearTimeout(flipTimer)
  },

  flip() {
    if (this.data.flipping) return
    this.setData({ flipping: true })
    playToolTone('coin')
    wx.vibrateShort({ type: 'light' })
    flipTimer = setTimeout(() => {
      const result = flipCoin()
      this.setData({
        result,
        flipping: false,
        headsCount: this.data.headsCount + (result === '正面' ? 1 : 0),
        tailsCount: this.data.tailsCount + (result === '反面' ? 1 : 0)
      })
      playToolTone('success')
      wx.vibrateShort({ type: 'medium' })
    }, 620)
  },

  resetCounts() {
    if (this.data.flipping) return
    this.setData({ headsCount: 0, tailsCount: 0 })
  }
})
