import type {
  MemberRechargeOrderSummary,
  MemberSelfServiceHistory,
  MemberSelfServiceSummary,
  MiniappHomeSnapshot,
  MiniappIdentity,
  PublicActivitySummary
} from '@zyapp/contracts'
import {
  getMiniappClient,
  isTestVirtualPhoneLoginEnabled,
  testVirtualPhoneCode
} from '../../services/client'
import {
  defaultConfirmedAtLeast14,
  normalizeNickname,
  normalizePhone,
  normalizeVerificationCode,
  phoneAuthorizationFailure,
  phoneCodeFromEvent,
  phoneVerificationHint,
  type PhoneNumberEvent
} from '../../services/member-login'

type MemberView = MemberSelfServiceSummary & {
  avatarText: string
  principalBalanceText: string
  giftBalanceText: string
  totalBalanceText: string
  tierText: string
  ageGateText: string
  canRecharge: boolean
  monthlyCardLabel: string
  monthlyCardExpiresText: string
  monthlyCardClass: string
}

type RechargePackageView = {
  id: string
  label: string
  principalFen: number
  priceText: string
  giftText: string
  totalText: string
}

type RechargeOrderView = MemberRechargeOrderSummary & {
  principalText: string
  giftText: string
  totalCreditText: string
  statusText: string
}

type RecentRecordView = {
  id: string
  title: string
  subtitle: string
  amountText: string
  amountClass: 'positive' | 'negative' | 'neutral'
}

type InputEvent = {
  detail: { value: string }
}

type SwitchEvent = {
  detail: { value: boolean }
}

const quickRechargeFen = [10_000, 30_000, 50_000, 100_000]
const emptyHistory: MemberSelfServiceHistory = {
  orders: [],
  walletEntries: [],
  monthlyCardEvents: []
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatMoney(value: number): string {
  const text = (value / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
  return `¥${text}`
}

function formatSignedMoney(value: number): string {
  if (value === 0) return formatMoney(0)
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`
}

function shanghaiDate(value: string): Date {
  return new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000)
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

function formatShortTime(value: string): string {
  const date = shanghaiDate(value)
  return `${twoDigits(date.getUTCMonth() + 1)}.${twoDigits(
    date.getUTCDate()
  )} ${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}`
}

function formatExpiry(value: string | null): string {
  if (!value) return '到期时间待同步'
  const date = shanghaiDate(value)
  return `到期 ${date.getUTCFullYear()}.${twoDigits(
    date.getUTCMonth() + 1
  )}.${twoDigits(date.getUTCDate())}`
}

function toMemberView(member: MemberSelfServiceSummary): MemberView {
  const hasMonthlyCard = member.monthlyCardStatus !== 'none'
  const monthlyCardLabel =
    member.monthlyCardStatus === 'active'
      ? '月卡生效中'
      : member.monthlyCardStatus === 'paused'
        ? '月卡已暂停'
        : '暂无月卡'
  const canRecharge = member.ageGate !== 'recharge_disabled'
  return {
    ...member,
    avatarText: member.nickname.trim().slice(0, 1) || '会',
    principalBalanceText: formatMoney(member.principalBalanceFen),
    giftBalanceText: formatMoney(member.giftBalanceFen),
    totalBalanceText: formatMoney(
      member.principalBalanceFen + member.giftBalanceFen
    ),
    tierText: member.tier === 'advanced' ? '高级会员' : '普通会员',
    ageGateText: canRecharge ? '可储值' : '暂不可储值',
    canRecharge,
    monthlyCardLabel,
    monthlyCardExpiresText: hasMonthlyCard
      ? formatExpiry(member.monthlyCardExpiresAt)
      : '开通后可在首页查看到期时间',
    monthlyCardClass: hasMonthlyCard ? member.monthlyCardStatus : 'none'
  }
}

function rechargeTiers(activities: PublicActivitySummary[]) {
  return activities
    .filter((activity) => activity.activityType === 'recharge')
    .flatMap((activity) => activity.rechargeTiers)
    .filter(
      (tier) =>
        Number.isSafeInteger(tier.principalFen) &&
        Number.isSafeInteger(tier.giftFen) &&
        tier.principalFen > 0 &&
        tier.giftFen >= 0
    )
    .sort((left, right) => left.principalFen - right.principalFen)
}

function giftFor(
  principalFen: number,
  activities: PublicActivitySummary[]
): number {
  const tiers = rechargeTiers(activities)
  const highest = tiers[tiers.length - 1]
  if (highest === undefined) return 0

  let remainderFen = principalFen
  let giftFen = 0
  if (remainderFen >= highest.principalFen) {
    const count = Math.floor(remainderFen / highest.principalFen)
    giftFen += count * highest.giftFen
    remainderFen -= count * highest.principalFen
  }

  const remainderTier = [...tiers]
    .reverse()
    .find((tier) => tier.principalFen <= remainderFen)
  return giftFen + (remainderTier?.giftFen ?? 0)
}

function buildRechargePackages(
  activities: PublicActivitySummary[]
): RechargePackageView[] {
  return quickRechargeFen.map((principalFen) => {
    const giftFen = giftFor(principalFen, activities)
    return {
      id: `recharge-${principalFen}`,
      label: giftFen > 0 ? `赠 ${formatMoney(giftFen)}` : '快捷充值',
      principalFen,
      priceText: formatMoney(principalFen),
      giftText: giftFen > 0 ? `赠 ${formatMoney(giftFen)}` : '无赠送',
      totalText: `到账 ${formatMoney(principalFen + giftFen)}`
    }
  })
}

function toRechargeOrderView(
  order: MemberRechargeOrderSummary
): RechargeOrderView {
  const statusText =
    order.status === 'creating'
      ? '创建中'
      : order.status === 'pending_payment'
        ? '待支付'
        : order.status === 'settled'
          ? '已到账'
          : order.status === 'expired'
            ? '已过期'
            : '支付失败'
  return {
    ...order,
    principalText: formatMoney(order.principalFen),
    giftText: formatMoney(order.giftFen),
    totalCreditText: formatMoney(order.totalCreditFen),
    statusText
  }
}

function walletTitle(eventType: string, reason: string | null): string {
  if (reason?.trim()) return reason.trim()
  if (eventType.includes('recharge')) return '充值到账'
  if (eventType.includes('debit') || eventType.includes('consume')) {
    return '余额消费'
  }
  if (eventType.includes('refund')) return '退款入账'
  return '余额变动'
}

function monthlyCardTitle(eventType: string, reason: string | null): string {
  if (reason?.trim()) return reason.trim()
  if (eventType.includes('purchase')) return '月卡开通'
  if (eventType.includes('pause')) return '月卡暂停'
  if (eventType.includes('resume')) return '月卡恢复'
  if (eventType.includes('extend')) return '月卡延期'
  return '月卡记录'
}

function toRecentRecords(history: MemberSelfServiceHistory): RecentRecordView[] {
  const records = [
    ...history.orders.map((item) => ({
      sortAt: item.completedAt,
      view: {
        id: `order-${item.orderId}`,
        title: '桌位消费',
        subtitle: `${item.orderNumber} · ${formatShortTime(item.completedAt)}`,
        amountText: `-${formatMoney(item.totalFen)}`,
        amountClass: 'negative' as const
      }
    })),
    ...history.walletEntries.map((item) => {
      const deltaFen = item.principalDeltaFen + item.giftDeltaFen
      return {
        sortAt: item.occurredAt,
        view: {
          id: `wallet-${item.operationId}`,
          title: walletTitle(item.eventType, item.reason),
          subtitle: formatShortTime(item.occurredAt),
          amountText: formatSignedMoney(deltaFen),
          amountClass:
            deltaFen > 0
              ? ('positive' as const)
              : deltaFen < 0
                ? ('negative' as const)
                : ('neutral' as const)
        }
      }
    }),
    ...history.monthlyCardEvents.map((item) => ({
      sortAt: item.occurredAt,
      view: {
        id: `monthly-${item.operationId}`,
        title: monthlyCardTitle(item.eventType, item.reason),
        subtitle: formatShortTime(item.occurredAt),
        amountText: '',
        amountClass: 'neutral' as const
      }
    }))
  ]

  return records
    .sort((left, right) => Date.parse(right.sortAt) - Date.parse(left.sortAt))
    .slice(0, 5)
    .map((item) => item.view)
}

function redirectForEmployee(identity: MiniappIdentity): boolean {
  if (identity.role === 'manager') {
    wx.redirectTo({ url: '/pages/manager/index' })
    return true
  }
  if (identity.role === 'staff') {
    wx.redirectTo({ url: '/pages/staff/index' })
    return true
  }
  return false
}

Page({
  data: {
    loading: true,
    home: null as MiniappHomeSnapshot | null,
    member: null as MemberView | null,
    rechargePackages: [] as RechargePackageView[],
    rechargeOrder: null as RechargeOrderView | null,
    recentRecords: [] as RecentRecordView[],
    busy: false,
    verificationBusy: false,
    testVirtualPhoneLoginEnabled: isTestVirtualPhoneLoginEnabled(),
    loginFallbackVisible: false,
    loginPhone: '',
    loginCode: '',
    loginNickname: '',
    loginChallengeId: null as string | null,
    loginVerificationHint: '',
    loginConfirmedAtLeast14: defaultConfirmedAtLeast14
  },

  async onShow() {
    await this.loadHome()
  },

  async loadHome() {
    let redirecting = false
    try {
      this.setData({ loading: true })
      const [home, identity] = await Promise.all([
        getMiniappClient().getHome(),
        getMiniappClient().getIdentity()
      ])
      redirecting = redirectForEmployee(identity)
      if (redirecting) return

      const member = await getMiniappClient().getMemberSummary()
      const history = member
        ? await getMiniappClient().getMemberHistory().catch(() => emptyHistory)
        : emptyHistory
      this.setData({
        home,
        member: member ? toMemberView(member) : null,
        rechargePackages: buildRechargePackages(home.activities),
        recentRecords: toRecentRecords(history)
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '加载失败',
        icon: 'none'
      })
    } finally {
      if (!redirecting) this.setData({ loading: false })
    }
  },

  openActivities() {
    wx.navigateTo({ url: '/pages/activities/index' })
  },

  openMember() {
    wx.navigateTo({ url: '/pages/member/index' })
  },

  showPhoneLogin() {
    this.setData({ loginFallbackVisible: true })
  },

  updateLoginPhone(event: InputEvent) {
    this.setData({
      loginPhone: event.detail.value,
      loginChallengeId: null,
      loginVerificationHint: ''
    })
  },

  updateLoginCode(event: InputEvent) {
    this.setData({ loginCode: event.detail.value })
  },

  updateLoginNickname(event: InputEvent) {
    this.setData({ loginNickname: event.detail.value })
  },

  toggleLoginAgeGate(event: SwitchEvent) {
    this.setData({ loginConfirmedAtLeast14: event.detail.value })
  },

  async requestLoginVerification() {
    if (this.data.busy || this.data.verificationBusy) return
    const phone = normalizePhone(this.data.loginPhone)
    if (!phone) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    this.setData({ verificationBusy: true })
    try {
      const challenge = await getMiniappClient().requestPhoneVerification(phone)
      this.setData({
        loginPhone: phone,
        loginChallengeId: challenge.challengeId,
        loginVerificationHint: phoneVerificationHint(challenge)
      })
      wx.showToast({ title: '验证码已发送', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '验证码发送失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ verificationBusy: false })
    }
  },

  async loginWithPhoneVerification() {
    if (this.data.busy) return
    const phone = normalizePhone(this.data.loginPhone)
    const verificationCode = normalizeVerificationCode(this.data.loginCode)
    if (!phone) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!verificationCode) {
      wx.showToast({ title: '请输入正确的验证码', icon: 'none' })
      return
    }
    if (!this.data.loginChallengeId) {
      wx.showToast({ title: '请先获取验证码', icon: 'none' })
      return
    }

    this.setData({ busy: true })
    try {
      const member = await getMiniappClient().registerMember({
        requestId: requestId('home-phone-login'),
        challengeId: this.data.loginChallengeId,
        verificationCode,
        phone,
        nickname: normalizeNickname(this.data.loginNickname),
        confirmedAtLeast14: this.data.loginConfirmedAtLeast14
      })
      const history = await getMiniappClient()
        .getMemberHistory()
        .catch(() => emptyHistory)
      this.setData({
        member: toMemberView(member),
        recentRecords: toRecentRecords(history),
        loginFallbackVisible: false,
        loginChallengeId: null,
        loginCode: '',
        loginVerificationHint: ''
      })
      wx.showToast({ title: '登录成功', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '登录失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  async loginWithWechat(event: PhoneNumberEvent) {
    if (this.data.busy) return
    const phoneCode = phoneCodeFromEvent(event)
    if (!phoneCode) {
      this.setData({ loginFallbackVisible: true })
      wx.showModal({
        title: '手机号授权未完成',
        content: phoneAuthorizationFailure(event),
        showCancel: false
      })
      return
    }

    await this.loginWithPhoneCode(phoneCode)
  },

  async loginWithVirtualPhone() {
    if (this.data.busy) return
    await this.loginWithPhoneCode(testVirtualPhoneCode())
  },

  async loginWithPhoneCode(phoneCode: string) {
    this.setData({ busy: true })
    try {
      const member = await getMiniappClient().loginWithWechatProfile({
        requestId: requestId('home-wechat-login'),
        phoneCode,
        confirmedAtLeast14: defaultConfirmedAtLeast14
      })
      const history = await getMiniappClient()
        .getMemberHistory()
        .catch(() => emptyHistory)
      this.setData({
        member: toMemberView(member),
        recentRecords: toRecentRecords(history)
      })
      wx.showToast({ title: '登录成功', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '登录失败',
        icon: 'none'
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  quickRecharge(event: { currentTarget: { dataset: { fen?: number } } }) {
    const fen = Number(event.currentTarget.dataset.fen)
    void this.performRecharge(fen)
  },

  async performRecharge(principalFen: number) {
    if (this.data.busy) return
    if (!this.data.member) {
      wx.showToast({ title: '请先一键登录', icon: 'none' })
      return
    }
    if (!this.data.member.canRecharge) {
      wx.showToast({ title: '当前账号暂不能储值', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      const order = await getMiniappClient().createRechargeOrder({
        requestId: requestId('home-recharge'),
        principalFen
      })
      this.setData({ rechargeOrder: toRechargeOrderView(order) })
      wx.showToast({ title: '充值单已创建', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '充值失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  async settleMockRecharge() {
    const order = this.data.rechargeOrder
    if (!order || this.data.busy) return
    this.setData({ busy: true })
    try {
      const settled = await getMiniappClient().settleMockRechargeOrder(
        order.orderId
      )
      const [member, history] = await Promise.all([
        getMiniappClient().getMemberSummary(),
        getMiniappClient().getMemberHistory()
      ])
      this.setData({
        rechargeOrder: toRechargeOrderView(settled),
        member: member ? toMemberView(member) : null,
        recentRecords: toRecentRecords(history)
      })
      wx.showToast({ title: '测试支付已到账', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '入账失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ busy: false })
    }
  }
})
