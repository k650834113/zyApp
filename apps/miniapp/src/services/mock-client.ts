import type {
  ActivitySummary,
  AnnouncementSummary,
  BoardGameSummary,
  BusinessReport,
  BusinessReportRequest,
  CashierCommandSummary,
  CatalogItemSummary,
  EmployeeFinancialCommandSummary,
  EmployeeMobileCreateCashierCommandRequest,
  EmployeeMobileCreateFinancialCommandRequest,
  EmployeeMobileCreateMemberRequest,
  EmployeeMobileCreateActivityRequest,
  EmployeeMobileCreateAnnouncementRequest,
  EmployeeMobileSetActivityStatusRequest,
  EmployeeMobileSetAnnouncementStatusRequest,
  EmployeeMobileUpdateActivityRequest,
  EmployeeMobileUpdateAnnouncementRequest,
  EmployeeMobileUpdateBoardGameOperationsRequest,
  EmployeeMobileUpdateStoreStatusRequest,
  EmployeeMobileMemberSummary,
  MemberSelfServiceSummary,
  MemberSelfServiceHistory,
  MemberRechargeConfiguration,
  MemberRechargeOrderSummary,
  CreateMemberRechargeOrderRequest,
  MiniappHomeSnapshot,
  MiniappIdentity,
  PhoneVerificationChallenge,
  PublicActivitySummary,
  PublicBoardGameSummary,
  StoreProfileSummary
} from '@zyapp/contracts'
import type {
  MemberRegistrationInput,
  WechatOneTapLoginInput,
  MiniappClient
} from './types'

const activities: PublicActivitySummary[] = [
  {
    id: 'activity-summer',
    title: '暑期充值赠送',
    summary: '活动期间按当前档位充值可获得赠送余额。',
    content: '赠送余额可与本金一起消费，消费时优先扣除赠送余额。',
    activityType: 'recharge',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: '2030-08-31T15:59:59.000Z',
    pinned: true,
    regularPriceFen: null,
    advancedPriceFen: null,
    allowStoredValue: false,
    allowWechat: true,
    rechargeTiers: [
      { principalFen: 30_000, giftFen: 2_000 },
      { principalFen: 50_000, giftFen: 5_000 },
      { principalFen: 100_000, giftFen: 20_000 }
    ]
  }
]

let managerActivities: ActivitySummary[] = activities.map((activity) => ({
  ...activity,
  status: 'published',
  visibility: 'active',
  rechargeTiers: activity.rechargeTiers.map((tier, index) => ({
    id: `mock-tier-${index + 1}`,
    ...tier
  })),
  createdAt: activity.startsAt,
  updatedAt: activity.startsAt
}))
let activeRechargeGiftTiers =
  managerActivities
    .find((activity) => activity.activityType === 'recharge')
    ?.rechargeTiers.map((tier) => ({ ...tier, active: true })) ?? []

const games: PublicBoardGameSummary[] = [
  {
    id: 'game-cascadia',
    name: '卡斯卡迪亚',
    introduction: '轻中度拼图与生态组合游戏，规则直观。',
    categories: ['家庭', '拼图', '策略'],
    minPlayers: 1,
    maxPlayers: 4,
    minMinutes: 30,
    maxMinutes: 45,
    difficulty: 'light',
    soldOut: false,
    imageUrl: null,
    customerNote: '适合第一次接触现代桌游的顾客。'
  },
  {
    id: 'game-brass',
    name: '工业革命：伯明翰',
    introduction: '围绕工业网络、市场和资源展开的重度策略游戏。',
    categories: ['重策', '经济'],
    minPlayers: 2,
    maxPlayers: 4,
    minMinutes: 90,
    maxMinutes: 150,
    difficulty: 'heavy',
    soldOut: true,
    imageUrl: null,
    customerNote: null
  }
]

let managerAnnouncements: AnnouncementSummary[] = [
  {
    id: 'announcement-1',
    title: '到店前可先查看桌游库存状态',
    content: '小程序当前为本地体验数据，正式接入云端后由店长发布。',
    status: 'published',
    visibility: 'active',
    pinned: true,
    visibleFrom: '2026-06-01T00:00:00.000Z',
    visibleUntil: null,
    publishedAt: '2026-06-14T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z'
  }
]

let employeeBoardGames: BoardGameSummary[] = games.map((game, index) => ({
  id: game.id,
  name: game.name,
  introduction: game.introduction,
  categories: [...game.categories],
  minPlayers: game.minPlayers,
  maxPlayers: game.maxPlayers,
  minMinutes: game.minMinutes,
  maxMinutes: game.maxMinutes,
  difficulty: game.difficulty,
  quantity: game.soldOut ? 0 : 1,
  recordStatus: 'active',
  available: !game.soldOut,
  customerConsigned: false,
  missingPieces: false,
  private: false,
  recommended: index === 0,
  imageUrl: game.imageUrl,
  localImagePath: null,
  bggId: null,
  customerNote: game.customerNote,
  internalNote: null,
  consignorNickname: null,
  missingParts: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-14T00:00:00.000Z'
}))

let mockStoreProfile: StoreProfileSummary = {
  storeId: 'mock-store',
  name: '桌游吧示例门店',
  address: null,
  contactPhone: null,
  businessOpenMinute: 780,
  businessCloseMinute: 1380,
  statusOverride: 'automatic',
  customStatusText: null,
  updatedAt: '2026-06-14T00:00:00.000Z'
}

let identity: MiniappIdentity = { role: 'guest' }
let member: MemberSelfServiceSummary | null = null
let memberHistory: MemberSelfServiceHistory = {
  orders: [],
  walletEntries: [],
  monthlyCardEvents: []
}
const rechargeOrders = new Map<string, MemberRechargeOrderSummary>()
let phoneChallenge:
  | {
      challengeId: string
      phone: string
      code: string
      expiresAt: number
      consumed: boolean
    }
  | null = null

let employeeMembers: EmployeeMobileMemberSummary[] = [
  {
    memberId: 'mock-member-staff-1',
    memberNumber: 'M0000000001',
    phone: '13800138000',
    nickname: '示例会员',
    tier: 'advanced',
    status: 'active',
    birthdayMonth: 6,
    birthdayDay: 14,
    note: '偏好中重度策略游戏',
    ageGate: 'confirmed_at_least_14',
    principalBalanceFen: 50_000,
    giftBalanceFen: 5_000,
    totalBalanceFen: 55_000,
    monthlyCardStatus: 'active',
    monthlyCardId: '77777777-aaaa-4777-8777-777777777777',
    monthlyCardPlanName: '30 天月卡',
    monthlyCardPriceFen: 20_000,
    monthlyCardExpiresAt: '2026-07-14T15:59:59.000Z',
    updatedAt: new Date().toISOString()
  }
]

const cashierCatalog: CatalogItemSummary[] = [
  {
    id: '11111111-aaaa-4111-8111-111111111111',
    code: 'ADMISSION',
    name: '入场费',
    itemType: 'admission',
    regularPriceFen: 4_000,
    advancedPriceFen: 3_000,
    status: 'active',
    availability: 'available',
    note: null,
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z'
  },
  {
    id: '22222222-aaaa-4222-8222-222222222222',
    code: 'DRINK',
    name: '饮料',
    itemType: 'product',
    regularPriceFen: 600,
    advancedPriceFen: 600,
    status: 'active',
    availability: 'available',
    note: '前台确认交付',
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z'
  }
]
const cashierCommands = new Map<string, CashierCommandSummary>()
const financialCommands = new Map<
  string,
  EmployeeFinancialCommandSummary
>()

export function activeActivities(now = new Date()): PublicActivitySummary[] {
  const timestamp = now.getTime()
  return managerActivities
    .filter(
      (activity) =>
        activity.status === 'published' &&
        timestamp >= Date.parse(activity.startsAt) &&
        timestamp < Date.parse(activity.endsAt)
    )
    .sort((left, right) => Number(right.pinned) - Number(left.pinned))
    .map((activity) => ({
      id: activity.id,
      title: activity.title,
      summary: activity.summary,
      content: activity.content,
      activityType: activity.activityType,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      pinned: activity.pinned,
      regularPriceFen: activity.regularPriceFen,
      advancedPriceFen: activity.advancedPriceFen,
      allowStoredValue: activity.allowStoredValue,
      allowWechat: activity.allowWechat,
      rechargeTiers: activity.rechargeTiers.map((tier) => ({
        principalFen: tier.principalFen,
        giftFen: tier.giftFen
      }))
    }))
}

function activeAnnouncements(now = new Date()) {
  const current = now.getTime()
  return managerAnnouncements
    .filter(
      (announcement) =>
        announcement.status === 'published' &&
        current >= Date.parse(announcement.visibleFrom) &&
        (announcement.visibleUntil === null ||
          current < Date.parse(announcement.visibleUntil))
    )
    .sort((left, right) => Number(right.pinned) - Number(left.pinned))
    .map((announcement) => ({
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      pinned: announcement.pinned,
      publishedAt: announcement.publishedAt ?? announcement.updatedAt
    }))
}

function publicGames(): PublicBoardGameSummary[] {
  return employeeBoardGames
    .filter((game) => game.recordStatus === 'active' && !game.private)
    .map((game) => ({
      id: game.id,
      name: game.name,
      introduction: game.introduction,
      categories: [...game.categories],
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      minMinutes: game.minMinutes,
      maxMinutes: game.maxMinutes,
      difficulty: game.difficulty,
      soldOut: !game.available || game.quantity <= 0,
      imageUrl: game.imageUrl,
      customerNote: game.customerNote
    }))
}

function giftFor(principalFen: number): number {
  const tiers = activeRechargeGiftTiers
  const highest = tiers[tiers.length - 1]
  if (!highest) return 0
  let remainder = principalFen
  let giftFen = 0
  if (remainder >= highest.principalFen) {
    const count = Math.floor(remainder / highest.principalFen)
    giftFen += count * highest.giftFen
    remainder -= count * highest.principalFen
  }
  const remainderTier = [...tiers]
    .reverse()
    .find((tier) => tier.principalFen <= remainder)
  return giftFen + (remainderTier?.giftFen ?? 0)
}

function demoMemberHistory(): MemberSelfServiceHistory {
  return {
    orders: [
      {
        orderId: 'mock-order-20260704',
        orderNumber: 'JD-260704-001',
        totalFen: 8_600,
        paymentMethod: 'stored_value',
        completedAt: '2026-07-04T13:18:00.000Z'
      },
      {
        orderId: 'mock-order-20260629',
        orderNumber: 'JD-260629-004',
        totalFen: 3_800,
        paymentMethod: 'stored_value',
        completedAt: '2026-06-29T14:03:00.000Z'
      }
    ],
    walletEntries: [
      {
        operationId: 'mock-wallet-recharge-20260702',
        eventType: 'wallet.wechat_recharged',
        principalDeltaFen: 30_000,
        giftDeltaFen: 2_000,
        reason: '充值到账',
        occurredAt: '2026-07-02T11:42:00.000Z'
      }
    ],
    monthlyCardEvents: [
      {
        operationId: 'mock-monthly-card-20260701',
        cardId: 'mock-monthly-card-active',
        eventType: 'monthly_card.purchased',
        reason: '月卡开通',
        occurredAt: '2026-07-01T04:00:00.000Z'
      }
    ]
  }
}

export class MockMiniappClient implements MiniappClient {
  async getIdentity(): Promise<MiniappIdentity> {
    return identity
  }

  async getHome(): Promise<MiniappHomeSnapshot> {
    const forcedClosed = mockStoreProfile.statusOverride === 'closed'
    const forcedOpen = mockStoreProfile.statusOverride === 'open'
    const isOpen = forcedOpen || !forcedClosed
    return {
      store: {
        id: mockStoreProfile.storeId,
        name: mockStoreProfile.name,
        address: mockStoreProfile.address,
        contactPhone: mockStoreProfile.contactPhone,
        businessHours: '13:00-23:00',
        isOpen,
        statusText:
          mockStoreProfile.customStatusText ??
          (isOpen ? '今日营业中' : '当前休息中')
      },
      announcements: activeAnnouncements(),
      activities: activeActivities(),
      recommendedGames: publicGames().filter((game) =>
        employeeBoardGames.find(
          (candidate) => candidate.id === game.id
        )?.recommended
      )
    }
  }

  async listActivities(): Promise<PublicActivitySummary[]> {
    return activeActivities()
  }

  async listGames(query = ''): Promise<PublicBoardGameSummary[]> {
    const normalized = query.trim().toLowerCase()
    const currentGames = publicGames()
    if (!normalized) return currentGames
    return currentGames.filter(
      (game) =>
        game.name.toLowerCase().includes(normalized) ||
        game.categories.some((category) =>
          category.toLowerCase().includes(normalized)
        )
    )
  }

  async getMemberSummary(): Promise<MemberSelfServiceSummary | null> {
    return member
  }

  async getMemberHistory(): Promise<MemberSelfServiceHistory> {
    if (!member) throw new Error('请先注册会员')
    return memberHistory
  }

  async getRechargeConfiguration(): Promise<MemberRechargeConfiguration> {
    return { providerMode: 'mock', testAmountFen: null }
  }

  async requestPhoneVerification(
    phone: string
  ): Promise<PhoneVerificationChallenge> {
    if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的手机号')
    phoneChallenge = {
      challengeId: `mock-challenge-${Date.now()}`,
      phone,
      code: '123456',
      expiresAt: Date.now() + 10 * 60 * 1_000,
      consumed: false
    }
    return {
      challengeId: phoneChallenge.challengeId,
      expiresAt: new Date(phoneChallenge.expiresAt).toISOString(),
      resendAfterSeconds: 60,
      mockCode: phoneChallenge.code
    }
  }

  async registerMember(
    input: MemberRegistrationInput
  ): Promise<MemberSelfServiceSummary> {
    if (!/^1\d{10}$/.test(input.phone)) throw new Error('请输入正确的手机号')
    if (input.nickname.trim().length < 1) throw new Error('请填写昵称')
    if (
      !phoneChallenge ||
      phoneChallenge.challengeId !== input.challengeId ||
      phoneChallenge.phone !== input.phone ||
      phoneChallenge.expiresAt <= Date.now() ||
      phoneChallenge.consumed
    ) {
      throw new Error('请先获取有效的手机验证码')
    }
    if (input.verificationCode !== phoneChallenge.code) {
      throw new Error('验证码不正确')
    }
    phoneChallenge.consumed = true
    member = {
      memberId: 'mock-member',
      nickname: input.nickname.trim(),
      avatarUrl: null,
      phoneMasked: `${input.phone.slice(0, 3)}****${input.phone.slice(-4)}`,
      tier: 'ordinary',
      principalBalanceFen: 0,
      giftBalanceFen: 0,
      monthlyCardStatus: 'none',
      monthlyCardExpiresAt: null,
      birthdayMonth: null,
      birthdayDay: null,
      birthdayCanBeFilled: true,
      ageGate: input.confirmedAtLeast14
        ? 'confirmed_at_least_14'
        : 'recharge_disabled'
    }
    memberHistory = {
      orders: [],
      walletEntries: [],
      monthlyCardEvents: []
    }
    identity = {
      role: 'member',
      memberId: member.memberId,
      nickname: member.nickname,
      phoneMasked: member.phoneMasked,
      tier: member.tier
    }
    return member
  }

  async loginWithWechatProfile(
    input: WechatOneTapLoginInput
  ): Promise<MemberSelfServiceSummary> {
    if (!input.phoneCode.startsWith('mock-phone:')) {
      throw new Error('Mock 模式需要使用测试手机号授权')
    }
    const phone = input.phoneCode.slice('mock-phone:'.length)
    if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的手机号')
    const nickname = input.nickname?.trim() || '微信用户'
    if (member && member.phoneMasked !== `${phone.slice(0, 3)}****${phone.slice(-4)}`) {
      throw new Error('当前微信账号已经绑定其他会员')
    }
    if (!member) {
      const canRecharge = input.confirmedAtLeast14
      member = {
        memberId: 'mock-member',
        nickname,
        avatarUrl: input.avatarUrl ?? null,
        phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
        tier: canRecharge ? 'advanced' : 'ordinary',
        principalBalanceFen: canRecharge ? 30_000 : 0,
        giftBalanceFen: canRecharge ? 6_850 : 0,
        monthlyCardStatus: canRecharge ? 'active' : 'none',
        monthlyCardExpiresAt: canRecharge
          ? '2026-08-06T15:59:59.000Z'
          : null,
        birthdayMonth: canRecharge ? 7 : null,
        birthdayDay: canRecharge ? 7 : null,
        birthdayCanBeFilled: !canRecharge,
        ageGate: canRecharge
          ? 'confirmed_at_least_14'
          : 'recharge_disabled'
      }
      memberHistory = canRecharge
        ? demoMemberHistory()
        : { orders: [], walletEntries: [], monthlyCardEvents: [] }
    }
    identity = {
      role: 'member',
      memberId: member.memberId,
      nickname: member.nickname,
      phoneMasked: member.phoneMasked,
      tier: member.tier
    }
    return member
  }

  async fillBirthday(
    month: number,
    day: number
  ): Promise<MemberSelfServiceSummary> {
    if (!member) throw new Error('请先注册会员')
    if (!member.birthdayCanBeFilled) throw new Error('生日已经填写，不能再次修改')
    const date = new Date(Date.UTC(2000, month - 1, day))
    if (
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error('请输入正确的生日月日')
    }
    member = {
      ...member,
      birthdayMonth: month,
      birthdayDay: day,
      birthdayCanBeFilled: false
    }
    return member
  }

  async createRechargeOrder(
    input: CreateMemberRechargeOrderRequest
  ): Promise<MemberRechargeOrderSummary> {
    if (!member) throw new Error('请先注册会员')
    if (member.ageGate === 'recharge_disabled') {
      throw new Error('当前账号未完成监护人同意与身份核验，暂不能储值')
    }
    const principalFen = input.principalFen
    if (!Number.isSafeInteger(principalFen) || principalFen <= 0) {
      throw new Error('充值金额必须大于 0')
    }
    const existing = [...rechargeOrders.values()].find(
      (order) => order.requestId === input.requestId
    )
    if (existing) {
      if (existing.principalFen !== principalFen) {
        throw new Error('同一请求号不能用于不同充值金额')
      }
      return existing
    }
    const giftFen = giftFor(principalFen)
    const now = new Date()
    const order: MemberRechargeOrderSummary = {
      orderId: `mock-recharge-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      requestId: input.requestId,
      principalFen,
      giftFen,
      totalCreditFen: principalFen + giftFen,
      status: 'pending_payment',
      providerMode: 'mock',
      clientPaymentParameters: {
        package: `prepay_id=mock-${Date.now()}`,
        signType: 'MOCK'
      },
      expiresAt: new Date(now.getTime() + 15 * 60 * 1_000).toISOString(),
      settledAt: null,
      createdAt: now.toISOString(),
      errorMessage: null
    }
    rechargeOrders.set(order.orderId, order)
    return order
  }

  async getRechargeOrder(
    orderId: string
  ): Promise<MemberRechargeOrderSummary> {
    const order = rechargeOrders.get(orderId)
    if (!order) throw new Error('充值订单不存在')
    return order
  }

  async settleMockRechargeOrder(
    orderId: string
  ): Promise<MemberRechargeOrderSummary> {
    if (!member) throw new Error('请先注册会员')
    const order = rechargeOrders.get(orderId)
    if (!order) throw new Error('充值订单不存在')
    if (order.status === 'settled') return order
    if (order.status !== 'pending_payment') {
      throw new Error('当前充值订单不能支付')
    }
    const settledAt = new Date().toISOString()
    member = {
      ...member,
      principalBalanceFen:
        member.principalBalanceFen + order.principalFen,
      giftBalanceFen: member.giftBalanceFen + order.giftFen,
      tier: order.principalFen >= 50_000 ? 'advanced' : member.tier
    }
    memberHistory = {
      ...memberHistory,
      walletEntries: [
        {
          operationId: order.orderId,
          eventType: 'wallet.wechat_recharged',
          principalDeltaFen: order.principalFen,
          giftDeltaFen: order.giftFen,
          reason: '小程序微信充值（Mock）',
          occurredAt: settledAt
        },
        ...memberHistory.walletEntries
      ]
    }
    identity = {
      role: 'member',
      memberId: member.memberId,
      nickname: member.nickname,
      phoneMasked: member.phoneMasked,
      tier: member.tier
    }
    const settled: MemberRechargeOrderSummary = {
      ...order,
      status: 'settled',
      settledAt
    }
    rechargeOrders.set(orderId, settled)
    return settled
  }

  async enterStaffMode(
    username: string,
    password: string
  ): Promise<MiniappIdentity> {
    if (username !== 'manager' || password !== 'Password123!') {
      throw new Error('体验账号或密码不正确')
    }
    identity = {
      role: 'manager',
      employeeId: 'mock-manager',
      displayName: '体验店长',
      permissions: [
        'member.profile.read',
        'member.profile.write',
        'wallet.recharge.cash',
        'monthly-card.manage',
        'order.create',
        'activity.manage',
        'report.read'
      ]
    }
    return identity
  }

  async leaveStaffMode(): Promise<void> {
    identity = member
      ? {
          role: 'member',
          memberId: member.memberId,
          nickname: member.nickname,
          phoneMasked: member.phoneMasked,
          tier: member.tier
        }
      : { role: 'guest' }
  }

  async searchEmployeeMembers(
    query = ''
  ): Promise<EmployeeMobileMemberSummary[]> {
    const normalized = query.trim().toLowerCase()
    return employeeMembers.filter(
      (candidate) =>
        normalized === '' ||
        candidate.phone.includes(normalized) ||
        candidate.memberNumber.toLowerCase().includes(normalized) ||
        candidate.nickname.toLowerCase().includes(normalized)
    )
  }

  async getEmployeeMember(
    memberId: string
  ): Promise<EmployeeMobileMemberSummary> {
    const found = employeeMembers.find(
      (candidate) => candidate.memberId === memberId
    )
    if (!found) throw new Error('会员不存在')
    return found
  }

  async createEmployeeMember(
    input: EmployeeMobileCreateMemberRequest
  ): Promise<EmployeeMobileMemberSummary> {
    if (employeeMembers.some((candidate) => candidate.phone === input.phone)) {
      throw new Error('该手机号已经登记为会员')
    }
    const created: EmployeeMobileMemberSummary = {
      memberId: `mock-employee-member-${employeeMembers.length + 1}`,
      memberNumber: `M${String(employeeMembers.length + 1).padStart(10, '0')}`,
      phone: input.phone,
      nickname: input.nickname,
      tier: 'ordinary',
      status: 'active',
      birthdayMonth: null,
      birthdayDay: null,
      note: input.note?.trim() || null,
      ageGate: 'confirmed_at_least_14',
      principalBalanceFen: 0,
      giftBalanceFen: 0,
      totalBalanceFen: 0,
      monthlyCardStatus: 'none',
      monthlyCardId: null,
      monthlyCardPlanName: null,
      monthlyCardPriceFen: null,
      monthlyCardExpiresAt: null,
      updatedAt: new Date().toISOString()
    }
    employeeMembers = [created, ...employeeMembers]
    return created
  }

  async listEmployeeCashierCatalog(): Promise<CatalogItemSummary[]> {
    return cashierCatalog
  }

  async createEmployeeCashierCommand(
    input: EmployeeMobileCreateCashierCommandRequest
  ): Promise<CashierCommandSummary> {
    if (identity.role !== 'staff' && identity.role !== 'manager') {
      throw new Error('请先进入员工模式')
    }
    if (input.lines.length < 1) throw new Error('请先添加收费项目')
    const commandId = `33333333-aaaa-4333-8333-${String(
      cashierCommands.size + 1
    ).padStart(12, '0')}`
    const created: CashierCommandSummary = {
      commandId,
      requestId: input.requestId,
      status: 'pending',
      requestedBy: identity.employeeId,
      claimedByDevice: null,
      localOrderId: null,
      result: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      completedAt: null
    }
    cashierCommands.set(commandId, created)
    setTimeout(() => {
      const current = cashierCommands.get(commandId)
      if (!current || current.status !== 'pending') return
      const totalFen = input.lines.reduce((sum, line) => {
        if ('customName' in line) {
          return sum + line.customUnitPriceFen * line.quantity
        }
        const item = cashierCatalog.find(
          (candidate) => candidate.id === line.catalogItemId
        )
        if (!item) return sum
        const unit =
          line.pricingTier === 'advanced'
            ? item.advancedPriceFen
            : item.regularPriceFen
        return sum + unit * line.quantity
      }, 0)
      const orderId = `44444444-aaaa-4444-8444-${String(
        cashierCommands.size
      ).padStart(12, '0')}`
      cashierCommands.set(commandId, {
        ...current,
        status: 'completed',
        claimedByDevice: '55555555-aaaa-4555-8555-555555555555',
        localOrderId: orderId,
        completedAt: new Date().toISOString(),
        result: {
          id: orderId,
          orderNumber: `MOCK-${Date.now()}`,
          visitBatchId: '66666666-aaaa-4666-8666-666666666666',
          customerMemberId: input.customerMemberId ?? null,
          paymentMethod: input.paymentMethod,
          walletMemberId: input.walletMemberId ?? null,
          memberNickname:
            employeeMembers.find(
              (candidate) =>
                candidate.memberId ===
                (input.walletMemberId ?? input.customerMemberId)
            )?.nickname ?? null,
          status: 'completed',
          totalFen,
          note: input.note?.trim() || null,
          completedAt: new Date().toISOString(),
          items: []
        }
      })
    }, 300)
    return created
  }

  async getEmployeeCashierCommand(
    commandId: string
  ): Promise<CashierCommandSummary> {
    const command = cashierCommands.get(commandId)
    if (!command) throw new Error('收银命令不存在')
    return command
  }

  async cancelEmployeeCashierCommand(
    commandId: string
  ): Promise<CashierCommandSummary> {
    const command = cashierCommands.get(commandId)
    if (!command) throw new Error('收银命令不存在')
    if (command.status !== 'pending') throw new Error('当前状态不能取消')
    const canceled = { ...command, status: 'canceled' as const }
    cashierCommands.set(commandId, canceled)
    return canceled
  }

  async createEmployeeFinancialCommand(
    input: EmployeeMobileCreateFinancialCommandRequest
  ): Promise<EmployeeFinancialCommandSummary> {
    if (identity.role !== 'staff' && identity.role !== 'manager') {
      throw new Error('请先进入员工模式')
    }
    const commandId = `88888888-aaaa-4888-8888-${String(
      financialCommands.size + 1
    ).padStart(12, '0')}`
    const created: EmployeeFinancialCommandSummary = {
      commandId,
      requestId: input.requestId,
      type: input.type,
      status: 'pending',
      requestedBy: identity.employeeId,
      claimedByDevice: null,
      result: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      completedAt: null
    }
    financialCommands.set(commandId, created)
    setTimeout(() => {
      const current = financialCommands.get(commandId)
      if (!current || current.status !== 'pending') return
      try {
        const completedAt = new Date().toISOString()
        if (input.type === 'cash_recharge') {
          const index = employeeMembers.findIndex(
            (candidate) => candidate.memberId === input.memberId
          )
          const existing = employeeMembers[index]
          if (!existing) throw new Error('会员不存在')
          if (existing.ageGate === 'recharge_disabled') {
            throw new Error('该会员当前禁止储值')
          }
          const giftFen = giftFor(input.principalFen)
          const updated: EmployeeMobileMemberSummary = {
            ...existing,
            tier:
              input.principalFen >= 50_000 ? 'advanced' : existing.tier,
            principalBalanceFen:
              existing.principalBalanceFen + input.principalFen,
            giftBalanceFen: existing.giftBalanceFen + giftFen,
            totalBalanceFen:
              existing.totalBalanceFen + input.principalFen + giftFen,
            updatedAt: completedAt
          }
          employeeMembers[index] = updated
          financialCommands.set(commandId, {
            ...current,
            status: 'completed',
            claimedByDevice: '55555555-aaaa-4555-8555-555555555555',
            completedAt,
            result: {
              type: 'cash_recharge',
              wallet: {
                operationId: `99999999-aaaa-4999-8999-${String(
                  financialCommands.size
                ).padStart(12, '0')}`,
                wallet: {
                  accountId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
                  memberId: existing.memberId,
                  principalBalanceFen: updated.principalBalanceFen,
                  giftBalanceFen: updated.giftBalanceFen,
                  totalBalanceFen: updated.totalBalanceFen,
                  status: 'active',
                  updatedAt: completedAt
                },
                principalDeltaFen: input.principalFen,
                giftDeltaFen: giftFen
              }
            }
          })
          return
        }
        if (input.type === 'apply_activity_recharge_tiers') {
          const activity = managerActivities.find(
            (candidate) => candidate.id === input.activityId
          )
          if (
            !activity ||
            activity.activityType !== 'recharge' ||
            activity.rechargeTiers.length === 0
          ) {
            throw new Error(
              '只有包含赠送档位的充值活动可以应用为当前规则'
            )
          }
          activeRechargeGiftTiers = activity.rechargeTiers.map((tier) => ({
            ...tier,
            active: true
          }))
          financialCommands.set(commandId, {
            ...current,
            status: 'completed',
            claimedByDevice: '55555555-aaaa-4555-8555-555555555555',
            completedAt,
            result: {
              type: 'apply_activity_recharge_tiers',
              rechargeGiftTiers: activeRechargeGiftTiers
            }
          })
          return
        }

        const index = employeeMembers.findIndex((candidate) =>
          input.type === 'monthly_card_purchase'
            ? candidate.memberId === input.memberId
            : candidate.monthlyCardId === input.cardId
        )
        const existing = employeeMembers[index]
        if (!existing) throw new Error('会员或月卡不存在')
        const startsAt = completedAt
        const currentExpiry = existing.monthlyCardExpiresAt
        const expiresAt =
          input.type === 'monthly_card_purchase' || !currentExpiry
            ? new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1_000
              ).toISOString()
            : currentExpiry
        const status =
          input.type === 'monthly_card_pause' ? 'paused' : 'active'
        const cardId =
          existing.monthlyCardId ??
          `bbbbbbbb-aaaa-4bbb-8bbb-${String(index + 1).padStart(12, '0')}`
        const updated: EmployeeMobileMemberSummary = {
          ...existing,
          monthlyCardStatus: status,
          monthlyCardId: cardId,
          monthlyCardPlanName: existing.monthlyCardPlanName ?? '30 天月卡',
          monthlyCardPriceFen: existing.monthlyCardPriceFen ?? 20_000,
          monthlyCardExpiresAt: expiresAt,
          updatedAt: completedAt
        }
        employeeMembers[index] = updated
        financialCommands.set(commandId, {
          ...current,
          status: 'completed',
          claimedByDevice: '55555555-aaaa-4555-8555-555555555555',
          completedAt,
          result: {
            type: input.type,
            monthlyCard: {
              id: cardId,
              memberId: existing.memberId,
              planName: updated.monthlyCardPlanName ?? '30 天月卡',
              priceFen: updated.monthlyCardPriceFen ?? 20_000,
              paymentMethod: 'cash',
              status,
              purchasedAt: startsAt,
              startsAt,
              expiresAt,
              pausedAt: status === 'paused' ? completedAt : null,
              usageCount: 0,
              scopeType: 'store',
              issuingStoreId: mockStoreProfile.storeId
            }
          }
        })
      } catch (error) {
        financialCommands.set(commandId, {
          ...current,
          status: 'failed',
          claimedByDevice: '55555555-aaaa-4555-8555-555555555555',
          errorMessage:
            error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString()
        })
      }
    }, 300)
    return created
  }

  async getEmployeeFinancialCommand(
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    const command = financialCommands.get(commandId)
    if (!command) throw new Error('财务操作命令不存在')
    return command
  }

  async cancelEmployeeFinancialCommand(
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    const command = financialCommands.get(commandId)
    if (!command) throw new Error('财务操作命令不存在')
    if (command.status !== 'pending') {
      throw new Error('当前状态不能取消')
    }
    const canceled = { ...command, status: 'canceled' as const }
    financialCommands.set(commandId, canceled)
    return canceled
  }

  async listEmployeeActivities(): Promise<ActivitySummary[]> {
    this.requireManager()
    return managerActivities.map((activity) => ({
      ...activity,
      rechargeTiers: activity.rechargeTiers.map((tier) => ({ ...tier }))
    }))
  }

  async createEmployeeActivity(
    input: EmployeeMobileCreateActivityRequest
  ): Promise<ActivitySummary> {
    this.requireManager()
    const now = new Date().toISOString()
    const created: ActivitySummary = {
      id: `mock-activity-${Date.now()}`,
      title: input.title.trim(),
      summary: input.summary.trim(),
      content: input.content.trim(),
      activityType: input.activityType,
      status: 'draft',
      visibility: 'draft',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      pinned: input.pinned,
      regularPriceFen: input.regularPriceFen ?? null,
      advancedPriceFen: input.advancedPriceFen ?? null,
      allowStoredValue: input.allowStoredValue,
      allowWechat: input.allowWechat,
      rechargeTiers: input.rechargeTiers.map((tier, index) => ({
        id: `mock-tier-${Date.now()}-${index}`,
        ...tier
      })),
      createdAt: now,
      updatedAt: now
    }
    managerActivities = [created, ...managerActivities]
    return created
  }

  async updateEmployeeActivity(
    input: EmployeeMobileUpdateActivityRequest
  ): Promise<ActivitySummary> {
    this.requireManager()
    const index = managerActivities.findIndex(
      (activity) => activity.id === input.activityId
    )
    const current = managerActivities[index]
    if (!current) throw new Error('活动不存在')
    const updated: ActivitySummary = {
      ...current,
      title: input.title.trim(),
      summary: input.summary.trim(),
      content: input.content.trim(),
      activityType: input.activityType,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      pinned: input.pinned,
      regularPriceFen: input.regularPriceFen ?? null,
      advancedPriceFen: input.advancedPriceFen ?? null,
      allowStoredValue: input.allowStoredValue,
      allowWechat: input.allowWechat,
      rechargeTiers: input.rechargeTiers.map((tier) => ({
        id:
          current.rechargeTiers.find(
            (candidate) => candidate.principalFen === tier.principalFen
          )?.id ?? `mock-tier-${Date.now()}-${tier.principalFen}`,
        ...tier
      })),
      updatedAt: new Date().toISOString()
    }
    managerActivities[index] = updated
    return updated
  }

  async setEmployeeActivityStatus(
    input: EmployeeMobileSetActivityStatusRequest
  ): Promise<ActivitySummary> {
    this.requireManager()
    const index = managerActivities.findIndex(
      (activity) => activity.id === input.activityId
    )
    const current = managerActivities[index]
    if (!current) throw new Error('活动不存在')
    const now = new Date()
    const visibility =
      input.status === 'disabled'
        ? 'disabled'
        : now.getTime() < Date.parse(current.startsAt)
          ? 'scheduled'
          : now.getTime() >= Date.parse(current.endsAt)
            ? 'ended'
            : 'active'
    const updated: ActivitySummary = {
      ...current,
      status: input.status,
      visibility,
      updatedAt: now.toISOString()
    }
    managerActivities[index] = updated
    return updated
  }

  async getEmployeeBusinessReport(
    input: BusinessReportRequest
  ): Promise<BusinessReport> {
    this.requireManager()
    return {
      fromDate: input.fromDate,
      toDate: input.toDate,
      generatedAt: new Date().toISOString(),
      order: {
        orderCount: 12,
        grossSalesFen: 48600,
        refundCount: 1,
        refundFen: 3000,
        netSalesFen: 45600,
        averageOrderFen: 4050,
        admissionQuantity: 10
      },
      payment: {
        cashSalesFen: 24600,
        cashRefundFen: 0,
        cashNetFen: 24600,
        storedValueSalesFen: 24000,
        storedValueRefundFen: 3000,
        storedValueNetFen: 21000
      },
      wallet: {
        rechargeCount: 3,
        rechargePrincipalFen: 130000,
        rechargeGiftFen: 22000,
        rechargeRefundCount: 0,
        rechargeRefundPrincipalFen: 0,
        reclaimedGiftFen: 0,
        consumptionDebitFen: 24000,
        orderRefundCreditFen: 3000
      },
      monthlyCard: {
        soldCount: 1,
        grossSalesFen: 20000,
        refundCount: 0,
        refundFen: 0,
        netSalesFen: 20000,
        usageCount: 2,
        activeCount: 8
      },
      actualCashInflowFen: 174600,
      items: [
        {
          itemName: '入场费',
          itemType: 'admission',
          soldQuantity: 10,
          refundedQuantity: 1,
          netQuantity: 9,
          grossSalesFen: 40000,
          refundFen: 3000,
          netSalesFen: 37000
        }
      ]
    }
  }

  async listEmployeeAnnouncements(): Promise<AnnouncementSummary[]> {
    this.requireManager()
    return managerAnnouncements.map((announcement) => ({ ...announcement }))
  }

  async createEmployeeAnnouncement(
    input: EmployeeMobileCreateAnnouncementRequest
  ): Promise<AnnouncementSummary> {
    this.requireManager()
    const now = new Date().toISOString()
    const created: AnnouncementSummary = {
      id: `mock-announcement-${Date.now()}`,
      title: input.title.trim(),
      content: input.content.trim(),
      status: 'draft',
      visibility: 'draft',
      pinned: input.pinned,
      visibleFrom: input.visibleFrom,
      visibleUntil: input.visibleUntil ?? null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now
    }
    managerAnnouncements = [created, ...managerAnnouncements]
    return created
  }

  async updateEmployeeAnnouncement(
    input: EmployeeMobileUpdateAnnouncementRequest
  ): Promise<AnnouncementSummary> {
    this.requireManager()
    const index = managerAnnouncements.findIndex(
      (announcement) => announcement.id === input.announcementId
    )
    const current = managerAnnouncements[index]
    if (!current) throw new Error('公告不存在')
    const now = new Date()
    const updated: AnnouncementSummary = {
      ...current,
      title: input.title.trim(),
      content: input.content.trim(),
      pinned: input.pinned,
      visibleFrom: input.visibleFrom,
      visibleUntil: input.visibleUntil ?? null,
      visibility:
        current.status === 'draft'
          ? 'draft'
          : current.status === 'disabled'
            ? 'disabled'
            : now.getTime() < Date.parse(input.visibleFrom)
              ? 'scheduled'
              : input.visibleUntil &&
                  now.getTime() >= Date.parse(input.visibleUntil)
                ? 'ended'
                : 'active',
      updatedAt: now.toISOString()
    }
    managerAnnouncements[index] = updated
    return updated
  }

  async setEmployeeAnnouncementStatus(
    input: EmployeeMobileSetAnnouncementStatusRequest
  ): Promise<AnnouncementSummary> {
    this.requireManager()
    const index = managerAnnouncements.findIndex(
      (announcement) => announcement.id === input.announcementId
    )
    const current = managerAnnouncements[index]
    if (!current) throw new Error('公告不存在')
    const now = new Date()
    const updated: AnnouncementSummary = {
      ...current,
      status: input.status,
      visibility:
        input.status === 'disabled'
          ? 'disabled'
          : now.getTime() < Date.parse(current.visibleFrom)
            ? 'scheduled'
            : current.visibleUntil &&
                now.getTime() >= Date.parse(current.visibleUntil)
              ? 'ended'
              : 'active',
      publishedAt:
        input.status === 'published'
          ? now.toISOString()
          : current.publishedAt,
      updatedAt: now.toISOString()
    }
    managerAnnouncements[index] = updated
    return updated
  }

  async listEmployeeBoardGames(): Promise<BoardGameSummary[]> {
    this.requireEmployee()
    return employeeBoardGames.map((game) => ({
      ...game,
      categories: [...game.categories],
      missingParts: game.missingParts.map((part) => ({ ...part }))
    }))
  }

  async updateEmployeeBoardGameOperations(
    input: EmployeeMobileUpdateBoardGameOperationsRequest
  ): Promise<BoardGameSummary> {
    this.requireEmployee()
    const index = employeeBoardGames.findIndex(
      (game) => game.id === input.boardGameId
    )
    const current = employeeBoardGames[index]
    if (!current) throw new Error('桌游不存在')
    if (input.customerConsigned && !input.consignorNickname?.trim()) {
      throw new Error('顾客寄存桌游必须填写寄存人昵称')
    }
    if (input.missingPieces && input.missingParts.length === 0) {
      throw new Error('缺件桌游必须填写缺件名称和数量')
    }
    const updated: BoardGameSummary = {
      ...current,
      available: input.available,
      customerConsigned: input.customerConsigned,
      missingPieces: input.missingPieces,
      private: input.private,
      customerNote: input.customerNote?.trim() || null,
      internalNote: input.internalNote?.trim() || null,
      consignorNickname: input.customerConsigned
        ? input.consignorNickname?.trim() || null
        : null,
      missingParts: input.missingPieces
        ? input.missingParts.map((part, partIndex) => ({
            id:
              current.missingParts.find(
                (candidate) => candidate.name === part.name.trim()
              )?.id ?? `mock-part-${Date.now()}-${partIndex}`,
            name: part.name.trim(),
            quantity: part.quantity
          }))
        : [],
      updatedAt: new Date().toISOString()
    }
    employeeBoardGames[index] = updated
    return updated
  }

  async getEmployeeStoreProfile(): Promise<StoreProfileSummary> {
    this.requireManager()
    return { ...mockStoreProfile }
  }

  async updateEmployeeStoreStatus(
    input: EmployeeMobileUpdateStoreStatusRequest
  ): Promise<StoreProfileSummary> {
    this.requireManager()
    mockStoreProfile = {
      ...mockStoreProfile,
      statusOverride: input.statusOverride,
      customStatusText: input.customStatusText?.trim() || null,
      updatedAt: new Date().toISOString()
    }
    return { ...mockStoreProfile }
  }

  private requireManager(): void {
    if (identity.role !== 'manager') {
      throw new Error('当前身份没有店长操作权限')
    }
  }

  private requireEmployee(): void {
    if (identity.role !== 'manager' && identity.role !== 'staff') {
      throw new Error('当前身份没有员工操作权限')
    }
  }
}
