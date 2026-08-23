import type {
  MemberActivitySummary,
  MemberSelfServiceHistory
} from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'
import { createShareAppMessage } from '../../services/share'

type HistoryFilter = 'all' | 'consumption' | 'recharge' | 'monthly_card'

type ActivityView = MemberActivitySummary & {
  amountText: string
  amountClass: 'debit' | 'credit' | 'neutral'
  timeText: string
  statusText: string
  iconText: string
}

type ActivityGroup = {
  date: string
  items: ActivityView[]
}

type FilterEvent = {
  currentTarget: { dataset: { filter?: HistoryFilter } }
}

const emptyHistory: MemberSelfServiceHistory = {
  activities: [],
  orders: [],
  walletEntries: [],
  monthlyCardEvents: []
}

function money(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`
}

function localParts(value: string): { date: string; time: string } {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return {
    date: `${year}年${month}月${day}日`,
    time: `${hour}:${minute}`
  }
}

function statusText(status: MemberActivitySummary['status']): string {
  return {
    completed: '已完成',
    settled: '已到账',
    active: '已生效',
    paused: '已暂停',
    resumed: '已恢复',
    used: '已使用',
    refunded: '已退款',
    reversed: '已冲正',
    expired: '已过期'
  }[status]
}

function activityView(activity: MemberActivitySummary): ActivityView {
  const time = localParts(activity.occurredAt).time
  const sign =
    activity.direction === 'credit'
      ? '+'
      : activity.direction === 'debit'
        ? '-'
        : ''
  return {
    ...activity,
    amountText:
      activity.amountFen === null ? '' : `${sign}${money(activity.amountFen)}`,
    amountClass: activity.direction,
    timeText: time,
    statusText: statusText(activity.status),
    iconText:
      activity.kind === 'consumption'
        ? '桌'
        : activity.kind === 'recharge'
          ? '充'
          : '卡'
  }
}

function groups(
  history: MemberSelfServiceHistory,
  filter: HistoryFilter
): ActivityGroup[] {
  const grouped = new Map<string, ActivityView[]>()
  for (const activity of history.activities) {
    if (filter !== 'all' && activity.kind !== filter) continue
    const date = localParts(activity.occurredAt).date
    const current = grouped.get(date) ?? []
    current.push(activityView(activity))
    grouped.set(date, current)
  }
  return [...grouped.entries()].map(([date, items]) => ({ date, items }))
}

Page({
  onShareAppMessage() {
    return createShareAppMessage('全部明细')
  },

  data: {
    loading: true,
    filter: 'all' as HistoryFilter,
    history: emptyHistory,
    groups: [] as ActivityGroup[]
  },

  onShow() {
    void this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const member = await getMiniappClient().getMemberSummary()
      if (!member) {
        wx.reLaunch({ url: '/pages/home/index' })
        return
      }
      if (!member.profileCompleted) {
        wx.reLaunch({ url: '/pages/member/index?mode=complete' })
        return
      }
      const history = await getMiniappClient().getMemberHistory()
      this.setData({
        history,
        groups: groups(history, this.data.filter)
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '明细加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseFilter(event: FilterEvent) {
    const filter = event.currentTarget.dataset.filter ?? 'all'
    this.setData({
      filter,
      groups: groups(this.data.history, filter)
    })
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' })
  },

  goHistory() {},

  goGames() {
    wx.reLaunch({ url: '/pages/games/index' })
  },

  goTools() {
    wx.reLaunch({ url: '/pages/tools/index' })
  },

  goProfile() {
    wx.reLaunch({ url: '/pages/member/index?mode=edit' })
  }
})
