import type {
  MemberMonthlyCardConfiguration,
  MemberSelfServiceSummary
} from '@zyapp/contracts'

const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

export type MonthlyCardDisplay = {
  state: 'unopened' | 'active' | 'paused'
  actionText: string
  priceText: string
  statusText: string
  expiresOn: string | null
  remainingDaysText: string | null
}

function money(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`
}

function shanghaiDay(value: Date): number {
  return Math.floor((value.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS)
}

function shanghaiDate(value: Date): string {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
}

function expiryDisplay(
  expiresAt: string | null,
  now: Date
): Pick<MonthlyCardDisplay, 'expiresOn' | 'remainingDaysText'> {
  if (!expiresAt) {
    return { expiresOn: null, remainingDaysText: null }
  }
  const expiry = new Date(expiresAt)
  const remainingDays = Math.max(0, shanghaiDay(expiry) - shanghaiDay(now))
  return {
    expiresOn: shanghaiDate(expiry),
    remainingDaysText: `剩余 ${remainingDays} 天`
  }
}

export function monthlyCardDisplay(
  member: MemberSelfServiceSummary,
  configuration: MemberMonthlyCardConfiguration,
  now = new Date()
): MonthlyCardDisplay {
  const priceText = `${money(configuration.priceFen)} / ${configuration.durationDays}天`

  if (member.monthlyCardStatus === 'none') {
    return {
      state: 'unopened',
      actionText: '微信开通到店月卡',
      priceText,
      statusText: `${configuration.planName}，支付成功后到店权益立即生效`,
      expiresOn: null,
      remainingDaysText: null
    }
  }

  const expiry = expiryDisplay(member.monthlyCardExpiresAt, now)
  if (member.monthlyCardStatus === 'paused') {
    return {
      state: 'paused',
      actionText: '暂不可续费',
      priceText,
      statusText:
        configuration.blockedReason ?? '月卡已暂停，请联系门店恢复后再续费',
      ...expiry
    }
  }

  return {
    state: 'active',
    actionText: '微信续费到店月卡',
    priceText,
    statusText: '续费后到店权益从当前到期日顺延',
    ...expiry
  }
}
