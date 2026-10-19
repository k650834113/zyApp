import { pickFirstPlayer } from '../../services/tabletop-tools'
import { playToolTone } from '../../services/tool-feedback'
import { createShareAppMessage } from '../../services/share'

type TouchPoint = {
  identifier?: number
  clientX: number
  clientY: number
}

type TouchEvent = { touches: TouchPoint[] }
type TapEvent = { detail: { x?: number; y?: number } }

type Marker = {
  id: number
  left: number
  top: number
  label: number
  tone: string
  selected: boolean
}

const touchTones = [
  'cyan', 'lime', 'amber', 'rose', 'violet', 'blue',
  'coral', 'mint', 'gold', 'sky', 'pink', 'slate'
]

let selectionTimer: ReturnType<typeof setTimeout> | null = null
let markerSequence = 100
let candidateSignature = ''
let toneSequence = 0
const touchToneById = new Map<number, string>()
const touchLabelById = new Map<number, number>()

function touchId(point: TouchPoint, index: number): number {
  return point.identifier ?? index
}

function signature(points: readonly TouchPoint[]): string {
  return points.map(touchId).sort((left, right) => left - right).join(',')
}

function toneFor(id: number): string {
  const existing = touchToneById.get(id)
  if (existing) return existing
  const tone = touchTones[toneSequence % touchTones.length] ?? 'cyan'
  toneSequence += 1
  touchToneById.set(id, tone)
  touchLabelById.set(id, touchLabelById.size + 1)
  return tone
}

function markerFromTouch(point: TouchPoint, index: number): Marker {
  const id = touchId(point, index)
  const tone = toneFor(id)
  return {
    id,
    left: Math.round(point.clientX - 34),
    top: Math.round(point.clientY - 34),
    label: touchLabelById.get(id) ?? index + 1,
    tone,
    selected: false
  }
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('先手玩家')
  },

  data: {
    markers: [] as Marker[],
    selected: false,
    winnerColor: '',
    singleMode: false,
    statusText: '请至少两位玩家同时按住屏幕',
    helperText: '轻微移动没关系，保持触点约 1 秒即可'
  },

  onUnload() {
    this.clearSelectionTimer()
    this.clearTouchIdentity()
  },

  clearSelectionTimer() {
    if (selectionTimer) clearTimeout(selectionTimer)
    selectionTimer = null
    candidateSignature = ''
  },

  clearTouchIdentity() {
    touchToneById.clear()
    touchLabelById.clear()
    toneSequence = 0
  },

  handleTouchStart(event: TouchEvent) {
    this.syncTouches(event, true)
  },

  handleTouchMove(event: TouchEvent) {
    this.syncTouches(event, false)
  },

  handleTouchEnd(event: TouchEvent) {
    this.syncTouches(event, false)
  },

  syncTouches(event: TouchEvent, withFeedback: boolean) {
    if (this.data.singleMode || this.data.selected) return
    const points = event.touches ?? []
    const previousIds = new Set(this.data.markers.map((marker) => marker.id))
    const markers = points.map(markerFromTouch)
    const nextSignature = signature(points)

    if (withFeedback) {
      const added = markers.filter((marker) => !previousIds.has(marker.id))
      added.forEach((marker, index) => playToolTone('touch', index))
      if (added.length > 0) wx.vibrateShort({ type: 'light' })
    }

    this.setData({
      markers,
      statusText:
        markers.length < 2
          ? markers.length === 1
            ? '再请一位玩家按住屏幕'
            : '请至少两位玩家同时按住屏幕'
          : `已识别 ${markers.length} 位玩家，正在抽取…`
    })

    if (markers.length < 2) {
      this.clearSelectionTimer()
      return
    }

    // Moving the same touches only changes coordinates. The countdown restarts
    // only when a finger is added or removed.
    if (candidateSignature === nextSignature && selectionTimer) return
    this.clearSelectionTimer()
    candidateSignature = nextSignature
    playToolTone('ready')
    selectionTimer = setTimeout(() => {
      const currentSignature = this.data.markers
        .map((marker) => marker.id)
        .sort((left, right) => left - right)
        .join(',')
      if (this.data.selected || currentSignature !== candidateSignature) return
      this.selectFromMarkers()
    }, 1050)
  },

  addSinglePlayer(event?: TapEvent) {
    if (!this.data.singleMode || this.data.selected) return
    this.addSinglePlayerAt(event?.detail?.x ?? 190, event?.detail?.y ?? 330)
  },

  addSinglePlayerFromButton() {
    if (!this.data.singleMode || this.data.selected) return
    const info = wx.getWindowInfo()
    const index = this.data.markers.length
    const x = info.windowWidth * (index % 2 === 0 ? 0.28 : 0.72)
    const y = 180 + Math.floor(index / 2) * 74
    this.addSinglePlayerAt(x, y)
  },

  addSinglePlayerAt(x: number, y: number) {
    if (this.data.markers.length >= 12) {
      wx.showToast({ title: '最多添加 12 位玩家', icon: 'none' })
      return
    }
    const id = markerSequence++
    const label = this.data.markers.length + 1
    const marker: Marker = {
      id,
      left: Math.round(x - 34),
      top: Math.round(y - 34),
      label,
      tone: touchTones[(label - 1) % touchTones.length] ?? 'cyan',
      selected: false
    }
    const markers = [...this.data.markers, marker]
    this.setData({ markers, statusText: `已添加 ${markers.length} 位玩家` })
    playToolTone('touch', label - 1)
    wx.vibrateShort({ type: 'light' })
  },

  selectFromMarkers() {
    if (this.data.markers.length < 2) {
      wx.showToast({ title: '请先添加至少两位玩家', icon: 'none' })
      return
    }
    const winner = pickFirstPlayer(this.data.markers)
    this.clearSelectionTimer()
    this.setData({
      selected: true,
      winnerColor: ['#50d8ef','#d9ef52','#ffb547','#ff718d','#ae8cff','#6ca8ff','#ff876b','#60e2b3','#f4d34f','#75d1ff','#f591d2','#b4c5c1'][touchTones.indexOf(winner.tone)] ?? '#50d8ef',
      markers: this.data.markers.map((marker) => ({
        ...marker,
        selected: marker.id === winner.id
      })),
      statusText: `玩家 ${winner.label} 先手`,
      helperText: '本轮结果已锁定，点击“再来一次”重新抽取'
    })
    playToolTone('success')
    wx.vibrateShort({ type: 'heavy' })
  },

  toggleSingleMode() {
    this.clearSelectionTimer()
    this.clearTouchIdentity()
    const singleMode = !this.data.singleMode
    this.setData({
      singleMode,
      selected: false,
      winnerColor: '',
      markers: [],
      statusText: singleMode
        ? '依次点击不同位置添加玩家'
        : '请至少两位玩家同时按住屏幕',
      helperText: singleMode
        ? '点击屏幕点位或下方按钮添加，完成后抽取'
        : '轻微移动没关系，保持触点约 1 秒即可'
    })
  },

  reset() {
    this.clearSelectionTimer()
    this.clearTouchIdentity()
    this.setData({
      selected: false,
      winnerColor: '',
      markers: [],
      statusText: this.data.singleMode
        ? '依次点击不同位置添加玩家'
        : '请至少两位玩家同时按住屏幕',
      helperText: this.data.singleMode
        ? '点击屏幕点位或下方按钮添加，完成后抽取'
        : '轻微移动没关系，保持触点约 1 秒即可'
    })
  }
})
