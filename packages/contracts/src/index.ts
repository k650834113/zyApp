export type Identifier = string

export type DataEnvironment = 'production' | 'test'

export type ModuleCapability = {
  desktop: boolean
  offline: boolean
  cloud: boolean
  miniapp: boolean
}

export type ModuleManifest = {
  id: string
  version: string
  dependencies: string[]
  permissions: string[]
  capabilities: ModuleCapability
}

export type SystemStatus = {
  appVersion: string
  dataEnvironment: DataEnvironment
  activeStoreProfileId: Identifier
  databasePath: string
  sqliteVersion: string
  schemaVersion: number
  journalMode: string
  modules: ModuleManifest[]
}

export type RelocateDatabaseResult = {
  canceled: boolean
  databasePath: string
  previousDatabasePath: string | null
  backupPath: string | null
  oldDatabaseRetained: boolean
}

export type BackupKind =
  | 'automatic'
  | 'manual'
  | 'pre_restore'
  | 'pre_upgrade'
  | 'pre_import'
  | 'pre_move'
  | 'pre_environment_switch'
  | 'unknown'

export type SwitchDataEnvironmentRequest = {
  environment: DataEnvironment
}

export type StoreConfigurationSummary = {
  profileId: Identifier
  environment: DataEnvironment
  tenantId: Identifier | null
  storeId: Identifier | null
  storeName: string
  deviceId: Identifier | null
  initialized: boolean
  active: boolean
}

export type SwitchStoreProfileRequest = {
  profileId: Identifier
}

export type BackupFileSummary = {
  fileName: string
  filePath: string
  kind: BackupKind
  createdAt: string
  sizeBytes: number
  sha256: string
  schemaVersion: number
  integrityOk: boolean
  secondaryCopy: boolean
}

export type BackupSettings = {
  primaryDirectory: string
  secondaryDirectory: string | null
}

export type BackupOverview = {
  settings: BackupSettings
  backups: BackupFileSummary[]
}

export type CreateBackupRequest = {
  requestId: Identifier
}

export type CreateBackupResult = {
  backup: BackupFileSummary
  secondaryPath: string | null
  secondaryError: string | null
}

export type SetSecondaryBackupDirectoryResult = {
  canceled: boolean
  settings: BackupSettings
}

export type RestoreDatabaseRequest = {
  requestId: Identifier
}

export type RestoreDatabaseResult = {
  canceled: boolean
  restoredFromPath: string | null
  protectionBackupPath: string | null
  schemaVersion: number | null
}

export type ExportDiagnosticsResult = {
  canceled: boolean
  filePath: string | null
  sha256: string | null
}

export type LegacyMemberConflictField =
  | 'nickname'
  | 'birthday'
  | 'balance'
  | 'monthly_card'

export type LegacyMemberImportCandidate = {
  legacyId: Identifier
  phone: string
  legacyNickname: string
  legacyBirthday: string | null
  legacyTier: MemberTier
  legacyBalanceFen: number
  legacyMonthlyCardStatus: 'active' | 'expired' | null
  currentMemberId: Identifier
  currentNickname: string
  currentBirthday: string | null
  currentTier: MemberTier
  currentBalanceFen: number
  currentMonthlyCardStatus: MonthlyCardStatus | null
  conflicts: LegacyMemberConflictField[]
}

export type LegacyCatalogImportConflict = {
  legacyId: Identifier
  legacyName: string
  legacyRegularPriceFen: number
  legacyAdvancedPriceFen: number
  currentItemId: Identifier
  currentName: string
  currentRegularPriceFen: number
  currentAdvancedPriceFen: number
}

export type LegacyImportSummary = {
  members: number
  transactions: number
  activityLogs: number
  quickDeductItems: number
  storedBalanceFen: number
  activeMonthlyCards: number
  expiredMonthlyCards: number
  newMembers: number
  matchedMembers: number
  memberConflicts: number
  catalogConflicts: number
  reconciliationIssues: number
}

export type LegacyImportPreflightResult =
  | {
      canceled: true
    }
  | {
      canceled: false
      token: Identifier
      sourceName: string
      sourceSha256: string
      sourceSizeBytes: number
      alreadyImported: boolean
      summary: LegacyImportSummary
      memberConflicts: LegacyMemberImportCandidate[]
      catalogConflicts: LegacyCatalogImportConflict[]
      warnings: string[]
      assumptions: string[]
    }

export type LegacyMemberImportResolution = {
  legacyId: Identifier
  nickname: 'keep_current' | 'use_legacy'
  birthday: 'keep_current' | 'use_legacy'
  balance: 'keep_current' | 'add_legacy'
  monthlyCard: 'keep_current' | 'use_legacy'
}

export type LegacyCatalogImportResolution = {
  legacyId: Identifier
  choice: 'keep_current' | 'import_as_new'
}

export type ExecuteLegacyImportRequest = {
  token: Identifier
  memberResolutions: LegacyMemberImportResolution[]
  catalogResolutions: LegacyCatalogImportResolution[]
}

export type LegacyImportResult = {
  batchId: Identifier
  backupPath: string
  importedAt: string
  summary: LegacyImportSummary
  importedMembers: number
  mergedMembers: number
  openingBalanceFen: number
  importedFinancialHistory: number
  importedMonthlyCards: number
  importedCatalogItems: number
}

export type EmployeeRole = 'manager' | 'staff'
export type EmployeeStatus = 'active' | 'disabled'

export type SessionUser = {
  id: Identifier
  username: string
  displayName: string
  role: EmployeeRole
  permissions: string[]
  storeId: Identifier
  storeName: string
  authenticationMode?: 'local' | 'cloud_online' | 'cloud_offline'
  offlineValidUntil?: string | null
}

export type EmployeeSummary = {
  id: Identifier
  username: string
  displayName: string
  role: EmployeeRole
  status: EmployeeStatus
  mobileAccessEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type ApplicationState = {
  initialized: boolean
  session: SessionUser | null
  system: SystemStatus
}

export type BootstrapStoreRequest = {
  storeName: string
  deviceName: string
  managerUsername: string
  managerDisplayName: string
  managerPassword: string
}

export type LoginRequest = {
  username: string
  password: string
  rememberPassword?: boolean
}

export type DesktopCloudLoginRequest = {
  username: string
  password: string
}

export type DesktopCloudLoginResult = {
  employee: {
    id: Identifier
    username: string
    displayName: string
    role: EmployeeRole
    status: EmployeeStatus
  }
  tenantId: Identifier
  storeId: Identifier
  deviceId: Identifier
  credentialVersion: number
  authorizationVersion: number
  serverTime: string
  offlineValidUntil: string
}

export type SavedLoginCredentials = {
  username: string
  password: string
}

export type CreateEmployeeRequest = {
  username: string
  displayName: string
  password: string
  role: EmployeeRole
}

export type SetEmployeeStatusRequest = {
  employeeId: Identifier
  status: EmployeeStatus
  reason: string
}

export type ResetEmployeePasswordRequest = {
  employeeId: Identifier
  newPassword: string
  reason: string
}

export type ConfigureEmployeeMobileAccessRequest = {
  employeeId: Identifier
  enabled: boolean
  newPassword?: string
  reason: string
}

export type MemberTier = 'ordinary' | 'advanced'
export type MemberStatus = 'active' | 'disabled'
export type MemberAgeGate =
  | 'confirmed_at_least_14'
  | 'under_14_verified'
  | 'recharge_disabled'

export type MemberSummary = {
  id: Identifier
  memberNumber: string
  phone: string
  nickname: string
  tier: MemberTier
  status: MemberStatus
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdaySource: 'customer' | 'manager_correction' | 'legacy' | null
  note: string | null
  source: 'desktop' | 'miniapp' | 'legacy'
  ageGate: MemberAgeGate
  createdAt: string
  updatedAt: string
}

export type SearchMembersRequest = {
  query: string
  limit?: number
}

export type CashierMemberOption = MemberSummary & {
  lastActiveAt: string | null
}

export type CreateMemberRequest = {
  phone: string
  nickname: string
  confirmedAtLeast14: boolean
  birthdayMonth?: number
  birthdayDay?: number
  note?: string
}

export type AdjustMemberTierRequest = {
  memberId: Identifier
  tier: MemberTier
  reason: string
}

export type CorrectMemberBirthdayRequest = {
  memberId: Identifier
  month: number
  day: number
  reason: string
}

export type DisableMemberRequest = {
  memberId: Identifier
  reason: string
}

export type WalletStatus = 'active' | 'frozen'

export type WalletSummary = {
  accountId: Identifier | null
  memberId: Identifier
  principalBalanceFen: number
  giftBalanceFen: number
  totalBalanceFen: number
  status: WalletStatus
  updatedAt: string | null
}

export type RechargeGiftTierSummary = {
  id: Identifier
  principalFen: number
  giftFen: number
  active: boolean
  sourceTemplateId?: Identifier | null
}

export type WalletLedgerEntry = {
  id: Identifier
  entryType:
    | 'cash_recharge'
    | 'wechat_recharge'
    | 'consumption_debit'
    | 'cash_recharge_reversal'
    | 'order_refund_credit'
    | 'manual_adjustment'
    | 'legacy_opening'
  principalDeltaFen: number
  giftDeltaFen: number
  principalBalanceAfterFen: number
  giftBalanceAfterFen: number
  sourceId: Identifier
  reason: string
  occurredAt: string
}

export type WalletRechargeSummary = {
  id: Identifier
  principalFen: number
  giftFen: number
  remainingPrincipalFen: number
  remainingGiftFen: number
  status: 'completed' | 'partially_consumed' | 'reversed'
  occurredAt: string
}

export type LegacyFinancialHistorySummary = {
  id: Identifier
  sourceTable: 'transactions' | 'activity_logs'
  eventType: string
  amountFen: number | null
  description: string | null
  occurredAtRaw: string | null
  occurredAtNormalized: string | null
}

export type WalletDetails = {
  wallet: WalletSummary
  giftTiers: RechargeGiftTierSummary[]
  ledger: WalletLedgerEntry[]
  recharges: WalletRechargeSummary[]
  legacyHistory: LegacyFinancialHistorySummary[]
}

export type GetWalletDetailsRequest = {
  memberId: Identifier
}

export type CashRechargeRequest = {
  requestId: Identifier
  memberId: Identifier
  principalFen: number
  reason?: string
}

export type WalletDebitRequest = {
  requestId: Identifier
  memberId: Identifier
  amountFen: number
  reason: string
}

export type ReverseCashRechargeRequest = {
  requestId: Identifier
  rechargeId: Identifier
  reason: string
}

export type UpdateRechargeGiftTiersRequest = {
  tiers: Array<{
    principalFen: number
    giftFen: number
  }>
  reason: string
}

export type WalletOperationResult = {
  operationId: Identifier
  wallet: WalletSummary
  principalDeltaFen: number
  giftDeltaFen: number
}

export type MonthlyCardScopeType = 'tenant' | 'store'

export type BusinessTemplateType =
  | 'recharge_gift_tier'
  | 'monthly_card_plan'
  | 'activity'

export type BusinessTemplateSummary = {
  id: Identifier
  templateType: BusinessTemplateType
  name: string
  payload: Record<string, unknown>
  active: boolean
  overridePayload: Record<string, unknown> | null
  overrideActive: boolean | null
  updatedAt: string
}

export type SaveBusinessTemplateRequest = {
  requestId: Identifier
  id: Identifier
  templateType: BusinessTemplateType
  name: string
  payload: Record<string, unknown>
  active: boolean
}

export type SaveBusinessTemplateOverrideRequest = {
  requestId: Identifier
  templateId: Identifier
  payload: Record<string, unknown>
  active: boolean
}

export type MonthlyCardStatus = 'active' | 'paused' | 'expired' | 'refunded' | 'voided'

export type MonthlyCardPlanSummary = {
  id: Identifier
  name: string
  priceFen: number
  durationDays: number
  active: boolean
  scopeType: MonthlyCardScopeType
  sourceTemplateId: Identifier | null
}

export type MonthlyCardSummary = {
  id: Identifier
  memberId: Identifier
  planName: string
  priceFen: number
  paymentMethod: 'cash' | 'wechat'
  status: MonthlyCardStatus
  purchasedAt: string
  startsAt: string
  expiresAt: string
  pausedAt: string | null
  usageCount: number
  scopeType: MonthlyCardScopeType
  issuingStoreId: Identifier
}

export type MonthlyCardEventSummary = {
  id: Identifier
  eventType:
    | 'purchased'
    | 'paused'
    | 'resumed'
    | 'used'
    | 'refunded'
    | 'expired'
    | 'manual_extended'
  reason: string
  occurredAt: string
}

export type MonthlyCardDetails = {
  plan: MonthlyCardPlanSummary
  current: MonthlyCardSummary | null
  history: MonthlyCardSummary[]
  events: MonthlyCardEventSummary[]
  legacyHistory: LegacyMonthlyCardHistorySummary[]
}

export type LegacyMonthlyCardHistorySummary = {
  id: Identifier
  planName: string
  startsAt: string
  expiresAt: string
  status: 'active' | 'expired'
  operationalCardId: Identifier | null
}

export type GetMonthlyCardDetailsRequest = {
  memberId: Identifier
}

export type PurchaseMonthlyCardRequest = {
  requestId: Identifier
  memberId: Identifier
  reason?: string
}

export type MonthlyCardActionRequest = {
  requestId: Identifier
  cardId: Identifier
  reason: string
}

export type MonthlyCardUseRequest = {
  requestId: Identifier
  cardId: Identifier
  reason: string
}

export type ExtendMonthlyCardRequest = {
  requestId: Identifier
  cardId: Identifier
  days: number
  reason: string
}

export type CatalogItemType = 'admission' | 'product' | 'service' | 'activity'
export type CatalogItemStatus = 'active' | 'disabled'
export type CatalogAvailability = 'available' | 'sold_out'

export type CatalogItemSummary = {
  id: Identifier
  code: string
  name: string
  itemType: CatalogItemType
  regularPriceFen: number
  advancedPriceFen: number
  status: CatalogItemStatus
  availability: CatalogAvailability
  note: string | null
  createdAt: string
  updatedAt: string
}

export type CreateCatalogItemRequest = {
  name: string
  itemType: CatalogItemType
  regularPriceFen: number
  advancedPriceFen: number
  note?: string
}

export type UpdateCatalogItemRequest = {
  itemId: Identifier
  name: string
  itemType: CatalogItemType
  regularPriceFen: number
  advancedPriceFen: number
  note?: string
  reason: string
}

export type SetCatalogItemStatusRequest = {
  itemId: Identifier
  status: CatalogItemStatus
  reason: string
}

export type SetCatalogAvailabilityRequest = {
  itemId: Identifier
  availability: CatalogAvailability
  reason: string
}

export type ActivityType = 'recharge' | 'general'
export type ActivityStatus = 'draft' | 'published' | 'disabled'
export type ActivityVisibility =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'ended'
  | 'disabled'

export type ActivityRechargeTier = {
  id: Identifier
  principalFen: number
  giftFen: number
}

export type ActivitySummary = {
  id: Identifier
  title: string
  summary: string
  content: string
  activityType: ActivityType
  status: ActivityStatus
  visibility: ActivityVisibility
  startsAt: string
  endsAt: string
  pinned: boolean
  regularPriceFen: number | null
  advancedPriceFen: number | null
  allowStoredValue: boolean
  allowWechat: boolean
  rechargeTiers: ActivityRechargeTier[]
  createdAt: string
  updatedAt: string
}

export type SaveActivityFields = {
  title: string
  summary: string
  content: string
  activityType: ActivityType
  startsAt: string
  endsAt: string
  pinned: boolean
  regularPriceFen?: number
  advancedPriceFen?: number
  allowStoredValue: boolean
  allowWechat: boolean
  rechargeTiers: Array<{
    principalFen: number
    giftFen: number
  }>
}

export type CreateActivityRequest = SaveActivityFields

export type UpdateActivityRequest = SaveActivityFields & {
  activityId: Identifier
  reason: string
}

export type SetActivityStatusRequest = {
  activityId: Identifier
  status: 'published' | 'disabled'
  reason: string
}

export type AnnouncementStatus = 'draft' | 'published' | 'disabled'
export type AnnouncementVisibility =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'ended'
  | 'disabled'

export type AnnouncementSummary = {
  id: Identifier
  title: string
  content: string
  status: AnnouncementStatus
  visibility: AnnouncementVisibility
  pinned: boolean
  visibleFrom: string
  visibleUntil: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SaveAnnouncementFields = {
  title: string
  content: string
  pinned: boolean
  visibleFrom: string
  visibleUntil?: string
}

export type CreateAnnouncementRequest = SaveAnnouncementFields

export type UpdateAnnouncementRequest = SaveAnnouncementFields & {
  announcementId: Identifier
  reason: string
}

export type SetAnnouncementStatusRequest = {
  announcementId: Identifier
  status: 'published' | 'disabled'
  reason: string
}

export type BoardGameDifficulty = 'light' | 'medium' | 'heavy'
export type BoardGameRecordStatus = 'active' | 'disabled'
export type BoardGameMetadataSource = 'bgg'
export type BoardGameCoverSource =
  | 'none'
  | 'bgg'
  | 'local'
  | 'external'
  | 'cached'

export type BoardGameMetadataAvailability = {
  source: BoardGameMetadataSource
  enabled: boolean
  imagesEnabled: boolean
}

export type BoardGameMetadataCandidate = {
  source: BoardGameMetadataSource
  externalId: string
  primaryName: string
  alternateNames: string[]
  yearPublished: number | null
}

export type BoardGameMetadataDetails = BoardGameMetadataCandidate & {
  minPlayers: number
  maxPlayers: number
  minMinutes: number | null
  maxMinutes: number | null
  complexityRating: number | null
  categories: string[]
  mechanics: string[]
  thumbnailUrl: string | null
  imageUrl: string | null
  sourceUrl: string
  fetchedAt: string
}

export type BoardGameMetadataDetailsRequest = {
  source: BoardGameMetadataSource
  externalId: string
}

export type CacheBoardGameCoverResult = {
  source: 'bgg'
  externalId: string
  cachedUrl: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
}

export type BoardGameMissingPart = {
  id: Identifier
  name: string
  quantity: number
}

export type BoardGameSummary = {
  id: Identifier
  baseGameId: Identifier | null
  name: string
  introduction: string
  categories: string[]
  minPlayers: number
  maxPlayers: number
  minMinutes: number | null
  maxMinutes: number | null
  difficulty: BoardGameDifficulty
  complexityRating: number | null
  quantity: number
  recordStatus: BoardGameRecordStatus
  available: boolean
  customerConsigned: boolean
  missingPieces: boolean
  private: boolean
  recommended: boolean
  imageUrl: string | null
  localImagePath: string | null
  bggId: number | null
  metadataSource: BoardGameMetadataSource | null
  metadataImportedAt: string | null
  customerNote: string | null
  internalNote: string | null
  consignorNickname: string | null
  missingParts: BoardGameMissingPart[]
  createdAt: string
  updatedAt: string
}

export type SaveBoardGameFields = {
  baseGameId?: Identifier
  name: string
  introduction: string
  categories: string[]
  minPlayers: number
  maxPlayers: number
  minMinutes?: number
  maxMinutes?: number
  complexityRating?: number
  quantity: number
  available: boolean
  customerConsigned: boolean
  missingPieces: boolean
  private: boolean
  recommended: boolean
  imageUrl?: string
  localImagePath?: string
  bggId?: number
  metadataSource?: BoardGameMetadataSource
  metadataImportedAt?: string
  customerNote?: string
  internalNote?: string
  consignorNickname?: string
  missingParts: Array<{
    name: string
    quantity: number
  }>
}

export type CreateBoardGameRequest = SaveBoardGameFields & {
  coverSource?: BoardGameCoverSource
}

export type UpdateBoardGameRequest = SaveBoardGameFields & {
  boardGameId: Identifier
  reason: string
  coverSource?: BoardGameCoverSource
}

export type UpdateBoardGameOperationsRequest = {
  boardGameId: Identifier
  available: boolean
  customerConsigned: boolean
  missingPieces: boolean
  private: boolean
  customerNote?: string
  internalNote?: string
  consignorNickname?: string
  missingParts: Array<{
    name: string
    quantity: number
  }>
  reason: string
}

export type SetBoardGameRecordStatusRequest = {
  boardGameId: Identifier
  status: BoardGameRecordStatus
  reason: string
}

export type ImportBoardGameImageResult = {
  canceled: boolean
  managedPath: string | null
  previewDataUrl: string | null
}

export type ReadBoardGameImageRequest = {
  managedPath: string
}

export type MiniappIdentity =
  | { role: 'guest' }
  | {
      role: 'member'
      memberId: Identifier
      nickname: string
      phoneMasked: string
      tier: MemberTier
    }
  | {
      role: 'staff' | 'manager'
      employeeId: Identifier
      displayName: string
      permissions: string[]
    }

export type MiniappDevelopmentSessionRequest = {
  storeId: Identifier
  providerSubject: string
}

export type MiniappWechatSessionRequest = {
  storeId: Identifier
  loginCode: string
}

export type MiniappSessionResult = {
  accessToken: string
  expiresAt: string
  identity: MiniappIdentity
}

export type EmployeeMobileMemberSummary = {
  memberId: Identifier
  memberNumber: string
  phone: string
  nickname: string
  tier: MemberTier
  status: MemberStatus
  birthdayMonth: number | null
  birthdayDay: number | null
  note: string | null
  ageGate: MemberAgeGate
  principalBalanceFen: number
  giftBalanceFen: number
  totalBalanceFen: number
  monthlyCardStatus: 'none' | 'active' | 'paused'
  monthlyCardId: Identifier | null
  monthlyCardPlanName: string | null
  monthlyCardPriceFen: number | null
  monthlyCardExpiresAt: string | null
  updatedAt: string
}

export type EmployeeMobileCreateMemberRequest = {
  requestId: string
  phone: string
  nickname: string
  note?: string
}

export type EmployeeMobileCreateActivityRequest = SaveActivityFields & {
  requestId: string
}

export type EmployeeMobileUpdateActivityRequest = SaveActivityFields & {
  requestId: string
  activityId: Identifier
  reason: string
}

export type EmployeeMobileSetActivityStatusRequest = {
  requestId: string
  activityId: Identifier
  status: 'published' | 'disabled'
  reason: string
}

export type EmployeeMobileCreateAnnouncementRequest =
  SaveAnnouncementFields & {
    requestId: string
  }

export type EmployeeMobileUpdateAnnouncementRequest =
  SaveAnnouncementFields & {
    requestId: string
    announcementId: Identifier
    reason: string
  }

export type EmployeeMobileSetAnnouncementStatusRequest = {
  requestId: string
  announcementId: Identifier
  status: 'published' | 'disabled'
  reason: string
}

export type EmployeeMobileUpdateBoardGameOperationsRequest =
  UpdateBoardGameOperationsRequest & {
    requestId: string
  }

export type EmployeeMobileUpdateStoreStatusRequest = {
  requestId: string
  statusOverride: StoreBusinessStatusOverride
  customStatusText?: string
  reason: string
}

export type CashierCommandStatus =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'canceled'

export type EmployeeMobileCreateCashierCommandRequest =
  CreateSalesOrderRequest

export type CashierCommandSummary = {
  commandId: Identifier
  requestId: string
  status: CashierCommandStatus
  requestedBy: Identifier
  claimedByDevice: Identifier | null
  localOrderId: Identifier | null
  result: SalesOrderSummary | null
  errorMessage: string | null
  createdAt: string
  expiresAt: string
  completedAt: string | null
}

export type CashierCommandExecution = {
  commandId: Identifier
  requestedBy: Identifier
  request: CreateSalesOrderRequest
  leaseExpiresAt: string
  expiresAt: string
}

export type CompleteCashierCommandRequest = {
  localOrderId: Identifier
  result: SalesOrderSummary
}

export type FailCashierCommandRequest = {
  errorMessage: string
}

export type RenewCashierCommandResult = {
  commandId: Identifier
  leaseExpiresAt: string
}

export type EmployeeFinancialCommandType =
  | 'cash_recharge'
  | 'monthly_card_purchase'
  | 'monthly_card_pause'
  | 'monthly_card_resume'
  | 'apply_activity_recharge_tiers'

export type EmployeeMobileCreateFinancialCommandRequest =
  | {
      requestId: string
      type: 'cash_recharge'
      memberId: Identifier
      principalFen: number
      reason?: string
    }
  | {
      requestId: string
      type: 'monthly_card_purchase'
      memberId: Identifier
      reason?: string
    }
  | {
      requestId: string
      type: 'monthly_card_pause' | 'monthly_card_resume'
      cardId: Identifier
      reason: string
    }
  | {
      requestId: string
      type: 'apply_activity_recharge_tiers'
      activityId: Identifier
      reason: string
    }

export type EmployeeFinancialCommandResult =
  | {
      type: 'cash_recharge'
      wallet: WalletOperationResult
    }
  | {
      type:
        | 'monthly_card_purchase'
        | 'monthly_card_pause'
        | 'monthly_card_resume'
      monthlyCard: MonthlyCardSummary
    }
  | {
      type: 'apply_activity_recharge_tiers'
      rechargeGiftTiers: RechargeGiftTierSummary[]
    }

export type EmployeeFinancialCommandSummary = {
  commandId: Identifier
  requestId: string
  type: EmployeeFinancialCommandType
  status: CashierCommandStatus
  requestedBy: Identifier
  claimedByDevice: Identifier | null
  result: EmployeeFinancialCommandResult | null
  errorMessage: string | null
  createdAt: string
  expiresAt: string
  completedAt: string | null
}

export type EmployeeFinancialCommandExecution = {
  commandId: Identifier
  requestedBy: Identifier
  request: EmployeeMobileCreateFinancialCommandRequest
  leaseExpiresAt: string
  expiresAt: string
}

export type CompleteEmployeeFinancialCommandRequest = {
  result: EmployeeFinancialCommandResult
}

export type RequestPhoneVerificationRequest = {
  phone: string
}

export type PhoneVerificationChallenge = {
  challengeId: Identifier
  expiresAt: string
  resendAfterSeconds: number
  mockCode?: string
}

export type RegisterMiniappMemberRequest = {
  requestId: string
  challengeId: Identifier
  verificationCode: string
  phone: string
  nickname: string
  confirmedAtLeast14: boolean
}

export type WechatOneTapMemberLoginRequest = {
  requestId: string
  phoneCode: string
  nickname?: string
  avatarUrl?: string | null
  confirmedAtLeast14: boolean
}

export type PublicStoreSummary = {
  id: Identifier
  name: string
  address: string | null
  contactPhone: string | null
  businessHours: string
  isOpen: boolean
  statusText: string
}

export type StoreBusinessStatusOverride = 'automatic' | 'open' | 'closed'

export type StoreProfileSummary = {
  storeId: Identifier
  name: string
  address: string | null
  contactPhone: string | null
  businessOpenMinute: number
  businessCloseMinute: number
  statusOverride: StoreBusinessStatusOverride
  customStatusText: string | null
  updatedAt: string
}

export type UpdateStoreProfileRequest = {
  name: string
  address?: string
  contactPhone?: string
  businessOpenMinute: number
  businessCloseMinute: number
  statusOverride: StoreBusinessStatusOverride
  customStatusText?: string
  reason: string
}

export type PublicAnnouncementSummary = {
  id: Identifier
  title: string
  content: string
  pinned: boolean
  publishedAt: string
}

export type PublicActivitySummary = {
  id: Identifier
  title: string
  summary: string
  content: string
  activityType: ActivityType
  startsAt: string
  endsAt: string
  pinned: boolean
  regularPriceFen: number | null
  advancedPriceFen: number | null
  allowStoredValue: boolean
  allowWechat: boolean
  rechargeTiers: Array<{
    principalFen: number
    giftFen: number
  }>
}

export type BoardGameSourceAttribution = {
  label: 'Powered by BGG'
  url: string
}

export type PublicBoardGameSummary = {
  id: Identifier
  baseGameId: Identifier | null
  name: string
  introduction: string
  categories: string[]
  minPlayers: number
  maxPlayers: number
  minMinutes: number | null
  maxMinutes: number | null
  complexityRating: number | null
  imageUrl: string | null
  customerNote: string | null
  sourceAttribution: BoardGameSourceAttribution | null
  likeCount: number
  likedByViewer: boolean
}

export type PublicBoardGameFilters = {
  query?: string
  categories?: string[]
  minPlayers?: number
  maxPlayers?: number
  minMinutes?: number
  maxMinutes?: number
  minComplexity?: number
  maxComplexity?: number
}

export type SetBoardGameLikeRequest = {
  liked: boolean
  requestId: string
}

export type BoardGameLikeResult = {
  boardGameId: Identifier
  likedByViewer: boolean
  likeCount: number
}

export type MiniappHomeSnapshot = {
  store: PublicStoreSummary
  announcements: PublicAnnouncementSummary[]
  activities: PublicActivitySummary[]
  recommendedGames: PublicBoardGameSummary[]
}

export type MemberSelfServiceSummary = {
  memberId: Identifier
  nickname: string
  avatarUrl: string | null
  profileCompleted: boolean
  phoneMasked: string
  tier: MemberTier
  principalBalanceFen: number
  giftBalanceFen: number
  monthlyCardStatus: 'none' | 'active' | 'paused'
  monthlyCardExpiresAt: string | null
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdayCanBeFilled: boolean
  ageGate: MemberAgeGate
}

export type UpdateMemberProfileRequest = {
  requestId: string
  nickname: string
}

export type FillMemberBirthdayRequest = {
  requestId: string
  month: number
  day: number
}

export type MemberOrderHistoryItem = {
  orderId: Identifier
  orderNumber: string
  totalFen: number
  paymentMethod: 'cash' | 'stored_value'
  completedAt: string
}

export type MemberWalletHistoryItem = {
  operationId: Identifier
  eventType: string
  principalDeltaFen: number
  giftDeltaFen: number
  reason: string | null
  occurredAt: string
}

export type MemberMonthlyCardHistoryItem = {
  operationId: Identifier
  cardId: Identifier
  eventType: string
  reason: string | null
  occurredAt: string
}

export type MemberActivitySummary = {
  activityId: string
  kind: 'consumption' | 'recharge' | 'monthly_card'
  businessId: string
  businessNumber: string | null
  title: string
  amountFen: number | null
  direction: 'debit' | 'credit' | 'neutral'
  status:
    | 'completed'
    | 'settled'
    | 'active'
    | 'paused'
    | 'resumed'
    | 'used'
    | 'refunded'
    | 'reversed'
    | 'expired'
  occurredAt: string
}

export type MemberSelfServiceHistory = {
  activities: MemberActivitySummary[]
  orders: MemberOrderHistoryItem[]
  walletEntries: MemberWalletHistoryItem[]
  monthlyCardEvents: MemberMonthlyCardHistoryItem[]
}

export type MemberRechargeOrderStatus =
  | 'creating'
  | 'pending_payment'
  | 'settled'
  | 'failed'
  | 'expired'

export type MemberRechargeOrderSummary = {
  orderId: Identifier
  requestId: string
  principalFen: number
  giftFen: number
  totalCreditFen: number
  status: MemberRechargeOrderStatus
  providerMode: 'mock' | 'wechat'
  clientPaymentParameters: Record<string, string> | null
  expiresAt: string
  settledAt: string | null
  createdAt: string
  errorMessage: string | null
}

export type CreateMemberRechargeOrderRequest = {
  requestId: string
  principalFen: number
}

export type MemberRechargeConfiguration = {
  providerMode: 'mock' | 'wechat'
  giftTiers: Array<{
    principalFen: number
    giftFen: number
  }>
}

export type MemberMonthlyCardConfiguration = {
  providerMode: 'mock' | 'wechat'
  planName: string
  priceFen: number
  durationDays: number
  scopeType: MonthlyCardScopeType
  purchaseAllowed: boolean
  blockedReason: string | null
}

export type CreateMemberMonthlyCardOrderRequest = {
  requestId: string
}

export type MemberMonthlyCardOrderSummary = {
  orderId: Identifier
  requestId: string
  planName: string
  priceFen: number
  durationDays: number
  status: MemberRechargeOrderStatus
  providerMode: 'mock' | 'wechat'
  clientPaymentParameters: Record<string, string> | null
  targetCardId: Identifier | null
  expiresBefore: string | null
  expiresAfter: string | null
  expiresAt: string
  settledAt: string | null
  createdAt: string
  errorMessage: string | null
}

export type WechatJsapiPaymentParameters = {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

export type OrderPaymentMethod = 'cash' | 'stored_value'
export type OrderPricingTier = 'regular' | 'advanced'
export type OrderBenefitType =
  | 'none'
  | 'birthday'
  | 'monthly_card'
  | 'repeat_admission'

export type CreateOrderLineRequest =
  | {
      catalogItemId: Identifier
      quantity: number
      pricingTier: OrderPricingTier
      personalAdmissionBenefit?: boolean
    }
  | {
      customName: string
      customUnitPriceFen: number
      quantity: number
      pricingTier: 'regular'
    }

export type CreateSalesOrderRequest = {
  requestId: Identifier
  customerMemberId?: Identifier
  paymentMethod: OrderPaymentMethod
  walletMemberId?: Identifier
  lines: CreateOrderLineRequest[]
  note?: string
}

export type SalesOrderItemSummary = {
  id: Identifier
  catalogItemId: Identifier
  itemName: string
  itemType: CatalogItemType
  regularPriceFen: number
  advancedPriceFen: number
  appliedUnitPriceFen: number
  pricingTier: OrderPricingTier
  quantity: number
  lineTotalFen: number
  benefitType: OrderBenefitType
  beneficiaryMemberId: Identifier | null
}

export type SalesOrderSummary = {
  id: Identifier
  orderNumber: string
  visitBatchId: Identifier
  customerMemberId: Identifier | null
  paymentMethod: OrderPaymentMethod
  walletMemberId: Identifier | null
  memberNickname: string | null
  status: 'completed'
  totalFen: number
  note: string | null
  completedAt: string
  items: SalesOrderItemSummary[]
}

export type ListRecentOrdersRequest = {
  limit?: number
}

export type ListTransactionRecordsRequest = {
  query?: string
  from?: string
  to?: string
  limit?: number
}

export type RechargeTransactionSummary = {
  id: Identifier
  orderNumber: string
  memberId: Identifier
  memberNickname: string
  phoneMasked: string
  channel: 'cash' | 'wechat'
  principalFen: number
  giftFen: number
  totalCreditFen: number
  status: 'pending_payment' | 'settled' | 'failed' | 'expired'
  providerTransactionId: string | null
  createdAt: string
  settledAt: string | null
}

export type RefundStatus = 'pending' | 'completed' | 'rejected'

export type RefundableOrderItemSummary = SalesOrderItemSummary & {
  pendingRefundQuantity: number
  completedRefundQuantity: number
  refundableQuantity: number
}

export type RefundableOrderSummary = Omit<SalesOrderSummary, 'items'> & {
  items: RefundableOrderItemSummary[]
  refundableUntil: string
  withinRefundWindow: boolean
}

export type FindRefundableOrderRequest = {
  query: string
}

export type CreateRefundItemRequest = {
  orderItemId: Identifier
  quantity: number
}

export type CreateRefundRequest = {
  requestId: Identifier
  orderId: Identifier
  items: CreateRefundItemRequest[]
  reason?: string
}

export type ApproveRefundRequest = {
  requestId: Identifier
  refundId: Identifier
  specialProductOverride?: boolean
  reason?: string
}

export type RejectRefundRequest = {
  requestId: Identifier
  refundId: Identifier
  reason: string
}

export type DirectRefundRequest = {
  requestId: Identifier
  orderId: Identifier
  items: CreateRefundItemRequest[]
  specialProductOverride?: boolean
  reason?: string
}

export type RefundItemSummary = {
  id: Identifier
  orderItemId: Identifier
  itemName: string
  itemType: CatalogItemType
  unitRefundFen: number
  quantity: number
  lineRefundFen: number
}

export type RefundEvidenceSummary = {
  id: Identifier
  evidenceType: 'pdf' | 'excel'
  fileName: string
  fileSha256: string
  generatedBy: Identifier
  generatedAt: string
}

export type RefundSummary = {
  id: Identifier
  refundNumber: string
  orderId: Identifier
  orderNumber: string
  paymentMethod: OrderPaymentMethod
  walletMemberId: Identifier | null
  status: RefundStatus
  totalFen: number
  requestedBy: Identifier
  requestedAt: string
  requestReason: string | null
  approvedBy: Identifier | null
  approvedAt: string | null
  specialProductOverride: boolean
  completionReason: string | null
  rejectedBy: Identifier | null
  rejectedAt: string | null
  rejectionReason: string | null
  completedAt: string | null
  items: RefundItemSummary[]
  evidence: RefundEvidenceSummary[]
}

export type ListRefundsRequest = {
  limit?: number
  status?: RefundStatus
}

export type ExportRefundEvidenceRequest = {
  requestId: Identifier
  refundId: Identifier
  evidenceType: 'pdf' | 'excel'
}

export type ExportRefundEvidenceResult = {
  canceled: boolean
  filePath: string | null
  evidence: RefundEvidenceSummary | null
}

export type FinancialRefundTargetType = 'monthly_card' | 'cash_recharge'

export type FinancialRefundSummary = {
  id: Identifier
  requestNumber: string
  targetType: FinancialRefundTargetType
  targetId: Identifier
  memberId: Identifier
  memberNickname: string
  memberPhone: string
  paymentMethod: 'cash'
  status: RefundStatus
  refundPrincipalFen: number
  reclaimGiftFen: number
  requiresSpecialOverride: boolean
  requestedBy: Identifier
  requestedAt: string
  requestReason: string | null
  approvedBy: Identifier | null
  approvedAt: string | null
  specialOverride: boolean
  completionReason: string | null
  executionOperationId: Identifier | null
  rejectedBy: Identifier | null
  rejectedAt: string | null
  rejectionReason: string | null
  completedAt: string | null
}

export type CreateFinancialRefundRequest = {
  requestId: Identifier
  targetType: FinancialRefundTargetType
  targetId: Identifier
  reason?: string
}

export type ApproveFinancialRefundRequest = {
  requestId: Identifier
  financialRefundId: Identifier
  specialOverride?: boolean
  reason?: string
}

export type RejectFinancialRefundRequest = {
  requestId: Identifier
  financialRefundId: Identifier
  reason: string
}

export type DirectFinancialRefundRequest = {
  requestId: Identifier
  targetType: FinancialRefundTargetType
  targetId: Identifier
  specialOverride?: boolean
  reason?: string
}

export type ListFinancialRefundsRequest = {
  limit?: number
  status?: RefundStatus
}

export type BusinessReportRequest = {
  fromDate: string
  toDate: string
  scope?: 'store' | 'tenant'
}

export type BusinessReportItem = {
  itemName: string
  itemType: CatalogItemType
  soldQuantity: number
  refundedQuantity: number
  netQuantity: number
  grossSalesFen: number
  refundFen: number
  netSalesFen: number
}

export type BusinessReport = {
  fromDate: string
  toDate: string
  generatedAt: string
  order: {
    orderCount: number
    grossSalesFen: number
    refundCount: number
    refundFen: number
    netSalesFen: number
    averageOrderFen: number
    admissionQuantity: number
  }
  payment: {
    cashSalesFen: number
    cashRefundFen: number
    cashNetFen: number
    storedValueSalesFen: number
    storedValueRefundFen: number
    storedValueNetFen: number
  }
  wallet: {
    rechargeCount: number
    rechargePrincipalFen: number
    rechargeGiftFen: number
    rechargeRefundCount: number
    rechargeRefundPrincipalFen: number
    reclaimedGiftFen: number
    consumptionDebitFen: number
    orderRefundCreditFen: number
  }
  monthlyCard: {
    soldCount: number
    grossSalesFen: number
    refundCount: number
    refundFen: number
    netSalesFen: number
    usageCount: number
    activeCount: number
  }
  actualCashInflowFen: number
  items: BusinessReportItem[]
}

export type ExportBusinessReportResult = {
  canceled: boolean
  filePath: string | null
}

export type ExportBusinessReportRequest = BusinessReportRequest & {
  requestId: Identifier
}

export type CloudConnectionState =
  | 'not_configured'
  | 'idle'
  | 'syncing'
  | 'error'

export type CloudRuntimeMode =
  | 'not_configured'
  | 'connecting'
  | 'cloud_online'
  | 'local_offline'
  | 'reconciling'
  | 'mirror_error'
  | 'result_pending'
  | 'configuration_error'

export type CloudConnectionStatus = {
  environment: DataEnvironment
  configuredEnvironment: DataEnvironment | null
  configured: boolean
  state: CloudConnectionState
  baseUrl: string | null
  deviceId: Identifier | null
  credentialMatchesDevice: boolean
  pendingOperations: number
  conflictedOperations: number
  pendingConflicts: number
  pendingInboundEvents: number
  inboundConflicts: number
  lastConfirmedDeviceSeq: number
  pullCursor: string | null
  lastPushAt: string | null
  lastPullAt: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  runtimeMode: CloudRuntimeMode
  lastCloudReachableAt: string | null
  mirrorCursor: string | null
  mirrorLag: number
  pendingOutcomes: number
  mirrorRepairRequired: boolean
  offlineFinancialLeaseOwnerDeviceId: Identifier | null
  offlineFinancialLeaseExpiresAt: string | null
  offlineFinancialWriteAllowed: boolean
}

export type OfflineFinancialLeaseStatus = {
  ownerDeviceId: Identifier | null
  ownerDeviceName: string | null
  expiresAt: string | null
  leaseVersion: number
  currentDeviceOwnsLease: boolean
}

export type CloudMirrorResource =
  | 'store'
  | 'employees'
  | 'members'
  | 'catalog'
  | 'activities'
  | 'announcements'
  | 'board_games'
  | 'wallet_accounts'
  | 'wallet_ledger'
  | 'monthly_cards'
  | 'monthly_card_events'
  | 'monthly_card_payment_orders'
  | 'wechat_recharge_orders'
  | 'business_templates'
  | 'orders'
  | 'order_items'
  | 'refunds'
  | 'refund_events'
  | 'financial_refunds'

export type CloudMirrorPage = {
  resource: CloudMirrorResource
  rows: Array<{ id: string; payload: Record<string, unknown> }>
  nextCursor: string | null
  eventCursor: string
  serverTime: string
}

export type PrepareEmptyCloudCutoverResult = {
  epochId: Identifier
  archivePath: string
  archiveSha256: string
  mirrorDatabasePath: string
}

export type EnrollCloudConnectionRequest = {
  requestId: Identifier
  baseUrl: string
  enrollmentSecret: string
}

export type CloudPairingCode = {
  code: string
  expiresAt: string
  storeName: string
}

export type TenantStoreAdminSummary = {
  id: Identifier
  name: string
  status: 'active' | 'disabled'
  createdAt: string
  currentStore: boolean
}

export type EmployeeStoreAccessSummary = {
  employeeId: Identifier
  username: string
  displayName: string
  identityStatus: 'active' | 'disabled'
  storeId: Identifier
  storeName: string
  role: EmployeeRole
  status: EmployeeStatus
  authorizationVersion: number
  updatedAt: string
}

export type CreateTenantStoreRequest = {
  requestId: Identifier
  storeName: string
}

export type CreateTenantStoreResult = {
  store: TenantStoreAdminSummary
  activationCode: string
  expiresAt: string
}

export type SetEmployeeStoreAccessRequest = {
  requestId: Identifier
  employeeId: Identifier
  storeId: Identifier
  role: EmployeeRole
  status: EmployeeStatus
  reason: string
}

export type JoinCloudStoreRequest = {
  requestId: Identifier
  baseUrl: string
  pairingCode: string
}

export type JoinCloudStoreResult = PrepareEmptyCloudCutoverResult & {
  storeName: string
  deviceId: Identifier
}

export type DeviceOnboardingState = {
  environment: DataEnvironment
  initialized: boolean
  pending: boolean
  baseUrl: string | null
  requestId: Identifier | null
  storeName: string | null
  lastError: string | null
}

export type JoinCloudStoreBeforeLoginRequest = {
  requestId: Identifier
  baseUrl: string
  pairingCode: string
}

export type JoinCloudStoreBeforeLoginResult = {
  environment: DataEnvironment
  tenantId: Identifier
  storeId: Identifier
  storeName: string
  deviceId: Identifier
  epochId: Identifier
  mirrorDatabasePath: string
}

export type InboundSyncConflictSummary = {
  sequence: string
  eventId: Identifier
  aggregateType: string
  aggregateId: Identifier
  eventType: string
  occurredAt: string
  receivedAt: string
  errorMessage: string
}

export type ResolveInboundSyncConflictRequest = {
  sequence: string
  resolution: 'keep_local' | 'apply_cloud'
  reason: string
}

export type ApplicationUpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type ApplicationUpdateStatus = {
  state: ApplicationUpdateState
  currentVersion: string
  availableVersion: string | null
  feedUrl: string | null
  downloadPercent: number | null
  transferredBytes: number | null
  totalBytes: number | null
  lastCheckedAt: string | null
  lastError: string | null
}

export const IPC_CHANNELS = {
  systemStatus: 'system:get-status',
  systemSwitchDataEnvironment: 'system:switch-data-environment',
  storeProfilesList: 'store-profiles:list',
  storeProfilesSwitch: 'store-profiles:switch',
  systemRelocateDatabase: 'system:relocate-database',
  systemBackupOverview: 'system:backup-overview',
  systemBackupNow: 'system:backup-now',
  systemBackupSetSecondary: 'system:backup-set-secondary',
  systemRestoreDatabase: 'system:restore-database',
  systemExportDiagnostics: 'system:export-diagnostics',
  cloudConnectionStatus: 'cloud:connection-status',
  cloudConnectionEnroll: 'cloud:connection-enroll',
  cloudPairingCodeCreate: 'cloud:pairing-code-create',
  tenantStoresList: 'tenant-admin:stores-list',
  tenantStoreCreate: 'tenant-admin:store-create',
  employeeStoreAccessList: 'tenant-admin:employee-store-access-list',
  employeeStoreAccessSet: 'tenant-admin:employee-store-access-set',
  businessTemplatesList: 'tenant-admin:business-templates-list',
  businessTemplateSave: 'tenant-admin:business-template-save',
  businessTemplateOverrideSave: 'tenant-admin:business-template-override-save',
  cloudStoreJoin: 'cloud:store-join',
  deviceOnboardingState: 'device-onboarding:state',
  deviceOnboardingJoin: 'device-onboarding:join',
  cloudSyncNow: 'cloud:sync-now',
  cloudPrepareEmptyCutover: 'cloud:prepare-empty-cutover',
  cloudClaimOfflineFinancialLease: 'cloud:claim-offline-financial-lease',
  cloudInboundConflicts: 'cloud:inbound-conflicts',
  cloudInboundConflictResolve: 'cloud:inbound-conflict-resolve',
  storeProfileGet: 'store-profile:get',
  storeProfileUpdate: 'store-profile:update',
  applicationUpdateStatus: 'application-update:status',
  applicationUpdateCheck: 'application-update:check',
  applicationUpdateDownload: 'application-update:download',
  applicationUpdateInstall: 'application-update:install',
  legacyImportPreflight: 'legacy-import:preflight',
  legacyImportExecute: 'legacy-import:execute',
  applicationState: 'application:get-state',
  bootstrapStore: 'application:bootstrap-store',
  savedLoginGet: 'identity:saved-login-get',
  login: 'identity:login',
  logout: 'identity:logout',
  employeeList: 'identity:employee-list',
  employeeCreate: 'identity:employee-create',
  employeeSetStatus: 'identity:employee-set-status',
  employeeResetPassword: 'identity:employee-reset-password',
  employeeConfigureMobileAccess: 'identity:employee-configure-mobile-access',
  memberSearch: 'member:search',
  memberCashierList: 'member:cashier-list',
  memberCreate: 'member:create',
  memberAdjustTier: 'member:adjust-tier',
  memberCorrectBirthday: 'member:correct-birthday',
  memberDisable: 'member:disable',
  walletDetails: 'wallet:details',
  walletCashRecharge: 'wallet:cash-recharge',
  walletDebit: 'wallet:debit',
  walletReverseCashRecharge: 'wallet:reverse-cash-recharge',
  walletUpdateGiftTiers: 'wallet:update-gift-tiers',
  monthlyCardDetails: 'monthly-card:details',
  monthlyCardPurchase: 'monthly-card:purchase',
  monthlyCardPause: 'monthly-card:pause',
  monthlyCardResume: 'monthly-card:resume',
  monthlyCardUse: 'monthly-card:use',
  monthlyCardRefund: 'monthly-card:refund',
  monthlyCardExtend: 'monthly-card:extend',
  catalogList: 'catalog:list',
  catalogCreate: 'catalog:create',
  catalogUpdate: 'catalog:update',
  catalogSetStatus: 'catalog:set-status',
  catalogSetAvailability: 'catalog:set-availability',
  activityList: 'activity:list',
  activityCreate: 'activity:create',
  activityUpdate: 'activity:update',
  activitySetStatus: 'activity:set-status',
  activityApplyRechargeTiers: 'activity:apply-recharge-tiers',
  announcementList: 'announcement:list',
  announcementCreate: 'announcement:create',
  announcementUpdate: 'announcement:update',
  announcementSetStatus: 'announcement:set-status',
  boardGameList: 'board-game:list',
  boardGameCreate: 'board-game:create',
  boardGameUpdate: 'board-game:update',
  boardGameUpdateOperations: 'board-game:update-operations',
  boardGameSetRecordStatus: 'board-game:set-record-status',
  boardGameImportImage: 'board-game:import-image',
  boardGameReadImage: 'board-game:read-image',
  boardGameMetadataStatus: 'board-game-metadata:status',
  boardGameMetadataSearch: 'board-game-metadata:search',
  boardGameMetadataDetails: 'board-game-metadata:details',
  orderCreate: 'order:create',
  orderRecent: 'order:recent',
  cashierRefresh: 'cashier:refresh',
  transactionSalesList: 'transaction:sales:list',
  transactionRechargeList: 'transaction:recharge:list',
  refundFindOrder: 'refund:find-order',
  refundCreate: 'refund:create',
  refundApprove: 'refund:approve',
  refundReject: 'refund:reject',
  refundDirect: 'refund:direct',
  refundList: 'refund:list',
  refundExportEvidence: 'refund:export-evidence',
  financialRefundCreate: 'financial-refund:create',
  financialRefundApprove: 'financial-refund:approve',
  financialRefundReject: 'financial-refund:reject',
  financialRefundDirect: 'financial-refund:direct',
  financialRefundList: 'financial-refund:list',
  reportBusiness: 'report:business',
  reportExportExcel: 'report:export-excel'
} as const

export type DesktopApi = {
  getSystemStatus(): Promise<SystemStatus>
  switchDataEnvironment(request: SwitchDataEnvironmentRequest): Promise<void>
  listStoreProfiles(): Promise<StoreConfigurationSummary[]>
  switchStoreProfile(request: SwitchStoreProfileRequest): Promise<ApplicationState>
  relocateDatabase(): Promise<RelocateDatabaseResult>
  getBackupOverview(): Promise<BackupOverview>
  createBackup(request: CreateBackupRequest): Promise<CreateBackupResult>
  setSecondaryBackupDirectory(): Promise<SetSecondaryBackupDirectoryResult>
  restoreDatabase(request: RestoreDatabaseRequest): Promise<RestoreDatabaseResult>
  exportDiagnostics(): Promise<ExportDiagnosticsResult>
  getCloudConnectionStatus(): Promise<CloudConnectionStatus>
  enrollCloudConnection(
    request: EnrollCloudConnectionRequest
  ): Promise<CloudConnectionStatus>
  createCloudPairingCode(): Promise<CloudPairingCode>
  listTenantStores(): Promise<TenantStoreAdminSummary[]>
  createTenantStore(
    request: CreateTenantStoreRequest
  ): Promise<CreateTenantStoreResult>
  listEmployeeStoreAccess(): Promise<EmployeeStoreAccessSummary[]>
  setEmployeeStoreAccess(
    request: SetEmployeeStoreAccessRequest
  ): Promise<EmployeeStoreAccessSummary>
  listBusinessTemplates(): Promise<BusinessTemplateSummary[]>
  saveBusinessTemplate(request: SaveBusinessTemplateRequest): Promise<BusinessTemplateSummary>
  saveBusinessTemplateOverride(
    request: SaveBusinessTemplateOverrideRequest
  ): Promise<BusinessTemplateSummary>
  joinCloudStore(request: JoinCloudStoreRequest): Promise<JoinCloudStoreResult | null>
  getDeviceOnboardingState(): Promise<DeviceOnboardingState>
  joinCloudStoreBeforeLogin(
    request: JoinCloudStoreBeforeLoginRequest
  ): Promise<JoinCloudStoreBeforeLoginResult>
  syncCloudNow(): Promise<CloudConnectionStatus>
  prepareEmptyCloudCutover(): Promise<PrepareEmptyCloudCutoverResult | null>
  claimOfflineFinancialLease(): Promise<OfflineFinancialLeaseStatus>
  listInboundSyncConflicts(): Promise<InboundSyncConflictSummary[]>
  resolveInboundSyncConflict(
    request: ResolveInboundSyncConflictRequest
  ): Promise<void>
  getStoreProfile(): Promise<StoreProfileSummary>
  updateStoreProfile(
    request: UpdateStoreProfileRequest
  ): Promise<StoreProfileSummary>
  getApplicationUpdateStatus(): Promise<ApplicationUpdateStatus>
  checkApplicationUpdate(): Promise<ApplicationUpdateStatus>
  downloadApplicationUpdate(): Promise<ApplicationUpdateStatus>
  installApplicationUpdate(): Promise<void>
  preflightLegacyImport(): Promise<LegacyImportPreflightResult>
  executeLegacyImport(request: ExecuteLegacyImportRequest): Promise<LegacyImportResult>
  getApplicationState(): Promise<ApplicationState>
  bootstrapStore(request: BootstrapStoreRequest): Promise<ApplicationState>
  getSavedLogin(): Promise<SavedLoginCredentials | null>
  login(request: LoginRequest): Promise<SessionUser>
  logout(): Promise<void>
  listEmployees(): Promise<EmployeeSummary[]>
  createEmployee(request: CreateEmployeeRequest): Promise<EmployeeSummary>
  setEmployeeStatus(request: SetEmployeeStatusRequest): Promise<EmployeeSummary>
  resetEmployeePassword(request: ResetEmployeePasswordRequest): Promise<void>
  configureEmployeeMobileAccess(
    request: ConfigureEmployeeMobileAccessRequest
  ): Promise<EmployeeSummary>
  searchMembers(request: SearchMembersRequest): Promise<MemberSummary[]>
  listCashierMembers(): Promise<CashierMemberOption[]>
  createMember(request: CreateMemberRequest): Promise<MemberSummary>
  adjustMemberTier(request: AdjustMemberTierRequest): Promise<MemberSummary>
  correctMemberBirthday(request: CorrectMemberBirthdayRequest): Promise<MemberSummary>
  disableMember(request: DisableMemberRequest): Promise<MemberSummary>
  getWalletDetails(request: GetWalletDetailsRequest): Promise<WalletDetails>
  cashRecharge(request: CashRechargeRequest): Promise<WalletOperationResult>
  debitWallet(request: WalletDebitRequest): Promise<WalletOperationResult>
  reverseCashRecharge(request: ReverseCashRechargeRequest): Promise<WalletOperationResult>
  updateRechargeGiftTiers(
    request: UpdateRechargeGiftTiersRequest
  ): Promise<RechargeGiftTierSummary[]>
  getMonthlyCardDetails(request: GetMonthlyCardDetailsRequest): Promise<MonthlyCardDetails>
  purchaseMonthlyCard(request: PurchaseMonthlyCardRequest): Promise<MonthlyCardSummary>
  pauseMonthlyCard(request: MonthlyCardActionRequest): Promise<MonthlyCardSummary>
  resumeMonthlyCard(request: MonthlyCardActionRequest): Promise<MonthlyCardSummary>
  useMonthlyCard(request: MonthlyCardUseRequest): Promise<MonthlyCardSummary>
  refundMonthlyCard(request: MonthlyCardActionRequest): Promise<MonthlyCardSummary>
  extendMonthlyCard(request: ExtendMonthlyCardRequest): Promise<MonthlyCardSummary>
  listCatalogItems(): Promise<CatalogItemSummary[]>
  createCatalogItem(request: CreateCatalogItemRequest): Promise<CatalogItemSummary>
  updateCatalogItem(request: UpdateCatalogItemRequest): Promise<CatalogItemSummary>
  setCatalogItemStatus(request: SetCatalogItemStatusRequest): Promise<CatalogItemSummary>
  setCatalogAvailability(
    request: SetCatalogAvailabilityRequest
  ): Promise<CatalogItemSummary>
  listActivities(): Promise<ActivitySummary[]>
  createActivity(request: CreateActivityRequest): Promise<ActivitySummary>
  updateActivity(request: UpdateActivityRequest): Promise<ActivitySummary>
  setActivityStatus(
    request: SetActivityStatusRequest
  ): Promise<ActivitySummary>
  applyActivityRechargeTiers(
    request: { activityId: Identifier; reason: string }
  ): Promise<RechargeGiftTierSummary[]>
  listAnnouncements(): Promise<AnnouncementSummary[]>
  createAnnouncement(
    request: CreateAnnouncementRequest
  ): Promise<AnnouncementSummary>
  updateAnnouncement(
    request: UpdateAnnouncementRequest
  ): Promise<AnnouncementSummary>
  setAnnouncementStatus(
    request: SetAnnouncementStatusRequest
  ): Promise<AnnouncementSummary>
  listBoardGames(): Promise<BoardGameSummary[]>
  createBoardGame(request: CreateBoardGameRequest): Promise<BoardGameSummary>
  updateBoardGame(request: UpdateBoardGameRequest): Promise<BoardGameSummary>
  updateBoardGameOperations(
    request: UpdateBoardGameOperationsRequest
  ): Promise<BoardGameSummary>
  setBoardGameRecordStatus(
    request: SetBoardGameRecordStatusRequest
  ): Promise<BoardGameSummary>
  importBoardGameImage(): Promise<ImportBoardGameImageResult>
  readBoardGameImage(
    request: ReadBoardGameImageRequest
  ): Promise<string | null>
  getBoardGameMetadataStatus(): Promise<BoardGameMetadataAvailability>
  searchBoardGameMetadata(
    request: { query: string }
  ): Promise<BoardGameMetadataCandidate[]>
  getBoardGameMetadataDetails(
    request: BoardGameMetadataDetailsRequest
  ): Promise<BoardGameMetadataDetails>
  createSalesOrder(request: CreateSalesOrderRequest): Promise<SalesOrderSummary>
  listRecentOrders(request?: ListRecentOrdersRequest): Promise<SalesOrderSummary[]>
  refreshCashierData(): Promise<void>
  listSalesTransactions(
    request?: ListTransactionRecordsRequest
  ): Promise<SalesOrderSummary[]>
  listRechargeTransactions(
    request?: ListTransactionRecordsRequest
  ): Promise<RechargeTransactionSummary[]>
  findRefundableOrder(request: FindRefundableOrderRequest): Promise<RefundableOrderSummary>
  createRefundRequest(request: CreateRefundRequest): Promise<RefundSummary>
  approveRefund(request: ApproveRefundRequest): Promise<RefundSummary>
  rejectRefund(request: RejectRefundRequest): Promise<RefundSummary>
  directRefund(request: DirectRefundRequest): Promise<RefundSummary>
  listRefunds(request?: ListRefundsRequest): Promise<RefundSummary[]>
  exportRefundEvidence(
    request: ExportRefundEvidenceRequest
  ): Promise<ExportRefundEvidenceResult>
  createFinancialRefundRequest(
    request: CreateFinancialRefundRequest
  ): Promise<FinancialRefundSummary>
  approveFinancialRefund(
    request: ApproveFinancialRefundRequest
  ): Promise<FinancialRefundSummary>
  rejectFinancialRefund(
    request: RejectFinancialRefundRequest
  ): Promise<FinancialRefundSummary>
  directFinancialRefund(
    request: DirectFinancialRefundRequest
  ): Promise<FinancialRefundSummary>
  listFinancialRefunds(
    request?: ListFinancialRefundsRequest
  ): Promise<FinancialRefundSummary[]>
  getBusinessReport(request: BusinessReportRequest): Promise<BusinessReport>
  exportBusinessReportExcel(
    request: ExportBusinessReportRequest
  ): Promise<ExportBusinessReportResult>
}
