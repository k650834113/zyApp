import type {
  MemberActivitySummary,
  MemberRechargeConfiguration,
  MemberRechargeOrderSummary,
  MemberSelfServiceSummary
} from '@zyapp/contracts'
import {
  getMiniappClient,
  isRealWechatPaymentBuild,
  isTestVirtualPhoneLoginEnabled,
  testVirtualPhoneCode
} from '../../services/client'
import { loadMemberHomeDetails } from '../../services/member-home'
import {
  defaultConfirmedAtLeast14,
  needsMemberProfileCompletion,
  normalizePhone,
  normalizeVerificationCode,
  phoneAuthorizationFailure,
  phoneCodeFromEvent,
  phoneVerificationHint,
  type PhoneNumberEvent
} from '../../services/member-login'
import { runRechargeFlow } from '../../services/recharge-flow'
import { requestWechatPayment } from '../../services/wechat-payment'

type MemberView = MemberSelfServiceSummary & {
  totalBalanceText: string
  monthlyCardText: string
  tierText: string
  avatarText: string
}

type ActivityView = MemberActivitySummary & {
  amountText: string
  amountClass: 'debit' | 'credit' | 'neutral'
  timeText: string
  statusText: string
  iconText: string
}

type RechargeOrderView = MemberRechargeOrderSummary & {
  amountText: string
  statusText: string
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function money(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`
}

function memberView(member: MemberSelfServiceSummary): MemberView {
  const monthlyCardText =
    member.monthlyCardStatus === 'none'
      ? '未开通月卡'
      : member.monthlyCardExpiresAt
        ? `月卡有效至 ${member.monthlyCardExpiresAt.slice(0, 10)}`
        : member.monthlyCardStatus === 'paused'
          ? '月卡已暂停'
          : '月卡生效中'
  return {
    ...member,
    totalBalanceText: money(
      member.principalBalanceFen + member.giftBalanceFen
    ),
    monthlyCardText,
    tierText: member.tier === 'advanced' ? '高级会员' : '会员',
    avatarText: Array.from(member.nickname)[0] ?? '会'
  }
}

function activityStatus(activity: MemberActivitySummary): string {
  const labels: Record<MemberActivitySummary['status'], string> = {
    completed: '已完成',
    settled: '已到账',
    active: '已生效',
    paused: '已暂停',
    resumed: '已恢复',
    used: '已使用',
    refunded: '已退款',
    expired: '已过期'
  }
  return labels[activity.status]
}

function activityView(activity: MemberActivitySummary): ActivityView {
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
    timeText: activity.occurredAt.replace('T', ' ').slice(5, 16),
    statusText: activityStatus(activity),
    iconText:
      activity.kind === 'consumption'
        ? '桌'
        : activity.kind === 'recharge'
          ? '充'
          : '卡'
  }
}

function rechargeOrderView(
  order: MemberRechargeOrderSummary
): RechargeOrderView {
  return {
    ...order,
    amountText: money(order.totalCreditFen),
    statusText:
      order.status === 'settled'
        ? '已到账'
        : order.status === 'pending_payment'
          ? '正在确认支付结果'
          : order.status === 'expired'
            ? '已过期'
            : '处理失败'
  }
}

function chooseRechargeAmount(
  _configuration: MemberRechargeConfiguration
): Promise<number | null> {
  const amounts = [10_000, 30_000, 50_000, 100_000]
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList: amounts.map((amount) => `充值 ${money(amount)}`),
      success: (result) => resolve(amounts[result.tapIndex] ?? null),
      fail: () => resolve(null)
    })
  })
}

Page({
  data: {
    loading: true,
    busy: false,
    member: null as MemberView | null,
    recentActivities: [] as ActivityView[],
    rechargeConfiguration: null as MemberRechargeConfiguration | null,
    rechargeOrder: null as RechargeOrderView | null,
    loginFallbackVisible: false,
    loginPhone: '',
    loginCode: '',
    loginChallengeId: null as string | null,
    loginHint: '',
    verificationBusy: false,
    testVirtualPhoneLoginEnabled: isTestVirtualPhoneLoginEnabled(),
    rechargeEnabled: isRealWechatPaymentBuild()
  },

  onShow() {
    void this.load()
  },

  async load() {
    this.setData({ loading: true })
    try {
      const member = await getMiniappClient().getMemberSummary()
      if (!member) {
        this.setData({
          member: null,
          recentActivities: [],
          rechargeConfiguration: null
        })
        return
      }
      if (needsMemberProfileCompletion(member)) {
        wx.reLaunch({ url: '/pages/member/index?mode=complete' })
        return
      }
      const miniappClient = getMiniappClient()
      const { history, rechargeConfiguration } =
        await loadMemberHomeDetails(
          {
            getHistory: () => miniappClient.getMemberHistory(),
            getRechargeConfiguration: () =>
              miniappClient.getRechargeConfiguration()
          },
          this.data.rechargeEnabled
        )
      this.setData({
        member: memberView(member),
        recentActivities: history.activities.slice(0, 3).map(activityView),
        rechargeConfiguration
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '会员信息加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
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
        requestId: requestId('member-login'),
        phoneCode,
        confirmedAtLeast14: defaultConfirmedAtLeast14
      })
      if (needsMemberProfileCompletion(member)) {
        wx.reLaunch({ url: '/pages/member/index?mode=complete' })
        return
      }
      await this.load()
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

  inputPhone(event: WechatMiniprogram.Input) {
    this.setData({ loginPhone: String(event.detail.value ?? '') })
  },

  inputCode(event: WechatMiniprogram.Input) {
    this.setData({ loginCode: String(event.detail.value ?? '') })
  },

  async requestVerification() {
    const phone = normalizePhone(this.data.loginPhone)
    if (!phone || this.data.verificationBusy) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    this.setData({ verificationBusy: true })
    try {
      const challenge =
        await getMiniappClient().requestPhoneVerification(phone)
      this.setData({
        loginChallengeId: challenge.challengeId,
        loginHint: phoneVerificationHint(challenge)
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '验证码发送失败',
        icon: 'none'
      })
    } finally {
      this.setData({ verificationBusy: false })
    }
  },

  async submitFallbackLogin() {
    const phone = normalizePhone(this.data.loginPhone)
    const code = normalizeVerificationCode(this.data.loginCode)
    if (!phone || !code || !this.data.loginChallengeId || this.data.busy) {
      wx.showToast({ title: '请填写手机号和验证码', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      const member = await getMiniappClient().registerMember({
        requestId: requestId('member-register'),
        challengeId: this.data.loginChallengeId,
        verificationCode: code,
        phone,
        nickname: '微信用户',
        confirmedAtLeast14: defaultConfirmedAtLeast14
      })
      if (needsMemberProfileCompletion(member)) {
        wx.reLaunch({ url: '/pages/member/index?mode=complete' })
        return
      }
      await this.load()
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

  async recharge() {
    const configuration = this.data.rechargeConfiguration
    if (!configuration || this.data.busy) return
    const principalFen = await chooseRechargeAmount(configuration)
    if (!principalFen) return
    this.setData({ busy: true, rechargeOrder: null })
    try {
      if (configuration.providerMode === 'mock') {
        const order = await getMiniappClient().createRechargeOrder({
          requestId: requestId('recharge'),
          principalFen
        })
        this.setData({ rechargeOrder: rechargeOrderView(order) })
        return
      }
      const result = await runRechargeFlow({
        createOrder: () =>
          getMiniappClient().createRechargeOrder({
            requestId: requestId('recharge'),
            principalFen
          }),
        requestPayment: requestWechatPayment,
        getOrder: (orderId) =>
          getMiniappClient().getRechargeOrder(orderId)
      })
      if (result.kind === 'cancelled') {
        this.setData({ rechargeOrder: null })
        wx.showToast({ title: '已取消支付', icon: 'none' })
        return
      }
      if (result.kind === 'confirmed') {
        this.setData({ rechargeOrder: null })
        await this.load()
        wx.showToast({ title: '充值已到账', icon: 'success' })
        return
      }
      this.setData({ rechargeOrder: rechargeOrderView(result.order) })
      wx.showToast({ title: '正在确认支付结果', icon: 'none' })
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
      await getMiniappClient().settleMockRechargeOrder(order.orderId)
      this.setData({ rechargeOrder: null })
      await this.load()
      wx.showToast({ title: '测试充值已到账', icon: 'success' })
    } finally {
      this.setData({ busy: false })
    }
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/member/index?mode=edit' })
  },

  goHome() {}
})
