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
  CreateMemberMonthlyCardOrderRequest,
  MemberMonthlyCardConfiguration,
  MemberMonthlyCardOrderSummary,
  MiniappHomeSnapshot,
  MiniappIdentity,
  PhoneVerificationChallenge,
  PublicActivitySummary,
  PublicBoardGameFilterOptions,
  PublicBoardGameFilters,
  PublicBoardGameSummary,
  SetBoardGameLikeRequest,
  BoardGameLikeResult,
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
  getPublicPricing():Promise<import('@zyapp/contracts').PublicPricing>
  logout():Promise<void>
  community?: CommunityClient
  getIdentity(): Promise<MiniappIdentity>
  getHome(): Promise<MiniappHomeSnapshot>
  getGame(id: string): Promise<PublicBoardGameSummary>
  listActivities(): Promise<PublicActivitySummary[]>
  listGames(filters?: PublicBoardGameFilters): Promise<PublicBoardGameSummary[]>
  getGameFilterOptions(): Promise<PublicBoardGameFilterOptions>
  listFavoriteGames(filters?:PublicBoardGameFilters): Promise<PublicBoardGameSummary[]>
  setGameLiked(
    gameId: string,
    input: SetBoardGameLikeRequest
  ): Promise<BoardGameLikeResult>
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
  getMonthlyCardConfiguration(): Promise<MemberMonthlyCardConfiguration>
  createMonthlyCardOrder(
    input: CreateMemberMonthlyCardOrderRequest
  ): Promise<MemberMonthlyCardOrderSummary>
  getMonthlyCardOrder(
    orderId: string
  ): Promise<MemberMonthlyCardOrderSummary>
  settleMockMonthlyCardOrder(
    orderId: string
  ): Promise<MemberMonthlyCardOrderSummary>
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
import type { CommunityFilters, CommunityPage, MeetupSummary, PlaySummary, CreateMeetup, SavePlay } from '@zyapp/contracts'
export interface CommunityClient {
  selfMember():Promise<import('@zyapp/contracts').CommunityMember>
  friends():Promise<import('@zyapp/contracts').FriendsSnapshot>
  findMember(number:string):Promise<import('@zyapp/contracts').CommunityMember>
  friendCommand(action:'request'|'accept'|'reject'|'remove',input:{requestId:string;memberId?:string;id?:string}):Promise<{ok:true}>
  createTable(requestId:string):Promise<import('@zyapp/contracts').TableSnapshot>
  getTable(id:string):Promise<import('@zyapp/contracts').TableSnapshot>
  closeTable(id:string,requestId:string):Promise<{ok:true}>
  createInvite(input:{requestId:string;tableId?:string;envVersion:'release'|'trial'|'develop'}):Promise<import('@zyapp/contracts').CommunityInvite>
  previewInvite(token:string):Promise<{kind:'table'|'friend';member:import('@zyapp/contracts').CommunityMember}>
  joinInvite(token:string,requestId:string):Promise<import('@zyapp/contracts').TableSnapshot|{ok:true}>
  listMeetups(filters?:CommunityFilters):Promise<CommunityPage<MeetupSummary>>
  getMeetup(id:string):Promise<MeetupSummary>
  createMeetup(input:CreateMeetup):Promise<MeetupSummary>
  actMeetup(id:string,action:'join'|'leave'|'cancel',requestId:string):Promise<MeetupSummary>
  listPlays(filters?:CommunityFilters):Promise<CommunityPage<PlaySummary>>
  getPlay(id:string):Promise<PlaySummary>
  savePlay(input:SavePlay):Promise<PlaySummary>
  deletePlay(id:string,expectedRevision:string,requestId:string):Promise<{deleted:true}>
}
