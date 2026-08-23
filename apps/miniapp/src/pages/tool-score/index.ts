import { scoreTotals } from '../../services/tabletop-tools'
import { createShareAppMessage } from '../../services/share'

type ScorePlayer = { id: number; name: string }
type ScoreRow = { id: number; values: string[] }
type IndexEvent = { currentTarget: { dataset: { index?: number | string } } }
type ScoreCellEvent = WechatMiniprogram.Input & {
  currentTarget: {
    dataset: { rowIndex?: number | string; playerIndex?: number | string }
  }
}
type NameEvent = WechatMiniprogram.Input & {
  currentTarget: { dataset: { index?: number | string } }
}

type StoredSheet = {
  players: ScorePlayer[]
  rows: ScoreRow[]
}

const storageKey = 'zyapp-tabletop-score-v2'
let nextPlayerId = 3
let nextRowId = 2
let pendingSheet: StoredSheet | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

function defaultPlayers(): ScorePlayer[] {
  return [
    { id: 1, name: '玩家 1' },
    { id: 2, name: '玩家 2' }
  ]
}

function defaultRows(): ScoreRow[] {
  return [{ id: 1, values: ['', ''] }]
}

function validStoredSheet(value: unknown): value is StoredSheet {
  if (!value || typeof value !== 'object') return false
  const sheet = value as Partial<StoredSheet>
  if (!Array.isArray(sheet.players) || sheet.players.length < 1 || sheet.players.length > 8) return false
  if (!Array.isArray(sheet.rows) || sheet.rows.length < 1 || sheet.rows.length > 100) return false
  if (!sheet.players.every((player) =>
    player && typeof player.id === 'number' && typeof player.name === 'string'
  )) return false
  return sheet.rows.every((row) =>
    row &&
    typeof row.id === 'number' &&
    Array.isArray(row.values) &&
    row.values.length === sheet.players?.length &&
    row.values.every((cell) => typeof cell === 'string')
  )
}

function cleanScoreInput(raw: unknown): string {
  const source = String(raw ?? '').replace(/，/g, '.').slice(0, 16)
  const negative = source.startsWith('-')
  const unsigned = source.replace(/-/g, '').replace(/[^\d.]/g, '')
  const dotIndex = unsigned.indexOf('.')
  const integerPart = (dotIndex >= 0 ? unsigned.slice(0, dotIndex) : unsigned).slice(0, 7)
  const decimalPart = dotIndex >= 0 ? unsigned.slice(dotIndex + 1).replace(/\./g, '').slice(0, 4) : ''
  const decimal = dotIndex >= 0 ? `.${decimalPart}` : ''
  return `${negative ? '-' : ''}${integerPart}${decimal}`
}

function displayTotal(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function totalsFor(rows: readonly ScoreRow[], playerCount: number): string[] {
  return scoreTotals(rows.map((row) => row.values), playerCount).map(displayTotal)
}

function persistSheet(sheet: StoredSheet): void {
  try {
    wx.setStorageSync(storageKey, sheet)
  } catch {
    // Keep the live score usable even when local storage is unavailable.
  }
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('计分器')
  },

  data: {
    players: defaultPlayers(),
    rows: defaultRows(),
    totals: ['0', '0'],
    tableWidth: 500
  },

  onLoad() {
    try {
      const stored = wx.getStorageSync(storageKey) as unknown
      if (validStoredSheet(stored)) {
        nextPlayerId = Math.max(...stored.players.map((player) => player.id)) + 1
        nextRowId = Math.max(...stored.rows.map((row) => row.id)) + 1
        this.setSheet(stored.players, stored.rows, false)
      }
    } catch {
      // Storage failure should never block an in-progress tabletop game.
    }
  },

  onHide() {
    this.flushPersist()
  },

  onUnload() {
    this.flushPersist()
  },

  schedulePersist(players: ScorePlayer[], rows: ScoreRow[]) {
    pendingSheet = { players, rows }
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => this.flushPersist(), 180)
  },

  flushPersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    if (!pendingSheet) return
    persistSheet(pendingSheet)
    pendingSheet = null
  },

  setSheet(players: ScorePlayer[], rows: ScoreRow[], shouldPersist = true) {
    this.setData({
      players,
      rows,
      totals: totalsFor(rows, players.length),
      tableWidth: 124 + players.length * 188
    })
    if (shouldPersist) this.schedulePersist(players, rows)
  },

  inputName(event: NameEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isSafeInteger(index) || !this.data.players[index]) return
    const name = String(event.detail.value ?? '').slice(0, 10)
    const players = this.data.players.map((player, playerIndex) =>
      playerIndex === index ? { ...player, name } : player
    )
    this.setData({ [`players[${index}].name`]: name })
    this.schedulePersist(players, this.data.rows)
    return name
  },

  inputScore(event: ScoreCellEvent) {
    const rowIndex = Number(event.currentTarget.dataset.rowIndex)
    const playerIndex = Number(event.currentTarget.dataset.playerIndex)
    const row = this.data.rows[rowIndex]
    if (!row || !this.data.players[playerIndex]) return
    const value = cleanScoreInput(event.detail.value)
    const rows = this.data.rows.map((item, index) =>
      index === rowIndex
        ? { ...item, values: item.values.map((cell, cellIndex) => cellIndex === playerIndex ? value : cell) }
        : item
    )
    this.setData({
      [`rows[${rowIndex}].values[${playerIndex}]`]: value,
      totals: totalsFor(rows, this.data.players.length)
    })
    this.schedulePersist(this.data.players, rows)
    return value
  },

  addPlayer() {
    if (this.data.players.length >= 8) return
    const players = [
      ...this.data.players,
      { id: nextPlayerId++, name: `玩家 ${this.data.players.length + 1}` }
    ]
    const rows = this.data.rows.map((row) => ({ ...row, values: [...row.values, ''] }))
    this.setSheet(players, rows)
  },

  removePlayer(event: IndexEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (this.data.players.length <= 1 || !this.data.players[index]) return
    const players = this.data.players.filter((_, playerIndex) => playerIndex !== index)
    const rows = this.data.rows.map((row) => ({
      ...row,
      values: row.values.filter((_, playerIndex) => playerIndex !== index)
    }))
    this.setSheet(players, rows)
  },

  addRow() {
    if (this.data.rows.length >= 100) {
      wx.showToast({ title: '最多记录 100 行分值', icon: 'none' })
      return
    }
    const rows = [
      ...this.data.rows,
      { id: nextRowId++, values: this.data.players.map(() => '') }
    ]
    this.setSheet(this.data.players, rows)
  },

  removeRow(event: IndexEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (this.data.rows.length <= 1 || !this.data.rows[index]) return
    this.setSheet(
      this.data.players,
      this.data.rows.filter((_, rowIndex) => rowIndex !== index)
    )
  },

  resetScores() {
    wx.showModal({
      title: '清空所有分值？',
      content: '玩家名称会保留，分值记录将恢复为一行空表格。',
      confirmText: '清空',
      confirmColor: '#a74e3f',
      success: (result) => {
        if (!result.confirm) return
        const rows = [{ id: nextRowId++, values: this.data.players.map(() => '') }]
        this.setSheet(this.data.players, rows)
      }
    })
  }
})
