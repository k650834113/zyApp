import type {
  AnnouncementSummary,
  BoardGameSummary,
  MiniappIdentity,
  StoreProfileSummary
} from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'

type AnnouncementView = AnnouncementSummary & {
  statusText: string
  scheduleText: string
}

type BoardGameView = BoardGameSummary & {
  statusText: string
  detailText: string
}

type AnnouncementForm = {
  announcementId: string
  title: string
  content: string
  visibleFrom: string
  visibleUntil: string
  reason: string
}

const storeStatusOptions = [
  { label: '按营业时间自动判断', value: 'automatic' as const },
  { label: '临时营业', value: 'open' as const },
  { label: '临时休息', value: 'closed' as const }
]

function isEmployee(identity: MiniappIdentity): boolean {
  return identity.role === 'staff' || identity.role === 'manager'
}

function localDateTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
}

function isoDateTime(
  value: string,
  name: string,
  optional = false
): string | undefined {
  const normalized = value.trim()
  if (!normalized && optional) return undefined
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`${name}请使用 YYYY-MM-DD HH:mm`)
  }
  const parsed = new Date(`${normalized.replace(' ', 'T')}:00+08:00`)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name}无效`)
  return parsed.toISOString()
}

function emptyAnnouncementForm(): AnnouncementForm {
  const now = new Date()
  return {
    announcementId: '',
    title: '',
    content: '',
    visibleFrom: localDateTime(now.toISOString()),
    visibleUntil: '',
    reason: ''
  }
}

function announcementView(
  announcement: AnnouncementSummary
): AnnouncementView {
  const statusText = {
    draft: '草稿',
    published: '已发布',
    disabled: '已停用'
  }[announcement.status]
  return {
    ...announcement,
    statusText,
    scheduleText:
      `${localDateTime(announcement.visibleFrom)} 起` +
      (announcement.visibleUntil
        ? `，至 ${localDateTime(announcement.visibleUntil)}`
        : '，长期显示')
  }
}

function boardGameView(game: BoardGameSummary): BoardGameView {
  const flags = [
    game.available ? '可用' : '不可用',
    game.customerConsigned ? '顾客寄存' : '',
    game.missingPieces ? '缺件' : '',
    game.private ? '不公开' : ''
  ].filter(Boolean)
  return {
    ...game,
    statusText: flags.join(' · '),
    detailText: `${game.minPlayers}-${game.maxPlayers} 人 · ${game.categories.join(
      ' / '
    )}`
  }
}

function parseMissingParts(
  value: string
): Array<{ name: string; quantity: number }> {
  const normalized = value.trim()
  if (!normalized) return []
  return normalized
    .split(/[,，\n]+/)
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.trim().split(/[:：]/)
      if (parts.length !== 2) {
        throw new Error('缺件请按“名称:数量”填写')
      }
      const name = parts[0]?.trim() ?? ''
      const quantity = Number(parts[1]?.trim())
      if (
        !name ||
        name.length > 100 ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        throw new Error('缺件名称或数量不正确')
      }
      return { name, quantity }
    })
}

function minutesText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60
  ).padStart(2, '0')}`
}

Page({
  data: {
    identity: { role: 'guest' } as MiniappIdentity,
    busy: false,
    announcements: [] as AnnouncementView[],
    announcementForm: emptyAnnouncementForm(),
    announcementPinned: false,
    announcementStatusReason: '',
    boardGames: [] as BoardGameView[],
    selectedBoardGame: null as BoardGameView | null,
    boardAvailable: true,
    boardCustomerConsigned: false,
    boardMissingPieces: false,
    boardPrivate: false,
    boardCustomerNote: '',
    boardInternalNote: '',
    boardConsignorNickname: '',
    boardMissingParts: '',
    boardReason: '',
    store: null as StoreProfileSummary | null,
    storeHoursText: '',
    storeStatusOptions,
    storeStatusIndex: 0,
    storeCustomStatusText: '',
    storeReason: ''
  },

  async onShow() {
    const identity = await getMiniappClient().getIdentity()
    this.setData({ identity })
    if (!isEmployee(identity)) {
      wx.showToast({ title: '请先进入员工模式', icon: 'none' })
      return
    }
    const jobs: Array<Promise<void>> = [this.loadBoardGames()]
    if (identity.role === 'manager') {
      jobs.push(this.loadAnnouncements(), this.loadStore())
    }
    await Promise.all(jobs)
  },

  async loadAnnouncements() {
    try {
      const announcements = (
        await getMiniappClient().listEmployeeAnnouncements()
      ).map(announcementView)
      this.setData({ announcements })
    } catch (error) {
      this.showError(error, '公告加载失败')
    }
  },

  async loadBoardGames() {
    try {
      const boardGames = (
        await getMiniappClient().listEmployeeBoardGames()
      ).map(boardGameView)
      this.setData({ boardGames })
      const selected =
        boardGames.find(
          (game) => game.id === this.data.selectedBoardGame?.id
        ) ??
        boardGames[0] ??
        null
      if (selected) this.selectBoardGameValue(selected)
    } catch (error) {
      this.showError(error, '桌游加载失败')
    }
  },

  async loadStore() {
    try {
      const store = await getMiniappClient().getEmployeeStoreProfile()
      const storeStatusIndex = Math.max(
        0,
        storeStatusOptions.findIndex(
          (option) => option.value === store.statusOverride
        )
      )
      this.setData({
        store,
        storeHoursText: `${minutesText(
          store.businessOpenMinute
        )}-${minutesText(store.businessCloseMinute)}`,
        storeStatusIndex,
        storeCustomStatusText: store.customStatusText ?? ''
      })
    } catch (error) {
      this.showError(error, '营业状态加载失败')
    }
  },

  newAnnouncement() {
    this.setData({
      announcementForm: emptyAnnouncementForm(),
      announcementPinned: false
    })
  },

  editAnnouncement(event: {
    currentTarget: { dataset: { announcementId?: string } }
  }) {
    const announcement = this.data.announcements.find(
      (candidate) =>
        candidate.id === event.currentTarget.dataset.announcementId
    )
    if (!announcement) return
    this.setData({
      announcementForm: {
        announcementId: announcement.id,
        title: announcement.title,
        content: announcement.content,
        visibleFrom: localDateTime(announcement.visibleFrom),
        visibleUntil: announcement.visibleUntil
          ? localDateTime(announcement.visibleUntil)
          : '',
        reason: ''
      },
      announcementPinned: announcement.pinned
    })
  },

  changeAnnouncementPinned(event: { detail: { value: boolean } }) {
    this.setData({ announcementPinned: event.detail.value })
  },

  updateAnnouncementStatusReason(event: { detail: { value?: string } }) {
    this.setData({ announcementStatusReason: event.detail.value ?? '' })
  },

  async saveAnnouncement(event: {
    detail: {
      value: {
        title?: string
        content?: string
        visibleFrom?: string
        visibleUntil?: string
        reason?: string
      }
    }
  }) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const value = event.detail.value
      const visibleFrom = isoDateTime(
        value.visibleFrom ?? '',
        '开始展示时间'
      )
      const visibleUntil = isoDateTime(
        value.visibleUntil ?? '',
        '结束展示时间',
        true
      )
      if (!visibleFrom) throw new Error('开始展示时间不能为空')
      if (
        visibleUntil &&
        Date.parse(visibleUntil) <= Date.parse(visibleFrom)
      ) {
        throw new Error('结束展示时间必须晚于开始展示时间')
      }
      const fields = {
        title: value.title?.trim() ?? '',
        content: value.content?.trim() ?? '',
        pinned: this.data.announcementPinned,
        visibleFrom,
        ...(visibleUntil ? { visibleUntil } : {})
      }
      const announcementId = this.data.announcementForm.announcementId
      const result = announcementId
        ? await getMiniappClient().updateEmployeeAnnouncement({
            requestId:
              `announcement-update-${Date.now()}-` +
              Math.random().toString(36).slice(2, 10),
            announcementId,
            reason: value.reason?.trim() ?? '',
            ...fields
          })
        : await getMiniappClient().createEmployeeAnnouncement({
            requestId:
              `announcement-create-${Date.now()}-` +
              Math.random().toString(36).slice(2, 10),
            ...fields
          })
      await this.loadAnnouncements()
      this.editAnnouncement({
        currentTarget: { dataset: { announcementId: result.id } }
      })
      wx.showToast({
        title: announcementId ? '公告已更新' : '公告草稿已创建'
      })
    } catch (error) {
      this.showError(error, '公告保存失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  async setAnnouncementStatus(event: {
    currentTarget: {
      dataset: {
        announcementId?: string
        status?: 'published' | 'disabled'
      }
    }
  }) {
    const announcementId = event.currentTarget.dataset.announcementId
    const status = event.currentTarget.dataset.status
    const reason = this.data.announcementStatusReason.trim()
    if (!announcementId || !status || this.data.busy) return
    if (reason.length < 2 || reason.length > 200) {
      wx.showToast({ title: '请填写 2-200 字操作原因', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      await getMiniappClient().setEmployeeAnnouncementStatus({
        requestId:
          `announcement-${status}-${Date.now()}-` +
          Math.random().toString(36).slice(2, 10),
        announcementId,
        status,
        reason
      })
      this.setData({ announcementStatusReason: '' })
      await this.loadAnnouncements()
      wx.showToast({
        title: status === 'published' ? '公告已发布' : '公告已停用'
      })
    } catch (error) {
      this.showError(error, '公告状态修改失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  selectBoardGame(event: {
    currentTarget: { dataset: { boardGameId?: string } }
  }) {
    const game = this.data.boardGames.find(
      (candidate) => candidate.id === event.currentTarget.dataset.boardGameId
    )
    if (game) this.selectBoardGameValue(game)
  },

  selectBoardGameValue(game: BoardGameView) {
    this.setData({
      selectedBoardGame: game,
      boardAvailable: game.available,
      boardCustomerConsigned: game.customerConsigned,
      boardMissingPieces: game.missingPieces,
      boardPrivate: game.private,
      boardCustomerNote: game.customerNote ?? '',
      boardInternalNote: game.internalNote ?? '',
      boardConsignorNickname: game.consignorNickname ?? '',
      boardMissingParts: game.missingParts
        .map((part) => `${part.name}:${part.quantity}`)
        .join(','),
      boardReason: ''
    })
  },

  changeBoardAvailable(event: { detail: { value: boolean } }) {
    this.setData({ boardAvailable: event.detail.value })
  },

  changeBoardCustomerConsigned(event: { detail: { value: boolean } }) {
    this.setData({ boardCustomerConsigned: event.detail.value })
  },

  changeBoardMissingPieces(event: { detail: { value: boolean } }) {
    this.setData({ boardMissingPieces: event.detail.value })
  },

  changeBoardPrivate(event: { detail: { value: boolean } }) {
    this.setData({ boardPrivate: event.detail.value })
  },

  updateBoardCustomerNote(event: { detail: { value?: string } }) {
    this.setData({ boardCustomerNote: event.detail.value ?? '' })
  },

  updateBoardInternalNote(event: { detail: { value?: string } }) {
    this.setData({ boardInternalNote: event.detail.value ?? '' })
  },

  updateBoardConsignorNickname(event: { detail: { value?: string } }) {
    this.setData({ boardConsignorNickname: event.detail.value ?? '' })
  },

  updateBoardMissingParts(event: { detail: { value?: string } }) {
    this.setData({ boardMissingParts: event.detail.value ?? '' })
  },

  updateBoardReason(event: { detail: { value?: string } }) {
    this.setData({ boardReason: event.detail.value ?? '' })
  },

  async saveBoardGameOperations() {
    const game = this.data.selectedBoardGame
    const reason = this.data.boardReason.trim()
    if (!game || this.data.busy) return
    if (reason.length < 2 || reason.length > 200) {
      wx.showToast({ title: '请填写 2-200 字修改原因', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      await getMiniappClient().updateEmployeeBoardGameOperations({
        requestId:
          `board-operations-${Date.now()}-` +
          Math.random().toString(36).slice(2, 10),
        boardGameId: game.id,
        available: this.data.boardAvailable,
        customerConsigned: this.data.boardCustomerConsigned,
        missingPieces: this.data.boardMissingPieces,
        private: this.data.boardPrivate,
        customerNote: this.data.boardCustomerNote.trim(),
        internalNote: this.data.boardInternalNote.trim(),
        consignorNickname: this.data.boardConsignorNickname.trim(),
        missingParts: this.data.boardMissingPieces
          ? parseMissingParts(this.data.boardMissingParts)
          : [],
        reason
      })
      await this.loadBoardGames()
      wx.showToast({ title: '桌游状态已更新' })
    } catch (error) {
      this.showError(error, '桌游状态保存失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  changeStoreStatus(event: { detail: { value: string } }) {
    this.setData({ storeStatusIndex: Number(event.detail.value) })
  },

  updateStoreCustomStatus(event: { detail: { value?: string } }) {
    this.setData({ storeCustomStatusText: event.detail.value ?? '' })
  },

  updateStoreReason(event: { detail: { value?: string } }) {
    this.setData({ storeReason: event.detail.value ?? '' })
  },

  async saveStoreStatus() {
    const reason = this.data.storeReason.trim()
    if (!this.data.store || this.data.busy) return
    if (reason.length < 2 || reason.length > 200) {
      wx.showToast({ title: '请填写 2-200 字修改原因', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      const store = await getMiniappClient().updateEmployeeStoreStatus({
        requestId:
          `store-status-${Date.now()}-` +
          Math.random().toString(36).slice(2, 10),
        statusOverride:
          storeStatusOptions[this.data.storeStatusIndex]?.value ??
          'automatic',
        customStatusText: this.data.storeCustomStatusText.trim(),
        reason
      })
      this.setData({ store, storeReason: '' })
      wx.showToast({ title: '营业状态已更新' })
    } catch (error) {
      this.showError(error, '营业状态保存失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  showError(error: unknown, fallback: string) {
    wx.showToast({
      title: error instanceof Error ? error.message : fallback,
      icon: 'none',
      duration: 4000
    })
  }
})
