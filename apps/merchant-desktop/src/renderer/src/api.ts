import type {
  ActivitySummary,
  AnnouncementSummary,
  ApplicationUpdateStatus,
  ApplicationState,
  BoardGameSummary,
  BusinessReport,
  BusinessReportRequest,
  CashierMemberOption,
  CatalogItemSummary,
  CloudConnectionStatus,
  DesktopApi,
  EmployeeSummary,
  FinancialRefundSummary,
  FinancialRefundTargetType,
  MemberSummary,
  MonthlyCardDetails,
  MonthlyCardSummary,
  OrderBenefitType,
  RefundSummary,
  RefundableOrderSummary,
  SalesOrderSummary,
  SessionUser,
  StoreProfileSummary,
  WalletDetails,
  WalletOperationResult
} from '@zyapp/contracts'

const previewManager: SessionUser = {
  id: 'preview-manager',
  username: 'manager',
  displayName: '预览店长',
  role: 'manager',
  permissions: [
    'identity.employee.manage',
    'member.profile.read',
    'member.profile.write',
    'wallet.recharge.cash',
    'wallet.ledger.debit',
    'wallet.ledger.adjust',
    'monthly-card.manage',
    'order.create',
    'refund.request',
    'refund.approve',
    'catalog.pricing.manage',
    'catalog.read',
    'catalog.availability.manage',
    'activity.read',
    'activity.manage',
    'content.read',
    'content.manage',
    'content.board-game.operations.manage',
    'report.read',
    'report.finance.export',
    'system.backup.manage',
    'system.cloud.manage',
    'store.profile.manage'
  ],
  storeId: 'preview-store',
  storeName: '桌游吧示例门店'
}

let previewEmployees: EmployeeSummary[] = [
  {
    id: previewManager.id,
    username: previewManager.username,
    displayName: previewManager.displayName,
    role: 'manager',
    status: 'active',
    mobileAccessEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
]

let previewMembers: MemberSummary[] = []
let previewDataEnvironment: 'production' | 'test' = 'test'
const previewWallets = new Map<string, WalletDetails>()
const previewWalletOperations = new Map<string, WalletOperationResult>()
const previewMonthlyCards = new Map<string, MonthlyCardDetails>()
let previewCatalogItems: CatalogItemSummary[] = [
  {
    id: 'preview-admission',
    code: 'CADMISSION',
    name: '入场费',
    itemType: 'admission',
    regularPriceFen: 4000,
    advancedPriceFen: 3000,
    status: 'active',
    availability: 'available',
    note: '系统默认入场收费项目',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
]
let previewActivities: ActivitySummary[] = []
let previewAnnouncements: AnnouncementSummary[] = []
let previewBoardGames: BoardGameSummary[] = []
let previewCloudStatus: CloudConnectionStatus = {
  environment: previewDataEnvironment,
  configuredEnvironment: null,
  configured: false,
  state: 'not_configured',
  baseUrl: null,
  deviceId: 'preview-device',
  credentialMatchesDevice: false,
  pendingOperations: 4,
  conflictedOperations: 0,
  pendingConflicts: 0,
  pendingInboundEvents: 0,
  inboundConflicts: 0,
  lastConfirmedDeviceSeq: 0,
  pullCursor: null,
  lastPushAt: null,
  lastPullAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  runtimeMode: 'not_configured',
  lastCloudReachableAt: null,
  mirrorCursor: null,
  mirrorLag: 0,
  pendingOutcomes: 0,
  mirrorRepairRequired: false,
  offlineFinancialLeaseOwnerDeviceId: null,
  offlineFinancialLeaseExpiresAt: null,
  offlineFinancialWriteAllowed: false
}
let previewStoreProfile: StoreProfileSummary = {
  storeId: 'preview-store',
  name: '桌游吧示例门店',
  address: '',
  contactPhone: '',
  businessOpenMinute: 13 * 60,
  businessCloseMinute: 23 * 60,
  statusOverride: 'automatic',
  customStatusText: null,
  updatedAt: new Date().toISOString()
}
const previewApplicationUpdateStatus: ApplicationUpdateStatus = {
  state: 'disabled',
  currentVersion: '0.1.0-preview',
  availableVersion: null,
  feedUrl: null,
  downloadPercent: null,
  transferredBytes: null,
  totalBytes: null,
  lastCheckedAt: null,
  lastError: null
}
let previewOrders: SalesOrderSummary[] = []
let previewRefunds: RefundSummary[] = []
let previewFinancialRefunds: FinancialRefundSummary[] = []

function previewBusinessReport(request: BusinessReportRequest): BusinessReport {
  return {
    fromDate: request.fromDate,
    toDate: request.toDate,
    generatedAt: new Date().toISOString(),
    order: {
      orderCount: 0,
      grossSalesFen: 0,
      refundCount: 0,
      refundFen: 0,
      netSalesFen: 0,
      averageOrderFen: 0,
      admissionQuantity: 0
    },
    payment: {
      cashSalesFen: 0,
      cashRefundFen: 0,
      cashNetFen: 0,
      storedValueSalesFen: 0,
      storedValueRefundFen: 0,
      storedValueNetFen: 0
    },
    wallet: {
      rechargeCount: 0,
      rechargePrincipalFen: 0,
      rechargeGiftFen: 0,
      rechargeRefundCount: 0,
      rechargeRefundPrincipalFen: 0,
      reclaimedGiftFen: 0,
      consumptionDebitFen: 0,
      orderRefundCreditFen: 0
    },
    monthlyCard: {
      soldCount: 0,
      grossSalesFen: 0,
      refundCount: 0,
      refundFen: 0,
      netSalesFen: 0,
      usageCount: 0,
      activeCount: [...previewMonthlyCards.values()].filter((details) => details.current)
        .length
    },
    actualCashInflowFen: 0,
    items: []
  }
}

let previewDefaultGiftTiers = [
  { id: 'tier-300', principalFen: 30_000, giftFen: 2_000, active: true },
  { id: 'tier-500', principalFen: 50_000, giftFen: 5_000, active: true },
  { id: 'tier-1000', principalFen: 100_000, giftFen: 20_000, active: true }
]
const previewGiftTiers = previewDefaultGiftTiers.map((tier) => ({ ...tier }))

function previewActivityVisibility(
  activity: Pick<ActivitySummary, 'status' | 'startsAt' | 'endsAt'>
): ActivitySummary['visibility'] {
  if (activity.status === 'draft') return 'draft'
  if (activity.status === 'disabled') return 'disabled'
  const now = Date.now()
  if (now < Date.parse(activity.startsAt)) return 'scheduled'
  if (now >= Date.parse(activity.endsAt)) return 'ended'
  return 'active'
}

function previewAnnouncementVisibility(
  announcement: Pick<
    AnnouncementSummary,
    'status' | 'visibleFrom' | 'visibleUntil'
  >
): AnnouncementSummary['visibility'] {
  if (announcement.status === 'draft') return 'draft'
  if (announcement.status === 'disabled') return 'disabled'
  const now = Date.now()
  if (now < Date.parse(announcement.visibleFrom)) return 'scheduled'
  if (
    announcement.visibleUntil &&
    now >= Date.parse(announcement.visibleUntil)
  ) {
    return 'ended'
  }
  return 'active'
}

function calculatePreviewGift(principalFen: number): number {
  let remainder = principalFen
  let giftFen = 0
  const highest = previewGiftTiers.at(-1)
  if (highest && remainder >= highest.principalFen) {
    const count = Math.floor(remainder / highest.principalFen)
    giftFen += count * highest.giftFen
    remainder -= count * highest.principalFen
  }
  const tier = [...previewGiftTiers]
    .reverse()
    .find((candidate) => candidate.principalFen <= remainder)
  return giftFen + (tier?.giftFen ?? 0)
}

function previewWalletDetails(memberId: string): WalletDetails {
  const existing = previewWallets.get(memberId)
  if (existing) {
    return existing
  }
  const details: WalletDetails = {
    wallet: {
      accountId: null,
      memberId,
      principalBalanceFen: 0,
      giftBalanceFen: 0,
      totalBalanceFen: 0,
      status: 'active',
      updatedAt: null
    },
    giftTiers: previewGiftTiers,
    ledger: [],
    recharges: [],
    legacyHistory: []
  }
  previewWallets.set(memberId, details)
  return details
}

function previewMonthlyCardDetails(memberId: string): MonthlyCardDetails {
  const existing = previewMonthlyCards.get(memberId)
  if (existing) return existing
  const details: MonthlyCardDetails = {
    plan: {
      id: 'preview-monthly-plan',
      name: '30 天月卡',
      priceFen: 20_000,
      durationDays: 30,
      active: true,
      scopeType: 'store',
      sourceTemplateId: null
    },
    current: null,
    history: [],
    events: [],
    legacyHistory: []
  }
  previewMonthlyCards.set(memberId, details)
  return details
}

function updatePreviewMonthlyCard(
  cardId: string,
  eventType: MonthlyCardDetails['events'][number]['eventType'],
  reason: string,
  update: (card: MonthlyCardSummary) => MonthlyCardSummary
): MonthlyCardSummary {
  const details = [...previewMonthlyCards.values()].find((item) =>
    item.history.some((card) => card.id === cardId)
  )
  const card = details?.history.find((item) => item.id === cardId)
  if (!details || !card) throw new Error('找不到月卡')
  const next = update(card)
  details.history = details.history.map((item) => (item.id === cardId ? next : item))
  details.current =
    next.status === 'active' || next.status === 'paused' ? next : null
  details.events.unshift({
    id: crypto.randomUUID(),
    eventType,
    reason,
    occurredAt: new Date().toISOString()
  })
  return next
}

function previewApplicationState(): ApplicationState {
  return {
    initialized: true,
    session: previewManager,
    system: {
      appVersion: '0.1.0-preview',
      dataEnvironment: previewDataEnvironment,
      activeStoreProfileId: 'preview-store-profile',
      databasePath: '开发模式浏览器预览',
      sqliteVersion: '3.53.0',
      schemaVersion: 16,
      journalMode: 'wal',
      modules: []
    }
  }
}

function previewRefundableOrder(query: string): RefundableOrderSummary {
  const order = previewOrders.find(
    (candidate) => candidate.id === query || candidate.orderNumber === query
  )
  if (!order) throw new Error('找不到订单')
  const refundableUntil = new Date(
    new Date(order.completedAt).getTime() + 720 * 60 * 60 * 1000
  )
  return {
    ...order,
    refundableUntil: refundableUntil.toISOString(),
    withinRefundWindow: Date.now() <= refundableUntil.getTime(),
    items: order.items.map((item) => {
      const related = previewRefunds.flatMap((refund) =>
        refund.items
          .filter((refundItem) => refundItem.orderItemId === item.id)
          .map((refundItem) => ({ status: refund.status, quantity: refundItem.quantity }))
      )
      const pendingRefundQuantity = related
        .filter((entry) => entry.status === 'pending')
        .reduce((sum, entry) => sum + entry.quantity, 0)
      const completedRefundQuantity = related
        .filter((entry) => entry.status === 'completed')
        .reduce((sum, entry) => sum + entry.quantity, 0)
      return {
        ...item,
        pendingRefundQuantity,
        completedRefundQuantity,
        refundableQuantity:
          item.quantity - pendingRefundQuantity - completedRefundQuantity
      }
    })
  }
}

function createPreviewRefund(
  requestId: string,
  orderId: string,
  requestedItems: Array<{ orderItemId: string; quantity: number }>,
  reason?: string
): RefundSummary {
  const repeated = previewRefunds.find((refund) => refund.id === requestId)
  if (repeated) return repeated
  const order = previewRefundableOrder(orderId)
  if (!order.withinRefundWindow) throw new Error('订单退款时限已过')
  const items = requestedItems.map((requested) => {
    const item = order.items.find((candidate) => candidate.id === requested.orderItemId)
    if (!item) throw new Error('退款项目不属于该订单')
    if (requested.quantity < 1 || requested.quantity > item.refundableQuantity) {
      throw new Error('退款数量超过可退数量')
    }
    if (item.appliedUnitPriceFen <= 0) throw new Error('该项目没有可退实付金额')
    return {
      id: crypto.randomUUID(),
      orderItemId: item.id,
      itemName: item.itemName,
      itemType: item.itemType,
      unitRefundFen: item.appliedUnitPriceFen,
      quantity: requested.quantity,
      lineRefundFen: item.appliedUnitPriceFen * requested.quantity
    }
  })
  const timestamp = new Date().toISOString()
  const refund: RefundSummary = {
    id: requestId,
    refundNumber: `R${timestamp.slice(0, 10).replaceAll('-', '')}-${requestId
      .replaceAll('-', '')
      .slice(0, 8)
      .toUpperCase()}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    walletMemberId: order.walletMemberId,
    status: 'pending',
    totalFen: items.reduce((sum, item) => sum + item.lineRefundFen, 0),
    requestedBy: previewManager.id,
    requestedAt: timestamp,
    requestReason: reason?.trim() || null,
    approvedBy: null,
    approvedAt: null,
    specialProductOverride: false,
    completionReason: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    completedAt: null,
    items,
    evidence: []
  }
  previewRefunds = [refund, ...previewRefunds]
  return refund
}

function completePreviewRefund(
  refundId: string,
  specialProductOverride: boolean,
  reason?: string
): RefundSummary {
  const refund = previewRefunds.find((candidate) => candidate.id === refundId)
  if (!refund || refund.status !== 'pending') throw new Error('找不到待审批退款')
  const completionReason = reason?.trim() || refund.requestReason || ''
  if (refund.items.some((item) => item.itemType === 'product')) {
    if (!specialProductOverride) throw new Error('已交付商品需要店长特殊退款')
    if (completionReason.length < 2) throw new Error('商品特殊退款必须填写原因')
  }
  const timestamp = new Date().toISOString()
  const completed: RefundSummary = {
    ...refund,
    status: 'completed',
    approvedBy: previewManager.id,
    approvedAt: timestamp,
    specialProductOverride,
    completionReason: completionReason || null,
    completedAt: timestamp
  }
  previewRefunds = previewRefunds.map((candidate) =>
    candidate.id === completed.id ? completed : candidate
  )
  if (completed.paymentMethod === 'stored_value' && completed.walletMemberId) {
    const details = previewWalletDetails(completed.walletMemberId)
    const principalBalanceFen =
      details.wallet.principalBalanceFen + completed.totalFen
    previewWallets.set(completed.walletMemberId, {
      ...details,
      wallet: {
        ...details.wallet,
        principalBalanceFen,
        totalBalanceFen: principalBalanceFen + details.wallet.giftBalanceFen,
        updatedAt: timestamp
      }
    })
  }
  return completed
}

function previewFinancialTarget(
  targetType: FinancialRefundTargetType,
  targetId: string
): {
  memberId: string
  refundPrincipalFen: number
  reclaimGiftFen: number
  requiresSpecialOverride: boolean
} {
  if (targetType === 'monthly_card') {
    for (const [memberId, details] of previewMonthlyCards) {
      const card = details.history.find((candidate) => candidate.id === targetId)
      if (!card) continue
      if (card.status !== 'active' && card.status !== 'paused') {
        throw new Error('月卡当前状态不可退款')
      }
      if (Date.now() - new Date(card.purchasedAt).getTime() > 24 * 60 * 60 * 1000) {
        throw new Error('月卡退款时限已过')
      }
      return {
        memberId,
        refundPrincipalFen: card.priceFen,
        reclaimGiftFen: 0,
        requiresSpecialOverride: card.usageCount > 0
      }
    }
    throw new Error('找不到月卡')
  }
  for (const [memberId, details] of previewWallets) {
    const recharge = details.recharges.find((candidate) => candidate.id === targetId)
    if (!recharge) continue
    if (recharge.status === 'reversed' || recharge.remainingPrincipalFen <= 0) {
      throw new Error('该充值没有可退本金')
    }
    return {
      memberId,
      refundPrincipalFen: recharge.remainingPrincipalFen,
      reclaimGiftFen: recharge.remainingGiftFen,
      requiresSpecialOverride: false
    }
  }
  throw new Error('找不到现金充值')
}

function createPreviewFinancialRefund(
  requestId: string,
  targetType: FinancialRefundTargetType,
  targetId: string,
  reason?: string
): FinancialRefundSummary {
  const repeated = previewFinancialRefunds.find((item) => item.id === requestId)
  if (repeated) return repeated
  const target = previewFinancialTarget(targetType, targetId)
  const member = previewMembers.find((item) => item.id === target.memberId)
  if (!member) throw new Error('找不到退款会员')
  const timestamp = new Date().toISOString()
  const request: FinancialRefundSummary = {
    id: requestId,
    requestNumber: `F${timestamp.slice(0, 10).replaceAll('-', '')}-${requestId
      .replaceAll('-', '')
      .slice(0, 8)
      .toUpperCase()}`,
    targetType,
    targetId,
    memberId: target.memberId,
    memberNickname: member.nickname,
    memberPhone: member.phone,
    paymentMethod: 'cash',
    status: 'pending',
    refundPrincipalFen: target.refundPrincipalFen,
    reclaimGiftFen: target.reclaimGiftFen,
    requiresSpecialOverride: target.requiresSpecialOverride,
    requestedBy: previewManager.id,
    requestedAt: timestamp,
    requestReason: reason?.trim() || null,
    approvedBy: null,
    approvedAt: null,
    specialOverride: false,
    completionReason: null,
    executionOperationId: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    completedAt: null
  }
  previewFinancialRefunds = [request, ...previewFinancialRefunds]
  return request
}

async function completePreviewFinancialRefund(
  financialRefundId: string,
  specialOverride: boolean,
  reason?: string
): Promise<FinancialRefundSummary> {
  const request = previewFinancialRefunds.find(
    (candidate) => candidate.id === financialRefundId
  )
  if (!request || request.status !== 'pending') throw new Error('找不到待审批退款')
  const target = previewFinancialTarget(request.targetType, request.targetId)
  const completionReason = reason?.trim() || request.requestReason || ''
  if (target.requiresSpecialOverride && !specialOverride) {
    throw new Error('已使用月卡需要店长特殊退款')
  }
  if (target.requiresSpecialOverride && completionReason.length < 2) {
    throw new Error('月卡特殊退款必须填写原因')
  }
  let executionOperationId: string
  if (request.targetType === 'monthly_card') {
    const card = await previewApi.refundMonthlyCard({
      requestId: crypto.randomUUID(),
      cardId: request.targetId,
      reason: completionReason || '月卡退款'
    })
    executionOperationId = card.id
  } else {
    const result = await previewApi.reverseCashRecharge({
      requestId: crypto.randomUUID(),
      rechargeId: request.targetId,
      reason: completionReason || '现金充值退款'
    })
    executionOperationId = result.operationId
  }
  const timestamp = new Date().toISOString()
  const completed: FinancialRefundSummary = {
    ...request,
    status: 'completed',
    approvedBy: previewManager.id,
    approvedAt: timestamp,
    specialOverride,
    completionReason: completionReason || null,
    executionOperationId,
    completedAt: timestamp
  }
  previewFinancialRefunds = previewFinancialRefunds.map((candidate) =>
    candidate.id === completed.id ? completed : candidate
  )
  return completed
}

const previewApi: DesktopApi = {
  getSystemStatus: async () => previewApplicationState().system,
  switchDataEnvironment: async (request) => {
    previewDataEnvironment = request.environment
    previewCloudStatus = {
      ...previewCloudStatus,
      environment: request.environment,
      configuredEnvironment: null,
      configured: false,
      state: 'not_configured',
      runtimeMode: 'not_configured',
      baseUrl: null,
      credentialMatchesDevice: false
    }
  },
  listStoreProfiles: async () => [
    {
      profileId: 'preview-store-profile',
      environment: previewDataEnvironment,
      tenantId: 'preview-tenant',
      storeId: previewStoreProfile.storeId,
      storeName: previewStoreProfile.name,
      deviceId: 'preview-device',
      initialized: true,
      active: true
    }
  ],
  switchStoreProfile: async () => previewApplicationState(),
  relocateDatabase: async () => ({
    canceled: true,
    databasePath: previewApplicationState().system.databasePath,
    previousDatabasePath: null,
    backupPath: null,
    oldDatabaseRetained: false
  }),
  getBackupOverview: async () => ({
    settings: {
      primaryDirectory: '浏览器预览：主备份目录',
      secondaryDirectory: null
    },
    backups: []
  }),
  createBackup: async () => ({
    backup: {
      fileName: 'zyapp-manual-preview.db',
      filePath: '浏览器预览：zyapp-manual-preview.db',
      kind: 'manual',
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      sha256: '0'.repeat(64),
      schemaVersion: 11,
      integrityOk: true,
      secondaryCopy: false
    },
    secondaryPath: null,
    secondaryError: null
  }),
  setSecondaryBackupDirectory: async () => ({
    canceled: true,
    settings: {
      primaryDirectory: '浏览器预览：主备份目录',
      secondaryDirectory: null
    }
  }),
  restoreDatabase: async () => ({
    canceled: true,
    restoredFromPath: null,
    protectionBackupPath: null,
    schemaVersion: null
  }),
  exportDiagnostics: async () => ({
    canceled: true,
    filePath: null,
    sha256: null
  }),
  getCloudConnectionStatus: async () => previewCloudStatus,
  enrollCloudConnection: async (request) => {
    const timestamp = new Date().toISOString()
    previewCloudStatus = {
      ...previewCloudStatus,
      configured: true,
      configuredEnvironment: previewDataEnvironment,
      state: 'idle',
      runtimeMode: 'cloud_online',
      baseUrl: request.baseUrl.replace(/\/$/, ''),
      credentialMatchesDevice: true,
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      lastError: null
    }
    return previewCloudStatus
  },
  createCloudPairingCode: async () => ({
    code: 'DEMO-DEMO-DEMO-DEMO',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    storeName: previewManager.storeName
  }),
  listTenantStores: async () => [
    {
      id: previewStoreProfile.storeId,
      name: previewStoreProfile.name,
      status: 'active',
      createdAt: new Date().toISOString(),
      currentStore: true
    }
  ],
  createTenantStore: async (request) => ({
    store: {
      id: crypto.randomUUID(),
      name: request.storeName,
      status: 'active',
      createdAt: new Date().toISOString(),
      currentStore: false
    },
    activationCode: '2345-6789-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  }),
  listEmployeeStoreAccess: async () => [
    {
      employeeId: previewManager.id,
      username: previewManager.username,
      displayName: previewManager.displayName,
      identityStatus: 'active',
      storeId: previewStoreProfile.storeId,
      storeName: previewStoreProfile.name,
      role: 'manager',
      status: 'active',
      authorizationVersion: 1,
      updatedAt: new Date().toISOString()
    }
  ],
  setEmployeeStoreAccess: async (request) => ({
    employeeId: request.employeeId,
    username: previewManager.username,
    displayName: previewManager.displayName,
    identityStatus: 'active',
    storeId: request.storeId,
    storeName: previewStoreProfile.name,
    role: request.role,
    status: request.status,
    authorizationVersion: 2,
    updatedAt: new Date().toISOString()
  }),
  listBusinessTemplates: async () => [],
  saveBusinessTemplate: async (request) => ({
    id: request.id,
    templateType: request.templateType,
    name: request.name,
    payload: request.payload,
    active: request.active,
    overridePayload: null,
    overrideActive: null,
    updatedAt: new Date().toISOString()
  }),
  saveBusinessTemplateOverride: async (request) => ({
    id: request.templateId,
    templateType: 'monthly_card_plan',
    name: 'Preview template',
    payload: {},
    active: true,
    overridePayload: request.payload,
    overrideActive: request.active,
    updatedAt: new Date().toISOString()
  }),
  joinCloudStore: async () => null,
  getDeviceOnboardingState: async () => ({
    environment: 'production',
    initialized: true,
    pending: false,
    baseUrl: null,
    requestId: null,
    storeName: null,
    lastError: null
  }),
  joinCloudStoreBeforeLogin: async () => ({
    environment: 'production',
    tenantId: 'preview-tenant',
    storeId: 'preview-store',
    storeName: '桌游吧示例门店',
    deviceId: 'preview-device',
    epochId: 'preview-epoch',
    mirrorDatabasePath: 'preview.db'
  }),
  syncCloudNow: async () => {
    const timestamp = new Date().toISOString()
    previewCloudStatus = {
      ...previewCloudStatus,
      state: 'idle',
      runtimeMode: 'cloud_online',
      lastCloudReachableAt: timestamp,
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      lastPushAt: timestamp,
      lastPullAt: timestamp,
      lastError: null
    }
    return previewCloudStatus
  },
  prepareEmptyCloudCutover: async () => null,
  claimOfflineFinancialLease: async () => ({
    ownerDeviceId: previewCloudStatus.deviceId,
    ownerDeviceName: 'Preview Cashier',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    leaseVersion: 1,
    currentDeviceOwnsLease: true
  }),
  listInboundSyncConflicts: async () => [],
  resolveInboundSyncConflict: async () => undefined,
  getStoreProfile: async () => previewStoreProfile,
  updateStoreProfile: async (request) => {
    previewStoreProfile = {
      ...previewStoreProfile,
      ...request,
      address: request.address?.trim() || null,
      contactPhone: request.contactPhone?.trim() || null,
      customStatusText: request.customStatusText?.trim() || null,
      updatedAt: new Date().toISOString()
    }
    return previewStoreProfile
  },
  getApplicationUpdateStatus: async () => previewApplicationUpdateStatus,
  checkApplicationUpdate: async () => previewApplicationUpdateStatus,
  downloadApplicationUpdate: async () => previewApplicationUpdateStatus,
  installApplicationUpdate: async () => undefined,
  preflightLegacyImport: async () => ({ canceled: true }),
  executeLegacyImport: async () => {
    throw new Error('浏览器预览模式不能访问本地旧数据库文件')
  },
  getApplicationState: async () => previewApplicationState(),
  bootstrapStore: async () => previewApplicationState(),
  getSavedLogin: async () => null,
  login: async () => previewManager,
  logout: async () => undefined,
  listEmployees: async () => previewEmployees,
  createEmployee: async (request) => {
    const timestamp = new Date().toISOString()
    const employee: EmployeeSummary = {
      id: `preview-${previewEmployees.length + 1}`,
      username: request.username,
      displayName: request.displayName,
      role: request.role,
      status: 'active',
      mobileAccessEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    previewEmployees = [...previewEmployees, employee]
    return employee
  },
  setEmployeeStatus: async (request) => {
    const employee = previewEmployees.find((item) => item.id === request.employeeId)
    if (!employee) {
      throw new Error('Employee was not found')
    }
    const updated = { ...employee, status: request.status, updatedAt: new Date().toISOString() }
    previewEmployees = previewEmployees.map((item) =>
      item.id === request.employeeId ? updated : item
    )
    return updated
  },
  resetEmployeePassword: async () => undefined,
  configureEmployeeMobileAccess: async (request) => {
    const employee = previewEmployees.find((item) => item.id === request.employeeId)
    if (!employee) {
      throw new Error('Employee was not found')
    }
    const updated = {
      ...employee,
      mobileAccessEnabled: request.enabled,
      updatedAt: new Date().toISOString()
    }
    previewEmployees = previewEmployees.map((item) =>
      item.id === request.employeeId ? updated : item
    )
    return updated
  },
  searchMembers: async (request) => {
    const query = request.query.trim().toLowerCase()
    return previewMembers
      .filter(
        (member) =>
          query === '' ||
          member.phone.includes(query) ||
          member.memberNumber.toLowerCase().includes(query) ||
          member.nickname.toLowerCase().includes(query)
      )
      .slice(0, request.limit ?? 50)
  },
  listCashierMembers: async (): Promise<CashierMemberOption[]> =>
    [...previewMembers]
      .filter((member) => member.status === 'active')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((member) => ({ ...member, lastActiveAt: member.updatedAt })),
  createMember: async (request) => {
    const existing = previewMembers.find((member) => member.phone === request.phone)
    if (existing?.status === 'active') {
      throw new Error('该手机号已经绑定会员，请直接查询原会员')
    }
    if (existing?.status === 'disabled') {
      const updated: MemberSummary = {
        ...existing,
        nickname: request.nickname,
        tier: 'ordinary',
        status: 'active',
        birthdayMonth: request.birthdayMonth ?? null,
        birthdayDay: request.birthdayDay ?? null,
        birthdaySource:
          request.birthdayMonth !== undefined && request.birthdayDay !== undefined
            ? 'customer'
            : null,
        note: request.note?.trim() || null,
        source: 'desktop',
        ageGate: 'confirmed_at_least_14',
        updatedAt: new Date().toISOString()
      }
      previewMembers = previewMembers.map((member) =>
        member.id === updated.id ? updated : member
      )
      return updated
    }
    const timestamp = new Date().toISOString()
    const member: MemberSummary = {
      id: `preview-member-${previewMembers.length + 1}`,
      memberNumber: `M${String(previewMembers.length + 1).padStart(10, '0')}`,
      phone: request.phone,
      nickname: request.nickname,
      tier: 'ordinary',
      status: 'active',
      birthdayMonth: request.birthdayMonth ?? null,
      birthdayDay: request.birthdayDay ?? null,
      birthdaySource:
        request.birthdayMonth !== undefined && request.birthdayDay !== undefined
          ? 'customer'
          : null,
      note: request.note?.trim() || null,
      source: 'desktop',
      ageGate: 'confirmed_at_least_14',
      createdAt: timestamp,
      updatedAt: timestamp
    }
    previewMembers = [member, ...previewMembers]
    return member
  },
  adjustMemberTier: async (request) => {
    const member = previewMembers.find((item) => item.id === request.memberId)
    if (!member) {
      throw new Error('Member was not found')
    }
    const updated: MemberSummary = {
      ...member,
      tier: request.tier,
      updatedAt: new Date().toISOString()
    }
    previewMembers = previewMembers.map((item) => (item.id === updated.id ? updated : item))
    return updated
  },
  correctMemberBirthday: async (request) => {
    const member = previewMembers.find((item) => item.id === request.memberId)
    if (!member) {
      throw new Error('Member was not found')
    }
    const updated: MemberSummary = {
      ...member,
      birthdayMonth: request.month,
      birthdayDay: request.day,
      birthdaySource: 'manager_correction',
      updatedAt: new Date().toISOString()
    }
    previewMembers = previewMembers.map((item) => (item.id === updated.id ? updated : item))
    return updated
  },
  disableMember: async (request) => {
    const member = previewMembers.find((item) => item.id === request.memberId)
    if (!member) {
      throw new Error('Member was not found')
    }
    const updated: MemberSummary = {
      ...member,
      status: 'disabled',
      updatedAt: new Date().toISOString()
    }
    previewMembers = previewMembers.map((item) => (item.id === updated.id ? updated : item))
    return updated
  },
  getWalletDetails: async (request) => previewWalletDetails(request.memberId),
  cashRecharge: async (request) => {
    const repeated = previewWalletOperations.get(request.requestId)
    if (repeated) return repeated
    const details = previewWalletDetails(request.memberId)
    const occurredAt = new Date().toISOString()
    const operationId = crypto.randomUUID()
    const giftFen = calculatePreviewGift(request.principalFen)
    const principalBalanceFen =
      details.wallet.principalBalanceFen + request.principalFen
    const giftBalanceFen = details.wallet.giftBalanceFen + giftFen
    const wallet = {
      ...details.wallet,
      accountId: details.wallet.accountId ?? `preview-wallet-${request.memberId}`,
      principalBalanceFen,
      giftBalanceFen,
      totalBalanceFen: principalBalanceFen + giftBalanceFen,
      updatedAt: occurredAt
    }
    const next: WalletDetails = {
      ...details,
      wallet,
      ledger: [
        {
          id: crypto.randomUUID(),
          entryType: 'cash_recharge',
          principalDeltaFen: request.principalFen,
          giftDeltaFen: giftFen,
          principalBalanceAfterFen: principalBalanceFen,
          giftBalanceAfterFen: giftBalanceFen,
          sourceId: operationId,
          reason: request.reason || '前台现金充值',
          occurredAt
        },
        ...details.ledger
      ],
      recharges: [
        {
          id: operationId,
          principalFen: request.principalFen,
          giftFen,
          remainingPrincipalFen: request.principalFen,
          remainingGiftFen: giftFen,
          status: 'completed',
          occurredAt
        },
        ...details.recharges
      ]
    }
    previewWallets.set(request.memberId, next)
    const result = {
      operationId,
      wallet,
      principalDeltaFen: request.principalFen,
      giftDeltaFen: giftFen
    }
    previewWalletOperations.set(request.requestId, result)
    return result
  },
  debitWallet: async (request) => {
    const repeated = previewWalletOperations.get(request.requestId)
    if (repeated) return repeated
    const details = previewWalletDetails(request.memberId)
    if (details.wallet.totalBalanceFen < request.amountFen) {
      throw new Error('用户余额不足')
    }
    const occurredAt = new Date().toISOString()
    const operationId = crypto.randomUUID()
    const giftUsed = Math.min(details.wallet.giftBalanceFen, request.amountFen)
    const principalUsed = request.amountFen - giftUsed
    const principalBalanceFen = details.wallet.principalBalanceFen - principalUsed
    const giftBalanceFen = details.wallet.giftBalanceFen - giftUsed
    const wallet = {
      ...details.wallet,
      principalBalanceFen,
      giftBalanceFen,
      totalBalanceFen: principalBalanceFen + giftBalanceFen,
      updatedAt: occurredAt
    }
    const next = {
      ...details,
      wallet,
      ledger: [
        {
          id: crypto.randomUUID(),
          entryType: 'consumption_debit' as const,
          principalDeltaFen: principalUsed === 0 ? 0 : -principalUsed,
          giftDeltaFen: giftUsed === 0 ? 0 : -giftUsed,
          principalBalanceAfterFen: principalBalanceFen,
          giftBalanceAfterFen: giftBalanceFen,
          sourceId: operationId,
          reason: request.reason,
          occurredAt
        },
        ...details.ledger
      ]
    }
    previewWallets.set(request.memberId, next)
    const result = {
      operationId,
      wallet,
      principalDeltaFen: principalUsed === 0 ? 0 : -principalUsed,
      giftDeltaFen: giftUsed === 0 ? 0 : -giftUsed
    }
    previewWalletOperations.set(request.requestId, result)
    return result
  },
  reverseCashRecharge: async (request) => {
    const repeated = previewWalletOperations.get(request.requestId)
    if (repeated) return repeated
    const details = [...previewWallets.values()].find((item) =>
      item.recharges.some((recharge) => recharge.id === request.rechargeId)
    )
    const recharge = details?.recharges.find((item) => item.id === request.rechargeId)
    if (!details || !recharge || recharge.status === 'reversed') {
      throw new Error('找不到可冲正的现金充值')
    }
    const occurredAt = new Date().toISOString()
    const operationId = crypto.randomUUID()
    const principalBalanceFen =
      details.wallet.principalBalanceFen - recharge.remainingPrincipalFen
    const giftBalanceFen = details.wallet.giftBalanceFen - recharge.remainingGiftFen
    const wallet = {
      ...details.wallet,
      principalBalanceFen,
      giftBalanceFen,
      totalBalanceFen: principalBalanceFen + giftBalanceFen,
      updatedAt: occurredAt
    }
    const next: WalletDetails = {
      ...details,
      wallet,
      recharges: details.recharges.map((item) =>
        item.id === recharge.id
          ? {
              ...item,
              remainingPrincipalFen: 0,
              remainingGiftFen: 0,
              status: 'reversed'
            }
          : item
      ),
      ledger: [
        {
          id: crypto.randomUUID(),
          entryType: 'cash_recharge_reversal',
          principalDeltaFen:
            recharge.remainingPrincipalFen === 0 ? 0 : -recharge.remainingPrincipalFen,
          giftDeltaFen:
            recharge.remainingGiftFen === 0 ? 0 : -recharge.remainingGiftFen,
          principalBalanceAfterFen: principalBalanceFen,
          giftBalanceAfterFen: giftBalanceFen,
          sourceId: operationId,
          reason: request.reason,
          occurredAt
        },
        ...details.ledger
      ]
    }
    previewWallets.set(details.wallet.memberId, next)
    const result = {
      operationId,
      wallet,
      principalDeltaFen:
        recharge.remainingPrincipalFen === 0 ? 0 : -recharge.remainingPrincipalFen,
      giftDeltaFen: recharge.remainingGiftFen === 0 ? 0 : -recharge.remainingGiftFen
    }
    previewWalletOperations.set(request.requestId, result)
    return result
  },
  updateRechargeGiftTiers: async (request) => {
    const nextTiers = request.tiers
      .sort((left, right) => left.principalFen - right.principalFen)
      .map((tier, index) => ({
        id: `preview-tier-${index + 1}`,
        principalFen: tier.principalFen,
        giftFen: tier.giftFen,
        active: true
      }))
    previewDefaultGiftTiers = nextTiers.map((tier) => ({ ...tier }))
    previewGiftTiers.splice(
      0,
      previewGiftTiers.length,
      ...nextTiers
    )
    for (const details of previewWallets.values()) {
      details.giftTiers = previewGiftTiers
    }
    return previewGiftTiers
  },
  getMonthlyCardDetails: async (request) => previewMonthlyCardDetails(request.memberId),
  purchaseMonthlyCard: async (request) => {
    const details = previewMonthlyCardDetails(request.memberId)
    if (details.current) throw new Error('会员已有生效或暂停中的月卡')
    const purchasedAt = new Date()
    const card: MonthlyCardSummary = {
      id: crypto.randomUUID(),
      memberId: request.memberId,
      planName: details.plan.name,
      priceFen: details.plan.priceFen,
      paymentMethod: 'cash',
      status: 'active',
      purchasedAt: purchasedAt.toISOString(),
      startsAt: purchasedAt.toISOString(),
      expiresAt: new Date(
        purchasedAt.getTime() + details.plan.durationDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      pausedAt: null,
      usageCount: 0,
      scopeType: details.plan.scopeType,
      issuingStoreId: previewStoreProfile.storeId
    }
    details.current = card
    details.history.unshift(card)
    details.events.unshift({
      id: crypto.randomUUID(),
      eventType: 'purchased',
      reason: request.reason || '前台现金购买月卡',
      occurredAt: purchasedAt.toISOString()
    })
    return card
  },
  pauseMonthlyCard: async (request) =>
    updatePreviewMonthlyCard(request.cardId, 'paused', request.reason, (card) => ({
      ...card,
      status: 'paused',
      pausedAt: new Date().toISOString()
    })),
  resumeMonthlyCard: async (request) =>
    updatePreviewMonthlyCard(request.cardId, 'resumed', request.reason, (card) => ({
      ...card,
      status: 'active',
      pausedAt: null
    })),
  useMonthlyCard: async (request) =>
    updatePreviewMonthlyCard(request.cardId, 'used', request.reason, (card) => ({
      ...card,
      usageCount: card.usageCount + 1
    })),
  refundMonthlyCard: async (request) =>
    updatePreviewMonthlyCard(request.cardId, 'refunded', request.reason, (card) => ({
      ...card,
      status: 'refunded',
      pausedAt: null
    })),
  extendMonthlyCard: async (request) =>
    updatePreviewMonthlyCard(
      request.cardId,
      'manual_extended',
      request.reason,
      (card) => {
        if (card.status === 'refunded' || card.status === 'voided') {
          throw new Error('已退款或已作废的月卡不能延长')
        }
        if (!Number.isInteger(request.days) || request.days < 1 || request.days > 365) {
          throw new Error('延长天数必须为 1-365 的整数')
        }
        const now = Date.now()
        return {
          ...card,
          status: card.status === 'expired' ? 'active' : card.status,
          expiresAt: new Date(
            Math.max(new Date(card.expiresAt).getTime(), now) +
              request.days * 24 * 60 * 60 * 1000
          ).toISOString()
        }
      }
    ),
  listCatalogItems: async () => previewCatalogItems,
  createCatalogItem: async (request) => {
    const timestamp = new Date().toISOString()
    const item: CatalogItemSummary = {
      id: crypto.randomUUID(),
      code: `C${String(previewCatalogItems.length + 1).padStart(10, '0')}`,
      name: request.name,
      itemType: request.itemType,
      regularPriceFen: request.regularPriceFen,
      advancedPriceFen: request.advancedPriceFen,
      status: 'active',
      availability: 'available',
      note: request.note?.trim() || null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    previewCatalogItems = [...previewCatalogItems, item]
    return item
  },
  updateCatalogItem: async (request) => {
    const current = previewCatalogItems.find((item) => item.id === request.itemId)
    if (!current) throw new Error('找不到收费项目')
    const updated: CatalogItemSummary = {
      ...current,
      name: request.name,
      itemType: request.itemType,
      regularPriceFen: request.regularPriceFen,
      advancedPriceFen: request.advancedPriceFen,
      note: request.note?.trim() || null,
      updatedAt: new Date().toISOString()
    }
    previewCatalogItems = previewCatalogItems.map((item) =>
      item.id === updated.id ? updated : item
    )
    return updated
  },
  setCatalogItemStatus: async (request) => {
    const current = previewCatalogItems.find((item) => item.id === request.itemId)
    if (!current) throw new Error('找不到收费项目')
    const updated = {
      ...current,
      status: request.status,
      updatedAt: new Date().toISOString()
    }
    previewCatalogItems = previewCatalogItems.map((item) =>
      item.id === updated.id ? updated : item
    )
    return updated
  },
  setCatalogAvailability: async (request) => {
    const current = previewCatalogItems.find((item) => item.id === request.itemId)
    if (!current) throw new Error('找不到收费项目')
    const updated = {
      ...current,
      availability: request.availability,
      updatedAt: new Date().toISOString()
    }
    previewCatalogItems = previewCatalogItems.map((item) =>
      item.id === updated.id ? updated : item
    )
    return updated
  },
  listActivities: async () =>
    previewActivities.map((activity) => ({
      ...activity,
      visibility: previewActivityVisibility(activity)
    })),
  createActivity: async (request) => {
    const timestamp = new Date().toISOString()
    const activity: ActivitySummary = {
      id: crypto.randomUUID(),
      ...request,
      status: 'draft',
      visibility: 'draft',
      regularPriceFen: request.regularPriceFen ?? null,
      advancedPriceFen: request.advancedPriceFen ?? null,
      rechargeTiers: request.rechargeTiers.map((tier) => ({
        id: crypto.randomUUID(),
        ...tier
      })),
      createdAt: timestamp,
      updatedAt: timestamp
    }
    previewActivities = [activity, ...previewActivities]
    return activity
  },
  updateActivity: async (request) => {
    const current = previewActivities.find(
      (activity) => activity.id === request.activityId
    )
    if (!current) throw new Error('找不到活动')
    const updated: ActivitySummary = {
      ...current,
      ...request,
      id: current.id,
      status: current.status,
      visibility: previewActivityVisibility({
        status: current.status,
        startsAt: request.startsAt,
        endsAt: request.endsAt
      }),
      regularPriceFen: request.regularPriceFen ?? null,
      advancedPriceFen: request.advancedPriceFen ?? null,
      rechargeTiers: request.rechargeTiers.map((tier) => ({
        id: crypto.randomUUID(),
        ...tier
      })),
      updatedAt: new Date().toISOString()
    }
    previewActivities = previewActivities.map((activity) =>
      activity.id === updated.id ? updated : activity
    )
    return updated
  },
  setActivityStatus: async (request) => {
    const current = previewActivities.find(
      (activity) => activity.id === request.activityId
    )
    if (!current) throw new Error('找不到活动')
    const updated: ActivitySummary = {
      ...current,
      status: request.status,
      visibility: previewActivityVisibility({
        ...current,
        status: request.status
      }),
      updatedAt: new Date().toISOString()
    }
    previewActivities = previewActivities.map((activity) =>
      activity.id === updated.id ? updated : activity
    )
    if (request.status === 'disabled' && current.activityType === 'recharge') {
      previewGiftTiers.splice(
        0,
        previewGiftTiers.length,
        ...previewDefaultGiftTiers.map((tier) => ({ ...tier }))
      )
    }
    return updated
  },
  applyActivityRechargeTiers: async (request) => {
    const activity = previewActivities.find(
      (candidate) => candidate.id === request.activityId
    )
    if (!activity || activity.activityType !== 'recharge') {
      throw new Error('找不到可应用的充值活动')
    }
    previewGiftTiers.splice(
      0,
      previewGiftTiers.length,
      ...activity.rechargeTiers.map((tier, index) => ({
        id: `preview-activity-tier-${index + 1}`,
        principalFen: tier.principalFen,
        giftFen: tier.giftFen,
        active: true
      }))
    )
    return previewGiftTiers
  },
  listAnnouncements: async () =>
    previewAnnouncements.map((announcement) => ({
      ...announcement,
      visibility: previewAnnouncementVisibility(announcement)
    })),
  createAnnouncement: async (request) => {
    const timestamp = new Date().toISOString()
    const announcement: AnnouncementSummary = {
      id: crypto.randomUUID(),
      ...request,
      visibleUntil: request.visibleUntil ?? null,
      status: 'draft',
      visibility: 'draft',
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    previewAnnouncements = [announcement, ...previewAnnouncements]
    return announcement
  },
  updateAnnouncement: async (request) => {
    const current = previewAnnouncements.find(
      (announcement) => announcement.id === request.announcementId
    )
    if (!current) throw new Error('找不到公告')
    const updated: AnnouncementSummary = {
      ...current,
      title: request.title,
      content: request.content,
      pinned: request.pinned,
      visibleFrom: request.visibleFrom,
      visibleUntil: request.visibleUntil ?? null,
      visibility: previewAnnouncementVisibility({
        status: current.status,
        visibleFrom: request.visibleFrom,
        visibleUntil: request.visibleUntil ?? null
      }),
      updatedAt: new Date().toISOString()
    }
    previewAnnouncements = previewAnnouncements.map((announcement) =>
      announcement.id === updated.id ? updated : announcement
    )
    return updated
  },
  setAnnouncementStatus: async (request) => {
    const current = previewAnnouncements.find(
      (announcement) => announcement.id === request.announcementId
    )
    if (!current) throw new Error('找不到公告')
    const updated: AnnouncementSummary = {
      ...current,
      status: request.status,
      visibility: previewAnnouncementVisibility({
        ...current,
        status: request.status
      }),
      publishedAt:
        request.status === 'published'
          ? new Date().toISOString()
          : current.publishedAt,
      updatedAt: new Date().toISOString()
    }
    previewAnnouncements = previewAnnouncements.map((announcement) =>
      announcement.id === updated.id ? updated : announcement
    )
    return updated
  },
  listBoardGames: async () => previewBoardGames,
  getBoardGameMetadataStatus: async () => ({
    source: 'bgg',
    enabled: false,
    imagesEnabled: false
  }),
  searchBoardGameMetadata: async () => {
    throw new Error('预览模式未连接 BGG 资料服务')
  },
  getBoardGameMetadataDetails: async () => {
    throw new Error('预览模式未连接 BGG 资料服务')
  },
  createBoardGame: async (request) => {
    const timestamp = new Date().toISOString()
    const game: BoardGameSummary = {
      id: crypto.randomUUID(),
      ...request,
      minMinutes: request.minMinutes ?? null,
      maxMinutes: request.maxMinutes ?? null,
      difficulty:
        request.complexityRating === undefined || request.complexityRating <= 2
          ? 'light'
          : request.complexityRating <= 3.5
            ? 'medium'
            : 'heavy',
      complexityRating: request.complexityRating ?? null,
      recordStatus: 'active',
      imageUrl: request.imageUrl ?? null,
      localImagePath: request.localImagePath ?? null,
      bggId: request.bggId ?? null,
      metadataSource: request.metadataSource ?? null,
      metadataImportedAt: request.metadataImportedAt ?? null,
      customerNote: request.customerNote ?? null,
      internalNote: request.internalNote ?? null,
      consignorNickname: request.consignorNickname ?? null,
      missingParts: request.missingParts.map((part) => ({
        id: crypto.randomUUID(),
        ...part
      })),
      createdAt: timestamp,
      updatedAt: timestamp
    }
    previewBoardGames = [game, ...previewBoardGames]
    return game
  },
  updateBoardGame: async (request) => {
    const current = previewBoardGames.find(
      (game) => game.id === request.boardGameId
    )
    if (!current) throw new Error('找不到桌游')
    const updated: BoardGameSummary = {
      ...current,
      ...request,
      id: current.id,
      recordStatus: current.recordStatus,
      minMinutes: request.minMinutes ?? null,
      maxMinutes: request.maxMinutes ?? null,
      difficulty:
        request.complexityRating === undefined || request.complexityRating <= 2
          ? 'light'
          : request.complexityRating <= 3.5
            ? 'medium'
            : 'heavy',
      complexityRating: request.complexityRating ?? null,
      imageUrl: request.imageUrl ?? null,
      localImagePath: request.localImagePath ?? null,
      bggId: request.bggId ?? null,
      metadataSource: request.metadataSource ?? null,
      metadataImportedAt: request.metadataImportedAt ?? null,
      customerNote: request.customerNote ?? null,
      internalNote: request.internalNote ?? null,
      consignorNickname: request.consignorNickname ?? null,
      missingParts: request.missingParts.map((part) => ({
        id: crypto.randomUUID(),
        ...part
      })),
      updatedAt: new Date().toISOString()
    }
    previewBoardGames = previewBoardGames.map((game) =>
      game.id === updated.id ? updated : game
    )
    return updated
  },
  updateBoardGameOperations: async (request) => {
    const current = previewBoardGames.find(
      (game) => game.id === request.boardGameId
    )
    if (!current) throw new Error('找不到桌游')
    const updated: BoardGameSummary = {
      ...current,
      available: request.available,
      customerConsigned: request.customerConsigned,
      missingPieces: request.missingPieces,
      private: request.private,
      customerNote: request.customerNote ?? null,
      internalNote: request.internalNote ?? null,
      consignorNickname: request.consignorNickname ?? null,
      missingParts: request.missingParts.map((part) => ({
        id: crypto.randomUUID(),
        ...part
      })),
      updatedAt: new Date().toISOString()
    }
    previewBoardGames = previewBoardGames.map((game) =>
      game.id === updated.id ? updated : game
    )
    return updated
  },
  setBoardGameRecordStatus: async (request) => {
    const current = previewBoardGames.find(
      (game) => game.id === request.boardGameId
    )
    if (!current) throw new Error('找不到桌游')
    const updated = {
      ...current,
      recordStatus: request.status,
      updatedAt: new Date().toISOString()
    }
    previewBoardGames = previewBoardGames.map((game) =>
      game.id === updated.id ? updated : game
    )
    return updated
  },
  importBoardGameImage: async () => ({
    canceled: true,
    managedPath: null,
    previewDataUrl: null
  }),
  readBoardGameImage: async () => null,
  createSalesOrder: async (request) => {
    const repeated = previewOrders.find((order) => order.id === request.requestId)
    if (repeated) return repeated
    const member = request.customerMemberId
      ? previewMembers.find((item) => item.id === request.customerMemberId)
      : null
    const visitBatchId = crypto.randomUUID()
    const completedAt = new Date().toISOString()
    const items = request.lines.map((line) => {
      const custom = 'customName' in line
      const catalog = custom
        ? {
            id: `custom-${crypto.randomUUID()}`,
            name: line.customName,
            itemType: 'service' as const,
            regularPriceFen: line.customUnitPriceFen,
            advancedPriceFen: line.customUnitPriceFen,
            status: 'active' as const,
            availability: 'available' as const
          }
        : previewCatalogItems.find((item) => item.id === line.catalogItemId)
      if (!catalog || catalog.status !== 'active' || catalog.availability !== 'available') {
        throw new Error('收费项目不存在、已停用或已售罄')
      }
      let pricingTier = line.pricingTier
      let benefitType: OrderBenefitType = 'none'
      const personalAdmissionBenefit =
        'personalAdmissionBenefit' in line && line.personalAdmissionBenefit === true
      if (personalAdmissionBenefit) {
        if (!member || catalog.itemType !== 'admission' || line.quantity !== 1) {
          throw new Error('本人入场权益需要选择会员和一份入场费')
        }
        pricingTier = member.tier === 'advanced' ? 'advanced' : 'regular'
        const businessDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai'
        }).format(new Date(completedAt))
        const repeatedAdmission = previewOrders.some(
          (order) =>
            new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Shanghai'
            }).format(new Date(order.completedAt)) === businessDate &&
            order.customerMemberId === member.id &&
            order.items.some((item) => item.beneficiaryMemberId === member.id)
        )
        const monthlyCard = previewMonthlyCardDetails(member.id).current
        benefitType = repeatedAdmission
          ? 'repeat_admission'
          : monthlyCard?.status === 'active'
            ? 'monthly_card'
            : 'none'
      }
      const regularPriceFen = catalog.regularPriceFen
      const advancedPriceFen = catalog.advancedPriceFen
      const appliedUnitPriceFen =
        benefitType === 'none'
          ? pricingTier === 'advanced'
            ? advancedPriceFen
            : regularPriceFen
          : 0
      return {
        id: crypto.randomUUID(),
        catalogItemId: catalog.id,
        itemName: catalog.name,
        itemType: catalog.itemType,
        regularPriceFen,
        advancedPriceFen,
        appliedUnitPriceFen,
        pricingTier,
        quantity: line.quantity,
        lineTotalFen: appliedUnitPriceFen * line.quantity,
        benefitType,
        beneficiaryMemberId: personalAdmissionBenefit ? (member?.id ?? null) : null
      }
    })
    const totalFen = items.reduce((sum, item) => sum + item.lineTotalFen, 0)
    if (request.paymentMethod === 'stored_value') {
      if (!request.walletMemberId) throw new Error('储值支付需要选择会员')
      if (totalFen > 0) {
        await previewApi.debitWallet({
          requestId: `${request.requestId}:wallet`,
          memberId: request.walletMemberId,
          amountFen: totalFen,
          reason: '预览订单储值支付'
        })
      }
    }
    const order: SalesOrderSummary = {
      id: request.requestId,
      orderNumber: `O${completedAt.slice(0, 10).replaceAll('-', '')}-${request.requestId
        .replaceAll('-', '')
        .slice(0, 8)
        .toUpperCase()}`,
      visitBatchId,
      customerMemberId: request.customerMemberId ?? null,
      paymentMethod: request.paymentMethod,
      walletMemberId: request.walletMemberId ?? null,
      memberNickname:
        previewMembers.find(
          (member) =>
            member.id === (request.walletMemberId ?? request.customerMemberId)
        )?.nickname ?? null,
      status: 'completed',
      totalFen,
      note: request.note?.trim() || null,
      completedAt,
      items
    }
    previewOrders = [order, ...previewOrders]
    return order
  },
  listRecentOrders: async (request) => previewOrders.slice(0, request?.limit ?? 20),
  refreshCashierData: async () => undefined,
  listSalesTransactions: async (request) => {
    const query = request?.query?.trim().toLocaleLowerCase() ?? ''
    const from = request?.from ? new Date(request.from).getTime() : Number.NEGATIVE_INFINITY
    const to = request?.to
      ? new Date(`${request.to}${/^\d{4}-\d{2}-\d{2}$/.test(request.to) ? 'T23:59:59.999+08:00' : ''}`).getTime()
      : Number.POSITIVE_INFINITY
    return previewOrders
      .filter((order) => {
        const completedAt = new Date(order.completedAt).getTime()
        return (
          completedAt >= from &&
          completedAt <= to &&
          (!query ||
            order.orderNumber.toLocaleLowerCase().includes(query) ||
            order.memberNickname?.toLocaleLowerCase().includes(query))
        )
      })
      .slice(0, request?.limit ?? 100)
  },
  listRechargeTransactions: async () => [],
  findRefundableOrder: async (request) => previewRefundableOrder(request.query),
  createRefundRequest: async (request) =>
    createPreviewRefund(
      request.requestId,
      request.orderId,
      request.items,
      request.reason
    ),
  approveRefund: async (request) =>
    completePreviewRefund(
      request.refundId,
      request.specialProductOverride === true,
      request.reason
    ),
  rejectRefund: async (request) => {
    const refund = previewRefunds.find((candidate) => candidate.id === request.refundId)
    if (!refund || refund.status !== 'pending') throw new Error('找不到待审批退款')
    const timestamp = new Date().toISOString()
    const rejected: RefundSummary = {
      ...refund,
      status: 'rejected',
      rejectedBy: previewManager.id,
      rejectedAt: timestamp,
      rejectionReason: request.reason
    }
    previewRefunds = previewRefunds.map((candidate) =>
      candidate.id === rejected.id ? rejected : candidate
    )
    return rejected
  },
  directRefund: async (request) => {
    const pending = createPreviewRefund(
      request.requestId,
      request.orderId,
      request.items,
      request.reason
    )
    return completePreviewRefund(
      pending.id,
      request.specialProductOverride === true,
      request.reason
    )
  },
  listRefunds: async (request) =>
    previewRefunds
      .filter((refund) => !request?.status || refund.status === request.status)
      .slice(0, request?.limit ?? 50),
  exportRefundEvidence: async (request) => {
    const refund = previewRefunds.find((candidate) => candidate.id === request.refundId)
    if (!refund || refund.status !== 'completed') {
      throw new Error('只有已完成退款可以导出凭证')
    }
    const evidence = {
      id: request.requestId,
      evidenceType: request.evidenceType,
      fileName: `${refund.refundNumber}-退款凭证.${
        request.evidenceType === 'pdf' ? 'pdf' : 'xls'
      }`,
      fileSha256: '0'.repeat(64),
      generatedBy: previewManager.id,
      generatedAt: new Date().toISOString()
    }
    const updated = { ...refund, evidence: [evidence, ...refund.evidence] }
    previewRefunds = previewRefunds.map((candidate) =>
      candidate.id === updated.id ? updated : candidate
    )
    return {
      canceled: false,
      filePath: `浏览器预览/${evidence.fileName}`,
      evidence
    }
  },
  createFinancialRefundRequest: async (request) =>
    createPreviewFinancialRefund(
      request.requestId,
      request.targetType,
      request.targetId,
      request.reason
    ),
  approveFinancialRefund: async (request) =>
    completePreviewFinancialRefund(
      request.financialRefundId,
      request.specialOverride === true,
      request.reason
    ),
  rejectFinancialRefund: async (request) => {
    const financialRefund = previewFinancialRefunds.find(
      (candidate) => candidate.id === request.financialRefundId
    )
    if (!financialRefund || financialRefund.status !== 'pending') {
      throw new Error('找不到待审批退款')
    }
    const timestamp = new Date().toISOString()
    const rejected: FinancialRefundSummary = {
      ...financialRefund,
      status: 'rejected',
      rejectedBy: previewManager.id,
      rejectedAt: timestamp,
      rejectionReason: request.reason
    }
    previewFinancialRefunds = previewFinancialRefunds.map((candidate) =>
      candidate.id === rejected.id ? rejected : candidate
    )
    return rejected
  },
  directFinancialRefund: async (request) => {
    const pending = createPreviewFinancialRefund(
      request.requestId,
      request.targetType,
      request.targetId,
      request.reason
    )
    return completePreviewFinancialRefund(
      pending.id,
      request.specialOverride === true,
      request.reason
    )
  },
  listFinancialRefunds: async (request) =>
    previewFinancialRefunds
      .filter((refund) => !request?.status || refund.status === request.status)
      .slice(0, request?.limit ?? 50),
  getBusinessReport: async (request) => previewBusinessReport(request),
  exportBusinessReportExcel: async () => ({
    canceled: true,
    filePath: null
  })
}

export function getDesktopApi(): DesktopApi {
  if (window.zyapp) {
    return window.zyapp
  }

  if (import.meta.env.DEV) {
    return previewApi
  }

  throw new Error('Desktop bridge is unavailable')
}

export function readableError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
}
