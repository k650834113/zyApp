import { createRandomTeams } from '../../services/tabletop-tools'
import { playToolTone } from '../../services/tool-feedback'
import { createShareAppMessage } from '../../services/share'

type TouchPoint = {
  identifier?: number
  clientX: number
  clientY: number
}

type TouchEvent = { touches: TouchPoint[] }
type StepEvent = { currentTarget: { dataset: { delta?: number | string } } }

type TeamMarker = {
  id: number
  left: number
  top: number
  label: number
  tone: string
  teamLabel: string
}

type TeamLegend = {
  name: string
  tone: string
  count: number
}

const touchTones = ['cyan', 'lime', 'amber', 'rose', 'violet', 'blue', 'coral', 'mint', 'gold', 'sky']
const teamTones = ['team-green', 'team-amber', 'team-blue', 'team-rose', 'team-purple', 'team-cyan']

let holdTimer: ReturnType<typeof setTimeout> | null = null
let holdSignature = ''
let toneSequence = 0
const toneByTouchId = new Map<number, string>()
const labelByTouchId = new Map<number, number>()

function idFor(point: TouchPoint, index: number): number {
  return point.identifier ?? index
}

function toneFor(id: number): string {
  const existing = toneByTouchId.get(id)
  if (existing) return existing
  const tone = touchTones[toneSequence % touchTones.length] ?? 'cyan'
  toneSequence += 1
  toneByTouchId.set(id, tone)
  labelByTouchId.set(id, labelByTouchId.size + 1)
  return tone
}

function markerFor(point: TouchPoint, index: number): TeamMarker {
  const id = idFor(point, index)
  const tone = toneFor(id)
  return {
    id,
    left: Math.round(point.clientX - 34),
    top: Math.round(point.clientY - 34),
    label: labelByTouchId.get(id) ?? index + 1,
    tone,
    teamLabel: ''
  }
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('玩家分队')
  },

  data: {
    teamCount: 2,
    markers: [] as TeamMarker[],
    legends: [] as TeamLegend[],
    assigned: false,
    statusText: '所有玩家同时把手指放到屏幕上',
    helperText: '触点达到队伍数后，保持约 1 秒自动分队'
  },

  onUnload() {
    this.clearHold()
    this.clearTouches()
  },

  clearHold() {
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null
    holdSignature = ''
  },

  clearTouches() {
    toneByTouchId.clear()
    labelByTouchId.clear()
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
    if (this.data.assigned) return
    const points = event.touches ?? []
    const previousIds = new Set(this.data.markers.map((marker) => marker.id))
    const markers = points.map(markerFor)
    const signature = markers.map((marker) => marker.id).sort((a, b) => a - b).join(',')

    if (withFeedback) {
      const added = markers.filter((marker) => !previousIds.has(marker.id))
      added.forEach((marker, index) => playToolTone('touch', index))
      if (added.length > 0) wx.vibrateShort({ type: 'light' })
    }

    const enoughPlayers = markers.length >= this.data.teamCount
    this.setData({
      markers,
      statusText: enoughPlayers
        ? `已识别 ${markers.length} 位玩家，正在分队…`
        : `还需要 ${this.data.teamCount - markers.length} 位玩家触摸屏幕`
    })

    if (!enoughPlayers) {
      this.clearHold()
      return
    }
    if (holdSignature === signature && holdTimer) return
    this.clearHold()
    holdSignature = signature
    playToolTone('ready')
    holdTimer = setTimeout(() => {
      const current = this.data.markers.map((marker) => marker.id).sort((a, b) => a - b).join(',')
      if (!this.data.assigned && current === holdSignature) this.assignTeams()
    }, 1100)
  },

  assignTeams() {
    if (this.data.markers.length < this.data.teamCount) return
    const groupedLabels = createRandomTeams(this.data.markers.length, this.data.teamCount)
    const teamByLabel = new Map<number, number>()
    groupedLabels.forEach((labels, teamIndex) => {
      labels.forEach((label) => teamByLabel.set(label, teamIndex))
    })
    const markers = this.data.markers.map((marker) => {
      const teamIndex = teamByLabel.get(marker.label) ?? 0
      return {
        ...marker,
        tone: teamTones[teamIndex] ?? 'team-green',
        teamLabel: `${teamIndex + 1} 队`
      }
    })
    const legends = groupedLabels.map((players, teamIndex) => ({
      name: `${teamIndex + 1} 队`,
      tone: teamTones[teamIndex] ?? 'team-green',
      count: players.length
    }))
    this.clearHold()
    this.setData({
      markers,
      legends,
      assigned: true,
      statusText: '分队完成',
      helperText: '相同颜色的玩家属于同一队'
    })
    playToolTone('success')
    wx.vibrateShort({ type: 'heavy' })
  },

  adjustTeams(event: StepEvent) {
    const delta = Number(event.currentTarget.dataset.delta ?? 0)
    const teamCount = Math.min(6, Math.max(2, this.data.teamCount + delta))
    if (teamCount === this.data.teamCount) return
    this.clearHold()
    this.clearTouches()
    this.setData({
      teamCount,
      markers: [],
      legends: [],
      assigned: false,
      statusText: '所有玩家同时把手指放到屏幕上',
      helperText: `至少需要 ${teamCount} 个触点，保持约 1 秒自动分队`
    })
  },

  reset() {
    this.clearHold()
    this.clearTouches()
    this.setData({
      markers: [],
      legends: [],
      assigned: false,
      statusText: '所有玩家同时把手指放到屏幕上',
      helperText: '触点达到队伍数后，保持约 1 秒自动分队'
    })
  }
})
