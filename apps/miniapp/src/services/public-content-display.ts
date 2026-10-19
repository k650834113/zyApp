import type { PublicActivitySummary } from '@zyapp/contracts'
export function publicActivityView(activity: PublicActivitySummary, now = Date.now()) {
  const format = (value: string) => {
    const date = new Date(Date.parse(value) + 8 * 60 * 60 * 1000)
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
  return { ...activity,
    lotteryStartsAtText:activity.lottery?format(activity.lottery.startsAt):'', lotteryClosesAtText:activity.lottery?format(activity.lottery.closesAt):'', lotteryDrawAtText:activity.lottery?format(activity.lottery.drawAt):'',
    coverUrl: activity.coverUrl || '',
    coverTitle: activity.title?.split(/[｜|]/)[0]?.trim() || '门店活动',
    coverDateText: format(activity.startsAt).slice(5, 10) + ' — ' + format(activity.endsAt).slice(5, 10),
    startsAtText: format(activity.startsAt), endsAtText: format(activity.endsAt),
    statusText: now < Date.parse(activity.startsAt) ? '活动预告' : now >= Date.parse(activity.endsAt) ? '已结束' : '进行中'
  }
}
export type PublicActivityView = ReturnType<typeof publicActivityView>
