import type {
  CashierCommandSummary,
  CatalogItemSummary,
  CreateOrderLineRequest,
  EmployeeFinancialCommandSummary,
  EmployeeMobileMemberSummary,
  MiniappIdentity,
  OrderPaymentMethod,
  OrderPricingTier
} from '@zyapp/contracts'
import { getMiniappClient } from '../../services/client'

type StaffMemberView = EmployeeMobileMemberSummary & {
  balanceText: string
  principalText: string
  giftText: string
  birthdayText: string
  monthlyCardText: string
  monthlyCardPriceText: string
  monthlyCardExpiresText: string
  ageGateText: string
}

type CatalogView = CatalogItemSummary & {
  regularPriceText: string
  advancedPriceText: string
  itemTypeText: string
}

type CartLine = {
  key: string
  source: 'catalog' | 'custom'
  catalogItemId: string | null
  customName: string | null
  customUnitPriceFen: number | null
  name: string
  itemType: CatalogItemSummary['itemType']
  quantity: number
  pricingTier: OrderPricingTier
  personalAdmissionBenefit: boolean
  unitPriceFen: number
  unitPriceText: string
  lineTotalText: string
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null
let financialPollingTimer: ReturnType<typeof setTimeout> | null = null

function isEmployee(identity: MiniappIdentity): boolean {
  return identity.role === 'staff' || identity.role === 'manager'
}

function money(fen: number): string {
  return (fen / 100).toFixed(2)
}

function dateText(value: string | null): string {
  if (!value) return '无'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`
}

function memberView(member: EmployeeMobileMemberSummary): StaffMemberView {
  const monthlyCardText =
    member.monthlyCardStatus === 'active'
      ? '使用中'
      : member.monthlyCardStatus === 'paused'
        ? '已暂停'
        : '无月卡'
  const ageGateText =
    member.ageGate === 'confirmed_at_least_14'
      ? '已确认满 14 周岁'
      : member.ageGate === 'under_14_verified'
        ? '监护人已核验'
        : '禁止储值'
  return {
    ...member,
    balanceText: money(member.totalBalanceFen),
    principalText: money(member.principalBalanceFen),
    giftText: money(member.giftBalanceFen),
    birthdayText:
      member.birthdayMonth === null || member.birthdayDay === null
        ? '未填写'
        : `${member.birthdayMonth} 月 ${member.birthdayDay} 日`,
    monthlyCardText,
    monthlyCardPriceText:
      member.monthlyCardPriceFen === null
        ? '200.00'
        : money(member.monthlyCardPriceFen),
    monthlyCardExpiresText: dateText(member.monthlyCardExpiresAt),
    ageGateText
  }
}

function catalogView(item: CatalogItemSummary): CatalogView {
  const labels: Record<CatalogItemSummary['itemType'], string> = {
    admission: '入场',
    product: '商品',
    service: '服务',
    activity: '活动'
  }
  return {
    ...item,
    regularPriceText: money(item.regularPriceFen),
    advancedPriceText: money(item.advancedPriceFen),
    itemTypeText: labels[item.itemType]
  }
}

function commandStatusText(command: CashierCommandSummary | null): string {
  if (!command) return ''
  const labels: Record<CashierCommandSummary['status'], string> = {
    pending: '等待门店 PC 接单',
    claimed: '门店 PC 正在处理',
    completed: '收款完成',
    failed: `收款失败：${command.errorMessage ?? '未知原因'}`,
    expired: '等待超时，请重新提交',
    canceled: '已取消'
  }
  return labels[command.status]
}

function financialCommandStatusText(
  command: EmployeeFinancialCommandSummary | null
): string {
  if (!command) return ''
  const labels: Record<EmployeeFinancialCommandSummary['status'], string> = {
    pending: '等待门店 PC 接单',
    claimed: '门店 PC 正在处理',
    completed: '财务操作完成',
    failed: `财务操作失败：${command.errorMessage ?? '未知原因'}`,
    expired: '等待超时，请重新提交',
    canceled: '已取消'
  }
  return labels[command.status]
}

function linePrice(
  line: CartLine,
  selectedMember: StaffMemberView | null,
  catalog: CatalogView[]
): CartLine {
  if (line.source === 'custom') {
    const unitPriceFen = line.customUnitPriceFen ?? 0
    return {
      ...line,
      pricingTier: 'regular',
      unitPriceFen,
      unitPriceText: money(unitPriceFen),
      lineTotalText: money(unitPriceFen * line.quantity)
    }
  }
  const item = catalog.find((candidate) => candidate.id === line.catalogItemId)
  const pricingTier: OrderPricingTier =
    selectedMember?.tier === 'advanced' ? 'advanced' : 'regular'
  const unitPriceFen =
    pricingTier === 'advanced'
      ? item?.advancedPriceFen ?? 0
      : item?.regularPriceFen ?? 0
  return {
    ...line,
    pricingTier,
    unitPriceFen,
    unitPriceText: money(unitPriceFen),
    lineTotalText: money(unitPriceFen * line.quantity)
  }
}

Page({
  data: {
    identity: { role: 'guest' } as MiniappIdentity,
    busy: false,
    memberBusy: false,
    cashierBusy: false,
    financialBusy: false,
    members: [] as StaffMemberView[],
    selectedMember: null as StaffMemberView | null,
    catalog: [] as CatalogView[],
    cart: [] as CartLine[],
    cartTotalText: '0.00',
    paymentMethod: 'stored_value' as OrderPaymentMethod,
    activeCommand: null as CashierCommandSummary | null,
    commandStatusText: '',
    commandTotalText: '0.00',
    activeFinancialCommand: null as EmployeeFinancialCommandSummary | null,
    financialCommandStatusText: '',
    financialCommandResultText: '',
    monthlyReason: ''
  },

  async onShow() {
    const identity = await getMiniappClient().getIdentity()
    this.setData({ identity })
    if (!isEmployee(identity)) {
      wx.redirectTo({ url: '/pages/home/index' })
      return
    }
    await Promise.all([this.loadMembers(''), this.loadCashierCatalog()])
  },

  onUnload() {
    if (pollingTimer) clearTimeout(pollingTimer)
    pollingTimer = null
    if (financialPollingTimer) clearTimeout(financialPollingTimer)
    financialPollingTimer = null
  },

  async login(event: {
    detail: { value: { username?: string; password?: string } }
  }) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const identity = await getMiniappClient().enterStaffMode(
        event.detail.value.username ?? '',
        event.detail.value.password ?? ''
      )
      this.setData({ identity })
      await Promise.all([this.loadMembers(''), this.loadCashierCatalog()])
      wx.showToast({ title: '已进入工作台', icon: 'success' })
    } catch (error) {
      this.showError(error, '登录失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  async loadMembers(query: string) {
    if (this.data.memberBusy) return
    this.setData({ memberBusy: true })
    try {
      const members = (
        await getMiniappClient().searchEmployeeMembers(query)
      ).map(memberView)
      const selectedMember =
        members.find(
          (member) => member.memberId === this.data.selectedMember?.memberId
        ) ??
        members[0] ??
        null
      this.setData({
        members,
        selectedMember
      })
      this.repriceCart(selectedMember)
    } catch (error) {
      this.showError(error, '会员查询失败')
    } finally {
      this.setData({ memberBusy: false })
    }
  },

  async loadCashierCatalog() {
    try {
      const catalog = (
        await getMiniappClient().listEmployeeCashierCatalog()
      ).map(catalogView)
      this.setData({ catalog })
      this.repriceCart(this.data.selectedMember, catalog)
    } catch (error) {
      this.showError(error, '收费目录加载失败')
    }
  },

  async searchMembers(event: {
    detail: { value: { query?: string } }
  }) {
    await this.loadMembers(event.detail.value.query ?? '')
  },

  async selectMember(event: {
    currentTarget: { dataset: { memberId?: string } }
  }) {
    const memberId = event.currentTarget.dataset.memberId
    if (!memberId || this.data.memberBusy) return
    this.setData({ memberBusy: true })
    try {
      const selectedMember = memberView(
        await getMiniappClient().getEmployeeMember(memberId)
      )
      this.setData({ selectedMember })
      this.repriceCart(selectedMember)
    } catch (error) {
      this.showError(error, '会员读取失败')
    } finally {
      this.setData({ memberBusy: false })
    }
  },

  selectGuest() {
    this.setData({
      selectedMember: null,
      paymentMethod: 'cash'
    })
    this.repriceCart(null)
  },

  addCatalogItem(event: {
    currentTarget: { dataset: { itemId?: string } }
  }) {
    const item = this.data.catalog.find(
      (candidate) => candidate.id === event.currentTarget.dataset.itemId
    )
    if (!item) return
    const existing = this.data.cart.find(
      (line) => line.source === 'catalog' && line.catalogItemId === item.id
    )
    const cart = existing
      ? this.data.cart.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: line.quantity + 1 }
            : line
        )
      : [
          ...this.data.cart,
          linePrice(
            {
              key: `catalog-${item.id}`,
              source: 'catalog',
              catalogItemId: item.id,
              customName: null,
              customUnitPriceFen: null,
              name: item.name,
              itemType: item.itemType,
              quantity: 1,
              pricingTier: 'regular',
              personalAdmissionBenefit: false,
              unitPriceFen: 0,
              unitPriceText: '0.00',
              lineTotalText: '0.00'
            },
            this.data.selectedMember,
            this.data.catalog
          )
        ]
    this.setCart(cart)
  },

  addCustomItem(event: {
    detail: { value: { customName?: string; customAmount?: string } }
  }) {
    const name = event.detail.value.customName?.trim() ?? ''
    const amountYuan = Number(event.detail.value.customAmount)
    const amountFen = Math.round(amountYuan * 100)
    if (
      name.length < 1 ||
      name.length > 60 ||
      !Number.isFinite(amountYuan) ||
      amountYuan <= 0 ||
      !Number.isSafeInteger(amountFen)
    ) {
      wx.showToast({ title: '请填写名称和正确金额', icon: 'none' })
      return
    }
    const key = `custom-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
    this.setCart([
      ...this.data.cart,
      linePrice(
        {
          key,
          source: 'custom',
          catalogItemId: null,
          customName: name,
          customUnitPriceFen: amountFen,
          name,
          itemType: 'service',
          quantity: 1,
          pricingTier: 'regular',
          personalAdmissionBenefit: false,
          unitPriceFen: amountFen,
          unitPriceText: money(amountFen),
          lineTotalText: money(amountFen)
        },
        this.data.selectedMember,
        this.data.catalog
      )
    ])
  },

  changeQuantity(event: {
    currentTarget: { dataset: { key?: string; delta?: string } }
  }) {
    const key = event.currentTarget.dataset.key
    const delta = Number(event.currentTarget.dataset.delta)
    if (!key || !Number.isInteger(delta)) return
    const cart = this.data.cart
      .map((line) =>
        line.key === key
          ? { ...line, quantity: line.quantity + delta }
          : line
      )
      .filter((line) => line.quantity > 0)
    this.setCart(cart)
  },

  toggleAdmissionBenefit(event: {
    currentTarget: { dataset: { key?: string } }
  }) {
    const key = event.currentTarget.dataset.key
    if (!key) return
    if (!this.data.selectedMember) {
      wx.showToast({ title: '请先选择会员', icon: 'none' })
      return
    }
    this.setCart(
      this.data.cart.map((line) => ({
        ...line,
        personalAdmissionBenefit:
          line.key === key
            ? !line.personalAdmissionBenefit
            : false
      }))
    )
  },

  setPaymentMethod(event: {
    currentTarget: { dataset: { method?: OrderPaymentMethod } }
  }) {
    const method = event.currentTarget.dataset.method
    if (method !== 'cash' && method !== 'stored_value') return
    if (method === 'stored_value' && !this.data.selectedMember) {
      wx.showToast({ title: '储值支付必须选择会员', icon: 'none' })
      return
    }
    this.setData({ paymentMethod: method })
  },

  async submitCashier(event: {
    detail: { value: { orderNote?: string } }
  }) {
    if (this.data.cashierBusy || this.data.cart.length === 0) return
    if (this.data.paymentMethod === 'stored_value' && !this.data.selectedMember) {
      wx.showToast({ title: '储值支付必须选择会员', icon: 'none' })
      return
    }
    this.setData({ cashierBusy: true })
    try {
      const lines: CreateOrderLineRequest[] = this.data.cart.map((line) =>
        line.source === 'custom'
          ? {
              customName: line.customName ?? line.name,
              customUnitPriceFen: line.customUnitPriceFen ?? 0,
              quantity: line.quantity,
              pricingTier: 'regular'
            }
          : {
              catalogItemId: line.catalogItemId ?? '',
              quantity: line.quantity,
              pricingTier: line.pricingTier,
              ...(line.personalAdmissionBenefit
                ? { personalAdmissionBenefit: true }
                : {})
            }
      )
      const command = await getMiniappClient().createEmployeeCashierCommand({
        requestId:
          `mobile-cashier-${Date.now()}-` +
          Math.random().toString(36).slice(2, 10),
        ...(this.data.selectedMember
          ? { customerMemberId: this.data.selectedMember.memberId }
          : {}),
        paymentMethod: this.data.paymentMethod,
        ...(this.data.paymentMethod === 'stored_value' &&
        this.data.selectedMember
          ? { walletMemberId: this.data.selectedMember.memberId }
          : {}),
        lines,
        note: event.detail.value.orderNote?.trim() ?? ''
      })
      this.setCommand(command)
      this.pollCommand(command.commandId)
    } catch (error) {
      this.showError(error, '提交收银失败')
      this.setData({ cashierBusy: false })
    }
  },

  async cancelCashier() {
    const command = this.data.activeCommand
    if (!command || command.status !== 'pending') return
    try {
      this.setCommand(
        await getMiniappClient().cancelEmployeeCashierCommand(
          command.commandId
        )
      )
      this.setData({ cashierBusy: false })
      if (pollingTimer) clearTimeout(pollingTimer)
      pollingTimer = null
    } catch (error) {
      this.showError(error, '取消失败')
    }
  },

  async submitCashRecharge(event: {
    detail: { value: { rechargeAmount?: string; rechargeReason?: string } }
  }) {
    const selectedMember = this.data.selectedMember
    if (!selectedMember || this.data.financialBusy) return
    const amountYuan = Number(event.detail.value.rechargeAmount)
    const principalFen = Math.round(amountYuan * 100)
    if (
      !Number.isFinite(amountYuan) ||
      amountYuan <= 0 ||
      !Number.isSafeInteger(principalFen)
    ) {
      wx.showToast({ title: '请输入正确的充值金额', icon: 'none' })
      return
    }
    this.setData({ financialBusy: true })
    try {
      const command =
        await getMiniappClient().createEmployeeFinancialCommand({
          requestId:
            `mobile-recharge-${Date.now()}-` +
            Math.random().toString(36).slice(2, 10),
          type: 'cash_recharge',
          memberId: selectedMember.memberId,
          principalFen,
          ...(event.detail.value.rechargeReason?.trim()
            ? { reason: event.detail.value.rechargeReason.trim() }
            : {})
        })
      this.setFinancialCommand(command)
      this.pollFinancialCommand(command.commandId)
    } catch (error) {
      this.setData({ financialBusy: false })
      this.showError(error, '提交现金充值失败')
    }
  },

  updateMonthlyReason(event: { detail: { value?: string } }) {
    this.setData({ monthlyReason: event.detail.value ?? '' })
  },

  async submitMonthlyCardAction(event: {
    currentTarget: {
      dataset: {
        action?: 'purchase' | 'pause' | 'resume'
      }
    }
  }) {
    const selectedMember = this.data.selectedMember
    const action = event.currentTarget.dataset.action
    if (!selectedMember || !action || this.data.financialBusy) return
    const reason = this.data.monthlyReason.trim()
    if (action !== 'purchase' && (reason.length < 2 || reason.length > 200)) {
      wx.showToast({ title: '暂停或恢复请填写 2-200 字原因', icon: 'none' })
      return
    }
    if (action !== 'purchase' && !selectedMember.monthlyCardId) {
      wx.showToast({ title: '当前会员没有可操作的月卡', icon: 'none' })
      return
    }
    this.setData({ financialBusy: true })
    try {
      const requestId =
        `mobile-monthly-${action}-${Date.now()}-` +
        Math.random().toString(36).slice(2, 10)
      const command =
        action === 'purchase'
          ? await getMiniappClient().createEmployeeFinancialCommand({
              requestId,
              type: 'monthly_card_purchase',
              memberId: selectedMember.memberId,
              ...(reason ? { reason } : {})
            })
          : await getMiniappClient().createEmployeeFinancialCommand({
              requestId,
              type:
                action === 'pause'
                  ? 'monthly_card_pause'
                  : 'monthly_card_resume',
              cardId: selectedMember.monthlyCardId ?? '',
              reason
            })
      this.setFinancialCommand(command)
      this.pollFinancialCommand(command.commandId)
    } catch (error) {
      this.setData({ financialBusy: false })
      this.showError(error, '提交月卡操作失败')
    }
  },

  async cancelFinancialCommand() {
    const command = this.data.activeFinancialCommand
    if (!command || command.status !== 'pending') return
    try {
      this.setFinancialCommand(
        await getMiniappClient().cancelEmployeeFinancialCommand(
          command.commandId
        )
      )
      this.setData({ financialBusy: false })
      if (financialPollingTimer) clearTimeout(financialPollingTimer)
      financialPollingTimer = null
    } catch (error) {
      this.showError(error, '取消财务操作失败')
    }
  },

  async createMember(event: {
    detail: {
      value: { phone?: string; nickname?: string; note?: string }
    }
  }) {
    if (this.data.memberBusy) return
    this.setData({ memberBusy: true })
    try {
      const created = memberView(
        await getMiniappClient().createEmployeeMember({
          requestId:
            `employee-member-${Date.now()}-` +
            Math.random().toString(36).slice(2, 10),
          phone: event.detail.value.phone ?? '',
          nickname: event.detail.value.nickname ?? '',
          note: event.detail.value.note ?? ''
        })
      )
      this.setData({
        members: [created, ...this.data.members],
        selectedMember: created,
        paymentMethod: 'stored_value'
      })
      this.repriceCart(created)
      wx.showToast({ title: '会员已新增', icon: 'success' })
    } catch (error) {
      this.showError(error, '新增会员失败')
    } finally {
      this.setData({ memberBusy: false })
    }
  },

  async logout() {
    if (pollingTimer) clearTimeout(pollingTimer)
    pollingTimer = null
    if (financialPollingTimer) clearTimeout(financialPollingTimer)
    financialPollingTimer = null
    await getMiniappClient().leaveStaffMode()
    this.setData({
      identity: await getMiniappClient().getIdentity(),
      members: [],
      selectedMember: null,
      catalog: [],
      cart: [],
      activeCommand: null,
      cashierBusy: false,
      activeFinancialCommand: null,
      financialBusy: false,
      monthlyReason: ''
    })
  },

  openManager() {
    wx.navigateTo({ url: '/pages/manager/index' })
  },

  openContent() {
    wx.navigateTo({ url: '/pages/content/index' })
  },

  repriceCart(
    selectedMember: StaffMemberView | null,
    catalog?: CatalogView[]
  ) {
    const currentCatalog = catalog ?? this.data.catalog
    this.setCart(
      this.data.cart.map((line) =>
        linePrice(line, selectedMember, currentCatalog)
      )
    )
  },

  setCart(cart: CartLine[]) {
    const totalFen = cart.reduce(
      (sum, line) => sum + line.unitPriceFen * line.quantity,
      0
    )
    this.setData({
      cart,
      cartTotalText: money(totalFen)
    })
  },

  setCommand(command: CashierCommandSummary) {
    this.setData({
      activeCommand: command,
      commandStatusText: commandStatusText(command),
      commandTotalText: money(command.result?.totalFen ?? 0)
    })
  },

  setFinancialCommand(command: EmployeeFinancialCommandSummary) {
    let resultText = ''
    if (command.result?.type === 'cash_recharge') {
      resultText = `本金增加 ¥${money(
        command.result.wallet.principalDeltaFen
      )}，赠送 ¥${money(command.result.wallet.giftDeltaFen)}`
    } else if (
      command.result?.type === 'apply_activity_recharge_tiers'
    ) {
      resultText = `已应用 ${command.result.rechargeGiftTiers.filter(
        (tier) => tier.active
      ).length} 个充值赠送档位`
    } else if (command.result) {
      const status =
        command.result.monthlyCard.status === 'paused'
          ? '已暂停'
          : '使用中'
      resultText = `${command.result.monthlyCard.planName} · ${status} · 到期 ${dateText(
        command.result.monthlyCard.expiresAt
      )}`
    }
    this.setData({
      activeFinancialCommand: command,
      financialCommandStatusText: financialCommandStatusText(command),
      financialCommandResultText: resultText
    })
  },

  pollCommand(commandId: string) {
    if (pollingTimer) clearTimeout(pollingTimer)
    pollingTimer = setTimeout(async () => {
      try {
        const command =
          await getMiniappClient().getEmployeeCashierCommand(commandId)
        this.setCommand(command)
        if (command.status === 'pending' || command.status === 'claimed') {
          this.pollCommand(commandId)
          return
        }
        this.setData({ cashierBusy: false })
        if (command.status === 'completed') {
          this.setCart([])
          await this.loadMembers('')
          wx.showModal({
            title: '收款完成',
            content: `${command.result?.orderNumber ?? ''}  ¥${money(
              command.result?.totalFen ?? 0
            )}`,
            showCancel: false
          })
        }
      } catch (error) {
        this.setData({ cashierBusy: false })
        this.showError(error, '收银状态查询失败')
      }
    }, 2_000)
  },

  pollFinancialCommand(commandId: string) {
    if (financialPollingTimer) clearTimeout(financialPollingTimer)
    financialPollingTimer = setTimeout(async () => {
      try {
        const command =
          await getMiniappClient().getEmployeeFinancialCommand(commandId)
        this.setFinancialCommand(command)
        if (command.status === 'pending' || command.status === 'claimed') {
          this.pollFinancialCommand(commandId)
          return
        }
        this.setData({ financialBusy: false })
        if (command.status === 'completed') {
          await this.loadMembers('')
          this.setData({ monthlyReason: '' })
          wx.showModal({
            title: '财务操作完成',
            content: this.data.financialCommandResultText,
            showCancel: false
          })
        }
      } catch (error) {
        this.setData({ financialBusy: false })
        this.showError(error, '财务操作状态查询失败')
      }
    }, 2_000)
  },

  showError(error: unknown, fallback: string) {
    wx.showToast({
      title: error instanceof Error ? error.message : fallback,
      icon: 'none',
      duration: 4_000
    })
  }
})
