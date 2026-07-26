import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  type OpenDialogOptions,
  type IpcMainInvokeEvent
} from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { basename, join, resolve } from 'node:path'
import {
  IPC_CHANNELS,
  type AdjustMemberTierRequest,
  type ActivityType,
  type AnnouncementStatus,
  type BoardGameDifficulty,
  type BoardGameRecordStatus,
  type ApproveFinancialRefundRequest,
  type ApproveRefundRequest,
  type ApplicationState,
  type BackupOverview,
  type BusinessTemplateSummary,
  type BootstrapStoreRequest,
  type BusinessReportRequest,
  type CatalogAvailability,
  type CatalogItemStatus,
  type CatalogItemType,
  type CashRechargeRequest,
  type CloudPairingCode,
  type CloudMirrorResource,
  type CloudConnectionStatus,
  type ConfigureEmployeeMobileAccessRequest,
  type CorrectMemberBirthdayRequest,
  type CreateCatalogItemRequest,
  type CreateActivityRequest,
  type CreateAnnouncementRequest,
  type CreateBoardGameRequest,
  type CreateBackupRequest,
  type CreateEmployeeRequest,
  type CreateTenantStoreRequest,
  type CreateTenantStoreResult,
  type CreateFinancialRefundRequest,
  type CreateMemberRequest,
  type CreateRefundRequest,
  type CreateSalesOrderRequest,
  type DisableMemberRequest,
  type DirectRefundRequest,
  type DirectFinancialRefundRequest,
  type DataEnvironment,
  type DeviceOnboardingState,
  type EmployeeRole,
  type EmployeeStoreAccessSummary,
  type EmployeeStatus,
  type EnrollCloudConnectionRequest,
  type JoinCloudStoreRequest,
  type JoinCloudStoreResult,
  type JoinCloudStoreBeforeLoginRequest,
  type JoinCloudStoreBeforeLoginResult,
  type ExportRefundEvidenceRequest,
  type ExportBusinessReportRequest,
  type ExecuteLegacyImportRequest,
  type ExtendMonthlyCardRequest,
  type RestoreDatabaseRequest,
  type ListRecentOrdersRequest,
  type ListTransactionRecordsRequest,
  type ListFinancialRefundsRequest,
  type ListRefundsRequest,
  type LoginRequest,
  type MemberTier,
  type GetWalletDetailsRequest,
  type GetMonthlyCardDetailsRequest,
  type MonthlyCardActionRequest,
  type MonthlyCardUseRequest,
  type OrderPaymentMethod,
  type OrderPricingTier,
  type PurchaseMonthlyCardRequest,
  type PrepareEmptyCloudCutoverResult,
  type RefundStatus,
  type FinancialRefundTargetType,
  type RejectRefundRequest,
  type RejectFinancialRefundRequest,
  type ResetEmployeePasswordRequest,
  type ResolveInboundSyncConflictRequest,
  type ReverseCashRechargeRequest,
  type SearchMembersRequest,
  type SaveBusinessTemplateRequest,
  type SaveBusinessTemplateOverrideRequest,
  type SessionUser,
  type SetEmployeeStatusRequest,
  type SetEmployeeStoreAccessRequest,
  type SetCatalogAvailabilityRequest,
  type SetCatalogItemStatusRequest,
  type SetActivityStatusRequest,
  type SetAnnouncementStatusRequest,
  type SetBoardGameRecordStatusRequest,
  type SystemStatus,
  type TenantStoreAdminSummary,
  type SwitchDataEnvironmentRequest,
  type StoreConfigurationSummary,
  type SwitchStoreProfileRequest,
  type UpdateCatalogItemRequest,
  type UpdateActivityRequest,
  type UpdateAnnouncementRequest,
  type UpdateBoardGameOperationsRequest,
  type UpdateBoardGameRequest,
  type UpdateRechargeGiftTiersRequest,
  type UpdateStoreProfileRequest,
  type WalletDebitRequest
} from '@zyapp/contracts'
import {
  DEFAULT_ROLE_PERMISSIONS,
  hashPassword,
  PERMISSIONS,
  verifyPassword
} from '@zyapp/auth'
import {
  bootstrapStore as bootstrapLocalStore,
  adjustMemberTier,
  applyPendingInboundEvents,
  applyCloudMirrorPage,
  applySyncPullResult,
  applySyncPushResult,
  approveFinancialRefund,
  approveRefund,
  cashRecharge,
  cacheCloudMirrorPage,
  cacheOfflineFinancialLease,
  correctMemberBirthday,
  createCatalogItem,
  createActivity,
  createAnnouncement,
  createBoardGame,
  createEmployee,
  configureEmployeeMobileAccess,
  createFinancialRefundRequest,
  createMember,
  createRefundRequest,
  createSalesOrder,
  directRefund,
  directFinancialRefund,
  ensureCloudRuntimeState,
  extendMonthlyCard,
  enrichCloudSyncOperation,
  findEmployeeRecordById,
  findEmployeeByUsername,
  getStoreContext,
  getStoreProfile,
  getMonthlyCardDetails,
  getWalletDetails,
  ensureLegacyImportCloudSyncOutbox,
  ensureMemberTierReconciliationOutbox,
  importLegacyDatabase,
  inspectLegacyDatabase,
  findRefundableOrder,
  getRefundDetails,
  getBusinessReport,
  getActivity,
  getLocalSyncStatus,
  getCloudRuntimeState,
  getSyncPullCursor,
  isStoreInitialized,
  listEmployees,
  listFinancialRefunds,
  listInboundSyncConflicts,
  listCashierMembers,
  listCatalogItems,
  listActivities,
  listAnnouncements,
  listBoardGames,
  listRecentOrders,
  listRechargeTransactions,
  listSalesTransactions,
  listPendingSyncBatch,
  listPendingCashierCommandReports,
  listPendingEmployeeFinancialCommandReports,
  listRefunds,
  markCashierCommandReported,
  markCloudMirrorEventsApplied,
  markEmployeeFinancialCommandReported,
  LATEST_SCHEMA_VERSION,
  openLocalDatabase,
  findPcOfflineCredential,
  savePcOfflineCredential,
  invalidatePcOfflineCredential,
  queuePcCredentialMigrations,
  recordLoginAttempt,
  recordRefundEvidence,
  recordBusinessReportExport,
  recordSyncBatchAccepted,
  recordPendingCloudOutcome,
  resolveCloudOutcome,
  setCloudRuntimeMode,
  recordFailedCashierCommand,
  recordFailedEmployeeFinancialCommand,
  recordSystemOperation,
  resolveInboundSyncConflict,
  resetEmployeePassword,
  rejectRefund,
  rejectFinancialRefund,
  reverseCashRecharge,
  pauseMonthlyCard,
  purchaseMonthlyCard,
  refundMonthlyCard,
  resumeMonthlyCard,
  searchMembers,
  setEmployeeStatus,
  setCatalogAvailability,
  setCatalogItemStatus,
  setActivityStatus,
  setAnnouncementStatus,
  setBoardGameRecordStatus,
  disableMember,
  debitWallet,
  updateCatalogItem,
  updateActivity,
  updateAnnouncement,
  updateBoardGame,
  updateBoardGameOperations,
  updateRechargeGiftTiers,
  updateStoreProfile,
  useMonthlyCard,
  type EmployeeRecord,
  type LocalDatabase,
  type StoreContext
} from '@zyapp/local-db'
import { FIRST_RELEASE_MODULES } from '@zyapp/module-registry'
import { createFileLogger } from '@zyapp/observability'
import { resolveDataRoot } from './data-paths'
import {
  activateStoreProfile,
  getActiveStoreProfile,
  loadOrCreateStoreProfileRegistry,
  profileSwitchBlockReason,
  registerCloudStoreProfile,
  resolveStoreProfileDataRoot,
  saveStoreProfileRegistry,
  storeProfileDatabasePath,
  updateStoreProfileIdentity,
  type StoreProfileConfig,
  type StoreProfileRegistry
} from './store-profile-router'
import {
  environmentSwitchBlockReason,
  isDataEnvironment,
  loadDataEnvironment,
  resolveEnvironmentDataRoot,
  saveDataEnvironment
} from './data-environment'
import { exportRefundEvidenceFile } from './refund-evidence'
import { exportBusinessReportFile } from './report-export'
import {
  createDatabaseBackup,
  createPreUpgradeBackup,
  findBackupByRequestId,
  inspectDatabaseFile,
  isAutomaticBackupDue,
  listDatabaseBackups
} from './backup-service'
import {
  loadSecondaryBackupDirectory,
  saveSecondaryBackupDirectory
} from './backup-settings'
import { exportDiagnosticPackage } from './diagnostic-export'
import { replaceDatabaseFromBackup } from './database-restore'
import {
  clearRememberedLogin,
  loadRememberedLogin,
  saveRememberedLogin
} from './remembered-login'
import {
  copyDatabaseFileVerified,
  loadConfiguredDatabasePath,
  saveConfiguredDatabasePath
} from './database-location'
import {
  defaultCloudBaseUrl,
  loadCloudConnection,
  normalizeCloudBaseUrl,
  saveCloudConnection,
  type CloudConnection
} from './cloud-connection'
import {
  activateEmptyCloudMirrorEpoch,
  claimOfflineFinancialLease,
  claimCloudCashierCommand,
  claimCloudEmployeeFinancialCommand,
  completeCloudCashierCommand,
  completeCloudEmployeeFinancialCommand,
  createCloudDevicePairingCode,
  createTenantStore as createCloudTenantStore,
  enrollCloudDevice,
  enrollPairedCloudDevice,
  enrollAuthorizedCloudStore,
  failCloudCashierCommand,
  failCloudEmployeeFinancialCommand,
  getCloudSyncEvents,
  getCloudOperationOutcome,
  getCloudMirrorPage,
  getCurrentCloudMirrorEpoch,
  getOfflineFinancialLease,
  getCloudSyncResults,
  loginDesktopEmployee,
  listEmployeeStoreAccess as listCloudEmployeeStoreAccess,
  listTenantStores as listCloudTenantStores,
  listBusinessTemplates as listCloudBusinessTemplates,
  pushCloudSyncBatch,
  streamCloudEventHints,
  submitCloudSyncCommand,
  renewOfflineFinancialLease,
  setEmployeeStoreAccess as setCloudEmployeeStoreAccess,
  saveBusinessTemplate as saveCloudBusinessTemplate,
  saveBusinessTemplateOverride as saveCloudBusinessTemplateOverride,
  CloudRequestError
} from './cloud-sync-client'
import {
  prepareEmptyLocalCloudMirror,
  prepareJoinedLocalCloudMirror,
  prepareFreshJoinedCloudMirror
} from './cloud-cutover'
import {
  clearPendingDeviceOnboarding,
  loadPendingDeviceOnboarding,
  savePendingDeviceOnboarding,
  type PendingDeviceOnboarding
} from './device-onboarding'
import {
  checkApplicationUpdate,
  configureApplicationUpdateFeed,
  downloadApplicationUpdate,
  getApplicationUpdateStatus,
  initializeApplicationUpdater,
  installApplicationUpdate
} from './application-update'
import {
  importBoardGameImage,
  readManagedBoardGameImage
} from './board-game-image'

let mainWindow: BrowserWindow | null = null
let localDatabase: LocalDatabase | null = null
let databasePath = ''
let rememberedLoginPath = ''
let databaseLocationConfigPath = ''
let backupSettingsConfigPath = ''
let cloudConnectionConfigPath = ''
let deviceOnboardingConfigPath = ''
let baseDataRoot = ''
let installationDataRoot = ''
let environmentDataRoot = ''
let dataEnvironmentConfigPath = ''
let storeProfileRegistryPath = ''
let storeProfileRegistry: StoreProfileRegistry | null = null
let activeRuntimeProfileId = ''
let activeDataEnvironment: DataEnvironment = 'production'
let databaseRelocating = false
let backupInProgress = false
let secondaryBackupDirectory: string | null = null
let automaticBackupTimer: NodeJS.Timeout | null = null
let cloudSyncTimer: NodeJS.Timeout | null = null
let cloudSyncWakeTimer: NodeJS.Timeout | null = null
let applicationUpdateTimer: NodeJS.Timeout | null = null
let cloudSyncInProgress = false
let cloudConnection: CloudConnection | null = null
let cloudSyncLastAttemptAt: string | null = null
let cloudSyncLastSuccessAt: string | null = null
let cloudSyncLastError: string | null = null
let cloudEventStreamAbort: AbortController | null = null
let cloudSyncRetryIndex = 0
let cloudSyncNextRetryAt = 0
let lastObservedPendingOperations = -1
const CLOUD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 15_000] as const
let logger: ReturnType<typeof createFileLogger> | null = null
const sessions = new Map<number, SessionUser>()
const legacyImportPreflights = new Map<
  string,
  {
    senderId: number
    sourcePath: string
    sourceName: string
    sourceSha256: string
    sourceSizeBytes: number
  }
>()

type StoreProfileRuntimePaths = {
  dataRoot: string
  databaseLocationConfigPath: string
  backupSettingsConfigPath: string
  cloudConnectionConfigPath: string
  rememberedLoginPath: string
  defaultDatabasePath: string
}

function requireStoreProfileRegistry(): StoreProfileRegistry {
  if (!storeProfileRegistry) throw new Error('门店配置路由尚未准备好')
  return storeProfileRegistry
}

function ensureStoreProfileDirectories(dataRoot: string): void {
  mkdirSync(join(dataRoot, 'data'), { recursive: true })
  mkdirSync(join(dataRoot, 'backups'), { recursive: true })
  mkdirSync(join(dataRoot, 'logs'), { recursive: true })
  mkdirSync(join(dataRoot, 'config'), { recursive: true })
  mkdirSync(join(dataRoot, 'assets', 'board-games'), { recursive: true })
}

function getStoreProfileRuntimePaths(
  profile: StoreProfileConfig
): StoreProfileRuntimePaths {
  const dataRoot = resolveStoreProfileDataRoot(environmentDataRoot, profile)
  return {
    dataRoot,
    databaseLocationConfigPath: join(dataRoot, 'config', 'database-location.json'),
    backupSettingsConfigPath: join(dataRoot, 'config', 'backup-settings.json'),
    cloudConnectionConfigPath: join(dataRoot, 'config', 'cloud-connection.json'),
    rememberedLoginPath: join(dataRoot, 'config', 'remembered-login.json'),
    defaultDatabasePath: storeProfileDatabasePath(dataRoot)
  }
}

function applyStoreProfileRuntimePaths(paths: StoreProfileRuntimePaths): void {
  baseDataRoot = paths.dataRoot
  databaseLocationConfigPath = paths.databaseLocationConfigPath
  backupSettingsConfigPath = paths.backupSettingsConfigPath
  cloudConnectionConfigPath = paths.cloudConnectionConfigPath
  rememberedLoginPath = paths.rememberedLoginPath
}

function resetCloudSyncRuntimeState(): void {
  cloudSyncLastAttemptAt = null
  cloudSyncLastSuccessAt = null
  cloudSyncLastError = null
  cloudSyncRetryIndex = 0
  cloudSyncNextRetryAt = 0
  lastObservedPendingOperations = -1
}

async function openStoreProfileRuntime(profile: StoreProfileConfig): Promise<{
  paths: StoreProfileRuntimePaths
  databasePath: string
  database: LocalDatabase
  connection: CloudConnection | null
  secondaryBackupDirectory: string | null
}> {
  const paths = getStoreProfileRuntimePaths(profile)
  ensureStoreProfileDirectories(paths.dataRoot)
  const targetSecondaryBackupDirectory = loadSecondaryBackupDirectory(
    paths.backupSettingsConfigPath
  )
  const targetDatabasePath = loadConfiguredDatabasePath(
    paths.databaseLocationConfigPath,
    paths.defaultDatabasePath
  )
  if (existsSync(targetDatabasePath)) {
    const existing = inspectDatabaseFile(targetDatabasePath)
    if (existing.schemaVersion > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `数据库 Schema v${existing.schemaVersion} 高于当前程序支持的 v${LATEST_SCHEMA_VERSION}，已拒绝打开`
      )
    }
    if (existing.schemaVersion > 0 && existing.schemaVersion < LATEST_SCHEMA_VERSION) {
      await createPreUpgradeBackup({
        databasePath: targetDatabasePath,
        primaryDirectory: join(paths.dataRoot, 'backups'),
        secondaryDirectory: targetSecondaryBackupDirectory,
        currentSchemaVersion: existing.schemaVersion
      })
    }
  }
  return {
    paths,
    databasePath: targetDatabasePath,
    database: openLocalDatabase(targetDatabasePath),
    connection: loadCloudConnection(
      paths.cloudConnectionConfigPath,
      safeStorage,
      activeDataEnvironment
    ),
    secondaryBackupDirectory: targetSecondaryBackupDirectory
  }
}

function updateActiveStoreProfileIdentity(): void {
  if (!localDatabase) return
  const context = getStoreContext(localDatabase.connection)
  if (!context) return
  const registry = requireStoreProfileRegistry()
  const active = getActiveStoreProfile(registry)
  if (
    active.tenantId === context.tenantId &&
    active.storeId === context.storeId &&
    active.storeName === context.storeName &&
    active.deviceId === context.deviceId
  ) {
    return
  }
  storeProfileRegistry = updateStoreProfileIdentity(registry, active.profileId, {
    tenantId: context.tenantId,
    storeId: context.storeId,
    storeName: context.storeName,
    deviceId: context.deviceId
  })
  saveStoreProfileRegistry(storeProfileRegistryPath, storeProfileRegistry)
}

function initializeOpenedStoreRuntime(): void {
  if (!localDatabase || !isStoreInitialized(localDatabase.connection)) return
  const context = getStoreContext(localDatabase.connection)
  if (!context) return
  const runtime = ensureCloudRuntimeState(localDatabase.connection, context)
  if (!cloudConnection) {
    setCloudRuntimeMode(localDatabase.connection, context, 'not_configured', {
      error: null
    })
  } else if (runtime.cloudPrimaryActivated) {
    const manager = localDatabase.connection.prepare(
      `SELECT id FROM employee
       WHERE tenant_id = ? AND store_id = ? AND role = 'manager'
         AND status = 'active'
       ORDER BY created_at LIMIT 1`
    ).get(context.tenantId, context.storeId) as { id: string } | undefined
    if (manager) {
      const queued = queuePcCredentialMigrations(
        localDatabase.connection,
        context,
        manager.id
      )
      if (queued > 0) {
        logger?.write('info', 'desktop_credential_migrations_queued', {
          count: queued,
          storeId: context.storeId,
          deviceId: context.deviceId
        })
      }
    }
  }
  updateActiveStoreProfileIdentity()
}

function storeProfileSwitchBlockReason(): string | null {
  if (!localDatabase) return '本地数据库尚未准备好'
  const context = getStoreContext(localDatabase.connection)
  const runtime = context
    ? getCloudRuntimeState(localDatabase.connection, context)
    : null
  return profileSwitchBlockReason({
    hasSession: sessions.size > 0,
    databaseMaintenance: databaseRelocating,
    backupInProgress,
    cloudSyncInProgress,
    pendingOutcomes: runtime?.pendingOutcomes ?? 0,
    mirrorRepairRequired: runtime?.mirrorRepairRequired ?? false
  })
}

async function activateStoreProfileRuntime(profileId: string): Promise<void> {
  const registry = requireStoreProfileRegistry()
  if (activeRuntimeProfileId === profileId) return
  const blockReason = storeProfileSwitchBlockReason()
  if (blockReason) throw new Error(blockReason)
  const profile = registry.profiles.find((candidate) => candidate.profileId === profileId)
  if (!profile) throw new Error('门店配置不存在')

  const next = await openStoreProfileRuntime(profile)
  const previousProfileId = registry.activeProfileId
  logger?.write('info', 'store_profile_switching', {
    fromProfileId: previousProfileId,
    toProfileId: profileId
  })
  cloudEventStreamAbort?.abort()
  cloudEventStreamAbort = null
  localDatabase?.close()
  sessions.clear()
  legacyImportPreflights.clear()

  storeProfileRegistry = activateStoreProfile(registry, profileId)
  saveStoreProfileRegistry(storeProfileRegistryPath, storeProfileRegistry)
  applyStoreProfileRuntimePaths(next.paths)
  databasePath = next.databasePath
  localDatabase = next.database
  cloudConnection = next.connection
  secondaryBackupDirectory = next.secondaryBackupDirectory
  activeRuntimeProfileId = profileId
  resetCloudSyncRuntimeState()
  logger = createFileLogger(join(baseDataRoot, 'logs'))
  logger.write('info', 'store_profile_activated', {
    profileId,
    storeId: profile.storeId,
    deviceId: profile.deviceId,
    databasePath
  })
  configureApplicationUpdateFeed(
    cloudConnection?.baseUrl ?? defaultCloudBaseUrl(activeDataEnvironment)
  )
  initializeOpenedStoreRuntime()
  void runAutomaticBackupIfDue()
  startCloudEventStream()
}

function listStoreProfiles(): StoreConfigurationSummary[] {
  const registry = requireStoreProfileRegistry()
  return registry.profiles.map((profile) => ({
    profileId: profile.profileId,
    environment: activeDataEnvironment,
    tenantId: profile.tenantId,
    storeId: profile.storeId,
    storeName: profile.storeName,
    deviceId: profile.deviceId,
    initialized: profile.tenantId !== null && profile.storeId !== null,
    active: profile.profileId === registry.activeProfileId
  }))
}

function requireDatabase(): LocalDatabase {
  if (databaseRelocating) {
    throw new Error('正在维护本地数据库，请稍候')
  }
  if (!localDatabase) {
    throw new Error('Local database is not ready')
  }
  return localDatabase
}

function getBackupOverview(): BackupOverview {
  const primaryDirectory = join(baseDataRoot, 'backups')
  return {
    settings: {
      primaryDirectory,
      secondaryDirectory: secondaryBackupDirectory
    },
    backups: listDatabaseBackups(primaryDirectory, secondaryBackupDirectory)
  }
}

async function performDatabaseBackup(
  kind:
    | 'automatic'
    | 'manual'
    | 'pre_restore'
    | 'pre_upgrade'
    | 'pre_import'
    | 'pre_move'
    | 'pre_environment_switch',
  requestId?: string
) {
  if (databaseRelocating) throw new Error('正在维护本地数据库，请稍候')
  if (backupInProgress) throw new Error('已有备份任务正在进行，请稍候')
  if (requestId) {
    const repeated = findBackupByRequestId(
      join(baseDataRoot, 'backups'),
      secondaryBackupDirectory,
      requestId
    )
    if (repeated) return repeated
  }
  backupInProgress = true
  try {
    const result = await createDatabaseBackup({
      database: requireDatabase(),
      primaryDirectory: join(baseDataRoot, 'backups'),
      secondaryDirectory: secondaryBackupDirectory,
      kind,
      ...(requestId ? { requestId } : {})
    })
    logger?.write('info', 'database_backup_created', {
      kind,
      fileName: result.backup.fileName,
      sha256: result.backup.sha256,
      secondaryCopied: result.secondaryPath !== null,
      secondaryError: result.secondaryError
    })
    return result
  } finally {
    backupInProgress = false
  }
}

async function runAutomaticBackupIfDue(): Promise<void> {
  if (
    !localDatabase ||
    databaseRelocating ||
    backupInProgress ||
    !isStoreInitialized(localDatabase.connection)
  ) {
    return
  }
  try {
    const overview = getBackupOverview()
    if (!isAutomaticBackupDue(overview.backups)) return
    await performDatabaseBackup('automatic')
  } catch (error) {
    logger?.write('error', 'automatic_backup_failed', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function getCloudConnectionStatus(): CloudConnectionStatus {
  const database = requireDatabase()
  const context = getStoreContext(database.connection)
  const localStatus = context
    ? getLocalSyncStatus(database.connection, context)
    : {
        pendingOperations: 0,
        conflictedOperations: 0,
        pendingConflicts: 0,
        pendingInboundEvents: 0,
        inboundConflicts: 0,
        lastConfirmedDeviceSeq: 0,
        pullCursor: null,
        lastPushAt: null,
        lastPullAt: null
      }
  const configured = cloudConnection !== null
  const runtime = context
    ? getCloudRuntimeState(database.connection, context)
    : {
        mirrorEpoch: '',
        cloudPrimaryActivated: false,
        runtimeMode: 'not_configured' as const,
        lastCloudReachableAt: null,
        lastError: null,
        pendingOutcomes: 0,
        mirrorRepairRequired: false,
        offlineFinancialLeaseOwnerDeviceId: null,
        offlineFinancialLeaseExpiresAt: null,
        offlineFinancialWriteAllowed: false
      }
  return {
    environment: activeDataEnvironment,
    configuredEnvironment: cloudConnection?.environment ?? null,
    configured,
    state: !configured
      ? 'not_configured'
      : cloudSyncInProgress
        ? 'syncing'
        : cloudSyncLastError
          ? 'error'
          : 'idle',
    baseUrl: cloudConnection?.baseUrl ?? null,
    deviceId: context?.deviceId ?? null,
    credentialMatchesDevice:
      Boolean(context) &&
      Boolean(cloudConnection) &&
      context?.deviceId === cloudConnection?.deviceId,
    ...localStatus,
    lastAttemptAt: cloudSyncLastAttemptAt,
    lastSuccessAt: cloudSyncLastSuccessAt,
    lastError: cloudSyncLastError,
    runtimeMode: configured ? runtime.runtimeMode : 'not_configured',
    lastCloudReachableAt: runtime.lastCloudReachableAt,
    mirrorCursor: localStatus.pullCursor,
    mirrorLag: localStatus.pendingInboundEvents,
    pendingOutcomes: runtime.pendingOutcomes,
    mirrorRepairRequired: runtime.mirrorRepairRequired,
    offlineFinancialLeaseOwnerDeviceId:
      runtime.offlineFinancialLeaseOwnerDeviceId,
    offlineFinancialLeaseExpiresAt: runtime.offlineFinancialLeaseExpiresAt,
    offlineFinancialWriteAllowed: runtime.offlineFinancialWriteAllowed
  }
}

function updateCloudRuntime(
  mode: CloudConnectionStatus['runtimeMode'],
  options: { reachable?: boolean; error?: string | null } = {}
): void {
  if (!localDatabase || !isStoreInitialized(localDatabase.connection)) return
  const context = getStoreContext(localDatabase.connection)
  if (!context) return
  setCloudRuntimeMode(localDatabase.connection, context, mode, options)
}

function cloudErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null
  const status = Number((error as { status?: unknown }).status)
  return Number.isInteger(status) ? status : null
}

function isCloudConfigurationFailure(error: unknown): boolean {
  const status = cloudErrorStatus(error)
  return status === 401 || status === 403 || status === 409
}

function getLocalDeviceName(deviceId: string): string {
  const row = requireDatabase()
    .connection.prepare('SELECT name FROM device WHERE id = ?')
    .get(deviceId) as { name: string } | undefined
  if (!row) throw new Error('本机设备配置缺失')
  return row.name
}

async function reportCashierCommandExecution(
  connection: CloudConnection,
  context: StoreContext,
  execution: ReturnType<typeof listPendingCashierCommandReports>[number]
): Promise<void> {
  if (execution.status === 'completed') {
    await completeCloudCashierCommand(connection, {
      commandId: execution.commandId,
      localOrderId: execution.localOrderId,
      result: execution.result
    })
  } else {
    await failCloudCashierCommand(connection, {
      commandId: execution.commandId,
      errorMessage: execution.errorMessage
    })
  }
  markCashierCommandReported(
    requireDatabase().connection,
    context,
    execution.commandId
  )
}

async function processCloudCashierCommands(
  connection: CloudConnection,
  context: StoreContext
): Promise<void> {
  const database = requireDatabase().connection
  for (const pending of listPendingCashierCommandReports(
    database,
    context,
    20
  )) {
    await reportCashierCommandExecution(connection, context, pending)
  }

  for (let index = 0; index < 10; index += 1) {
    const command = await claimCloudCashierCommand(connection)
    if (!command) break
    const employee = findEmployeeRecordById(
      database,
      context.tenantId,
      command.requestedBy
    )
    try {
      if (!employee || employee.status !== 'active') {
        throw new Error('发起收银的员工在本机不存在或已停用')
      }
      if (
        !DEFAULT_ROLE_PERMISSIONS[employee.role].includes(
          PERMISSIONS.orderCreate
        )
      ) {
        throw new Error('发起收银的员工没有收银权限')
      }
      createSalesOrder(
        database,
        { ...context, actor: employee },
        {
          ...command.request,
          requestId: command.commandId,
          sourceCashierCommand: {
            commandId: command.commandId,
            requestedByEmployeeId: command.requestedBy
          }
        }
      )
    } catch (error) {
      recordFailedCashierCommand(database, context, {
        commandId: command.commandId,
        requestedByEmployeeId: command.requestedBy,
        errorMessage: (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 500)
      })
    }
    const result = listPendingCashierCommandReports(
      database,
      context,
      20
    ).find((item) => item.commandId === command.commandId)
    if (!result) {
      throw new Error('本地收银命令执行结果缺失')
    }
    await reportCashierCommandExecution(connection, context, result)
  }
}

async function reportEmployeeFinancialCommandExecution(
  connection: CloudConnection,
  context: StoreContext,
  execution: ReturnType<
    typeof listPendingEmployeeFinancialCommandReports
  >[number]
): Promise<void> {
  if (execution.status === 'completed') {
    await completeCloudEmployeeFinancialCommand(connection, {
      commandId: execution.commandId,
      result: execution.result
    })
  } else {
    await failCloudEmployeeFinancialCommand(connection, {
      commandId: execution.commandId,
      errorMessage: execution.errorMessage
    })
  }
  markEmployeeFinancialCommandReported(
    requireDatabase().connection,
    context,
    execution.commandId
  )
}

async function processCloudEmployeeFinancialCommands(
  connection: CloudConnection,
  context: StoreContext
): Promise<void> {
  const database = requireDatabase().connection
  for (const pending of listPendingEmployeeFinancialCommandReports(
    database,
    context,
    20
  )) {
    await reportEmployeeFinancialCommandExecution(
      connection,
      context,
      pending
    )
  }

  for (let index = 0; index < 10; index += 1) {
    const command = await claimCloudEmployeeFinancialCommand(connection)
    if (!command) break
    const employee = findEmployeeRecordById(
      database,
      context.tenantId,
      command.requestedBy
    )
    try {
      if (!employee || employee.status !== 'active') {
        throw new Error('发起财务操作的员工在本机不存在或已停用')
      }
      const requiredPermission =
        command.request.type === 'cash_recharge'
          ? PERMISSIONS.walletRechargeCash
          : command.request.type === 'apply_activity_recharge_tiers'
            ? PERMISSIONS.activityManage
            : PERMISSIONS.monthlyCardManage
      if (
        !DEFAULT_ROLE_PERMISSIONS[employee.role].includes(
          requiredPermission
        )
      ) {
        throw new Error('发起员工没有执行该财务操作的权限')
      }
      const sourceFinancialCommand = {
        commandId: command.commandId,
        requestedByEmployeeId: command.requestedBy
      }
      switch (command.request.type) {
        case 'cash_recharge':
          cashRecharge(
            database,
            { ...context, actor: employee },
            {
              requestId: command.commandId,
              memberId: command.request.memberId,
              principalFen: command.request.principalFen,
              reason: command.request.reason ?? '移动端现金充值',
              sourceFinancialCommand
            }
          )
          break
        case 'monthly_card_purchase':
          purchaseMonthlyCard(
            database,
            { ...context, actor: employee },
            {
              requestId: command.commandId,
              memberId: command.request.memberId,
              reason: command.request.reason ?? '移动端现金购买月卡',
              sourceFinancialCommand
            }
          )
          break
        case 'monthly_card_pause':
          pauseMonthlyCard(
            database,
            { ...context, actor: employee },
            {
              requestId: command.commandId,
              cardId: command.request.cardId,
              reason: command.request.reason,
              sourceFinancialCommand
            }
          )
          break
        case 'monthly_card_resume':
          resumeMonthlyCard(
            database,
            { ...context, actor: employee },
            {
              requestId: command.commandId,
              cardId: command.request.cardId,
              reason: command.request.reason,
              sourceFinancialCommand
            }
          )
          break
        case 'apply_activity_recharge_tiers': {
          const activity = getActivity(
            database,
            context.tenantId,
            command.request.activityId
          )
          if (
            activity.activityType !== 'recharge' ||
            activity.rechargeTiers.length === 0
          ) {
            throw new Error(
              '只有包含赠送档位的充值活动可以应用为当前规则'
            )
          }
          updateRechargeGiftTiers(
            database,
            { ...context, actor: employee },
            {
              tiers: activity.rechargeTiers.map((tier) => ({
                principalFen: tier.principalFen,
                giftFen: tier.giftFen
              })),
              reason: command.request.reason,
              sourceActivityId: activity.id,
              sourceFinancialCommand
            }
          )
          break
        }
      }
    } catch (error) {
      recordFailedEmployeeFinancialCommand(database, context, {
        commandId: command.commandId,
        requestedByEmployeeId: command.requestedBy,
        commandType: command.request.type,
        errorMessage: (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 500)
      })
    }
    const result = listPendingEmployeeFinancialCommandReports(
      database,
      context,
      20
    ).find((item) => item.commandId === command.commandId)
    if (!result) {
      throw new Error('本地财务操作命令执行结果缺失')
    }
    await reportEmployeeFinancialCommandExecution(
      connection,
      context,
      result
    )
  }
}

class AmbiguousCloudOperationError extends Error {
  constructor(readonly operationId: string, cause: unknown) {
    super(
      `云端操作 ${operationId} 的结果尚未确认：${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
    this.name = 'AmbiguousCloudOperationError'
  }
}

async function pushPendingOperationsCloudFirst(
  connection: CloudConnection,
  context: StoreContext
): Promise<void> {
  const database = requireDatabase()
  const batch = listPendingSyncBatch(database.connection, context, 100)
  if (!batch) return
  let contactedCloud = false
  for (const operation of batch.operations) {
    const cloudOperation = enrichCloudSyncOperation(
      database.connection,
      context,
      operation
    )
    const aggregateType = cloudOperation.operationType.split('.')[0] ?? 'unknown'
    recordPendingCloudOutcome(database.connection, context, {
      operationId: operation.operationId,
      aggregateType,
      aggregateId: cloudOperation.aggregateId
    })
    let result = await getCloudOperationOutcome(
      connection,
      cloudOperation.operationId
    )
    contactedCloud = true
    if (!result) {
      try {
        result = await submitCloudSyncCommand(connection, cloudOperation)
      } catch (error) {
        throw new AmbiguousCloudOperationError(
          cloudOperation.operationId,
          error
        )
      }
    }
    const outcome = result.outcome
    if (outcome.status === 'received' || outcome.status === 'processing') {
      break
    }
    applySyncPushResult(database.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      serverTime: result.serverTime,
      receipts: [
        outcome.status === 'confirmed'
          ? {
              operationId: outcome.operationId,
              status: 'confirmed',
              serverVersion: outcome.serverVersion
            }
          : {
              operationId: outcome.operationId,
              status: 'conflict',
              conflictType: outcome.conflictType ?? 'unknown',
              serverPayloadJson: outcome.serverPayloadJson
            }
      ]
    })
    resolveCloudOutcome(database.connection, {
      operationId: outcome.operationId,
      status: outcome.status,
      serverVersion: outcome.serverVersion,
      resultJson: outcome.resultJson,
      errorMessage:
        outcome.status === 'conflict' ? outcome.conflictType : null
    })
  }
  if (contactedCloud) {
    recordSyncBatchAccepted(database.connection, context)
  }
}

async function runCloudSyncOnce(
  throwOnError = false
): Promise<CloudConnectionStatus> {
  if (cloudSyncInProgress) {
    if (throwOnError) throw new Error('同步正在进行，请稍候')
    return getCloudConnectionStatus()
  }
  if (
    !cloudConnection ||
    !localDatabase ||
    databaseRelocating ||
    !isStoreInitialized(localDatabase.connection)
  ) {
    return getCloudConnectionStatus()
  }
  const context = getStoreContext(localDatabase.connection)
  if (!context || context.deviceId !== cloudConnection.deviceId) {
    cloudSyncLastError = '云端凭证与当前本地设备不匹配，请由店长重新注册'
    if (throwOnError) throw new Error(cloudSyncLastError)
    return getCloudConnectionStatus()
  }
  const runtime = ensureCloudRuntimeState(localDatabase.connection, context)
  if (!runtime.cloudPrimaryActivated) {
    cloudSyncLastError = '当前环境尚未执行云主库切换，已阻止旧经营数据上传'
    updateCloudRuntime('configuration_error', {
      reachable: true,
      error: cloudSyncLastError
    })
    if (throwOnError) throw new Error(cloudSyncLastError)
    return getCloudConnectionStatus()
  }
  cloudSyncInProgress = true
  cloudSyncLastAttemptAt = new Date().toISOString()
  try {
    const repairedMemberTiers = ensureMemberTierReconciliationOutbox(
      localDatabase.connection,
      context
    )
    if (repairedMemberTiers.created > 0) {
      logger?.write(
        'info',
        'member_tier_cloud_sync_repaired',
        repairedMemberTiers
      )
    }
    const repairedLegacyImports = ensureLegacyImportCloudSyncOutbox(
      localDatabase.connection,
      context
    )
    if (repairedLegacyImports.created > 0) {
      logger?.write('info', 'legacy_import_cloud_sync_repaired', repairedLegacyImports)
    }
    const before = getLocalSyncStatus(localDatabase.connection, context)
    updateCloudRuntime(
      before.pendingOperations > 0 ? 'reconciling' : 'connecting'
    )
    await pushPendingOperationsCloudFirst(cloudConnection, context)
    const status = getLocalSyncStatus(localDatabase.connection, context)
    const completed = await getCloudSyncResults(
      cloudConnection,
      status.lastConfirmedDeviceSeq
    )
    if (completed.receipts.length > 0) {
      applySyncPushResult(localDatabase.connection, context, completed)
    }
    let pullCursor = getSyncPullCursor(
      localDatabase.connection,
      context.deviceId
    )
    let receivedCloudEvents = false
    for (let page = 0; page < 5; page += 1) {
      const pulled = await getCloudSyncEvents(
        cloudConnection,
        pullCursor
      )
      applySyncPullResult(localDatabase.connection, context, pulled)
      receivedCloudEvents ||= pulled.events.length > 0
      pullCursor = pulled.nextCursor
      if (!pulled.hasMore) break
    }
    const hasCloudMirrorCache = Boolean(localDatabase.connection.prepare(
      `SELECT 1 FROM cloud_read_model_cache
       WHERE tenant_id = ? AND store_id = ? LIMIT 1`
    ).get(context.tenantId, context.storeId))
    if (receivedCloudEvents || !hasCloudMirrorCache) {
      let mirrorCursor = pullCursor ?? '0'
      for (const resource of CLOUD_MIRROR_REFRESH_ORDER) {
        const cursor = await refreshCloudResourceMirror(
          cloudConnection,
          localDatabase,
          context,
          resource
        )
        if (BigInt(cursor) > BigInt(mirrorCursor)) mirrorCursor = cursor
      }
      markCloudMirrorEventsApplied(
        localDatabase.connection,
        context,
        mirrorCursor
      )
    }
    applyPendingInboundEvents(localDatabase.connection, context)
    await processCloudCashierCommands(cloudConnection, context)
    await processCloudEmployeeFinancialCommands(
      cloudConnection,
      context
    )
    let lease = await getOfflineFinancialLease(cloudConnection)
    if (
      lease.currentDeviceOwnsLease &&
      lease.expiresAt &&
      Date.parse(lease.expiresAt) - Date.now() < 6 * 60 * 60 * 1000
    ) {
      lease = await renewOfflineFinancialLease(cloudConnection)
    }
    cacheOfflineFinancialLease(
      localDatabase.connection,
      context,
      lease
    )
    cloudSyncLastSuccessAt = new Date().toISOString()
    cloudSyncLastError = null
    cloudSyncRetryIndex = 0
    cloudSyncNextRetryAt =
      getLocalSyncStatus(localDatabase.connection, context).pendingOperations > 0
        ? Date.now() + CLOUD_RETRY_DELAYS_MS[0]
        : 0
    updateCloudRuntime('cloud_online', { reachable: true, error: null })
  } catch (error) {
    cloudSyncLastError =
      error instanceof Error ? error.message : String(error)
    if (error instanceof AmbiguousCloudOperationError) {
      updateCloudRuntime('result_pending', {
        reachable: true,
        error: cloudSyncLastError
      })
    } else if (isCloudConfigurationFailure(error)) {
      updateCloudRuntime('configuration_error', {
        reachable: true,
        error: cloudSyncLastError
      })
    } else {
      updateCloudRuntime('local_offline', { error: cloudSyncLastError })
    }
    const delay = CLOUD_RETRY_DELAYS_MS[
      Math.min(cloudSyncRetryIndex, CLOUD_RETRY_DELAYS_MS.length - 1)
    ] ?? 15_000
    cloudSyncRetryIndex += 1
    cloudSyncNextRetryAt = Date.now() + delay
    logger?.write('error', 'cloud_sync_failed', {
      message: cloudSyncLastError
    })
    if (throwOnError) throw error
  } finally {
    cloudSyncInProgress = false
  }
  return getCloudConnectionStatus()
}

function startCloudEventStream(): void {
  cloudEventStreamAbort?.abort()
  cloudEventStreamAbort = null
  if (!cloudConnection || !localDatabase) return
  const context = getStoreContext(localDatabase.connection)
  if (!context || context.deviceId !== cloudConnection.deviceId) return
  const connection = cloudConnection
  const controller = new AbortController()
  cloudEventStreamAbort = controller
  void (async () => {
    let retryIndex = 0
    while (!controller.signal.aborted && cloudConnection === connection) {
      try {
        await streamCloudEventHints(connection, {
          signal: controller.signal,
          onCursor: (cursor) => {
            if (controller.signal.aborted || !localDatabase) return
            const currentContext = getStoreContext(localDatabase.connection)
            if (!currentContext) return
            const localCursor = getSyncPullCursor(
              localDatabase.connection,
              currentContext.deviceId
            )
            if (cursor !== (localCursor ?? '0')) {
              cloudSyncNextRetryAt = 0
              void runCloudSyncOnce()
            }
          }
        })
        retryIndex = 0
      } catch (error) {
        if (controller.signal.aborted) return
        logger?.write('error', 'cloud_event_stream_disconnected', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
      const delay = CLOUD_RETRY_DELAYS_MS[
        Math.min(retryIndex, CLOUD_RETRY_DELAYS_MS.length - 1)
      ] ?? 15_000
      retryIndex += 1
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay)
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true }
        )
      })
    }
  })()
}

function wakeCloudSyncWhenNeeded(): void {
  if (
    !cloudConnection ||
    !localDatabase ||
    cloudSyncInProgress ||
    !isStoreInitialized(localDatabase.connection)
  ) {
    return
  }
  const context = getStoreContext(localDatabase.connection)
  if (!context) return
  const pending = getLocalSyncStatus(
    localDatabase.connection,
    context
  ).pendingOperations
  const changed = pending > lastObservedPendingOperations
  lastObservedPendingOperations = pending
  if (
    changed ||
    (pending > 0 && Date.now() >= cloudSyncNextRetryAt) ||
    (cloudSyncLastError && Date.now() >= cloudSyncNextRetryAt)
  ) {
    void runCloudSyncOnce()
  }
}

const CLOUD_MIRROR_REFRESH_ORDER: CloudMirrorResource[] = [
  'store',
  'employees',
  'members',
  'catalog',
  'activities',
  'announcements',
  'board_games',
  'wallet_accounts',
  'wallet_ledger',
  'monthly_cards',
  'monthly_card_events',
  'wechat_recharge_orders',
  'business_templates',
  'orders',
  'order_items',
  'refunds',
  'refund_events',
  'financial_refunds'
]

async function refreshCloudResourceMirror(
  connection: CloudConnection,
  database: LocalDatabase,
  context: StoreContext,
  resource: CloudMirrorResource
): Promise<string> {
  let after: string | null = null
  let eventCursor = '0'
  for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
    const page = await getCloudMirrorPage(connection, resource, after)
    cacheCloudMirrorPage(database.connection, context, page)
    applyCloudMirrorPage(database.connection, context, page)
    eventCursor = page.eventCursor
    after = page.nextCursor
    if (!after) break
  }
  return eventCursor
}

async function refreshCloudResourcesBeforeRead(
  resources: CloudMirrorResource[]
): Promise<void> {
  if (!cloudConnection || !localDatabase || cloudSyncInProgress) return
  const context = getStoreContext(localDatabase.connection)
  if (!context || context.deviceId !== cloudConnection.deviceId) return
  const runtime = getCloudRuntimeState(localDatabase.connection, context)
  if (!runtime.cloudPrimaryActivated) return
  try {
    for (const resource of resources) {
      await refreshCloudResourceMirror(
        cloudConnection,
        localDatabase,
        context,
        resource
      )
    }
    await runCloudSyncOnce()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    cloudSyncLastError = message
    updateCloudRuntime(
      isCloudConfigurationFailure(error)
        ? 'configuration_error'
        : 'local_offline',
      { reachable: isCloudConfigurationFailure(error), error: message }
    )
    logger?.write('error', 'cloud_read_fell_back_to_local_mirror', {
      resources,
      message
    })
  }
}

async function refreshCloudResourceBeforeRead(
  resource: CloudMirrorResource
): Promise<void> {
  return refreshCloudResourcesBeforeRead([resource])
}

function isSamePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

function getSystemStatus(): SystemStatus {
  const database = requireDatabase()
  return {
    appVersion: app.getVersion(),
    dataEnvironment: activeDataEnvironment,
    activeStoreProfileId: requireStoreProfileRegistry().activeProfileId,
    databasePath,
    sqliteVersion: database.sqliteVersion,
    schemaVersion: database.schemaVersion,
    journalMode: database.journalMode,
    modules: FIRST_RELEASE_MODULES
  }
}

function getApplicationState(senderId: number): ApplicationState {
  const database = requireDatabase()
  return {
    initialized: isStoreInitialized(database.connection),
    session: sessions.get(senderId) ?? null,
    system: getSystemStatus()
  }
}

function getDeviceOnboardingState(): DeviceOnboardingState {
  const database = requireDatabase()
  const pending = loadPendingDeviceOnboarding(
    deviceOnboardingConfigPath,
    safeStorage,
    activeDataEnvironment
  )
  return {
    environment: activeDataEnvironment,
    initialized: isStoreInitialized(database.connection),
    pending: pending !== null,
    baseUrl: pending?.baseUrl ?? null,
    requestId: pending?.requestId ?? null,
    storeName: pending?.storeName ?? null,
    lastError: pending?.lastError ?? null
  }
}

function finalizePendingDeviceOnboarding(
  pending: PendingDeviceOnboarding
): { mirrorDatabasePath: string; profileId: string } {
  if (
    pending.phase !== 'enrolled' ||
    !pending.tenantId ||
    !pending.storeId ||
    !pending.storeName ||
    !pending.epochId ||
    !pending.token
  ) {
    throw new Error('Pending device onboarding response is incomplete')
  }
  const registered = registerCloudStoreProfile(requireStoreProfileRegistry(), {
    tenantId: pending.tenantId,
    storeId: pending.storeId,
    storeName: pending.storeName,
    deviceId: pending.deviceId
  })
  const targetPaths = getStoreProfileRuntimePaths(registered.profile)
  ensureStoreProfileDirectories(targetPaths.dataRoot)
  const mirrorDatabasePath = join(
    targetPaths.dataRoot,
    'data',
    `cloud-mirror-${pending.epochId}-${pending.deviceId}.db`
  )
  prepareFreshJoinedCloudMirror({
    mirrorDatabasePath,
    epochId: pending.epochId,
    identity: {
      tenantId: pending.tenantId,
      storeId: pending.storeId,
      storeName: pending.storeName,
      deviceId: pending.deviceId,
      deviceName: pending.deviceName
    }
  })
  saveCloudConnection(targetPaths.cloudConnectionConfigPath, safeStorage, {
    environment: pending.environment,
    baseUrl: pending.baseUrl,
    deviceId: pending.deviceId,
    token: pending.token
  })
  saveConfiguredDatabasePath(
    targetPaths.databaseLocationConfigPath,
    mirrorDatabasePath
  )
  clearRememberedLogin(targetPaths.rememberedLoginPath)
  storeProfileRegistry = registered.registry
  saveStoreProfileRegistry(storeProfileRegistryPath, storeProfileRegistry)
  clearPendingDeviceOnboarding(deviceOnboardingConfigPath)
  return { mirrorDatabasePath, profileId: registered.profile.profileId }
}

function buildSession(
  employee: EmployeeRecord,
  context: StoreContext,
  authenticationMode: NonNullable<SessionUser['authenticationMode']>,
  offlineValidUntil: string | null
): SessionUser {
  return {
    id: employee.id,
    username: employee.username,
    displayName: employee.displayName,
    role: employee.role,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[employee.role]],
    storeId: context.storeId,
    storeName: context.storeName,
    authenticationMode,
    offlineValidUntil
  }
}

function encryptPcVerifier(verifier: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前 Windows 环境无法保护离线登录凭据')
  }
  return safeStorage.encryptString(verifier).toString('base64')
}

function decryptPcVerifier(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前 Windows 环境无法读取离线登录凭据')
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

async function authenticateCloudEmployee(
  database: LocalDatabase,
  context: StoreContext,
  username: string,
  password: string
): Promise<{ employee: EmployeeRecord; mode: 'cloud_online' | 'cloud_offline'; expiresAt: string }> {
  if (!cloudConnection || cloudConnection.deviceId !== context.deviceId) {
    return authenticateOfflineEmployee(database, context, username, password)
  }
  try {
    const manager = database.connection.prepare(
      `SELECT id FROM employee
       WHERE tenant_id = ? AND store_id = ? AND role = 'manager' AND status = 'active'
       ORDER BY created_at LIMIT 1`
    ).get(context.tenantId, context.storeId) as { id: string } | undefined
    if (manager) {
      queuePcCredentialMigrations(database.connection, context, manager.id)
      await runCloudSyncOnce(true)
    }
    const result = await loginDesktopEmployee(cloudConnection, { username, password })
    const localVerifier = await hashPassword(password)
    savePcOfflineCredential(
      database.connection,
      context,
      result,
      encryptPcVerifier(localVerifier)
    )
    const employee = findEmployeeRecordById(
      database.connection,
      context.tenantId,
      result.employee.id
    )
    if (!employee) throw new Error('云端员工登录成功，但本地身份镜像写入失败')
    return {
      employee,
      mode: 'cloud_online',
      expiresAt: result.offlineValidUntil
    }
  } catch (error) {
    if (
      error instanceof CloudRequestError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      const cached = findPcOfflineCredential(database.connection, context, username)
      if (cached) {
        invalidatePcOfflineCredential(database.connection, cached.employeeId)
      }
      throw error
    }
    return authenticateOfflineEmployee(database, context, username, password)
  }
}

async function authenticateOfflineEmployee(
  database: LocalDatabase,
  context: StoreContext,
  username: string,
  password: string
): Promise<{ employee: EmployeeRecord; mode: 'cloud_offline'; expiresAt: string }> {
  const cached = findPcOfflineCredential(database.connection, context, username)
  if (
    !cached ||
    cached.status !== 'active' ||
    cached.invalidatedAt !== null ||
    Date.parse(cached.expiresAt) < Date.now()
  ) {
    throw new Error('需要联网验证员工账号，当前没有有效的离线登录凭据')
  }
  const valid = await verifyPassword(
    password,
    decryptPcVerifier(cached.encryptedVerifier)
  )
  if (!valid) throw new Error('账号或密码错误，或者账号已被停用')
  const employee = findEmployeeRecordById(
    database.connection,
    context.tenantId,
    cached.employeeId
  )
  if (!employee || employee.status !== 'active') {
    throw new Error('账号或密码错误，或者账号已被停用')
  }
  return { employee, mode: 'cloud_offline', expiresAt: cached.expiresAt }
}

function requireText(
  value: unknown,
  fieldName: string,
  options: { min: number; max: number }
): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName}格式不正确`)
  }
  const normalized = value.trim()
  if (normalized.length < options.min || normalized.length > options.max) {
    throw new RangeError(`${fieldName}长度应为 ${options.min}-${options.max} 个字符`)
  }
  return normalized
}

function requireUsername(value: unknown): string {
  const username = requireText(value, '登录账号', { min: 3, max: 32 }).toLowerCase()
  if (!/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw new TypeError('登录账号只能包含文字、数字、点、下划线和连字符')
  }
  return username
}

function requirePassword(value: unknown, fieldName = '密码'): string {
  const password = requireText(value, fieldName, { min: 8, max: 128 })
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    throw new RangeError(`${fieldName}至少包含一个文字和一个数字`)
  }
  return password
}

function requireRole(value: unknown): EmployeeRole {
  if (value !== 'manager' && value !== 'staff') {
    throw new TypeError('员工角色不正确')
  }
  return value
}

function requireEmployeeStatus(value: unknown): EmployeeStatus {
  if (value !== 'active' && value !== 'disabled') {
    throw new TypeError('员工状态不正确')
  }
  return value
}

function requireMemberTier(value: unknown): MemberTier {
  if (value !== 'ordinary' && value !== 'advanced') {
    throw new TypeError('会员等级不正确')
  }
  return value
}

function requireCatalogItemType(value: unknown): CatalogItemType {
  if (
    value !== 'admission' &&
    value !== 'product' &&
    value !== 'service' &&
    value !== 'activity'
  ) {
    throw new TypeError('收费项目类型不正确')
  }
  return value
}

function requireCatalogItemStatus(value: unknown): CatalogItemStatus {
  if (value !== 'active' && value !== 'disabled') {
    throw new TypeError('收费项目状态不正确')
  }
  return value
}

function requireCatalogAvailability(value: unknown): CatalogAvailability {
  if (value !== 'available' && value !== 'sold_out') {
    throw new TypeError('在售状态不正确')
  }
  return value
}

function requireActivityType(value: unknown): ActivityType {
  if (value !== 'recharge' && value !== 'general') {
    throw new TypeError('活动类型不正确')
  }
  return value
}

function requireBoardGameDifficulty(value: unknown): BoardGameDifficulty {
  if (value !== 'light' && value !== 'medium' && value !== 'heavy') {
    throw new TypeError('桌游难度不正确')
  }
  return value
}

function requireBoardGameRecordStatus(value: unknown): BoardGameRecordStatus {
  if (value !== 'active' && value !== 'disabled') {
    throw new TypeError('桌游资料状态不正确')
  }
  return value
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${fieldName}格式不正确`)
  }
  return value
}

function optionalText(
  value: unknown,
  fieldName: string,
  max: number
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireText(value, fieldName, { min: 1, max })
}

function requireActivityFields(
  request: CreateActivityRequest | UpdateActivityRequest
): CreateActivityRequest {
  const startsAtInput = requireText(request?.startsAt, '活动开始时间', {
    min: 10,
    max: 50
  })
  const endsAtInput = requireText(request?.endsAt, '活动结束时间', {
    min: 10,
    max: 50
  })
  const startsAt = Date.parse(startsAtInput)
  const endsAt = Date.parse(endsAtInput)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    throw new RangeError('活动结束时间必须晚于开始时间')
  }
  if (!Array.isArray(request?.rechargeTiers) || request.rechargeTiers.length > 20) {
    throw new RangeError('活动充值档位数量应为 0-20 个')
  }
  const rechargeTiers = request.rechargeTiers.map((tier) => ({
    principalFen: requirePositiveFen(tier?.principalFen, '档位本金'),
    giftFen: requireInteger(tier?.giftFen, '赠送金额', {
      min: 0,
      max: Number.MAX_SAFE_INTEGER
    })
  }))
  const activityType = requireActivityType(request?.activityType)
  if (activityType === 'recharge' && rechargeTiers.length === 0) {
    throw new RangeError('充值活动至少需要一个赠送档位')
  }
  const regularPriceFen =
    request.regularPriceFen === undefined
      ? undefined
      : requireInteger(request.regularPriceFen, '普通价格', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        })
  const advancedPriceFen =
    request.advancedPriceFen === undefined
      ? undefined
      : requireInteger(request.advancedPriceFen, '高级会员价格', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        })
  return {
    title: requireText(request?.title, '活动标题', { min: 2, max: 100 }),
    summary: requireText(request?.summary, '活动摘要', { min: 2, max: 300 }),
    content: requireText(request?.content, '活动内容', { min: 2, max: 5000 }),
    activityType,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    pinned: requireBoolean(request?.pinned, '置顶设置'),
    ...(regularPriceFen === undefined ? {} : { regularPriceFen }),
    ...(advancedPriceFen === undefined ? {} : { advancedPriceFen }),
    allowStoredValue: requireBoolean(request?.allowStoredValue, '储值支付设置'),
    allowWechat: requireBoolean(request?.allowWechat, '微信支付设置'),
    rechargeTiers
  }
}

function requireAnnouncementFields(
  request: CreateAnnouncementRequest | UpdateAnnouncementRequest
): CreateAnnouncementRequest {
  const visibleFromInput = requireText(
    request?.visibleFrom,
    '公告显示时间',
    { min: 10, max: 50 }
  )
  const visibleFrom = Date.parse(visibleFromInput)
  if (!Number.isFinite(visibleFrom)) {
    throw new RangeError('公告显示时间不正确')
  }
  const visibleUntilInput = optionalText(
    request?.visibleUntil,
    '公告结束时间',
    50
  )
  const visibleUntil = visibleUntilInput
    ? Date.parse(visibleUntilInput)
    : undefined
  if (
    visibleUntil !== undefined &&
    (!Number.isFinite(visibleUntil) || visibleUntil <= visibleFrom)
  ) {
    throw new RangeError('公告结束时间必须晚于显示时间')
  }
  return {
    title: requireText(request?.title, '公告标题', { min: 2, max: 100 }),
    content: requireText(request?.content, '公告内容', { min: 2, max: 5000 }),
    pinned: requireBoolean(request?.pinned, '公告置顶设置'),
    visibleFrom: new Date(visibleFrom).toISOString(),
    ...(visibleUntil === undefined
      ? {}
      : { visibleUntil: new Date(visibleUntil).toISOString() })
  }
}

function requireBoardGameMissingParts(
  value: unknown
): Array<{ name: string; quantity: number }> {
  if (!Array.isArray(value) || value.length > 100) {
    throw new RangeError('缺件记录数量应为 0-100 条')
  }
  return value.map((part) => {
    if (!part || typeof part !== 'object') {
      throw new TypeError('缺件记录格式不正确')
    }
    const record = part as Record<string, unknown>
    return {
      name: requireText(record.name, '缺件名称', { min: 1, max: 100 }),
      quantity: requireInteger(record.quantity, '缺件数量', {
        min: 1,
        max: 100_000
      })
    }
  })
}

function requireBoardGameOperations(
  request: UpdateBoardGameOperationsRequest
): UpdateBoardGameOperationsRequest {
  const customerNote = optionalText(
    request?.customerNote,
    '顾客可见备注',
    1000
  )
  const internalNote = optionalText(request?.internalNote, '内部备注', 2000)
  const consignorNickname = optionalText(
    request?.consignorNickname,
    '寄存人昵称',
    100
  )
  return {
    boardGameId: requireText(request?.boardGameId, '桌游编号', {
      min: 1,
      max: 100
    }),
    available: requireBoolean(request?.available, '可用状态'),
    customerConsigned: requireBoolean(
      request?.customerConsigned,
      '顾客寄存状态'
    ),
    missingPieces: requireBoolean(request?.missingPieces, '缺件状态'),
    private: requireBoolean(request?.private, '公开状态'),
    ...(customerNote === undefined ? {} : { customerNote }),
    ...(internalNote === undefined ? {} : { internalNote }),
    ...(consignorNickname === undefined ? {} : { consignorNickname }),
    missingParts: requireBoardGameMissingParts(request?.missingParts),
    reason: requireText(request?.reason, '修改原因', { min: 2, max: 200 })
  }
}

function requireBoardGameFields(
  request: CreateBoardGameRequest | UpdateBoardGameRequest
): CreateBoardGameRequest {
  if (!Array.isArray(request?.categories) || request.categories.length > 20) {
    throw new RangeError('桌游分类数量应为 1-20 个')
  }
  const categories = [
    ...new Set(
      request.categories.map((category) =>
        requireText(category, '桌游分类', { min: 1, max: 40 })
      )
    )
  ]
  if (categories.length === 0) throw new RangeError('请至少填写一个桌游分类')
  const minMinutes =
    request.minMinutes === undefined
      ? undefined
      : requireInteger(request.minMinutes, '最短时长', {
          min: 1,
          max: 100_000
        })
  const maxMinutes =
    request.maxMinutes === undefined
      ? undefined
      : requireInteger(request.maxMinutes, '最长时长', {
          min: 1,
          max: 100_000
        })
  const imageUrl = optionalText(request.imageUrl, '图片 URL', 2048)
  const localImagePath = optionalText(
    request.localImagePath,
    '本地图片路径',
    4096
  )
  if (localImagePath) {
    readManagedBoardGameImage(localImagePath, baseDataRoot)
  }
  const bggId =
    request.bggId === undefined
      ? undefined
      : requireInteger(request.bggId, 'BGG 编号', {
          min: 1,
          max: Number.MAX_SAFE_INTEGER
        })
  const customerNote = optionalText(
    request?.customerNote,
    '顾客可见备注',
    1000
  )
  const internalNote = optionalText(request?.internalNote, '内部备注', 2000)
  const consignorNickname = optionalText(
    request?.consignorNickname,
    '寄存人昵称',
    100
  )
  return {
    name: requireText(request?.name, '桌游名称', { min: 1, max: 120 }),
    introduction: requireText(request?.introduction, '桌游简介', {
      min: 2,
      max: 5000
    }),
    categories,
    minPlayers: requireInteger(request?.minPlayers, '最少人数', {
      min: 1,
      max: 1000
    }),
    maxPlayers: requireInteger(request?.maxPlayers, '最多人数', {
      min: 1,
      max: 1000
    }),
    ...(minMinutes === undefined ? {} : { minMinutes }),
    ...(maxMinutes === undefined ? {} : { maxMinutes }),
    difficulty: requireBoardGameDifficulty(request?.difficulty),
    quantity: requireInteger(request?.quantity, '库存数量', {
      min: 0,
      max: 100_000
    }),
    available: requireBoolean(request?.available, '可用状态'),
    customerConsigned: requireBoolean(
      request?.customerConsigned,
      '顾客寄存状态'
    ),
    missingPieces: requireBoolean(request?.missingPieces, '缺件状态'),
    private: requireBoolean(request?.private, '公开状态'),
    recommended: requireBoolean(request?.recommended, '推荐状态'),
    ...(imageUrl ? { imageUrl } : {}),
    ...(localImagePath ? { localImagePath } : {}),
    ...(bggId === undefined ? {} : { bggId }),
    ...(customerNote === undefined ? {} : { customerNote }),
    ...(internalNote === undefined ? {} : { internalNote }),
    ...(consignorNickname === undefined ? {} : { consignorNickname }),
    missingParts: requireBoardGameMissingParts(request?.missingParts)
  }
}

function requireOrderPaymentMethod(value: unknown): OrderPaymentMethod {
  if (value !== 'cash' && value !== 'stored_value') {
    throw new TypeError('支付方式不正确')
  }
  return value
}

function requireOrderPricingTier(value: unknown): OrderPricingTier {
  if (value !== 'regular' && value !== 'advanced') {
    throw new TypeError('计价类别不正确')
  }
  return value
}

function requireRefundStatus(value: unknown): RefundStatus {
  if (value !== 'pending' && value !== 'completed' && value !== 'rejected') {
    throw new TypeError('退款状态不正确')
  }
  return value
}

function requireFinancialRefundTargetType(value: unknown): FinancialRefundTargetType {
  if (value !== 'monthly_card' && value !== 'cash_recharge') {
    throw new TypeError('退款目标类型不正确')
  }
  return value
}

function requireOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new TypeError(`${fieldName}格式不正确`)
  }
  return value
}

function requireRefundItems(value: unknown): Array<{ orderItemId: string; quantity: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new RangeError('退款需要包含 1-100 个订单项目')
  }
  return value.map((item) => {
    const record = item as { orderItemId?: unknown; quantity?: unknown }
    return {
      orderItemId: requireText(record?.orderItemId, '订单项目编号', {
        min: 1,
        max: 100
      }),
      quantity: requireInteger(record?.quantity, '退款数量', { min: 1, max: 999 })
    }
  })
}

function requirePhone(value: unknown): string {
  const phone = requireText(value, '手机号', { min: 11, max: 11 })
  if (!/^1\d{10}$/.test(phone)) {
    throw new TypeError('请输入正确的 11 位中国大陆手机号')
  }
  return phone
}

function requireInteger(
  value: unknown,
  fieldName: string,
  options: { min: number; max: number }
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < options.min ||
    value > options.max
  ) {
    throw new RangeError(`${fieldName}应为 ${options.min}-${options.max} 的整数`)
  }
  return value
}

function requirePositiveFen(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName}必须是大于 0 的整数分`)
  }
  return value
}

function fileSha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function requireLegacyImportRequest(
  request: ExecuteLegacyImportRequest
): ExecuteLegacyImportRequest {
  const token = requireText(request?.token, '导入预检令牌', { min: 8, max: 100 })
  if (!Array.isArray(request?.memberResolutions)) {
    throw new TypeError('会员冲突处理结果格式不正确')
  }
  if (!Array.isArray(request?.catalogResolutions)) {
    throw new TypeError('收费项目冲突处理结果格式不正确')
  }
  const memberResolutions = request.memberResolutions.map((resolution) => {
    const nickname = resolution?.nickname
    const birthday = resolution?.birthday
    const balance = resolution?.balance
    const monthlyCard = resolution?.monthlyCard
    if (nickname !== 'keep_current' && nickname !== 'use_legacy') {
      throw new TypeError('会员昵称冲突处理方式不正确')
    }
    if (birthday !== 'keep_current' && birthday !== 'use_legacy') {
      throw new TypeError('会员生日冲突处理方式不正确')
    }
    if (balance !== 'keep_current' && balance !== 'add_legacy') {
      throw new TypeError('会员余额冲突处理方式不正确')
    }
    if (monthlyCard !== 'keep_current' && monthlyCard !== 'use_legacy') {
      throw new TypeError('会员月卡冲突处理方式不正确')
    }
    return {
      legacyId: requireText(resolution?.legacyId, '旧会员编号', {
        min: 1,
        max: 100
      }),
      nickname,
      birthday,
      balance,
      monthlyCard
    }
  })
  const catalogResolutions = request.catalogResolutions.map((resolution) => {
    if (
      resolution?.choice !== 'keep_current' &&
      resolution?.choice !== 'import_as_new'
    ) {
      throw new TypeError('收费项目冲突处理方式不正确')
    }
    return {
      legacyId: requireText(resolution.legacyId, '旧收费项目编号', {
        min: 1,
        max: 100
      }),
      choice: resolution.choice
    }
  })
  return { token, memberResolutions, catalogResolutions }
}

function requireSession(event: IpcMainInvokeEvent, permission?: string): SessionUser {
  const session = sessions.get(event.sender.id)
  if (!session) {
    throw new Error('登录状态已失效，请重新登录')
  }
  if (permission && !session.permissions.includes(permission)) {
    throw new Error('当前账号没有执行此操作的权限')
  }
  return session
}

function requireMemberWriteContext(session: SessionUser): {
  tenantId: string
  storeId: string
  storeName: string
  deviceId: string
  actor: EmployeeRecord
} {
  const database = requireDatabase()
  const context = getStoreContext(database.connection)
  if (!context) {
    throw new Error('门店配置缺失')
  }
  const actor = findEmployeeRecordById(database.connection, context.tenantId, session.id)
  if (!actor || actor.status !== 'active') {
    throw new Error('当前员工账号不可用，请重新登录')
  }
  return { ...context, actor }
}

function clearEmployeeSessions(employeeId: string, exceptSenderId?: number): void {
  for (const [senderId, session] of sessions) {
    if (session.id === employeeId && senderId !== exceptSenderId) {
      sessions.delete(senderId)
    }
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f5f3ee',
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })
  const senderId = mainWindow.webContents.id
  mainWindow.webContents.once('destroyed', () => {
    sessions.delete(senderId)
    for (const [token, preflight] of legacyImportPreflights) {
      if (preflight.senderId === senderId) {
        legacyImportPreflights.delete(token)
      }
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    logger?.write('info', 'renderer_loaded')
  })
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl) => {
      logger?.write('error', 'renderer_load_failed', {
        errorCode,
        errorDescription,
        validatedUrl
      })
    }
  )
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger?.write('error', 'renderer_process_gone', {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger?.write('error', 'preload_failed', {
      preloadPath,
      message: error.message,
      stack: error.stack
    })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

async function prepareAndInstallApplicationUpdate(): Promise<void> {
  const database = requireDatabase()
  const backup = await createPreUpgradeBackup({
    databasePath,
    primaryDirectory: join(baseDataRoot, 'backups'),
    secondaryDirectory: secondaryBackupDirectory,
    currentSchemaVersion: database.schemaVersion
  })
  logger?.write('info', 'application_update_backup_created', {
    version: getApplicationUpdateStatus().availableVersion,
    fileName: backup.backup.fileName,
    sha256: backup.backup.sha256,
    secondaryCopied: backup.secondaryPath !== null,
    secondaryError: backup.secondaryError
  })
  installApplicationUpdate()
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.systemStatus, (): SystemStatus => getSystemStatus())
  ipcMain.handle(
    IPC_CHANNELS.systemSwitchDataEnvironment,
    async (_event, request: SwitchDataEnvironmentRequest): Promise<void> => {
      if (!isDataEnvironment(request?.environment)) {
        throw new Error('Data environment must be production or test')
      }
      if (request.environment === activeDataEnvironment) return

      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (context) {
        const syncStatus = getLocalSyncStatus(database.connection, context)
        const runtime = getCloudRuntimeState(database.connection, context)
        const blockReason = environmentSwitchBlockReason({
          cloudPrimaryActivated: runtime.cloudPrimaryActivated,
          pendingOperations: syncStatus.pendingOperations
        })
        if (blockReason) throw new Error(blockReason)
      }

      const targetLabel = request.environment === 'production'
        ? '生产环境'
        : '测试环境'
      const currentLabel = activeDataEnvironment === 'production'
        ? '生产环境'
        : '测试环境'
      const options = {
        type: 'warning' as const,
        buttons: ['取消', `切换到${targetLabel}`],
        defaultId: 0,
        cancelId: 0,
        title: '切换数据环境',
        message: `确认从${currentLabel}切换到${targetLabel}？`,
        detail:
          '两套环境的本地数据库、云端连接、同步队列和备份完全独立。程序将自动备份当前数据库并重新启动；尚未切换云主库的旧离线记录只留在原环境，不会上传。'
      }
      const choice = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (choice.response !== 1) return

      if (isStoreInitialized(database.connection)) {
        await performDatabaseBackup(
          'pre_environment_switch',
          randomUUID()
        )
      }
      saveDataEnvironment(dataEnvironmentConfigPath, request.environment)
      logger?.write('info', 'data_environment_switch_requested', {
        from: activeDataEnvironment,
        to: request.environment
      })
      app.relaunch()
      app.exit(0)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.storeProfilesList,
    (): StoreConfigurationSummary[] => listStoreProfiles()
  )
  ipcMain.handle(
    IPC_CHANNELS.storeProfilesSwitch,
    async (
      event,
      request: SwitchStoreProfileRequest
    ): Promise<ApplicationState> => {
      const profileId = requireText(request?.profileId, '门店配置编号', {
        min: 8,
        max: 100
      })
      const registry = requireStoreProfileRegistry()
      if (activeRuntimeProfileId === profileId) {
        return getApplicationState(event.sender.id)
      }
      const target = registry.profiles.find(
        (profile) => profile.profileId === profileId
      )
      if (!target) throw new Error('门店配置不存在')
      const blockReason = storeProfileSwitchBlockReason()
      if (blockReason) throw new Error(blockReason)
      const options = {
        type: 'warning' as const,
        buttons: ['取消', `切换到${target.storeName}`],
        defaultId: 0,
        cancelId: 0,
        title: '切换门店',
        message: `确认切换到“${target.storeName}”？`,
        detail:
          '程序会关闭当前门店数据库和同步连接，再载入目标门店。各门店的数据库、云端令牌、待上传队列、备份和登录记忆相互隔离。'
      }
      const choice = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (choice.response !== 1) return getApplicationState(event.sender.id)
      await activateStoreProfileRuntime(profileId)
      void runCloudSyncOnce()
      return getApplicationState(event.sender.id)
    }
  )
  ipcMain.handle(IPC_CHANNELS.cloudConnectionStatus, (event) => {
    requireSession(event)
    return getCloudConnectionStatus()
  })
  ipcMain.handle(IPC_CHANNELS.storeProfileGet, async (event) => {
    requireSession(event, PERMISSIONS.storeProfileManage)
    await refreshCloudResourceBeforeRead('store')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return getStoreProfile(database.connection, context)
  })
  ipcMain.handle(
    IPC_CHANNELS.storeProfileUpdate,
    (event, request: UpdateStoreProfileRequest) => {
      const session = requireSession(
        event,
        PERMISSIONS.storeProfileManage
      )
      const database = requireDatabase()
      const updated = updateStoreProfile(
        database.connection,
        requireMemberWriteContext(session),
        request
      )
      updateActiveStoreProfileIdentity()
      return updated
    }
  )
  ipcMain.handle(IPC_CHANNELS.cloudInboundConflicts, (event) => {
    requireSession(event, PERMISSIONS.cloudManage)
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return listInboundSyncConflicts(database.connection, context)
  })
  ipcMain.handle(
    IPC_CHANNELS.cloudInboundConflictResolve,
    (event, request: ResolveInboundSyncConflictRequest): void => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      const database = requireDatabase()
      resolveInboundSyncConflict(
        database.connection,
        requireMemberWriteContext(session),
        request
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.cloudConnectionEnroll,
    async (event, request: EnrollCloudConnectionRequest) => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      const context = requireMemberWriteContext(session)
      const requestId = requireText(request?.requestId, '请求编号', {
        min: 8,
        max: 100
      })
      const baseUrl = normalizeCloudBaseUrl(
        requireText(request?.baseUrl, '云端地址', { min: 8, max: 2048 })
      )
      const enrollmentSecret = requireText(
        request?.enrollmentSecret,
        '设备注册密钥',
        { min: 32, max: 512 }
      )
      const enrolled = await enrollCloudDevice({
        environment: activeDataEnvironment,
        baseUrl,
        enrollmentSecret,
        tenantId: context.tenantId,
        storeId: context.storeId,
        deviceId: context.deviceId,
        storeName: context.storeName,
        deviceName: getLocalDeviceName(context.deviceId)
      })
      if (
        enrolled.environment !== activeDataEnvironment ||
        enrolled.tenantId !== context.tenantId ||
        enrolled.storeId !== context.storeId ||
        enrolled.deviceId !== context.deviceId
      ) {
        throw new Error('云端返回的设备身份与本机不一致，已拒绝保存')
      }
      const nextConnection: CloudConnection = {
        environment: activeDataEnvironment,
        baseUrl,
        deviceId: context.deviceId,
        token: enrolled.token
      }
      saveCloudConnection(
        cloudConnectionConfigPath,
        safeStorage,
        nextConnection
      )
      cloudConnection = nextConnection
      configureApplicationUpdateFeed(nextConnection.baseUrl)
      cloudSyncLastAttemptAt = null
      cloudSyncLastSuccessAt = null
      cloudSyncLastError = null
      updateCloudRuntime('connecting', { error: null })
      startCloudEventStream()
      recordSystemOperation(requireDatabase().connection, context, {
        requestId,
        action: 'system.cloud.connected',
        reason: '店长注册或轮换云端设备凭证',
        details: {
          baseUrl,
          deviceId: context.deviceId
        }
      })
      const baseline = { created: 0, byType: {} }
      logger?.write('info', 'cloud_device_enrolled', {
        baseUrl,
        deviceId: context.deviceId,
        baselineOperations: baseline.created
      })
      updateCloudRuntime('configuration_error', {
        reachable: true,
        error: '请先归档本地库并连接云主库'
      })
      return getCloudConnectionStatus()
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.deviceOnboardingState,
    (): DeviceOnboardingState => getDeviceOnboardingState()
  )
  ipcMain.handle(
    IPC_CHANNELS.deviceOnboardingJoin,
    async (
      _event,
      request: JoinCloudStoreBeforeLoginRequest
    ): Promise<JoinCloudStoreBeforeLoginResult> => {
      requireDatabase()
      const switchBlockReason = storeProfileSwitchBlockReason()
      if (switchBlockReason) throw new Error(switchBlockReason)
      const requestId = requireText(request?.requestId, '请求编号', {
        min: 8,
        max: 100
      })
      const baseUrl = normalizeCloudBaseUrl(
        requireText(request?.baseUrl, '云端地址', { min: 8, max: 2048 })
      )
      const pairingCode = requireText(request?.pairingCode, '门店加入码', {
        min: 16,
        max: 48
      })
      const existing = loadPendingDeviceOnboarding(
        deviceOnboardingConfigPath,
        safeStorage,
        activeDataEnvironment
      )
      const deviceId = existing?.requestId === requestId
        ? existing.deviceId
        : randomUUID()
      const deviceName = existing?.requestId === requestId
        ? existing.deviceName
        : `Windows收银设备-${deviceId.slice(0, 8)}`
      let pending: PendingDeviceOnboarding = {
        version: 1,
        phase: 'requested',
        environment: activeDataEnvironment,
        requestId,
        baseUrl,
        deviceId,
        deviceName,
        updatedAt: new Date().toISOString()
      }
      savePendingDeviceOnboarding(
        deviceOnboardingConfigPath,
        safeStorage,
        pending
      )
      try {
        const compactCode = pairingCode.replaceAll('-', '').trim()
        const paired = compactCode.length === 32
          ? await enrollAuthorizedCloudStore({
              environment: activeDataEnvironment,
              baseUrl,
              activationCode: pairingCode,
              deviceId,
              deviceName,
              requestId
            })
          : await enrollPairedCloudDevice({
              environment: activeDataEnvironment,
              baseUrl,
              pairingCode,
              deviceId,
              deviceName,
              requestId
            })
        if (
          paired.environment !== activeDataEnvironment ||
          paired.deviceId !== deviceId
        ) {
          throw new Error('云端返回的配对身份与本机请求不一致')
        }
        pending = {
          ...pending,
          phase: 'enrolled',
          tenantId: paired.tenantId,
          storeId: paired.storeId,
          storeName: paired.storeName,
          epochId: paired.epochId,
          token: paired.token,
          updatedAt: new Date().toISOString()
        }
        savePendingDeviceOnboarding(
          deviceOnboardingConfigPath,
          safeStorage,
          pending
        )
        const finalized = finalizePendingDeviceOnboarding(pending)
        await activateStoreProfileRuntime(finalized.profileId)
        void runCloudSyncOnce()
        logger?.write('info', 'prelogin_device_onboarding_completed', {
          environment: activeDataEnvironment,
          storeId: paired.storeId,
          deviceId,
          epochId: paired.epochId
        })
        return {
          environment: activeDataEnvironment,
          tenantId: paired.tenantId,
          storeId: paired.storeId,
          storeName: paired.storeName,
          deviceId,
          epochId: paired.epochId,
          mirrorDatabasePath: finalized.mirrorDatabasePath
        }
      } catch (error) {
        savePendingDeviceOnboarding(
          deviceOnboardingConfigPath,
          safeStorage,
          {
            ...pending,
            updatedAt: new Date().toISOString(),
            lastError: error instanceof Error ? error.message : String(error)
          }
        )
        throw error
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.cloudPairingCodeCreate,
    async (event): Promise<CloudPairingCode> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      return createCloudDevicePairingCode(cloudConnection, session.id)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.tenantStoresList,
    async (event): Promise<TenantStoreAdminSummary[]> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      return listCloudTenantStores(cloudConnection, session.id)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.tenantStoreCreate,
    async (
      event,
      request: CreateTenantStoreRequest
    ): Promise<CreateTenantStoreResult> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      return createCloudTenantStore(cloudConnection, session.id, request)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.employeeStoreAccessList,
    async (event): Promise<EmployeeStoreAccessSummary[]> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      return listCloudEmployeeStoreAccess(cloudConnection, session.id)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.employeeStoreAccessSet,
    async (
      event,
      request: SetEmployeeStoreAccessRequest
    ): Promise<EmployeeStoreAccessSummary> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      const updated = await setCloudEmployeeStoreAccess(
        cloudConnection,
        session.id,
        request
      )
      void runCloudSyncOnce()
      return updated
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.businessTemplatesList,
    async (event): Promise<BusinessTemplateSummary[]> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      return listCloudBusinessTemplates(cloudConnection, session.id)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.businessTemplateSave,
    async (event, request: SaveBusinessTemplateRequest): Promise<BusinessTemplateSummary> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      const result = await saveCloudBusinessTemplate(cloudConnection, session.id, request)
      void runCloudSyncOnce()
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.businessTemplateOverrideSave,
    async (
      event,
      request: SaveBusinessTemplateOverrideRequest
    ): Promise<BusinessTemplateSummary> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      const result = await saveCloudBusinessTemplateOverride(
        cloudConnection,
        session.id,
        request
      )
      void runCloudSyncOnce()
      return result
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.cloudStoreJoin,
    async (
      event,
      request: JoinCloudStoreRequest
    ): Promise<JoinCloudStoreResult | null> => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      const database = requireDatabase()
      const baseUrl = normalizeCloudBaseUrl(
        requireText(request?.baseUrl, '云端地址', { min: 8, max: 2048 })
      )
      const pairingCode = requireText(request?.pairingCode, '门店加入码', {
        min: 16,
        max: 32
      })
      const choice = mainWindow
        ? await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['取消', '归档本地库并加入'],
            defaultId: 0,
            cancelId: 0,
            title: '加入现有云门店',
            message: '确认让本设备加入现有云主库？',
            detail:
              '当前本地 SQLite 将生成只读归档，不会上传会员、余额、订单或历史。加入成功后程序会重启。'
          })
        : await dialog.showMessageBox({
            type: 'warning',
            buttons: ['取消', '归档本地库并加入'],
            defaultId: 0,
            cancelId: 0,
            title: '加入现有云门店',
            message: '确认让本设备加入现有云主库？',
            detail:
              '当前本地 SQLite 将生成只读归档，不会上传会员、余额、订单或历史。加入成功后程序会重启。'
          })
      if (choice.response !== 1) return null

      const localManager = database.connection.prepare(
        `SELECT password_hash FROM employee
         WHERE id = ? AND role = 'manager' AND status = 'active'`
      ).get(session.id) as { password_hash: string } | undefined
      if (!localManager) {
        throw new Error('当前店长本地登录凭据缺失，无法建立离线登录镜像')
      }
      const deviceId = randomUUID()
      const paired = await enrollPairedCloudDevice({
        environment: activeDataEnvironment,
        baseUrl,
        pairingCode,
        deviceId,
        deviceName: getLocalDeviceName(deviceId)
      })
      if (
        paired.environment !== activeDataEnvironment ||
        paired.deviceId !== deviceId
      ) {
        throw new Error('云端返回的配对身份与本机请求不一致')
      }
      const nextConnection: CloudConnection = {
        environment: activeDataEnvironment,
        baseUrl,
        deviceId,
        token: paired.token
      }
      const mirrorDatabasePath = join(
        baseDataRoot,
        'data',
        `cloud-mirror-${paired.epochId}-${deviceId}.db`
      )
      const prepared = await prepareJoinedLocalCloudMirror({
        source: database,
        sourceDatabasePath: databasePath,
        archiveDirectory: join(baseDataRoot, 'backups', 'cloud-cutover'),
        mirrorDatabasePath,
        epochId: paired.epochId,
        identity: {
          tenantId: paired.tenantId,
          storeId: paired.storeId,
          storeName: paired.storeName,
          deviceId,
          deviceName: paired.deviceName,
          manager: {
            id: paired.manager.id,
            username: paired.manager.username,
            displayName: paired.manager.displayName,
            passwordHash: localManager.password_hash,
            createdAt: paired.manager.createdAt,
            updatedAt: paired.manager.updatedAt
          }
        }
      })
      saveCloudConnection(
        cloudConnectionConfigPath,
        safeStorage,
        nextConnection
      )
      saveConfiguredDatabasePath(
        databaseLocationConfigPath,
        mirrorDatabasePath
      )
      clearRememberedLogin(rememberedLoginPath)
      logger?.write('info', 'cloud_store_joined', {
        environment: activeDataEnvironment,
        storeId: paired.storeId,
        deviceId,
        epochId: paired.epochId,
        archivePath: prepared.archivePath,
        archiveSha256: prepared.archiveSha256
      })
      app.relaunch()
      app.exit(0)
      return {
        ...prepared,
        storeName: paired.storeName,
        deviceId
      }
    }
  )
  ipcMain.handle(IPC_CHANNELS.cloudSyncNow, async (event) => {
    requireSession(event, PERMISSIONS.cloudManage)
    if (!cloudConnection) throw new Error('尚未配置云端连接')
    return runCloudSyncOnce(true)
  })
  ipcMain.handle(
    IPC_CHANNELS.cloudPrepareEmptyCutover,
    async (event): Promise<PrepareEmptyCloudCutoverResult | null> => {
      requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      const localStatus = getLocalSyncStatus(database.connection, context)
      const existingEpoch = await getCurrentCloudMirrorEpoch(cloudConnection)
      const environmentLabel =
        activeDataEnvironment === 'production' ? '生产环境' : '测试环境'
      const options = {
        type: 'warning' as const,
        buttons: ['取消', '归档并启用空云主库'],
        defaultId: 0,
        cancelId: 0,
        title: existingEpoch ? '加入现有云主库' : '启用空云主库',
        message: existingEpoch
          ? `确认让本设备加入${environmentLabel}现有云主库？`
          : `确认切换${environmentLabel}到新的空云业务库？`,
        detail:
          `现有 SQLite 会生成只读归档，本机会员、余额、订单和历史不会上传。` +
          `当前待上传 ${localStatus.pendingOperations} 条；切换后程序将重启。`
      }
      const choice = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (choice.response !== 1) return null

      const epochId = existingEpoch?.epochId ?? randomUUID()
      const mirrorDatabasePath = join(
        baseDataRoot,
        'data',
        `cloud-mirror-${epochId}.db`
      )
      const prepared = await prepareEmptyLocalCloudMirror({
        source: database,
        sourceDatabasePath: databasePath,
        archiveDirectory: join(baseDataRoot, 'backups', 'cloud-cutover'),
        mirrorDatabasePath,
        epochId,
        seedIdentityOutbox: !existingEpoch
      })
      try {
        if (!existingEpoch) {
          await activateEmptyCloudMirrorEpoch(cloudConnection, {
            epochId,
            archiveSha256: prepared.archiveSha256
          })
        }
      } catch (error) {
        rmSync(mirrorDatabasePath, { force: true })
        rmSync(`${mirrorDatabasePath}-wal`, { force: true })
        rmSync(`${mirrorDatabasePath}-shm`, { force: true })
        throw error
      }
      saveConfiguredDatabasePath(
        databaseLocationConfigPath,
        mirrorDatabasePath
      )
      logger?.write('info', 'empty_cloud_primary_cutover_activated', {
        epochId,
        environment: activeDataEnvironment,
        archivePath: prepared.archivePath,
        archiveSha256: prepared.archiveSha256,
        mirrorDatabasePath
      })
      app.relaunch()
      app.exit(0)
      return prepared
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.cloudClaimOfflineFinancialLease,
    async (event) => {
      const session = requireSession(event, PERMISSIONS.cloudManage)
      if (!cloudConnection) throw new Error('尚未配置云端连接')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      const lease = await claimOfflineFinancialLease(
        cloudConnection,
        session.id
      )
      cacheOfflineFinancialLease(database.connection, context, lease)
      logger?.write('info', 'offline_financial_lease_claimed', {
        deviceId: context.deviceId,
        expiresAt: lease.expiresAt,
        leaseVersion: lease.leaseVersion
      })
      return lease
    }
  )
  ipcMain.handle(IPC_CHANNELS.applicationUpdateStatus, (event) => {
    requireSession(event, PERMISSIONS.cloudManage)
    return getApplicationUpdateStatus()
  })
  ipcMain.handle(IPC_CHANNELS.applicationUpdateCheck, async (event) => {
    requireSession(event, PERMISSIONS.cloudManage)
    let next = getApplicationUpdateStatus()
    if (next.state !== 'downloaded') {
      next = await checkApplicationUpdate()
    }
    if (next.state === 'idle') {
      const options = {
        type: 'info' as const,
        buttons: ['确定'],
        defaultId: 0,
        title: '检查更新',
        message: '当前已是最新版本',
        detail: `当前版本：${next.currentVersion}`
      }
      if (mainWindow) await dialog.showMessageBox(mainWindow, options)
      else await dialog.showMessageBox(options)
      return next
    }
    if (next.state === 'available') {
      const options = {
        type: 'question' as const,
        buttons: ['稍后', '在线更新'],
        defaultId: 1,
        cancelId: 0,
        title: '发现新版本',
        message: `发现新版本 ${next.availableVersion ?? ''}`,
        detail: '是否现在在线下载？下载期间可以继续查看当前页面。'
      }
      const choice = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (choice.response === 0) return next
      next = await downloadApplicationUpdate()
    }
    if (next.state === 'downloaded') {
      const options = {
        type: 'question' as const,
        buttons: ['稍后安装', '立即重启安装'],
        defaultId: 1,
        cancelId: 0,
        title: '更新下载完成',
        message: `版本 ${next.availableVersion ?? ''} 已下载`,
        detail: '立即安装前会先创建一致性数据库保护备份。'
      }
      const choice = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (choice.response === 1) {
        await prepareAndInstallApplicationUpdate()
      }
    }
    return next
  })
  ipcMain.handle(IPC_CHANNELS.applicationUpdateDownload, async (event) => {
    requireSession(event, PERMISSIONS.cloudManage)
    return downloadApplicationUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.applicationUpdateInstall, async (event) => {
    requireSession(event, PERMISSIONS.cloudManage)
    await prepareAndInstallApplicationUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.systemBackupOverview, (event) => {
    requireSession(event, PERMISSIONS.backupManage)
    return getBackupOverview()
  })
  ipcMain.handle(
    IPC_CHANNELS.systemBackupNow,
    async (event, request: CreateBackupRequest) => {
      const session = requireSession(event, PERMISSIONS.backupManage)
      const context = requireMemberWriteContext(session)
      const requestId = requireText(request?.requestId, '请求编号', {
        min: 8,
        max: 100
      })
      const result = await performDatabaseBackup('manual', requestId)
      recordSystemOperation(requireDatabase().connection, context, {
        requestId,
        action: 'system.backup.created',
        reason: '店长立即备份',
        details: {
          fileName: result.backup.fileName,
          sha256: result.backup.sha256,
          secondaryCopied: result.secondaryPath !== null,
          secondaryError: result.secondaryError
        }
      })
      return result
    }
  )
  ipcMain.handle(IPC_CHANNELS.systemBackupSetSecondary, async (event) => {
    const session = requireSession(event, PERMISSIONS.backupManage)
    const context = requireMemberWriteContext(session)
    const choiceOptions = {
      type: 'question' as const,
      buttons: ['取消', '清除第二目录', '选择目录'],
      defaultId: 2,
      cancelId: 0,
      title: '第二备份目录',
      message: secondaryBackupDirectory
        ? '更改或清除第二备份目录'
        : '设置第二备份目录',
      detail: secondaryBackupDirectory
        ? `当前目录：\n${secondaryBackupDirectory}`
        : '建议选择另一块磁盘或外置设备。主备份仍保存在程序数据目录。'
    }
    const choice = mainWindow
      ? await dialog.showMessageBox(mainWindow, choiceOptions)
      : await dialog.showMessageBox(choiceOptions)
    if (choice.response === 0) {
      return { canceled: true, settings: getBackupOverview().settings }
    }
    const before = secondaryBackupDirectory
    if (choice.response === 1) {
      secondaryBackupDirectory = null
    } else {
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, {
            title: '选择第二备份目录',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({
            title: '选择第二备份目录',
            properties: ['openDirectory', 'createDirectory']
          })
      if (selected.canceled || !selected.filePaths[0]) {
        return { canceled: true, settings: getBackupOverview().settings }
      }
      secondaryBackupDirectory = resolve(selected.filePaths[0])
      if (isSamePath(secondaryBackupDirectory, join(baseDataRoot, 'backups'))) {
        secondaryBackupDirectory = before
        throw new Error('第二备份目录不能与主备份目录相同')
      }
      mkdirSync(secondaryBackupDirectory, { recursive: true })
    }
    saveSecondaryBackupDirectory(
      backupSettingsConfigPath,
      secondaryBackupDirectory
    )
    recordSystemOperation(requireDatabase().connection, context, {
      requestId: randomUUID(),
      action: 'system.backup.secondary_directory_changed',
      reason: '店长修改第二备份目录',
      details: {
        beforeConfigured: before !== null,
        afterConfigured: secondaryBackupDirectory !== null
      }
    })
    return { canceled: false, settings: getBackupOverview().settings }
  })
  ipcMain.handle(
    IPC_CHANNELS.systemRestoreDatabase,
    async (event, request: RestoreDatabaseRequest) => {
      const session = requireSession(event, PERMISSIONS.backupManage)
      const sourceDatabase = requireDatabase()
      const sourceContext = requireMemberWriteContext(session)
      const requestId = requireText(request?.requestId, '请求编号', {
        min: 8,
        max: 100
      })
      const selected = mainWindow
        ? await dialog.showOpenDialog(mainWindow, {
            title: '选择要恢复的 ZyApp 数据库备份',
            properties: ['openFile'],
            filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
          })
        : await dialog.showOpenDialog({
            title: '选择要恢复的 ZyApp 数据库备份',
            properties: ['openFile'],
            filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
          })
      const selectedPath = selected.filePaths[0]
      if (selected.canceled || !selectedPath) {
        return {
          canceled: true,
          restoredFromPath: null,
          protectionBackupPath: null,
          schemaVersion: null
        }
      }
      if (isSamePath(selectedPath, databasePath)) {
        throw new Error('不能使用当前正在运行的数据库进行恢复')
      }
      const candidate = inspectDatabaseFile(selectedPath)
      if (!candidate.integrityOk) {
        throw new Error(`备份完整性校验失败：${candidate.integrityMessage}`)
      }
      if (candidate.storeCount !== 1) {
        throw new Error('备份中必须且只能包含一家门店')
      }
      if (
        candidate.schemaVersion <= 0 ||
        candidate.schemaVersion > sourceDatabase.schemaVersion
      ) {
        throw new Error(
          `备份 Schema v${candidate.schemaVersion} 不能由当前程序 Schema v${sourceDatabase.schemaVersion} 恢复`
        )
      }
      const confirmationOptions = {
        type: 'warning' as const,
        buttons: ['取消', '备份当前数据并恢复'],
        defaultId: 0,
        cancelId: 0,
        title: '恢复数据库',
        message: '恢复后将退出当前登录状态。',
        detail:
          `候选文件：${basename(selectedPath)}\n` +
          `Schema：v${candidate.schemaVersion}\n` +
          `SHA-256：${candidate.sha256}\n\n` +
          '程序会先完整备份当前数据库；任何一步失败都会自动恢复当前数据库。'
      }
      const confirmation = mainWindow
        ? await dialog.showMessageBox(mainWindow, confirmationOptions)
        : await dialog.showMessageBox(confirmationOptions)
      if (confirmation.response !== 1) {
        return {
          canceled: true,
          restoredFromPath: null,
          protectionBackupPath: null,
          schemaVersion: null
        }
      }
      if (backupInProgress) {
        throw new Error('已有备份任务正在进行，请稍候再恢复')
      }

      databaseRelocating = true
      let protectionBackupPath: string | null = null
      try {
        const protection = await createDatabaseBackup({
          database: sourceDatabase,
          primaryDirectory: join(baseDataRoot, 'backups'),
          secondaryDirectory: secondaryBackupDirectory,
          kind: 'pre_restore',
          requestId: `${requestId}:protection`
        })
        protectionBackupPath = protection.backup.filePath
        const restored = replaceDatabaseFromBackup({
          sourcePath: selectedPath,
          activePath: databasePath,
          activeDatabase: sourceDatabase,
          onDatabaseUnavailable: () => {
            localDatabase = null
          },
          onDatabaseReady: (database) => {
            localDatabase = database
          },
          beforeCommit: (database) => {
            const restoredContext = getStoreContext(database.connection)
            if (!restoredContext) throw new Error('恢复后的门店配置缺失')
            recordSystemOperation(
              database.connection,
              { ...restoredContext, actor: sourceContext.actor },
              {
                requestId,
                action: 'system.database.restored',
                reason: '店长恢复数据库',
                details: {
                  sourceFileName: basename(selectedPath),
                  sourceSha256: candidate.sha256,
                  protectionBackupFileName: basename(protection.backup.filePath)
                }
              }
            )
          }
        })
        sessions.clear()
        logger?.write('warn', 'database_restored', {
          sourceFileName: basename(selectedPath),
          sourceSha256: candidate.sha256,
          protectionBackupPath,
          schemaVersion: restored.schemaVersion
        })
        setTimeout(() => mainWindow?.webContents.reload(), 250)
        return {
          canceled: false,
          restoredFromPath: selectedPath,
          protectionBackupPath,
          schemaVersion: restored.schemaVersion
        }
      } finally {
        databaseRelocating = false
      }
    }
  )
  ipcMain.handle(IPC_CHANNELS.systemExportDiagnostics, async (event) => {
    const session = requireSession(event, PERMISSIONS.backupManage)
    const database = requireDatabase()
    const context = requireMemberWriteContext(session)
    const timestamp = new Date().toISOString().slice(0, 10)
    const options = {
      title: '导出脱敏诊断包',
      defaultPath: `zyapp-diagnostic-${timestamp}.json.gz`,
      filters: [{ name: 'Gzip JSON', extensions: ['json.gz', 'gz'] }]
    }
    const selected = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) {
      return { canceled: true, filePath: null, sha256: null }
    }
    let fileWritten = false
    try {
      const exported = exportDiagnosticPackage({
        destinationPath: selected.filePath,
        system: getSystemStatus(),
        database,
        databasePath,
        dataRoot: baseDataRoot,
        logDirectory: join(baseDataRoot, 'logs'),
        backupOverview: getBackupOverview()
      })
      fileWritten = true
      recordSystemOperation(database.connection, context, {
        requestId: randomUUID(),
        action: 'system.diagnostics.exported',
        reason: '店长导出脱敏诊断包',
        details: {
          fileName: basename(selected.filePath),
          sha256: exported.sha256
        }
      })
      return {
        canceled: false,
        filePath: selected.filePath,
        sha256: exported.sha256
      }
    } catch (error) {
      if (fileWritten) rmSync(selected.filePath, { force: true })
      throw error
    }
  })
  ipcMain.handle(IPC_CHANNELS.systemRelocateDatabase, async (event) => {
    requireSession(event, PERMISSIONS.backupManage)
    const sourceDatabase = requireDatabase()
    const sourcePath = databasePath
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: '选择新的本地数据库目录',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择新的本地数据库目录',
          properties: ['openDirectory', 'createDirectory']
        })
    if (selected.canceled || !selected.filePaths[0]) {
      return {
        canceled: true,
        databasePath: sourcePath,
        previousDatabasePath: null,
        backupPath: null,
        oldDatabaseRetained: false
      }
    }
    const destinationPath = resolve(selected.filePaths[0], 'zyapp.db')
    if (isSamePath(destinationPath, sourcePath)) {
      return {
        canceled: true,
        databasePath: sourcePath,
        previousDatabasePath: null,
        backupPath: null,
        oldDatabaseRetained: false
      }
    }
    if (existsSync(destinationPath)) {
      throw new Error('目标目录已经存在 zyapp.db，请选择空目录')
    }
    const confirmation = mainWindow
      ? await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['取消', '备份并移动'],
          defaultId: 0,
          cancelId: 0,
          title: '移动本地数据库',
          message: '移动期间门店数据会短暂停止写入。',
          detail: `程序会先备份并校验，再把数据库移动到：\n${destinationPath}`
        })
      : await dialog.showMessageBox({
          type: 'warning',
          buttons: ['取消', '备份并移动'],
          defaultId: 0,
          cancelId: 0,
          title: '移动本地数据库',
          message: '移动期间门店数据会短暂停止写入。',
          detail: `程序会先备份并校验，再把数据库移动到：\n${destinationPath}`
        })
    if (confirmation.response !== 1) {
      return {
        canceled: true,
        databasePath: sourcePath,
        previousDatabasePath: null,
        backupPath: null,
        oldDatabaseRetained: false
      }
    }
    if (backupInProgress) {
      throw new Error('已有备份任务正在进行，请稍候再移动数据库')
    }

    databaseRelocating = true
    let backupPath: string | null = null
    let destinationDatabase: LocalDatabase | null = null
    let configSaved = false
    try {
      const backup = await createDatabaseBackup({
        database: sourceDatabase,
        primaryDirectory: join(baseDataRoot, 'backups'),
        secondaryDirectory: secondaryBackupDirectory,
        kind: 'pre_move',
        requestId: randomUUID()
      })
      backupPath = backup.backup.filePath
      sourceDatabase.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      sourceDatabase.close()
      localDatabase = null

      copyDatabaseFileVerified(sourcePath, destinationPath)
      destinationDatabase = openLocalDatabase(destinationPath)
      const integrity = destinationDatabase.connection
        .prepare('PRAGMA integrity_check')
        .get() as { integrity_check: string }
      if (integrity.integrity_check !== 'ok') {
        throw new Error(`新数据库完整性校验失败：${integrity.integrity_check}`)
      }
      saveConfiguredDatabasePath(databaseLocationConfigPath, destinationPath)
      configSaved = true
      localDatabase = destinationDatabase
      destinationDatabase = null
      databasePath = destinationPath

      let oldDatabaseRetained = false
      try {
        rmSync(sourcePath, { force: true })
        rmSync(`${sourcePath}-wal`, { force: true })
        rmSync(`${sourcePath}-shm`, { force: true })
      } catch {
        oldDatabaseRetained = true
      }
      try {
        logger?.write('info', 'database_relocated', {
          previousDatabasePath: sourcePath,
          databasePath,
          backupPath,
          oldDatabaseRetained
        })
      } catch {
        // Database relocation already succeeded; a logging failure must not roll it back.
      }
      return {
        canceled: false,
        databasePath,
        previousDatabasePath: sourcePath,
        backupPath,
        oldDatabaseRetained
      }
    } catch (error) {
      destinationDatabase?.close()
      if (!configSaved) {
        rmSync(destinationPath, { force: true })
        localDatabase = openLocalDatabase(sourcePath)
        databasePath = sourcePath
      }
      throw error
    } finally {
      databaseRelocating = false
    }
  })
  ipcMain.handle(IPC_CHANNELS.legacyImportPreflight, async (event) => {
    requireSession(event, PERMISSIONS.backupManage)
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: '选择旧收银系统数据库',
          properties: ['openFile'],
          filters: [
            { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: '选择旧收银系统数据库',
          properties: ['openFile'],
          filters: [
            { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
    const sourcePath = selected.filePaths[0]
    if (selected.canceled || !sourcePath) {
      return { canceled: true as const }
    }
    if (isSamePath(sourcePath, databasePath)) {
      throw new Error('不能把当前正在使用的数据库作为旧库导入')
    }
    const sourceName = basename(sourcePath)
    const sourceSha256 = fileSha256(sourcePath)
    const sourceSizeBytes = statSync(sourcePath).size
    const source = new DatabaseSync(sourcePath, { readOnly: true })
    try {
      source.exec('PRAGMA query_only = ON')
      const inspection = inspectLegacyDatabase(
        source,
        database.connection,
        context,
        { sourceName, sourceSha256, sourceSizeBytes }
      )
      for (const [existingToken, existing] of legacyImportPreflights) {
        if (existing.senderId === event.sender.id) {
          legacyImportPreflights.delete(existingToken)
        }
      }
      const token = randomUUID()
      legacyImportPreflights.set(token, {
        senderId: event.sender.id,
        sourcePath,
        sourceName,
        sourceSha256,
        sourceSizeBytes
      })
      logger?.write('info', 'legacy_import_preflight_completed', {
        sourceName,
        sourceSha256,
        summary: inspection.summary,
        alreadyImported: inspection.alreadyImported
      })
      return {
        canceled: false as const,
        token,
        ...inspection
      }
    } finally {
      source.close()
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.legacyImportExecute,
    async (event, rawRequest: ExecuteLegacyImportRequest) => {
      const session = requireSession(event, PERMISSIONS.backupManage)
      const request = requireLegacyImportRequest(rawRequest)
      const preflight = legacyImportPreflights.get(request.token)
      if (!preflight || preflight.senderId !== event.sender.id) {
        throw new Error('导入预检已失效，请重新选择旧数据库')
      }
      if (!existsSync(preflight.sourcePath)) {
        throw new Error('预检的旧数据库文件已经不存在，请重新选择')
      }
      const currentSize = statSync(preflight.sourcePath).size
      const currentSha256 = fileSha256(preflight.sourcePath)
      if (
        currentSize !== preflight.sourceSizeBytes ||
        currentSha256 !== preflight.sourceSha256
      ) {
        throw new Error('旧数据库在预检后发生变化，请重新检查后再导入')
      }

      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      if (backupInProgress) {
        throw new Error('已有备份任务正在进行，请稍候再导入旧数据库')
      }
      databaseRelocating = true
      try {
        const backup = await createDatabaseBackup({
          database,
          primaryDirectory: join(baseDataRoot, 'backups'),
          secondaryDirectory: secondaryBackupDirectory,
          kind: 'pre_import',
          requestId: request.token
        })
        const backupPath = backup.backup.filePath
        const source = new DatabaseSync(preflight.sourcePath, { readOnly: true })
        try {
          source.exec('PRAGMA query_only = ON')
          const result = importLegacyDatabase(
            source,
            database.connection,
            context,
            {
              sourceName: preflight.sourceName,
              sourceSha256: preflight.sourceSha256,
              sourceSizeBytes: preflight.sourceSizeBytes
            },
           {
              memberResolutions: request.memberResolutions,
              catalogResolutions: request.catalogResolutions,
              prepareCloudSync: getCloudRuntimeState(
                database.connection,
                context
              ).cloudPrimaryActivated
            }
          )
          legacyImportPreflights.delete(request.token)
          logger?.write('info', 'legacy_import_completed', {
            sourceName: preflight.sourceName,
            sourceSha256: preflight.sourceSha256,
            batchId: result.batchId,
            backupPath,
            importedMembers: result.importedMembers,
            mergedMembers: result.mergedMembers,
            openingBalanceFen: result.openingBalanceFen
          })
          return { ...result, backupPath }
        } finally {
          source.close()
        }
      } finally {
        databaseRelocating = false
      }
    }
  )
  ipcMain.handle(IPC_CHANNELS.applicationState, (event): ApplicationState =>
    getApplicationState(event.sender.id)
  )
  ipcMain.handle(
    IPC_CHANNELS.bootstrapStore,
    async (event, request: BootstrapStoreRequest): Promise<ApplicationState> => {
      const database = requireDatabase()
      if (isStoreInitialized(database.connection)) {
        throw new Error('门店已经初始化，不能重复执行')
      }

      const storeName = requireText(request?.storeName, '门店名称', { min: 1, max: 60 })
      const deviceName = requireText(request?.deviceName, '设备名称', { min: 1, max: 60 })
      const managerUsername = requireUsername(request?.managerUsername)
      const managerDisplayName = requireText(request?.managerDisplayName, '店长姓名', {
        min: 1,
        max: 40
      })
      const managerPassword = requirePassword(request?.managerPassword, '店长密码')
      const managerPasswordHash = await hashPassword(managerPassword)

      bootstrapLocalStore(database.connection, {
        storeName,
        deviceName,
        managerUsername,
        managerDisplayName,
        managerPasswordHash
      })
      updateActiveStoreProfileIdentity()
      logger?.write('info', 'store_bootstrapped', { storeName, deviceName, managerUsername })
      void runAutomaticBackupIfDue()
      return getApplicationState(event.sender.id)
    }
  )
  ipcMain.handle(IPC_CHANNELS.savedLoginGet, () =>
    loadRememberedLogin(rememberedLoginPath, safeStorage)
  )
  ipcMain.handle(
    IPC_CHANNELS.login,
    async (event, request: LoginRequest): Promise<SessionUser> => {
      const database = requireDatabase()
      if (!isStoreInitialized(database.connection)) {
        throw new Error('请先完成门店初始化')
      }

      const username = requireUsername(request?.username)
      const password = requireText(request?.password, '密码', { min: 1, max: 128 })
      const storeContext = getStoreContext(database.connection)
      if (!storeContext) {
        throw new Error('门店配置缺失')
      }
      const runtime = getCloudRuntimeState(database.connection, storeContext)
      let employee: EmployeeRecord | null = null
      let authenticationMode: NonNullable<SessionUser['authenticationMode']> = 'local'
      let offlineValidUntil: string | null = null
      try {
        if (runtime.cloudPrimaryActivated) {
          const authenticated = await authenticateCloudEmployee(
            database,
            storeContext,
            username,
            password
          )
          employee = authenticated.employee
          authenticationMode = authenticated.mode
          offlineValidUntil = authenticated.expiresAt
        } else {
          const localEmployee = findEmployeeByUsername(database.connection, username)
          const passwordValid = localEmployee
            ? await verifyPassword(password, localEmployee.passwordHash)
            : false
          if (!localEmployee || localEmployee.status !== 'active' || !passwordValid) {
            throw new Error('账号或密码错误，或者账号已被停用')
          }
          employee = localEmployee
        }
        recordLoginAttempt(database.connection, findEmployeeByUsername(
          database.connection,
          username
        ), username, true)
      } catch (error) {
        recordLoginAttempt(
          database.connection,
          findEmployeeByUsername(database.connection, username),
          username,
          false
        )
        logger?.write('warn', 'employee_login_failed', {
          username,
          cloudPrimary: runtime.cloudPrimaryActivated,
          reason: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
      if (!employee) throw new Error('员工身份缺失')
      const session = buildSession(
        employee,
        storeContext,
        authenticationMode,
        offlineValidUntil
      )
      if (request?.rememberPassword === true) {
        saveRememberedLogin(rememberedLoginPath, safeStorage, {
          username,
          password
        })
      } else {
        clearRememberedLogin(rememberedLoginPath)
      }
      sessions.set(event.sender.id, session)
      logger?.write('info', 'employee_logged_in', {
        employeeId: employee.id,
        username: employee.username,
        role: employee.role
      })
      return session
    }
  )
  ipcMain.handle(IPC_CHANNELS.logout, (event): void => {
    const session = sessions.get(event.sender.id)
    sessions.delete(event.sender.id)
    logger?.write('info', 'employee_logged_out', {
      employeeId: session?.id,
      username: session?.username
    })
  })
  ipcMain.handle(IPC_CHANNELS.employeeList, async (event) => {
    requireSession(event, PERMISSIONS.employeeManage)
    await refreshCloudResourceBeforeRead('employees')
    return listEmployees(requireDatabase().connection)
  })
  ipcMain.handle(
    IPC_CHANNELS.employeeCreate,
    async (event, request: CreateEmployeeRequest) => {
      const session = requireSession(event, PERMISSIONS.employeeManage)
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) {
        throw new Error('门店配置缺失')
      }

      const username = requireUsername(request?.username)
      const displayName = requireText(request?.displayName, '员工姓名', { min: 1, max: 40 })
      const password = requirePassword(request?.password, '初始密码')
      const role = requireRole(request?.role)
      const passwordHash = await hashPassword(password)

      try {
        return createEmployee(
          database.connection,
          { ...context, actorId: session.id },
          { username, displayName, passwordHash, role }
        )
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
          throw new Error('该登录账号已经存在')
        }
        throw error
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.employeeSetStatus,
    (event, request: SetEmployeeStatusRequest) => {
      const session = requireSession(event, PERMISSIONS.employeeManage)
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) {
        throw new Error('门店配置缺失')
      }

      const employeeId = requireText(request?.employeeId, '员工编号', { min: 1, max: 100 })
      const status = requireEmployeeStatus(request?.status)
      const reason = requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      const employee = setEmployeeStatus(
        database.connection,
        { ...context, actorId: session.id },
        { employeeId, status, reason }
      )
      if (status === 'disabled') {
        invalidatePcOfflineCredential(database.connection, employeeId)
        clearEmployeeSessions(employeeId)
      }
      return employee
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.employeeResetPassword,
    async (event, request: ResetEmployeePasswordRequest): Promise<void> => {
      const session = requireSession(event, PERMISSIONS.employeeManage)
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) {
        throw new Error('门店配置缺失')
      }

      const employeeId = requireText(request?.employeeId, '员工编号', { min: 1, max: 100 })
      const newPassword = requirePassword(request?.newPassword, '新密码')
      const reason = requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      const passwordHash = await hashPassword(newPassword)
      resetEmployeePassword(
        database.connection,
        { ...context, actorId: session.id },
        { employeeId, passwordHash, reason }
      )
      invalidatePcOfflineCredential(database.connection, employeeId)
      clearEmployeeSessions(employeeId, employeeId === session.id ? event.sender.id : undefined)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.employeeConfigureMobileAccess,
    async (
      event,
      request: ConfigureEmployeeMobileAccessRequest
    ) => {
      const session = requireSession(event, PERMISSIONS.employeeManage)
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) {
        throw new Error('门店配置缺失')
      }

      const employeeId = requireText(request?.employeeId, '员工编号', {
        min: 1,
        max: 100
      })
      const enabled = request?.enabled
      if (typeof enabled !== 'boolean') {
        throw new Error('移动登录状态不正确')
      }
      const reason = requireText(request?.reason, '操作原因', {
        min: 2,
        max: 200
      })
      const passwordHash = enabled
        ? await hashPassword(requirePassword(request?.newPassword, '移动端密码'))
        : undefined

      return configureEmployeeMobileAccess(
        database.connection,
        { ...context, actorId: session.id },
        {
          employeeId,
          enabled,
          ...(passwordHash ? { passwordHash } : {}),
          reason
        }
      )
    }
  )
  ipcMain.handle(IPC_CHANNELS.memberSearch, async (event, request: SearchMembersRequest) => {
    requireSession(event, PERMISSIONS.memberRead)
    await refreshCloudResourceBeforeRead('members')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) {
      throw new Error('门店配置缺失')
    }
    const query = requireText(request?.query ?? '', '查询内容', { min: 0, max: 60 })
    const limit =
      request?.limit === undefined
        ? 50
        : requireInteger(request.limit, '查询数量', { min: 1, max: 100 })
    return searchMembers(database.connection, context.tenantId, query, limit)
  })
  ipcMain.handle(IPC_CHANNELS.memberCashierList, async (event) => {
    requireSession(event, PERMISSIONS.memberRead)
    await refreshCloudResourceBeforeRead('members')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) {
      throw new Error('门店配置缺失')
    }
    return listCashierMembers(database.connection, context.tenantId)
  })
  ipcMain.handle(IPC_CHANNELS.memberCreate, (event, request: CreateMemberRequest) => {
    const session = requireSession(event, PERMISSIONS.memberWrite)
    const database = requireDatabase()
    const context = requireMemberWriteContext(session)
    const phone = requirePhone(request?.phone)
    const nickname = requireText(request?.nickname, '会员昵称', { min: 1, max: 40 })
    if (request?.confirmedAtLeast14 !== true) {
      throw new Error('未确认已满 14 周岁，不能建立可储值会员')
    }
    const note =
      request.note === undefined
        ? undefined
        : requireText(request.note, '会员备注', { min: 0, max: 500 })

    const birthdayProvided =
      request?.birthdayMonth !== undefined || request?.birthdayDay !== undefined
    if (
      birthdayProvided &&
      (request?.birthdayMonth === undefined || request?.birthdayDay === undefined)
    ) {
      throw new Error('生日月份和日期需要同时填写')
    }
    const birthday = birthdayProvided
      ? {
          birthdayMonth: requireInteger(request?.birthdayMonth, '生日月份', {
            min: 1,
            max: 12
          }),
          birthdayDay: requireInteger(request?.birthdayDay, '生日日期', {
            min: 1,
            max: 31
          })
        }
      : {}

    try {
      return createMember(database.connection, context, {
        phone,
        nickname,
        confirmedAtLeast14: true,
        ...birthday,
        ...(note ? { note } : {})
      })
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
        throw new Error('该手机号已经绑定会员，请直接查询原会员')
      }
      if (error instanceof Error && error.message === 'Member phone already exists') {
        throw new Error('该手机号已经绑定会员，请直接查询原会员')
      }
      if (
        error instanceof Error &&
        error.message === 'Only managers can restore disabled members'
      ) {
        throw new Error('该手机号对应会员已注销，请店长重新登记恢复')
      }
      throw error
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.memberAdjustTier,
    (event, request: AdjustMemberTierRequest) => {
      const session = requireSession(event, PERMISSIONS.memberWrite)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return adjustMemberTier(database.connection, context, {
        memberId: requireText(request?.memberId, '会员编号', { min: 1, max: 100 }),
        tier: requireMemberTier(request?.tier),
        reason: requireText(request?.reason, '调整原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.memberCorrectBirthday,
    (event, request: CorrectMemberBirthdayRequest) => {
      const session = requireSession(event, PERMISSIONS.memberWrite)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return correctMemberBirthday(database.connection, context, {
        memberId: requireText(request?.memberId, '会员编号', { min: 1, max: 100 }),
        month: requireInteger(request?.month, '生日月份', { min: 1, max: 12 }),
        day: requireInteger(request?.day, '生日日期', { min: 1, max: 31 }),
        reason: requireText(request?.reason, '修正原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(IPC_CHANNELS.memberDisable, (event, request: DisableMemberRequest) => {
    const session = requireSession(event, PERMISSIONS.memberWrite)
    const database = requireDatabase()
    const context = requireMemberWriteContext(session)
    return disableMember(database.connection, context, {
      memberId: requireText(request?.memberId, '会员编号', { min: 1, max: 100 }),
      reason: requireText(request?.reason, '注销原因', { min: 2, max: 200 })
    })
  })
  ipcMain.handle(IPC_CHANNELS.walletDetails, async (event, request: GetWalletDetailsRequest) => {
    requireSession(event, PERMISSIONS.memberRead)
    await refreshCloudResourceBeforeRead('business_templates')
    await refreshCloudResourceBeforeRead('wallet_accounts')
    await refreshCloudResourceBeforeRead('wallet_ledger')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) {
      throw new Error('门店配置缺失')
    }
    return getWalletDetails(
      database.connection,
      context,
      requireText(request?.memberId, '会员编号', { min: 1, max: 100 })
    )
  })
  ipcMain.handle(
    IPC_CHANNELS.walletCashRecharge,
    (event, request: CashRechargeRequest) => {
      const session = requireSession(event, PERMISSIONS.walletRechargeCash)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? '前台现金充值'
          : requireText(request.reason, '充值备注', { min: 0, max: 200 }) ||
            '前台现金充值'
      return cashRecharge(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        memberId: requireText(request?.memberId, '会员编号', { min: 1, max: 100 }),
        principalFen: requirePositiveFen(request?.principalFen, '充值金额'),
        reason
      })
    }
  )
  ipcMain.handle(IPC_CHANNELS.walletDebit, (event, request: WalletDebitRequest) => {
    const session = requireSession(event, PERMISSIONS.walletDebit)
    const database = requireDatabase()
    const context = requireMemberWriteContext(session)
    return debitWallet(database.connection, context, {
      requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
      memberId: requireText(request?.memberId, '会员编号', { min: 1, max: 100 }),
      amountFen: requirePositiveFen(request?.amountFen, '扣款金额'),
      reason: requireText(request?.reason, '扣款原因', { min: 2, max: 200 })
    })
  })
  ipcMain.handle(
    IPC_CHANNELS.walletReverseCashRecharge,
    (event, request: ReverseCashRechargeRequest) => {
      const session = requireSession(event, PERMISSIONS.walletAdjust)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return reverseCashRecharge(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        rechargeId: requireText(request?.rechargeId, '充值编号', { min: 1, max: 100 }),
        reason: requireText(request?.reason, '冲正原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.walletUpdateGiftTiers,
    (event, request: UpdateRechargeGiftTiersRequest) => {
      const session = requireSession(event, PERMISSIONS.walletAdjust)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      if (!Array.isArray(request?.tiers) || request.tiers.length > 20) {
        throw new Error('赠送档位数量应为 0-20 个')
      }
      const tiers = request.tiers.map((tier) => ({
        principalFen: requirePositiveFen(tier?.principalFen, '档位本金'),
        giftFen: requireInteger(tier?.giftFen, '赠送金额', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        })
      }))
      return updateRechargeGiftTiers(database.connection, context, {
        tiers,
        reason: requireText(request?.reason, '修改原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.monthlyCardDetails,
    async (event, request: GetMonthlyCardDetailsRequest) => {
      requireSession(event, PERMISSIONS.memberRead)
      await refreshCloudResourceBeforeRead('business_templates')
      await refreshCloudResourceBeforeRead('monthly_cards')
      await refreshCloudResourceBeforeRead('monthly_card_events')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      return getMonthlyCardDetails(
        database.connection,
        context,
        requireText(request?.memberId, '会员编号', { min: 1, max: 100 })
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.monthlyCardPurchase,
    (event, request: PurchaseMonthlyCardRequest) => {
      const session = requireSession(event, PERMISSIONS.monthlyCardManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return purchaseMonthlyCard(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        memberId: requireText(request?.memberId, '会员编号', { min: 1, max: 100 }),
        reason:
          request?.reason === undefined
            ? '前台现金购买月卡'
            : requireText(request.reason, '购买备注', { min: 0, max: 200 }) ||
              '前台现金购买月卡'
      })
    }
  )
  const registerMonthlyCardAction = (
    channel: string,
    action: typeof pauseMonthlyCard | typeof resumeMonthlyCard | typeof useMonthlyCard
  ): void => {
    ipcMain.handle(channel, (event, request: MonthlyCardActionRequest | MonthlyCardUseRequest) => {
      const session = requireSession(event, PERMISSIONS.monthlyCardManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return action(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        cardId: requireText(request?.cardId, '月卡编号', { min: 1, max: 100 }),
        reason: requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      })
    })
  }
  registerMonthlyCardAction(IPC_CHANNELS.monthlyCardPause, pauseMonthlyCard)
  registerMonthlyCardAction(IPC_CHANNELS.monthlyCardResume, resumeMonthlyCard)
  registerMonthlyCardAction(IPC_CHANNELS.monthlyCardUse, useMonthlyCard)
  ipcMain.handle(
    IPC_CHANNELS.monthlyCardExtend,
    (event, request: ExtendMonthlyCardRequest) => {
      const session = requireSession(event, PERMISSIONS.monthlyCardManage)
      if (session.role !== 'manager') throw new Error('仅店长可以人工延长月卡')
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return extendMonthlyCard(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        cardId: requireText(request?.cardId, '月卡编号', { min: 1, max: 100 }),
        days: requireInteger(request?.days, '延长天数', { min: 1, max: 365 }),
        reason: requireText(request?.reason, '延长原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.monthlyCardRefund,
    (event, request: MonthlyCardActionRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return refundMonthlyCard(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        cardId: requireText(request?.cardId, '月卡编号', { min: 1, max: 100 }),
        reason: requireText(request?.reason, '退款原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(IPC_CHANNELS.catalogList, async (event) => {
    requireSession(event, PERMISSIONS.catalogRead)
    await refreshCloudResourceBeforeRead('catalog')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return listCatalogItems(database.connection, context)
  })
  ipcMain.handle(
    IPC_CHANNELS.catalogCreate,
    (event, request: CreateCatalogItemRequest) => {
      const session = requireSession(event, PERMISSIONS.pricingManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const note =
        request?.note === undefined
          ? undefined
          : requireText(request.note, '项目备注', { min: 0, max: 500 })
      return createCatalogItem(database.connection, context, {
        name: requireText(request?.name, '项目名称', { min: 1, max: 80 }),
        itemType: requireCatalogItemType(request?.itemType),
        regularPriceFen: requireInteger(request?.regularPriceFen, '普通价', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        }),
        advancedPriceFen: requireInteger(request?.advancedPriceFen, '高级会员价', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        }),
        ...(note ? { note } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.catalogUpdate,
    (event, request: UpdateCatalogItemRequest) => {
      const session = requireSession(event, PERMISSIONS.pricingManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const note =
        request?.note === undefined
          ? undefined
          : requireText(request.note, '项目备注', { min: 0, max: 500 })
      return updateCatalogItem(database.connection, context, {
        itemId: requireText(request?.itemId, '项目编号', { min: 1, max: 100 }),
        name: requireText(request?.name, '项目名称', { min: 1, max: 80 }),
        itemType: requireCatalogItemType(request?.itemType),
        regularPriceFen: requireInteger(request?.regularPriceFen, '普通价', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        }),
        advancedPriceFen: requireInteger(request?.advancedPriceFen, '高级会员价', {
          min: 0,
          max: Number.MAX_SAFE_INTEGER
        }),
        ...(note ? { note } : {}),
        reason: requireText(request?.reason, '修改原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.catalogSetStatus,
    (event, request: SetCatalogItemStatusRequest) => {
      const session = requireSession(event, PERMISSIONS.pricingManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return setCatalogItemStatus(database.connection, context, {
        itemId: requireText(request?.itemId, '项目编号', { min: 1, max: 100 }),
        status: requireCatalogItemStatus(request?.status),
        reason: requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.catalogSetAvailability,
    (event, request: SetCatalogAvailabilityRequest) => {
      const session = requireSession(event, PERMISSIONS.catalogAvailabilityManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return setCatalogAvailability(database.connection, context, {
        itemId: requireText(request?.itemId, '项目编号', { min: 1, max: 100 }),
        availability: requireCatalogAvailability(request?.availability),
        reason: requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(IPC_CHANNELS.activityList, async (event) => {
    requireSession(event, PERMISSIONS.activityRead)
    await refreshCloudResourceBeforeRead('business_templates')
    await refreshCloudResourceBeforeRead('activities')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return listActivities(database.connection, context)
  })
  ipcMain.handle(
    IPC_CHANNELS.activityCreate,
    (event, request: CreateActivityRequest) => {
      const session = requireSession(event, PERMISSIONS.activityManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return createActivity(
        database.connection,
        context,
        requireActivityFields(request)
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.activityUpdate,
    (event, request: UpdateActivityRequest) => {
      const session = requireSession(event, PERMISSIONS.activityManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return updateActivity(
        database.connection,
        context,
        requireText(request?.activityId, '活动编号', { min: 1, max: 100 }),
        requireActivityFields(request),
        requireText(request?.reason, '修改原因', { min: 2, max: 200 })
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.activitySetStatus,
    (event, request: SetActivityStatusRequest) => {
      const session = requireSession(event, PERMISSIONS.activityManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      if (request?.status !== 'published' && request?.status !== 'disabled') {
        throw new TypeError('活动状态不正确')
      }
      return setActivityStatus(
        database.connection,
        context,
        requireText(request?.activityId, '活动编号', { min: 1, max: 100 }),
        request.status,
        requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.activityApplyRechargeTiers,
    (event, request: { activityId?: unknown; reason?: unknown }) => {
      const session = requireSession(event, PERMISSIONS.activityManage)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const activity = getActivity(
        database.connection,
        context.tenantId,
        requireText(request?.activityId, '活动编号', { min: 1, max: 100 })
      )
      if (activity.activityType !== 'recharge' || activity.rechargeTiers.length === 0) {
        throw new Error('只有包含赠送档位的充值活动可以应用为当前规则')
      }
      return updateRechargeGiftTiers(database.connection, context, {
        tiers: activity.rechargeTiers.map((tier) => ({
          principalFen: tier.principalFen,
          giftFen: tier.giftFen
        })),
        sourceActivityId: activity.id,
        reason: requireText(request?.reason, '应用原因', { min: 2, max: 200 })
      })
    }
  )
  ipcMain.handle(IPC_CHANNELS.announcementList, async (event) => {
    requireSession(event, PERMISSIONS.contentRead)
    await refreshCloudResourceBeforeRead('announcements')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return listAnnouncements(database.connection, context)
  })
  ipcMain.handle(
    IPC_CHANNELS.announcementCreate,
    (event, request: CreateAnnouncementRequest) => {
      const session = requireSession(event, PERMISSIONS.contentManage)
      const database = requireDatabase()
      return createAnnouncement(
        database.connection,
        requireMemberWriteContext(session),
        requireAnnouncementFields(request)
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.announcementUpdate,
    (event, request: UpdateAnnouncementRequest) => {
      const session = requireSession(event, PERMISSIONS.contentManage)
      const database = requireDatabase()
      return updateAnnouncement(
        database.connection,
        requireMemberWriteContext(session),
        requireText(request?.announcementId, '公告编号', {
          min: 1,
          max: 100
        }),
        requireAnnouncementFields(request),
        requireText(request?.reason, '修改原因', { min: 2, max: 200 })
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.announcementSetStatus,
    (event, request: SetAnnouncementStatusRequest) => {
      const session = requireSession(event, PERMISSIONS.contentManage)
      const database = requireDatabase()
      const status = request?.status as AnnouncementStatus
      if (status !== 'published' && status !== 'disabled') {
        throw new TypeError('公告状态不正确')
      }
      return setAnnouncementStatus(
        database.connection,
        requireMemberWriteContext(session),
        requireText(request?.announcementId, '公告编号', {
          min: 1,
          max: 100
        }),
        status,
        requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      )
    }
  )
  ipcMain.handle(IPC_CHANNELS.boardGameList, async (event) => {
    requireSession(event, PERMISSIONS.contentRead)
    await refreshCloudResourceBeforeRead('board_games')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return listBoardGames(database.connection, context)
  })
  ipcMain.handle(
    IPC_CHANNELS.boardGameCreate,
    (event, request: CreateBoardGameRequest) => {
      const session = requireSession(event, PERMISSIONS.contentManage)
      const database = requireDatabase()
      return createBoardGame(
        database.connection,
        requireMemberWriteContext(session),
        requireBoardGameFields(request)
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.boardGameUpdate,
    (event, request: UpdateBoardGameRequest) => {
      const session = requireSession(event, PERMISSIONS.contentManage)
      const database = requireDatabase()
      return updateBoardGame(
        database.connection,
        requireMemberWriteContext(session),
        requireText(request?.boardGameId, '桌游编号', {
          min: 1,
          max: 100
        }),
        requireBoardGameFields(request),
        requireText(request?.reason, '修改原因', { min: 2, max: 200 })
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.boardGameUpdateOperations,
    (event, request: UpdateBoardGameOperationsRequest) => {
      const session = requireSession(
        event,
        PERMISSIONS.boardGameOperationsManage
      )
      const database = requireDatabase()
      return updateBoardGameOperations(
        database.connection,
        requireMemberWriteContext(session),
        requireBoardGameOperations(request)
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.boardGameSetRecordStatus,
    (event, request: SetBoardGameRecordStatusRequest) => {
      const session = requireSession(event, PERMISSIONS.contentManage)
      const database = requireDatabase()
      return setBoardGameRecordStatus(
        database.connection,
        requireMemberWriteContext(session),
        requireText(request?.boardGameId, '桌游编号', {
          min: 1,
          max: 100
        }),
        requireBoardGameRecordStatus(request?.status),
        requireText(request?.reason, '操作原因', { min: 2, max: 200 })
      )
    }
  )
  ipcMain.handle(IPC_CHANNELS.boardGameImportImage, async (event) => {
    requireSession(event, PERMISSIONS.contentManage)
    const options: OpenDialogOptions = {
      title: '选择桌游封面',
      properties: ['openFile'],
      filters: [
        {
          name: '图片文件',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif']
        }
      ]
    }
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const sourcePath = selected.filePaths[0]
    if (selected.canceled || !sourcePath) {
      return { canceled: true, managedPath: null, previewDataUrl: null }
    }
    const imported = importBoardGameImage(sourcePath, baseDataRoot)
    return { canceled: false, ...imported }
  })
  ipcMain.handle(
    IPC_CHANNELS.boardGameReadImage,
    (event, request: { managedPath?: unknown }) => {
      requireSession(event, PERMISSIONS.contentRead)
      return readManagedBoardGameImage(
        requireText(request?.managedPath, '本地图片路径', {
          min: 1,
          max: 4096
        }),
        baseDataRoot
      )
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.orderCreate,
    (event, request: CreateSalesOrderRequest) => {
      const session = requireSession(event, PERMISSIONS.orderCreate)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      if (!Array.isArray(request?.lines) || request.lines.length < 1 || request.lines.length > 100) {
        throw new RangeError('一张消费单需要包含 1-100 个收费项目')
      }
      const customerMemberId =
        request.customerMemberId === undefined
          ? undefined
          : requireText(request.customerMemberId, '顾客会员编号', { min: 1, max: 100 })
      const walletMemberId =
        request.walletMemberId === undefined
          ? undefined
          : requireText(request.walletMemberId, '储值账户会员编号', { min: 1, max: 100 })
      const note =
        request.note === undefined
          ? undefined
          : requireText(request.note, '订单备注', { min: 0, max: 500 })
      return createSalesOrder(database.connection, context, {
        requestId: requireText(request.requestId, '请求编号', { min: 8, max: 100 }),
        ...(customerMemberId ? { customerMemberId } : {}),
        paymentMethod: requireOrderPaymentMethod(request.paymentMethod),
        ...(walletMemberId ? { walletMemberId } : {}),
        lines: request.lines.map((line) => {
          if ('customName' in line) {
            return {
              customName: requireText(line.customName, '自定义收款名称', {
                min: 1,
                max: 60
              }),
              customUnitPriceFen: requirePositiveFen(
                line.customUnitPriceFen,
                '自定义收款金额'
              ),
              quantity: requireInteger(line.quantity, '数量', { min: 1, max: 999 }),
              pricingTier: 'regular' as const
            }
          }
          if (
            line?.personalAdmissionBenefit !== undefined &&
            typeof line.personalAdmissionBenefit !== 'boolean'
          ) {
            throw new TypeError('本人入场权益标记不正确')
          }
          return {
            catalogItemId: requireText(line?.catalogItemId, '收费项目编号', {
              min: 1,
              max: 100
            }),
            quantity: requireInteger(line?.quantity, '数量', { min: 1, max: 999 }),
            pricingTier: requireOrderPricingTier(line?.pricingTier),
            ...(line?.personalAdmissionBenefit
              ? { personalAdmissionBenefit: true }
              : {})
          }
        }),
        ...(note ? { note } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.orderRecent,
    async (event, request?: ListRecentOrdersRequest) => {
      requireSession(event, PERMISSIONS.orderCreate)
      await refreshCloudResourceBeforeRead('orders')
      await refreshCloudResourceBeforeRead('order_items')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      const limit =
        request?.limit === undefined
          ? 20
          : requireInteger(request.limit, '订单数量', { min: 1, max: 100 })
      return listRecentOrders(database.connection, context, limit)
    }
  )
  ipcMain.handle(IPC_CHANNELS.cashierRefresh, async (event) => {
    requireSession(event, PERMISSIONS.orderCreate)
    await refreshCloudResourcesBeforeRead([
      'members',
      'catalog',
      'orders',
      'order_items',
      'wallet_accounts',
      'wallet_ledger',
      'monthly_cards',
      'monthly_card_events'
    ])
  })
  ipcMain.handle(
    IPC_CHANNELS.transactionSalesList,
    async (event, request?: ListTransactionRecordsRequest) => {
      requireSession(event, PERMISSIONS.orderCreate)
      await refreshCloudResourceBeforeRead('orders')
      await refreshCloudResourceBeforeRead('order_items')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      return listSalesTransactions(database.connection, context, request)
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.transactionRechargeList,
    async (event, request?: ListTransactionRecordsRequest) => {
      requireSession(event, PERMISSIONS.memberRead)
      await refreshCloudResourceBeforeRead('wechat_recharge_orders')
      await refreshCloudResourceBeforeRead('members')
      await refreshCloudResourceBeforeRead('wallet_ledger')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      return listRechargeTransactions(database.connection, context, request)
    }
  )
  ipcMain.handle(IPC_CHANNELS.refundFindOrder, async (event, request) => {
    requireSession(event, PERMISSIONS.refundRequest)
    await refreshCloudResourceBeforeRead('orders')
    await refreshCloudResourceBeforeRead('order_items')
    const database = requireDatabase()
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('门店配置缺失')
    return findRefundableOrder(
      database.connection,
      context,
      requireText(request?.query, '订单号', { min: 1, max: 100 })
    )
  })
  ipcMain.handle(
    IPC_CHANNELS.refundCreate,
    (event, request: CreateRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundRequest)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? undefined
          : requireText(request.reason, '退款原因', { min: 0, max: 500 })
      return createRefundRequest(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        orderId: requireText(request?.orderId, '订单编号', { min: 1, max: 100 }),
        items: requireRefundItems(request?.items),
        ...(reason ? { reason } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.refundApprove,
    (event, request: ApproveRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? undefined
          : requireText(request.reason, '审批说明', { min: 0, max: 500 })
      const specialProductOverride = requireOptionalBoolean(
        request?.specialProductOverride,
        '商品特殊退款标记'
      )
      return approveRefund(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        refundId: requireText(request?.refundId, '退款编号', { min: 1, max: 100 }),
        ...(specialProductOverride === undefined
          ? {}
          : { specialProductOverride }),
        ...(reason ? { reason } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.refundReject,
    (event, request: RejectRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return rejectRefund(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        refundId: requireText(request?.refundId, '退款编号', { min: 1, max: 100 }),
        reason: requireText(request?.reason, '驳回原因', { min: 2, max: 500 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.refundDirect,
    (event, request: DirectRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? undefined
          : requireText(request.reason, '退款原因', { min: 0, max: 500 })
      const specialProductOverride = requireOptionalBoolean(
        request?.specialProductOverride,
        '商品特殊退款标记'
      )
      return directRefund(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        orderId: requireText(request?.orderId, '订单编号', { min: 1, max: 100 }),
        items: requireRefundItems(request?.items),
        ...(specialProductOverride === undefined
          ? {}
          : { specialProductOverride }),
        ...(reason ? { reason } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.refundList,
    async (event, request?: ListRefundsRequest) => {
      requireSession(event, PERMISSIONS.refundRequest)
      await refreshCloudResourceBeforeRead('refunds')
      await refreshCloudResourceBeforeRead('refund_events')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      const limit =
        request?.limit === undefined
          ? 50
          : requireInteger(request.limit, '退款数量', { min: 1, max: 100 })
      const status =
        request?.status === undefined ? undefined : requireRefundStatus(request.status)
      return listRefunds(database.connection, context, {
        limit,
        ...(status === undefined ? {} : { status })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.refundExportEvidence,
    async (event, request: ExportRefundEvidenceRequest) => {
      const session = requireSession(event, PERMISSIONS.financeExport)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const requestId = requireText(request?.requestId, '请求编号', { min: 8, max: 100 })
      const refundId = requireText(request?.refundId, '退款编号', { min: 1, max: 100 })
      if (request?.evidenceType !== 'pdf' && request?.evidenceType !== 'excel') {
        throw new TypeError('凭证格式不正确')
      }
      const refund = getRefundDetails(database.connection, context, refundId)
      if (refund.status !== 'completed') {
        throw new Error('只有已完成退款可以导出凭证')
      }
      const extension = request.evidenceType === 'pdf' ? 'pdf' : 'xls'
      const options = {
        title: '导出退款凭证',
        defaultPath: `${refund.refundNumber}-退款凭证.${extension}`,
        filters:
          request.evidenceType === 'pdf'
            ? [{ name: 'PDF 文件', extensions: ['pdf'] }]
            : [{ name: 'Excel 文件', extensions: ['xls'] }]
      }
      const selected = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (selected.canceled || !selected.filePath) {
        return { canceled: true, filePath: null, evidence: null }
      }
      let fileWritten = false
      try {
        const exported = await exportRefundEvidenceFile({
          refund,
          storeName: context.storeName,
          evidenceType: request.evidenceType,
          destinationPath: selected.filePath
        })
        fileWritten = true
        const evidence = recordRefundEvidence(database.connection, context, {
          requestId,
          refundId,
          evidenceType: request.evidenceType,
          fileName: exported.fileName,
          fileSha256: exported.fileSha256
        })
        return { canceled: false, filePath: selected.filePath, evidence }
      } catch (error) {
        if (fileWritten) rmSync(selected.filePath, { force: true })
        throw error
      }
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.financialRefundCreate,
    (event, request: CreateFinancialRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundRequest)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? undefined
          : requireText(request.reason, '退款原因', { min: 0, max: 500 })
      return createFinancialRefundRequest(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        targetType: requireFinancialRefundTargetType(request?.targetType),
        targetId: requireText(request?.targetId, '退款目标编号', { min: 1, max: 100 }),
        ...(reason ? { reason } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.financialRefundApprove,
    (event, request: ApproveFinancialRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? undefined
          : requireText(request.reason, '审批说明', { min: 0, max: 500 })
      const specialOverride = requireOptionalBoolean(
        request?.specialOverride,
        '特殊退款标记'
      )
      return approveFinancialRefund(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        financialRefundId: requireText(request?.financialRefundId, '退款申请编号', {
          min: 1,
          max: 100
        }),
        ...(specialOverride === undefined ? {} : { specialOverride }),
        ...(reason ? { reason } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.financialRefundReject,
    (event, request: RejectFinancialRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      return rejectFinancialRefund(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        financialRefundId: requireText(request?.financialRefundId, '退款申请编号', {
          min: 1,
          max: 100
        }),
        reason: requireText(request?.reason, '驳回原因', { min: 2, max: 500 })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.financialRefundDirect,
    (event, request: DirectFinancialRefundRequest) => {
      const session = requireSession(event, PERMISSIONS.refundApprove)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const reason =
        request?.reason === undefined
          ? undefined
          : requireText(request.reason, '退款原因', { min: 0, max: 500 })
      const specialOverride = requireOptionalBoolean(
        request?.specialOverride,
        '特殊退款标记'
      )
      return directFinancialRefund(database.connection, context, {
        requestId: requireText(request?.requestId, '请求编号', { min: 8, max: 100 }),
        targetType: requireFinancialRefundTargetType(request?.targetType),
        targetId: requireText(request?.targetId, '退款目标编号', { min: 1, max: 100 }),
        ...(specialOverride === undefined ? {} : { specialOverride }),
        ...(reason ? { reason } : {})
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.financialRefundList,
    async (event, request?: ListFinancialRefundsRequest) => {
      requireSession(event, PERMISSIONS.refundRequest)
      await refreshCloudResourceBeforeRead('financial_refunds')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      const limit =
        request?.limit === undefined
          ? 50
          : requireInteger(request.limit, '退款数量', { min: 1, max: 100 })
      const status =
        request?.status === undefined ? undefined : requireRefundStatus(request.status)
      return listFinancialRefunds(database.connection, context, {
        limit,
        ...(status === undefined ? {} : { status })
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.reportBusiness,
    async (event, request: BusinessReportRequest) => {
      requireSession(event, PERMISSIONS.reportRead)
      await refreshCloudResourceBeforeRead('store')
      await refreshCloudResourceBeforeRead('orders')
      await refreshCloudResourceBeforeRead('refunds')
      await refreshCloudResourceBeforeRead('wallet_accounts')
      await refreshCloudResourceBeforeRead('wallet_ledger')
      await refreshCloudResourceBeforeRead('monthly_cards')
      await refreshCloudResourceBeforeRead('monthly_card_events')
      await refreshCloudResourceBeforeRead('financial_refunds')
      const database = requireDatabase()
      const context = getStoreContext(database.connection)
      if (!context) throw new Error('门店配置缺失')
      return getBusinessReport(database.connection, context, {
        fromDate: requireText(request?.fromDate, '开始日期', { min: 10, max: 10 }),
        toDate: requireText(request?.toDate, '结束日期', { min: 10, max: 10 }),
        scope: request?.scope === 'tenant' ? 'tenant' : 'store'
      })
    }
  )
  ipcMain.handle(
    IPC_CHANNELS.reportExportExcel,
    async (event, request: ExportBusinessReportRequest) => {
      const session = requireSession(event, PERMISSIONS.financeExport)
      const database = requireDatabase()
      const context = requireMemberWriteContext(session)
      const requestId = requireText(request?.requestId, '请求编号', {
        min: 8,
        max: 100
      })
      const report = getBusinessReport(database.connection, context, {
        fromDate: requireText(request?.fromDate, '开始日期', { min: 10, max: 10 }),
        toDate: requireText(request?.toDate, '结束日期', { min: 10, max: 10 }),
        scope: request?.scope === 'tenant' ? 'tenant' : 'store'
      })
      const options = {
        title: '导出营业报表',
        defaultPath: `${context.storeName}-${report.fromDate}-${report.toDate}-营业报表.xls`,
        filters: [{ name: 'Excel 文件', extensions: ['xls'] }]
      }
      const selected = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (selected.canceled || !selected.filePath) {
        return { canceled: true, filePath: null }
      }
      let fileWritten = false
      try {
        const exported = await exportBusinessReportFile({
          report,
          storeName: context.storeName,
          destinationPath: selected.filePath
        })
        fileWritten = true
        recordBusinessReportExport(database.connection, context, {
          requestId,
          report,
          fileName: exported.fileName,
          fileSha256: exported.fileSha256
        })
        return { canceled: false, filePath: selected.filePath }
      } catch (error) {
        if (fileWritten) rmSync(selected.filePath, { force: true })
        throw error
      }
    }
  )
}

app.whenReady().then(async () => {
  installationDataRoot = resolveDataRoot({
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData')
  })
  dataEnvironmentConfigPath = join(
    installationDataRoot,
    'config',
    'active-environment.json'
  )
  activeDataEnvironment = loadDataEnvironment(dataEnvironmentConfigPath)
  environmentDataRoot = resolveEnvironmentDataRoot(
    installationDataRoot,
    activeDataEnvironment
  )
  mkdirSync(join(environmentDataRoot, 'config'), { recursive: true })
  storeProfileRegistryPath = join(
    environmentDataRoot,
    'config',
    'store-profiles.json'
  )
  storeProfileRegistry = loadOrCreateStoreProfileRegistry(
    storeProfileRegistryPath
  )
  deviceOnboardingConfigPath = join(
    environmentDataRoot,
    'config',
    'device-onboarding.pending'
  )
  const pendingOnboarding = loadPendingDeviceOnboarding(
    deviceOnboardingConfigPath,
    safeStorage,
    activeDataEnvironment
  )
  let resumedOnboardingPath: string | null = null
  if (pendingOnboarding?.phase === 'enrolled') {
    resumedOnboardingPath = finalizePendingDeviceOnboarding(
      pendingOnboarding
    ).mirrorDatabasePath
  }
  const activeProfile = getActiveStoreProfile(requireStoreProfileRegistry())
  const runtime = await openStoreProfileRuntime(activeProfile)
  applyStoreProfileRuntimePaths(runtime.paths)
  databasePath = runtime.databasePath
  localDatabase = runtime.database
  cloudConnection = runtime.connection
  secondaryBackupDirectory = runtime.secondaryBackupDirectory
  activeRuntimeProfileId = activeProfile.profileId
  logger = createFileLogger(join(baseDataRoot, 'logs'))
  logger.write('info', 'app_starting', {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    dataEnvironment: activeDataEnvironment,
    storeProfileId: activeProfile.profileId,
    dataRoot: baseDataRoot
  })
  if (resumedOnboardingPath) {
    logger.write('info', 'prelogin_device_onboarding_resumed', {
      environment: activeDataEnvironment,
      deviceId: pendingOnboarding?.deviceId,
      storeId: pendingOnboarding?.storeId,
      databasePath: resumedOnboardingPath
    })
  }
  initializeApplicationUpdater({
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    log: (level, event, details) => logger?.write(level, event, details)
  })
  configureApplicationUpdateFeed(
    cloudConnection?.baseUrl ?? defaultCloudBaseUrl(activeDataEnvironment)
  )
  logger.write('info', 'database_ready', {
    databasePath,
    sqliteVersion: localDatabase.sqliteVersion,
    schemaVersion: localDatabase.schemaVersion,
    journalMode: localDatabase.journalMode
  })
  initializeOpenedStoreRuntime()
  registerIpcHandlers()
  createMainWindow()
  void runAutomaticBackupIfDue()
  automaticBackupTimer = setInterval(() => {
    void runAutomaticBackupIfDue()
  }, 15 * 60 * 1000)
  automaticBackupTimer.unref()
  void runCloudSyncOnce()
  startCloudEventStream()
  cloudSyncWakeTimer = setInterval(() => {
    wakeCloudSyncWhenNeeded()
  }, 1_000)
  cloudSyncWakeTimer.unref()
  cloudSyncTimer = setInterval(() => {
    void runCloudSyncOnce()
  }, 15 * 1000)
  cloudSyncTimer.unref()
  applicationUpdateTimer = setInterval(() => {
    const update = getApplicationUpdateStatus()
    if (
      update.state === 'idle' ||
      update.state === 'error'
    ) {
      void checkApplicationUpdate().catch(() => undefined)
    }
  }, 6 * 60 * 60 * 1000)
  applicationUpdateTimer.unref()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  logger?.write('info', 'app_stopping')
  if (automaticBackupTimer) {
    clearInterval(automaticBackupTimer)
    automaticBackupTimer = null
  }
  if (cloudSyncTimer) {
    clearInterval(cloudSyncTimer)
    cloudSyncTimer = null
  }
  if (cloudSyncWakeTimer) {
    clearInterval(cloudSyncWakeTimer)
    cloudSyncWakeTimer = null
  }
  cloudEventStreamAbort?.abort()
  cloudEventStreamAbort = null
  if (applicationUpdateTimer) {
    clearInterval(applicationUpdateTimer)
    applicationUpdateTimer = null
  }
  cloudConnection = null
  localDatabase?.close()
  localDatabase = null
})

process.on('uncaughtException', (error) => {
  logger?.write('error', 'uncaught_exception', {
    message: error.message,
    stack: error.stack
  })
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger?.write('error', 'unhandled_rejection', {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
