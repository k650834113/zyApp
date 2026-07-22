import type { PublicActivitySummary } from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'

type ActivityView = PublicActivitySummary & {
  startsAtText: string
  endsAtText: string
  tierTexts: string[]
}

function formatTime(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`
}

function formatFen(value: number): string {
  return `¥${(value / 100).toFixed(2)}`
}

Page({
  data: {
    loading: true,
    activities: [] as ActivityView[]
  },

  async onLoad() {
    try {
      const activities = await getMiniappClient().listActivities()
      this.setData({
        activities: activities.map((activity) => ({
          ...activity,
          startsAtText: formatTime(activity.startsAt),
          endsAtText: formatTime(activity.endsAt),
          tierTexts: activity.rechargeTiers.map(
            (tier) =>
              `充 ${formatFen(tier.principalFen)} 赠 ${formatFen(tier.giftFen)}`
          )
        }))
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  }
})
