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

export type MemberRegistrationInput = {
  requestId: string
  challengeId: string
  verificationCode: string
  phone: string
  nickname: string
  confirmedAtLeast14: boolean
}

export type WechatOneTapLoginInput = {
  requestId: string
  phoneCode: string
  nickname?: string
  avatarUrl?: string | null
  confirmedAtLeast14: boolean
}

export interface MiniappClient {
  getIdentity(): Promise<MiniappIdentity>
  getHome(): Promise<MiniappHomeSnapshot>
  listActivities(): Promise<PublicActivitySummary[]>
  listGames(query?: string): Promise<PublicBoardGameSummary[]>
  getMemberSummary(): Promise<MemberSelfServiceSummary | null>
  getMemberHistory(): Promise<MemberSelfServiceHistory>
  getRechargeConfiguration(): Promise<MemberRechargeConfiguration>
  requestPhoneVerification(phone: string): Promise<PhoneVerificationChallenge>
  registerMember(input: MemberRegistrationInput): Promise<MemberSelfServiceSummary>
  loginWithWechatProfile(
    input: WechatOneTapLoginInput
  ): Promise<MemberSelfServiceSummary>
  updateMemberProfile(nickname: string): Promise<MemberSelfServiceSummary>
  updateMemberProfileWithAvatar(
    nickname: string,
    localAvatarPath: string
  ): Promise<MemberSelfServiceSummary>
  fillBirthday(month: number, day: number): Promise<MemberSelfServiceSummary>
  createRechargeOrder(
    input: CreateMemberRechargeOrderRequest
  ): Promise<MemberRechargeOrderSummary>
  getRechargeOrder(orderId: string): Promise<MemberRechargeOrderSummary>
  settleMockRechargeOrder(
    orderId: string
  ): Promise<MemberRechargeOrderSummary>
  enterStaffMode(username: string, password: string): Promise<MiniappIdentity>
  leaveStaffMode(): Promise<void>
  searchEmployeeMembers(query?: string): Promise<EmployeeMobileMemberSummary[]>
  getEmployeeMember(memberId: string): Promise<EmployeeMobileMemberSummary>
  createEmployeeMember(
    input: EmployeeMobileCreateMemberRequest
  ): Promise<EmployeeMobileMemberSummary>
  listEmployeeCashierCatalog(): Promise<CatalogItemSummary[]>
  createEmployeeCashierCommand(
    input: EmployeeMobileCreateCashierCommandRequest
  ): Promise<CashierCommandSummary>
  getEmployeeCashierCommand(
    commandId: string
  ): Promise<CashierCommandSummary>
  cancelEmployeeCashierCommand(
    commandId: string
  ): Promise<CashierCommandSummary>
  createEmployeeFinancialCommand(
    input: EmployeeMobileCreateFinancialCommandRequest
  ): Promise<EmployeeFinancialCommandSummary>
  getEmployeeFinancialCommand(
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary>
  cancelEmployeeFinancialCommand(
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary>
  listEmployeeActivities(): Promise<ActivitySummary[]>
  createEmployeeActivity(
    input: EmployeeMobileCreateActivityRequest
  ): Promise<ActivitySummary>
  updateEmployeeActivity(
    input: EmployeeMobileUpdateActivityRequest
  ): Promise<ActivitySummary>
  setEmployeeActivityStatus(
    input: EmployeeMobileSetActivityStatusRequest
  ): Promise<ActivitySummary>
  getEmployeeBusinessReport(
    input: BusinessReportRequest
  ): Promise<BusinessReport>
  listEmployeeAnnouncements(): Promise<AnnouncementSummary[]>
  createEmployeeAnnouncement(
    input: EmployeeMobileCreateAnnouncementRequest
  ): Promise<AnnouncementSummary>
  updateEmployeeAnnouncement(
    input: EmployeeMobileUpdateAnnouncementRequest
  ): Promise<AnnouncementSummary>
  setEmployeeAnnouncementStatus(
    input: EmployeeMobileSetAnnouncementStatusRequest
  ): Promise<AnnouncementSummary>
  listEmployeeBoardGames(): Promise<BoardGameSummary[]>
  updateEmployeeBoardGameOperations(
    input: EmployeeMobileUpdateBoardGameOperationsRequest
  ): Promise<BoardGameSummary>
  getEmployeeStoreProfile(): Promise<StoreProfileSummary>
  updateEmployeeStoreStatus(
    input: EmployeeMobileUpdateStoreStatusRequest
  ): Promise<StoreProfileSummary>
}
