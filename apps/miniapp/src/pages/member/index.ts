import type {
  MemberSelfServiceHistory,
  MemberSelfServiceSummary,
  MemberRechargeOrderSummary,
  MiniappIdentity
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
  monthlyCardText: string
  ageGateText: string
  birthdayText: string
}

type HistoryLine = {
  id: string
  title: string
  amountText: string
  timeText: string
}

type RechargeOrderView = MemberRechargeOrderSummary & {
  principalText: string
  giftText: string
  totalCreditText: string
  statusText: string
}

type InputEvent = {
  detail: { value: string }
}

type SwitchEvent = {
  detail: { value: boolean }
}

const emptyHistory: MemberSelfServiceHistory = {
  orders: [],
  walletEntries: [],
  monthlyCardEvents: []
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatFen(value: number): string {
  return `¥${(value / 100).toFixed(2)}`
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

function toView(member: MemberSelfServiceSummary): MemberView {
  return {
    ...member,
    avatarText: member.nickname.trim().slice(0, 1) || '会',
    principalBalanceText: formatFen(member.principalBalanceFen),
    giftBalanceText: formatFen(member.giftBalanceFen),
    totalBalanceText: formatFen(
      member.principalBalanceFen + member.giftBalanceFen
    ),
    tierText: member.tier === 'advanced' ? '高级会员' : '普通会员',
    monthlyCardText:
      member.monthlyCardStatus === 'none'
        ? '无有效月卡'
        : member.monthlyCardStatus === 'paused'
          ? '月卡已暂停'
          : '月卡生效中',
    ageGateText:
      member.ageGate === 'recharge_disabled'
        ? '未完成监护人同意与身份核验，暂不能储值'
        : '已具备储值资格',
    birthdayText:
      member.birthdayMonth === null || member.birthdayDay === null
        ? '尚未填写'
        : `${member.birthdayMonth} 月 ${member.birthdayDay} 日`
  }
}

function timeText(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
}

function signedFen(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatFen(Math.abs(value))}`
}

function rechargeOrderView(
  order: MemberRechargeOrderSummary
): RechargeOrderView {
  const statusText =
    order.status === 'creating'
      ? '正在创建支付单'
      : order.status === 'pending_payment'
        ? '等待微信支付'
        : order.status === 'settled'
          ? '支付成功，储值已入账'
          : order.status === 'expired'
            ? '订单已过期'
            : '订单失败'
  return {
    ...order,
    principalText: formatFen(order.principalFen),
    giftText: formatFen(order.giftFen),
    totalCreditText: formatFen(order.totalCreditFen),
    statusText
  }
}

function toHistoryView(history: MemberSelfServiceHistory): {
  orderHistory: HistoryLine[]
  walletHistory: HistoryLine[]
  monthlyCardHistory: HistoryLine[]
} {
  return {
    orderHistory: history.orders.map((item) => ({
      id: item.orderId,
      title: `消费单 ${item.orderNumber}`,
      amountText: `-${formatFen(item.totalFen)}`,
      timeText: timeText(item.completedAt)
    })),
    walletHistory: history.walletEntries.map((item) => ({
      id: item.operationId,
      title: item.reason ?? item.eventType,
      amountText: signedFen(
        item.principalDeltaFen + item.giftDeltaFen
      ),
      timeText: timeText(item.occurredAt)
    })),
    monthlyCardHistory: history.monthlyCardEvents.map((item) => ({
      id: item.operationId,
      title: item.reason ?? item.eventType,
      amountText: '',
      timeText: timeText(item.occurredAt)
    }))
  }
}

Page({
  data: {
    member: null as MemberView | null,
    orderHistory: [] as HistoryLine[],
    walletHistory: [] as HistoryLine[],
    monthlyCardHistory: [] as HistoryLine[],
    rechargeOrder: null as RechargeOrderView | null,
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
    try {
      const identity = await getMiniappClient().getIdentity()
      if (redirectForEmployee(identity)) return
      const member = await getMiniappClient().getMemberSummary()
      if (!member) {
        this.setData({
          member: null,
          orderHistory: [],
          walletHistory: [],
          monthlyCardHistory: []
        })
        return
      }
      const history = await getMiniappClient().getMemberHistory()
      this.setData({ member: toView(member), ...toHistoryView(history) })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '会员资料加载失败',
        icon: 'none'
      })
    }
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
        requestId: requestId('member-phone-login'),
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
        member: toView(member),
        ...toHistoryView(history),
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
        requestId: requestId('member-wechat-login'),
        phoneCode,
        confirmedAtLeast14: defaultConfirmedAtLeast14
      })
      this.setData({
        member: toView(member)
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

  async fillBirthday(event: {
    detail: { value: { birthdayMonth?: string; birthdayDay?: string } }
  }) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const member = await getMiniappClient().fillBirthday(
        Number(event.detail.value.birthdayMonth),
        Number(event.detail.value.birthdayDay)
      )
      this.setData({ member: toView(member) })
      wx.showToast({ title: '生日已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '生日保存失败',
        icon: 'none'
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  recharge(event: { currentTarget: { dataset: { fen?: number } } }) {
    const fen = Number(event.currentTarget.dataset.fen)
    void this.performRecharge(fen)
  },

  async performRecharge(fen: number) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const order = await getMiniappClient().createRechargeOrder({
        requestId: requestId('recharge'),
        principalFen: fen
      })
      this.setData({ rechargeOrder: rechargeOrderView(order) })
      wx.showToast({ title: '充值订单已创建', icon: 'success' })
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
        rechargeOrder: rechargeOrderView(settled),
        member: member ? toView(member) : null,
        ...toHistoryView(history)
      })
      wx.showToast({ title: 'Mock 支付并入账成功', icon: 'success' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '模拟支付失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ busy: false })
    }
  }
})
