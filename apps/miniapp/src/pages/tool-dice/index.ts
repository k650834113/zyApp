import {
  diceExpression,
  maxDiceCount,
  rollDiceCombination,
  supportedDiceSides,
  type DiceGroup,
  type DiceResult
} from '../../services/tabletop-tools'
import { playToolTone } from '../../services/tool-feedback'
import { createShareAppMessage } from '../../services/share'

type DiceGroupView = DiceGroup & { id: number }
type GroupEvent = {
  currentTarget: {
    dataset: {
      delta?: number | string
      sides?: number | string
    }
  }
}

let rollingTimer: ReturnType<typeof setTimeout> | null = null
let previewTimer: ReturnType<typeof setInterval> | null = null

function initialGroups(): DiceGroupView[] {
  return supportedDiceSides.map((sides) => ({
    id: sides,
    sides,
    count: sides === 6 ? 2 : 0
  }))
}

function activeGroups(groups: readonly DiceGroup[]): DiceGroup[] {
  return groups.filter((group) => group.count > 0)
}

function diceFor(groups: readonly DiceGroup[]): DiceResult[] {
  return rollDiceCombination(activeGroups(groups))
}

function placeholderDice(groups: readonly DiceGroup[]): DiceResult[] {
  const active = activeGroups(groups)
  return active.length > 0 ? rollDiceCombination(active, () => 0) : []
}

function totalDice(groups: readonly DiceGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0)
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('快速骰子')
  },

  data: {
    controlsVisible: false,
    groups: initialGroups(),
    expression: '2D6',
    results: placeholderDice(initialGroups()),
    total: 2,
    rolling: false,
    rolled: false,
    maxDiceCount
  },

  toggleControls(){this.setData({controlsVisible:!this.data.controlsVisible})},
  onUnload() {
    this.clearRollTimers()
  },

  clearRollTimers() {
    if (rollingTimer) clearTimeout(rollingTimer)
    if (previewTimer) clearInterval(previewTimer)
    rollingTimer = null
    previewTimer = null
  },

  applyGroups(groups: DiceGroupView[]) {
    const results = placeholderDice(groups)
    const active = activeGroups(groups)
    this.setData({
      groups,
      expression: active.length > 0 ? diceExpression(active) : '请选择骰子',
      results,
      total: results.length,
      rolled: false
    })
  },

  adjustCount(event: GroupEvent) {
    const sides = Number(event.currentTarget.dataset.sides)
    const delta = Number(event.currentTarget.dataset.delta ?? 0)
    const index = this.data.groups.findIndex((group) => group.sides === sides)
    const group = this.data.groups[index]
    if (!group || !Number.isSafeInteger(delta) || !supportedDiceSides.includes(sides as any)) return
    if (delta > 0 && totalDice(this.data.groups) >= maxDiceCount) {
      wx.showToast({ title: `最多组合 ${maxDiceCount} 枚骰子`, icon: 'none' })
      return
    }
    const count = Math.max(0, group.count + delta)
    if (count === group.count) return
    this.applyGroups(this.data.groups.map((item, groupIndex) =>
      groupIndex === index ? { ...item, count } : item
    ))
  },

  clearAll() {
    this.applyGroups(this.data.groups.map((group) => ({ ...group, count: 0 })))
  },

  roll() {
    if (this.data.rolling) return
    if (totalDice(this.data.groups) === 0) {
      wx.showToast({ title: '请先选择至少 1 枚骰子', icon: 'none' })
      return
    }
    this.clearRollTimers()
    this.setData({ rolling: true })
    playToolTone('roll')
    wx.vibrateShort({ type: 'medium' })

    previewTimer = setInterval(() => {
      this.setData({ results: diceFor(this.data.groups) })
    }, 75)

    rollingTimer = setTimeout(() => {
      if (previewTimer) clearInterval(previewTimer)
      previewTimer = null
      const results = diceFor(this.data.groups)
      this.setData({
        results,
        total: results.reduce((sum, die) => sum + die.value, 0),
        rolling: false,
        rolled: true
      })
      playToolTone('success')
      wx.vibrateShort({ type: 'medium' })
    }, 780)
  }
})
