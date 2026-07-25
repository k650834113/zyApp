import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type DesktopApi } from '@zyapp/contracts'

const desktopApi: DesktopApi = {
  getSystemStatus: () => ipcRenderer.invoke(IPC_CHANNELS.systemStatus),
  switchDataEnvironment: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.systemSwitchDataEnvironment, request),
  listStoreProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.storeProfilesList),
  switchStoreProfile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.storeProfilesSwitch, request),
  relocateDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.systemRelocateDatabase),
  getBackupOverview: () => ipcRenderer.invoke(IPC_CHANNELS.systemBackupOverview),
  createBackup: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.systemBackupNow, request),
  setSecondaryBackupDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.systemBackupSetSecondary),
  restoreDatabase: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.systemRestoreDatabase, request),
  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.systemExportDiagnostics),
  getCloudConnectionStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudConnectionStatus),
  enrollCloudConnection: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudConnectionEnroll, request),
  createCloudPairingCode: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudPairingCodeCreate),
  listTenantStores: () => ipcRenderer.invoke(IPC_CHANNELS.tenantStoresList),
  createTenantStore: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.tenantStoreCreate, request),
  listEmployeeStoreAccess: () =>
    ipcRenderer.invoke(IPC_CHANNELS.employeeStoreAccessList),
  setEmployeeStoreAccess: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.employeeStoreAccessSet, request),
  listBusinessTemplates: () => ipcRenderer.invoke(IPC_CHANNELS.businessTemplatesList),
  saveBusinessTemplate: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.businessTemplateSave, request),
  saveBusinessTemplateOverride: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.businessTemplateOverrideSave, request),
  joinCloudStore: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudStoreJoin, request),
  getDeviceOnboardingState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.deviceOnboardingState),
  joinCloudStoreBeforeLogin: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.deviceOnboardingJoin, request),
  syncCloudNow: () => ipcRenderer.invoke(IPC_CHANNELS.cloudSyncNow),
  prepareEmptyCloudCutover: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudPrepareEmptyCutover),
  claimOfflineFinancialLease: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudClaimOfflineFinancialLease),
  listInboundSyncConflicts: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudInboundConflicts),
  resolveInboundSyncConflict: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.cloudInboundConflictResolve, request),
  getStoreProfile: () => ipcRenderer.invoke(IPC_CHANNELS.storeProfileGet),
  updateStoreProfile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.storeProfileUpdate, request),
  getApplicationUpdateStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.applicationUpdateStatus),
  checkApplicationUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.applicationUpdateCheck),
  downloadApplicationUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.applicationUpdateDownload),
  installApplicationUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.applicationUpdateInstall),
  preflightLegacyImport: () =>
    ipcRenderer.invoke(IPC_CHANNELS.legacyImportPreflight),
  executeLegacyImport: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.legacyImportExecute, request),
  getApplicationState: () => ipcRenderer.invoke(IPC_CHANNELS.applicationState),
  bootstrapStore: (request) => ipcRenderer.invoke(IPC_CHANNELS.bootstrapStore, request),
  getSavedLogin: () => ipcRenderer.invoke(IPC_CHANNELS.savedLoginGet),
  login: (request) => ipcRenderer.invoke(IPC_CHANNELS.login, request),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout),
  listEmployees: () => ipcRenderer.invoke(IPC_CHANNELS.employeeList),
  createEmployee: (request) => ipcRenderer.invoke(IPC_CHANNELS.employeeCreate, request),
  setEmployeeStatus: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.employeeSetStatus, request),
  resetEmployeePassword: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.employeeResetPassword, request),
  configureEmployeeMobileAccess: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.employeeConfigureMobileAccess, request),
  searchMembers: (request) => ipcRenderer.invoke(IPC_CHANNELS.memberSearch, request),
  listCashierMembers: () => ipcRenderer.invoke(IPC_CHANNELS.memberCashierList),
  createMember: (request) => ipcRenderer.invoke(IPC_CHANNELS.memberCreate, request),
  adjustMemberTier: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.memberAdjustTier, request),
  correctMemberBirthday: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.memberCorrectBirthday, request),
  disableMember: (request) => ipcRenderer.invoke(IPC_CHANNELS.memberDisable, request),
  getWalletDetails: (request) => ipcRenderer.invoke(IPC_CHANNELS.walletDetails, request),
  cashRecharge: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.walletCashRecharge, request),
  debitWallet: (request) => ipcRenderer.invoke(IPC_CHANNELS.walletDebit, request),
  reverseCashRecharge: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.walletReverseCashRecharge, request),
  updateRechargeGiftTiers: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.walletUpdateGiftTiers, request),
  getMonthlyCardDetails: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.monthlyCardDetails, request),
  purchaseMonthlyCard: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.monthlyCardPurchase, request),
  pauseMonthlyCard: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.monthlyCardPause, request),
  resumeMonthlyCard: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.monthlyCardResume, request),
  useMonthlyCard: (request) => ipcRenderer.invoke(IPC_CHANNELS.monthlyCardUse, request),
  refundMonthlyCard: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.monthlyCardRefund, request),
  extendMonthlyCard: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.monthlyCardExtend, request),
  listCatalogItems: () => ipcRenderer.invoke(IPC_CHANNELS.catalogList),
  createCatalogItem: (request) => ipcRenderer.invoke(IPC_CHANNELS.catalogCreate, request),
  updateCatalogItem: (request) => ipcRenderer.invoke(IPC_CHANNELS.catalogUpdate, request),
  setCatalogItemStatus: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.catalogSetStatus, request),
  setCatalogAvailability: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.catalogSetAvailability, request),
  listActivities: () => ipcRenderer.invoke(IPC_CHANNELS.activityList),
  createActivity: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.activityCreate, request),
  updateActivity: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.activityUpdate, request),
  setActivityStatus: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.activitySetStatus, request),
  applyActivityRechargeTiers: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.activityApplyRechargeTiers, request),
  listAnnouncements: () =>
    ipcRenderer.invoke(IPC_CHANNELS.announcementList),
  createAnnouncement: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.announcementCreate, request),
  updateAnnouncement: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.announcementUpdate, request),
  setAnnouncementStatus: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.announcementSetStatus, request),
  listBoardGames: () =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameList),
  createBoardGame: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameCreate, request),
  updateBoardGame: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameUpdate, request),
  updateBoardGameOperations: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameUpdateOperations, request),
  setBoardGameRecordStatus: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameSetRecordStatus, request),
  importBoardGameImage: () =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameImportImage),
  readBoardGameImage: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.boardGameReadImage, request),
  createSalesOrder: (request) => ipcRenderer.invoke(IPC_CHANNELS.orderCreate, request),
  listRecentOrders: (request) => ipcRenderer.invoke(IPC_CHANNELS.orderRecent, request),
  listSalesTransactions: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.transactionSalesList, request),
  listRechargeTransactions: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.transactionRechargeList, request),
  findRefundableOrder: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.refundFindOrder, request),
  createRefundRequest: (request) => ipcRenderer.invoke(IPC_CHANNELS.refundCreate, request),
  approveRefund: (request) => ipcRenderer.invoke(IPC_CHANNELS.refundApprove, request),
  rejectRefund: (request) => ipcRenderer.invoke(IPC_CHANNELS.refundReject, request),
  directRefund: (request) => ipcRenderer.invoke(IPC_CHANNELS.refundDirect, request),
  listRefunds: (request) => ipcRenderer.invoke(IPC_CHANNELS.refundList, request),
  exportRefundEvidence: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.refundExportEvidence, request),
  createFinancialRefundRequest: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.financialRefundCreate, request),
  approveFinancialRefund: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.financialRefundApprove, request),
  rejectFinancialRefund: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.financialRefundReject, request),
  directFinancialRefund: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.financialRefundDirect, request),
  listFinancialRefunds: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.financialRefundList, request),
  getBusinessReport: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportBusiness, request),
  exportBusinessReportExcel: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportExportExcel, request)
}

contextBridge.exposeInMainWorld('zyapp', desktopApi)
