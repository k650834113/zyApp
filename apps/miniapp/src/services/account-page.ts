declare const __ZYAPP_UI_DEMO_ENABLED__: boolean
import { consumeMeetupReturn } from './meetup-return'
import {scanRegistration} from './workspace'
import type {
  MemberActivitySummary,
  MemberMonthlyCardConfiguration,
  MemberMonthlyCardOrderSummary,
  MemberRechargeConfiguration,
  MemberRechargeOrderSummary,
  MemberSelfServiceSummary
} from '@zyapp/contracts'
import {
  getMiniappClient,
  isRealWechatPaymentBuild,
  isMockMiniappBuild
} from './client'
import { loadMemberHomeDetails } from './member-home'
import { openCommunityPage } from './community-page'
import { createShareAppMessage } from './share'
import {
  monthlyCardDisplay,
  type MonthlyCardDisplay
} from './monthly-card-display'
import {
  defaultConfirmedAtLeast14,
  needsMemberProfileCompletion,
  normalizePhone,
  normalizeVerificationCode,
  phoneAuthorizationFailure,
  phoneCodeFromEvent,
  phoneVerificationHint,
  type PhoneNumberEvent
} from './member-login'
import { runRechargeFlow } from './recharge-flow'
import {
  quickRechargeAmounts,
  resolveRechargeAmountFen
} from './recharge-amount'
import {
  calculateRechargeGift,
  formatRechargeRuleContent
} from './recharge-gift'
import {
  parseWechatPaymentParameters,
  pollMonthlyCardOrder,
  requestWechatPayment
} from './wechat-payment'

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

function rechargeAmountViews(
  configuration: MemberRechargeConfiguration | null
) {
  const tiers = configuration?.giftTiers ?? []
  return quickRechargeAmounts.map((amount) => {
    const giftFen = calculateRechargeGift(amount.principalFen, tiers)
    return {
      ...amount,
      giftText: giftFen > 0 ? `预计赠送 ${money(giftFen)}` : '暂无赠送',
      totalText: `预计到账 ${money(amount.principalFen + giftFen)}`
    }
  })
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
    reversed: '已冲正',
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

export function registerAccountPage(surface: 'member' | 'login' | 'recharge' | 'monthly-card') {
Page({
  onShareAppMessage() {
    return createShareAppMessage('我的')
  },

  data: {
    employee:false,
    surface,
    storeName: '',
    loading: true,
    busy: false,
    member: null as MemberView | null,
    recentActivities: [] as ActivityView[],
    rechargeConfiguration: null as MemberRechargeConfiguration | null,
    rechargeOrder: null as RechargeOrderView | null,
    monthlyCardConfiguration: null as MemberMonthlyCardConfiguration | null,
    monthlyCardOrder: null as MemberMonthlyCardOrderSummary | null,
    monthlyCardActionText: '微信开通到店月卡',
    monthlyCardPriceText: '',
    monthlyCardStatusText: '',
    monthlyCardState: 'unopened' as MonthlyCardDisplay['state'],
    monthlyCardExpiresOn: null as string | null,
    monthlyCardRemainingDaysText: null as string | null,
    loginFallbackVisible: false,
    loginAgreementAccepted: false,
    loginPhone: '',
    loginCode: '',
    loginChallengeId: null as string | null,
    loginHint: '',
    verificationBusy: false,
    rechargeEnabled: isRealWechatPaymentBuild() || isMockMiniappBuild(),
    monthlyCardEnabled: isRealWechatPaymentBuild() || isMockMiniappBuild(),
    quickRechargeAmounts: rechargeAmountViews(null),
    rechargeRuleContent: formatRechargeRuleContent([]),
    selectedRechargeAmountFen: 10_000 as number | null,
    customRechargeAmount: '',
    rechargePrincipalText: '',
    rechargeGiftText: '',
    rechargeTotalText: ''
  },

  onShow() {
    void getMiniappClient().getIdentity().then(identity=>this.setData({employee:identity.role==='staff'||identity.role==='manager'})).catch(()=>this.setData({employee:false}))
    void getMiniappClient().getHome().then(home => this.setData({storeName: home.store.name})).catch(() => {})
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
          rechargeConfiguration: null,
          monthlyCardConfiguration: null,
          quickRechargeAmounts: rechargeAmountViews(null),
          rechargeRuleContent: formatRechargeRuleContent([])
        })
        return
      }
      if (needsMemberProfileCompletion(member)) {
        wx.reLaunch({ url: '/pages/profile/index?mode=complete' })
        return
      }
      const meetupReturn=surface==='login'?consumeMeetupReturn():null
      if(meetupReturn){wx.reLaunch({url:meetupReturn});return}
      if (surface === 'login') { wx.reLaunch({url:'/pages/member/index'}); return }
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
      const monthlyCardConfiguration = this.data.monthlyCardEnabled
        ? await miniappClient.getMonthlyCardConfiguration()
        : null
      const monthlyCard = monthlyCardConfiguration
        ? monthlyCardDisplay(member, monthlyCardConfiguration)
        : null
      this.setData({
        member: memberView(member),
        recentActivities: history.activities.slice(0, 3).map(activityView),
        rechargeConfiguration,
        quickRechargeAmounts: rechargeAmountViews(rechargeConfiguration),
        rechargeRuleContent: formatRechargeRuleContent(
          rechargeConfiguration?.giftTiers ?? []
        ),
        monthlyCardConfiguration,
        monthlyCardActionText:
          monthlyCard?.actionText ?? '微信开通到店月卡',
        monthlyCardPriceText: monthlyCard?.priceText ?? '',
        monthlyCardStatusText: monthlyCard?.statusText ?? '',
        monthlyCardState: monthlyCard?.state ?? 'unopened',
        monthlyCardExpiresOn: monthlyCard?.expiresOn ?? null,
        monthlyCardRemainingDaysText: monthlyCard?.remainingDaysText ?? null
      })
      this.updateRechargePreview()
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '会员信息加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  goStaffWorkbench(){wx.navigateTo({url:'/pages/staff-workbench/index'})},
  goMessages(){wx.navigateTo({url:'/pages/messages/index'})},
  scanRegistration(){scanRegistration()},
  showFallbackLogin() { this.setData({loginFallbackVisible: !this.data.loginFallbackVisible}) },
  toggleLoginAgreement() { this.setData({loginAgreementAccepted: !this.data.loginAgreementAccepted}) },
  checkLoginAgreement() { if (!this.data.loginAgreementAccepted) wx.showToast({title:'请先阅读并同意协议',icon:'none'}) },

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

  async loginWithPhoneCode(phoneCode: string) {
    this.setData({ busy: true })
    try {
      const member = await getMiniappClient().loginWithWechatProfile({
        requestId: requestId('member-login'),
        phoneCode,
        confirmedAtLeast14: defaultConfirmedAtLeast14
      })
      if (needsMemberProfileCompletion(member)) {
        wx.reLaunch({ url: '/pages/profile/index?mode=complete' })
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
        wx.reLaunch({ url: '/pages/profile/index?mode=complete' })
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
    let principalFen: number
    try {
      principalFen = resolveRechargeAmountFen(
        this.data.selectedRechargeAmountFen,
        this.data.customRechargeAmount
      )
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '充值金额不正确',
        icon: 'none'
      })
      return
    }
    this.setData({ busy: true, rechargeOrder: null })
    try {
      if (__ZYAPP_UI_DEMO_ENABLED__ && configuration.providerMode === 'mock') {
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
        wx.showToast({ title: '门店预存款已到账', icon: 'success' })
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

  async purchaseMonthlyCard() {
    const configuration = this.data.monthlyCardConfiguration
    if (!configuration || !configuration.purchaseAllowed || this.data.busy) {
      return
    }
    this.setData({ busy: true, monthlyCardOrder: null })
    try {
      const client = getMiniappClient()
      const order = await client.createMonthlyCardOrder({
        requestId: requestId('monthly-card')
      })
      this.setData({ monthlyCardOrder: order })
      if (order.status === 'settled') {
        this.setData({ monthlyCardOrder: null })
        await this.load()
        wx.showToast({ title: '月卡已生效', icon: 'success' })
        return
      }
      if (
        order.status === 'creating' ||
        order.status === 'failed' ||
        order.status === 'expired'
      ) {
        throw new Error(
          order.errorMessage ||
            (order.status === 'creating'
              ? '月卡订单正在创建，请稍后重试'
              : '月卡订单不可支付')
        )
      }
      if (__ZYAPP_UI_DEMO_ENABLED__ && order.providerMode === 'mock') {
        await client.settleMockMonthlyCardOrder(order.orderId)
        this.setData({ monthlyCardOrder: null })
        await this.load()
        wx.showToast({ title: '月卡已开通', icon: 'success' })
        return
      }
      const paymentResult = await requestWechatPayment(
        parseWechatPaymentParameters(order.clientPaymentParameters)
      )
      if (paymentResult === 'cancelled') {
        this.setData({ monthlyCardOrder: null })
        wx.showToast({ title: '已取消支付', icon: 'none' })
        return
      }
      const confirmed = await pollMonthlyCardOrder({
        orderId: order.orderId,
        getOrder: (orderId) => client.getMonthlyCardOrder(orderId)
      })
      this.setData({ monthlyCardOrder: confirmed })
      if (confirmed.status === 'settled') {
        this.setData({ monthlyCardOrder: null })
        await this.load()
        wx.showToast({ title: '月卡已生效', icon: 'success' })
        return
      }
      wx.showToast({
        title:
          confirmed.status === 'pending_payment'
            ? '正在确认支付结果'
            : confirmed.errorMessage || '月卡支付未完成',
        icon: 'none',
        duration: 3000
      })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '月卡支付失败',
        icon: 'none',
        duration: 3000
      })
    } finally {
      this.setData({ busy: false })
    }
  },

  updateRechargePreview() {
    try {
      const principal = resolveRechargeAmountFen(this.data.selectedRechargeAmountFen, this.data.customRechargeAmount)
      const gift = calculateRechargeGift(principal, this.data.rechargeConfiguration?.giftTiers ?? [])
      this.setData({rechargePrincipalText:money(principal),rechargeGiftText:money(gift),rechargeTotalText:money(principal+gift)})
    } catch { this.setData({rechargePrincipalText:'—',rechargeGiftText:'—',rechargeTotalText:'—'}) }
  },
  selectRechargeAmount(event: {
    currentTarget: { dataset: { principalFen?: number | string } }
  }) {
    const principalFen = Number(event.currentTarget.dataset.principalFen)
    if (!Number.isSafeInteger(principalFen) || principalFen <= 0) return
    this.setData({
      selectedRechargeAmountFen: principalFen,
      customRechargeAmount: ''
    })
    this.updateRechargePreview()
  },

  inputCustomRechargeAmount(event: WechatMiniprogram.Input) {
    this.setData({
      selectedRechargeAmountFen: null,
      customRechargeAmount: String(event.detail.value ?? '')
    })
    this.updateRechargePreview()
  },

  showRechargeRules() {
    wx.showModal({
      title: '当前充赠规则',
      content: this.data.rechargeRuleContent,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  async settleMockRecharge() {
    if (!__ZYAPP_UI_DEMO_ENABLED__) return
    const order = this.data.rechargeOrder
    if (!order || this.data.busy) return
    this.setData({ busy: true })
    try {
      await getMiniappClient().settleMockRechargeOrder(order.orderId)
      this.setData({ rechargeOrder: null })
      await this.load()
      wx.showToast({ title: '测试门店预存款已到账', icon: 'success' })
    } finally {
      this.setData({ busy: false })
    }
  },

  goLogin() { wx.navigateTo({url:'/pages/login/index'}) },
  goRecharge() { wx.navigateTo({url:'/pages/recharge/index'}) },
  goMonthlyCard() { wx.navigateTo({url:'/pages/monthly-card/index'}) },
  goPricing() { wx.navigateTo({url:'/pages/pricing/index'}) },
  goSettings() { wx.navigateTo({url:'/pages/settings/index'}) },
  showUnavailable() {
    if (!this.data.member) { this.goLogin(); return }
    wx.showToast({title:'功能尚未开放',icon:'none'})
  },
  goMyMeetups(){void openCommunityPage('my-meetups')},
  goPlays(){void openCommunityPage('plays')},
  goHistory() {
    wx.navigateTo({ url: '/pages/history/index' })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index?mode=edit' })
  },

  goGames() {
    wx.reLaunch({ url: '/pages/games/index' })
  },

  goTools() {
    wx.reLaunch({ url: '/pages/tools/index' })
  },

  goActivities() {
    wx.navigateTo({ url: '/pages/activities/index' })
  },

  goFriends() { wx.navigateTo({url:'/pages/friends/index'}) },
  goFavorites() { wx.navigateTo({ url: '/pages/favorites/index' }) },
  goAbout() { wx.navigateTo({ url: '/pages/about/index' }) },
  goMember() {},
  goHome() { wx.reLaunch({ url: '/pages/home/index' }) }
})
}
