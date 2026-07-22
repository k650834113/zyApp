import type {
  ActivitySummary,
  BusinessReport,
  EmployeeFinancialCommandSummary,
  MiniappIdentity,
  SaveActivityFields
} from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'

let applyPollingTimer: ReturnType<typeof setTimeout> | undefined

type ActivityView = ActivitySummary & {
  statusText: string
  scheduleText: string
  tierText: string
}

type ActivityForm = {
  activityId: string
  title: string
  summary: string
  content: string
  startsAt: string
  endsAt: string
  regularPrice: string
  advancedPrice: string
  rechargeTiers: string
  reason: string
}

type ReportView = {
  orderNetText: string
  actualCashText: string
  rechargePrincipalText: string
  rechargeGiftText: string
  monthlyNetText: string
  refundText: string
  admissionQuantity: number
  orderCount: number
  activeMonthlyCount: number
  items: Array<{
    key: string
    itemName: string
    quantityText: string
    amountText: string
  }>
}

const activityTypeOptions = [
  { label: '一般活动', value: 'general' as const },
  { label: '充值活动', value: 'recharge' as const }
]

function money(fen: number): string {
  return (fen / 100).toFixed(2)
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function localDateTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
}

function isoDateTime(value: string, name: string): string {
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`${name}请使用 YYYY-MM-DD HH:mm`)
  }
  const parsed = new Date(`${normalized.replace(' ', 'T')}:00+08:00`)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name}无效`)
  return parsed.toISOString()
}

function optionalMoney(value: string, name: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${name}最多保留两位小数`)
  }
  const fen = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(fen) || fen < 0) {
    throw new Error(`${name}无效`)
  }
  return fen
}

function parseTiers(value: string): SaveActivityFields['rechargeTiers'] {
  const normalized = value.trim()
  if (!normalized) return []
  const principals = new Set<number>()
  return normalized
    .split(/[,，;\n]+/)
    .filter(Boolean)
    .map((entry) => {
      const [principalText, giftText, extra] = entry
        .trim()
        .split(/[:：]/)
      if (!principalText || giftText === undefined || extra !== undefined) {
        throw new Error('充值档位请按“本金:赠送”填写')
      }
      const principalFen = optionalMoney(principalText, '充值本金')
      const giftFen = optionalMoney(giftText, '赠送金额')
      if (
        principalFen === undefined ||
        principalFen <= 0 ||
        giftFen === undefined
      ) {
        throw new Error('充值本金必须大于 0')
      }
      if (principals.has(principalFen)) {
        throw new Error('充值本金档位不能重复')
      }
      principals.add(principalFen)
      return { principalFen, giftFen }
    })
}

function activityView(activity: ActivitySummary): ActivityView {
  return {
    ...activity,
    statusText: {
      draft: '草稿',
      published: '已发布',
      disabled: '已停用'
    }[activity.status],
    scheduleText:
      `${localDateTime(activity.startsAt)} 至 ` +
      localDateTime(activity.endsAt),
    tierText:
      activity.rechargeTiers.length === 0
        ? '无充值档位'
        : activity.rechargeTiers
            .map(
              (tier) =>
                `充 ${money(tier.principalFen)} 赠 ${money(tier.giftFen)}`
            )
            .join('；')
  }
}

function emptyForm(): ActivityForm {
  const now = new Date()
  return {
    activityId: '',
    title: '',
    summary: '',
    content: '',
    startsAt: localDateTime(now.toISOString()),
    endsAt: localDateTime(
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    ),
    regularPrice: '',
    advancedPrice: '',
    rechargeTiers: '',
    reason: ''
  }
}

function reportView(report: BusinessReport): ReportView {
  return {
    orderNetText: money(report.order.netSalesFen),
    actualCashText: money(report.actualCashInflowFen),
    rechargePrincipalText: money(report.wallet.rechargePrincipalFen),
    rechargeGiftText: money(report.wallet.rechargeGiftFen),
    monthlyNetText: money(report.monthlyCard.netSalesFen),
    refundText: money(
      report.order.refundFen +
        report.wallet.rechargeRefundPrincipalFen +
        report.monthlyCard.refundFen
    ),
    admissionQuantity: report.order.admissionQuantity,
    orderCount: report.order.orderCount,
    activeMonthlyCount: report.monthlyCard.activeCount,
    items: report.items.map((item) => ({
      key: `${item.itemType}-${item.itemName}`,
      itemName: item.itemName,
      quantityText: `${item.soldQuantity} / ${item.refundedQuantity} / ${item.netQuantity}`,
      amountText: money(item.netSalesFen)
    }))
  }
}

function applyCommandStatusText(
  command: EmployeeFinancialCommandSummary
): string {
  const labels: Record<EmployeeFinancialCommandSummary['status'], string> = {
    pending: '等待门店 PC 领取',
    claimed: '门店 PC 正在应用充值规则',
    completed: '充值规则已生效',
    failed: '充值规则应用失败',
    expired: '操作已过期',
    canceled: '操作已取消'
  }
  return command.errorMessage
    ? `${labels[command.status]}：${command.errorMessage}`
    : labels[command.status]
}

Page({
  data: {
    identity: { role: 'guest' } as MiniappIdentity,
    busy: false,
    activities: [] as ActivityView[],
    form: emptyForm(),
    activityTypeOptions,
    activityTypeIndex: 0,
    pinned: false,
    allowStoredValue: true,
    allowWechat: true,
    statusReason: '',
    applyReason: '',
    activeApplyCommand: null as EmployeeFinancialCommandSummary | null,
    applyStatusText: '',
    applyResultText: '',
    applyBusy: false,
    reportFromDate: today(),
    reportToDate: today(),
    report: null as ReportView | null
  },

  async onShow() {
    const identity = await getMiniappClient().getIdentity()
    this.setData({ identity })
    if (identity.role !== 'manager') {
      wx.showToast({ title: '仅店长可进入', icon: 'none' })
      return
    }
    await Promise.all([this.loadActivities(), this.loadReport()])
  },

  onUnload() {
    if (applyPollingTimer) clearTimeout(applyPollingTimer)
  },

  async loadActivities() {
    try {
      const activities = (
        await getMiniappClient().listEmployeeActivities()
      ).map(activityView)
      this.setData({ activities })
    } catch (error) {
      this.showError(error, '活动加载失败')
    }
  },

  newActivity() {
    this.setData({
      form: emptyForm(),
      activityTypeIndex: 0,
      pinned: false,
      allowStoredValue: true,
      allowWechat: true
    })
  },

  editActivity(event: {
    currentTarget: { dataset: { activityId?: string } }
  }) {
    const activity = this.data.activities.find(
      (candidate) => candidate.id === event.currentTarget.dataset.activityId
    )
    if (!activity) return
    this.setData({
      form: {
        activityId: activity.id,
        title: activity.title,
        summary: activity.summary,
        content: activity.content,
        startsAt: localDateTime(activity.startsAt),
        endsAt: localDateTime(activity.endsAt),
        regularPrice:
          activity.regularPriceFen === null
            ? ''
            : money(activity.regularPriceFen),
        advancedPrice:
          activity.advancedPriceFen === null
            ? ''
            : money(activity.advancedPriceFen),
        rechargeTiers: activity.rechargeTiers
          .map(
            (tier) =>
              `${money(tier.principalFen)}:${money(tier.giftFen)}`
          )
          .join(','),
        reason: ''
      },
      activityTypeIndex: activity.activityType === 'recharge' ? 1 : 0,
      pinned: activity.pinned,
      allowStoredValue: activity.allowStoredValue,
      allowWechat: activity.allowWechat
    })
  },

  changeActivityType(event: { detail: { value: string } }) {
    this.setData({ activityTypeIndex: Number(event.detail.value) })
  },

  changePinned(event: { detail: { value: boolean } }) {
    this.setData({ pinned: event.detail.value })
  },

  changeStoredValue(event: { detail: { value: boolean } }) {
    this.setData({ allowStoredValue: event.detail.value })
  },

  changeWechat(event: { detail: { value: boolean } }) {
    this.setData({ allowWechat: event.detail.value })
  },

  updateStatusReason(event: { detail: { value?: string } }) {
    this.setData({ statusReason: event.detail.value ?? '' })
  },

  updateApplyReason(event: { detail: { value?: string } }) {
    this.setData({ applyReason: event.detail.value ?? '' })
  },

  async saveActivity(event: {
    detail: {
      value: {
        title?: string
        summary?: string
        content?: string
        startsAt?: string
        endsAt?: string
        regularPrice?: string
        advancedPrice?: string
        rechargeTiers?: string
        reason?: string
      }
    }
  }) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const value = event.detail.value
      const regularPriceFen = optionalMoney(
        value.regularPrice ?? '',
        '普通价格'
      )
      const advancedPriceFen = optionalMoney(
        value.advancedPrice ?? '',
        '高级会员价格'
      )
      const fields: SaveActivityFields = {
        title: value.title?.trim() ?? '',
        summary: value.summary?.trim() ?? '',
        content: value.content?.trim() ?? '',
        activityType:
          activityTypeOptions[this.data.activityTypeIndex]?.value ?? 'general',
        startsAt: isoDateTime(value.startsAt ?? '', '开始时间'),
        endsAt: isoDateTime(value.endsAt ?? '', '结束时间'),
        pinned: this.data.pinned,
        ...(regularPriceFen === undefined ? {} : { regularPriceFen }),
        ...(advancedPriceFen === undefined ? {} : { advancedPriceFen }),
        allowStoredValue: this.data.allowStoredValue,
        allowWechat: this.data.allowWechat,
        rechargeTiers: parseTiers(value.rechargeTiers ?? '')
      }
      const activityId = this.data.form.activityId
      const result = activityId
        ? await getMiniappClient().updateEmployeeActivity({
            requestId:
              `activity-update-${Date.now()}-` +
              Math.random().toString(36).slice(2, 10),
            activityId,
            reason: value.reason?.trim() ?? '',
            ...fields
          })
        : await getMiniappClient().createEmployeeActivity({
            requestId:
              `activity-create-${Date.now()}-` +
              Math.random().toString(36).slice(2, 10),
            ...fields
          })
      await this.loadActivities()
      this.editActivity({
        currentTarget: { dataset: { activityId: result.id } }
      })
      wx.showToast({ title: activityId ? '活动已更新' : '草稿已创建' })
    } catch (error) {
      this.showError(error, '活动保存失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  async setActivityStatus(event: {
    currentTarget: {
      dataset: {
        activityId?: string
        status?: 'published' | 'disabled'
      }
    }
  }) {
    const activityId = event.currentTarget.dataset.activityId
    const status = event.currentTarget.dataset.status
    const reason = this.data.statusReason.trim()
    if (!activityId || !status || this.data.busy) return
    if (reason.length < 2 || reason.length > 200) {
      wx.showToast({ title: '请填写 2-200 字操作原因', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    try {
      await getMiniappClient().setEmployeeActivityStatus({
        requestId:
          `activity-${status}-${Date.now()}-` +
          Math.random().toString(36).slice(2, 10),
        activityId,
        status,
        reason
      })
      this.setData({ statusReason: '' })
      await this.loadActivities()
      wx.showToast({
        title: status === 'published' ? '活动已发布' : '活动已停用'
      })
    } catch (error) {
      this.showError(error, '活动状态修改失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  async applyRechargeTiers(event: {
    currentTarget: { dataset: { activityId?: string } }
  }) {
    const activityId = event.currentTarget.dataset.activityId
    const reason = this.data.applyReason.trim()
    if (!activityId || this.data.applyBusy) return
    if (reason.length < 2 || reason.length > 200) {
      wx.showToast({
        title: '请填写 2-200 字应用原因',
        icon: 'none'
      })
      return
    }
    this.setData({ applyBusy: true })
    try {
      const command =
        await getMiniappClient().createEmployeeFinancialCommand({
          requestId:
            `activity-tiers-${Date.now()}-` +
            Math.random().toString(36).slice(2, 10),
          type: 'apply_activity_recharge_tiers',
          activityId,
          reason
        })
      this.setApplyCommand(command)
      this.pollApplyCommand(command.commandId)
    } catch (error) {
      this.setData({ applyBusy: false })
      this.showError(error, '充值规则提交失败')
    }
  },

  async cancelApplyCommand() {
    const command = this.data.activeApplyCommand
    if (!command || command.status !== 'pending') return
    try {
      const canceled =
        await getMiniappClient().cancelEmployeeFinancialCommand(
          command.commandId
        )
      if (applyPollingTimer) clearTimeout(applyPollingTimer)
      this.setApplyCommand(canceled)
      this.setData({ applyBusy: false })
    } catch (error) {
      this.showError(error, '取消充值规则操作失败')
    }
  },

  setApplyCommand(command: EmployeeFinancialCommandSummary) {
    const resultText =
      command.result?.type === 'apply_activity_recharge_tiers'
        ? `当前生效 ${
            command.result.rechargeGiftTiers.filter((tier) => tier.active)
              .length
          } 个充值赠送档位`
        : ''
    this.setData({
      activeApplyCommand: command,
      applyStatusText: applyCommandStatusText(command),
      applyResultText: resultText
    })
  },

  pollApplyCommand(commandId: string) {
    if (applyPollingTimer) clearTimeout(applyPollingTimer)
    applyPollingTimer = setTimeout(async () => {
      try {
        const command =
          await getMiniappClient().getEmployeeFinancialCommand(commandId)
        this.setApplyCommand(command)
        if (command.status === 'pending' || command.status === 'claimed') {
          this.pollApplyCommand(commandId)
          return
        }
        this.setData({ applyBusy: false })
        if (command.status === 'completed') {
          this.setData({ applyReason: '' })
          wx.showModal({
            title: '充值规则已生效',
            content: this.data.applyResultText,
            showCancel: false
          })
        }
      } catch (error) {
        this.setData({ applyBusy: false })
        this.showError(error, '充值规则状态查询失败')
      }
    }, 2_000)
  },

  changeReportFrom(event: { detail: { value: string } }) {
    this.setData({ reportFromDate: event.detail.value })
  },

  changeReportTo(event: { detail: { value: string } }) {
    this.setData({ reportToDate: event.detail.value })
  },

  async loadReport() {
    try {
      const report = await getMiniappClient().getEmployeeBusinessReport({
        fromDate: this.data.reportFromDate,
        toDate: this.data.reportToDate
      })
      this.setData({ report: reportView(report) })
    } catch (error) {
      this.showError(error, '经营摘要加载失败')
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
