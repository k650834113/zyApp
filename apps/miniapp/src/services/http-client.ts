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
  MiniappSessionResult,
  PhoneVerificationChallenge,
  PublicActivitySummary,
  PublicBoardGameFilterOptions,
  PublicBoardGameFilters,
  PublicBoardGameSummary,
  SetBoardGameLikeRequest,
  BoardGameLikeResult,
  StoreProfileSummary
} from '@zyapp/contracts'
import type {
  MemberRegistrationInput,
  CommunityClient,
  WechatOneTapLoginInput,
  MiniappClient
} from './types'

type HttpClientOptions = {
  baseUrl: string
  storeId: string
  token(): string | null
  saveToken(token: string): void
  clearToken(): void
  loggedOut?(): boolean
  setLoggedOut?(value:boolean): void
  authMode: 'development' | 'wechat'
  developmentProviderSubject?: string
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly fieldErrors:Record<string,string> = {}
  ) {
    super(message)
  }
}

function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => {
        if (result.code) {
          resolve(result.code)
        } else {
          reject(new Error('微信登录没有返回授权码'))
        }
      },
      fail: (error) => reject(new Error(error.errMsg))
    })
  })
}

function profileRequestId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function boardGameQuery(
  storeId: string,
  filters: PublicBoardGameFilters
): string {
  const pairs: Array<[string, string]> = [['storeId', storeId]]
  const append = (key: string, value: string | number | undefined) => {
    if (value !== undefined) pairs.push([key, String(value)])
  }
  append('query', filters.query?.trim() || undefined)
  append('baseGameId', filters.baseGameId)
  append('sort', filters.sort)
  for (const category of filters.categories ?? []) {
    append('categories', category)
  }
  append('minPlayers', filters.minPlayers)
  append('maxPlayers', filters.maxPlayers)
  append('minMinutes', filters.minMinutes)
  append('maxMinutes', filters.maxMinutes)
  append('minComplexity', filters.minComplexity)
  append('maxComplexity', filters.maxComplexity)
  append('limit', filters.limit)
  append('offset', filters.offset)
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

function responseMessage(data: unknown, fallback: string): string {
  const body = data as
    | { message?: string | string[] }
    | string
    | undefined
  if (typeof body === 'string') return body || fallback
  if (Array.isArray(body?.message)) return body.message.join('；')
  return body?.message || fallback
}

function avatarUploadError(message: string): Error {
  return message.includes('url not in domain list')
    ? new Error('头像上传域名尚未生效，请稍后重试或使用默认头像')
    : new Error(message || '头像上传失败')
}

export class HttpMiniappClient implements MiniappClient {
  readonly workspace:import('@zyapp/contracts').WorkspaceClient={
    testNotice:input=>this.request('/v1/workspace/notice-tests','POST',input),
    activities:()=>this.request('/v1/workspace/activities'),
    batches:activityId=>this.request('/v1/workspace/batches?activityId='+encodeURIComponent(activityId)),
    batchCode:id=>this.request('/v1/workspace/batches/'+encodeURIComponent(id)+'/code'),
    createBatch:input=>this.request('/v1/workspace/batches','POST',input),
    revokeBatch:id=>this.request('/v1/workspace/batches/'+encodeURIComponent(id)+'/revoke','POST'),
    cancelEntry:(id,entryId,reason)=>this.request('/v1/workspace/batches/'+encodeURIComponent(id)+'/cancel','POST',{entryId,reason}),
    transactions:filters=>this.request('/v1/workspace/transactions?'+Object.entries(filters).filter(([,v])=>v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&')),
    admit:scene=>this.request('/v1/workspace/admissions/'+encodeURIComponent(scene),'POST'),
    register:scene=>this.request('/v1/workspace/admissions/'+encodeURIComponent(scene)+'/confirm','POST'),
    lotteryResult:id=>this.request('/v1/workspace/lotteries/'+encodeURIComponent(id)),
    scenes:()=>this.request('/v1/workspace/notice-scenes'),
    saveScene:scene=>this.request('/v1/workspace/notice-scenes','POST',scene),
    prepareSubscription:(scene,businessId)=>this.request('/v1/workspace/subscriptions','POST',{scene,...(businessId?{businessId}:{})}),
    recordSubscription:(id,result)=>this.request('/v1/workspace/subscriptions/'+encodeURIComponent(id),'POST',{result}),
    notices:(offset=0)=>this.request('/v1/workspace/notices?offset='+offset),
    readNotice:id=>this.request('/v1/workspace/notices/'+encodeURIComponent(id)+'/read','POST')
  }
  readonly community:CommunityClient = {
    selfMember:()=>this.request('/v1/member/community/profile'),
    friends:()=>this.request('/v1/member/community/friends'),
    findMember:number=>this.request('/v1/member/community/members?number='+encodeURIComponent(number)),
    friendCommand:(action,input)=>this.request('/v1/member/community/friends/'+action,'POST',input),
    createTable:requestId=>this.request('/v1/member/community/tables','POST',{requestId}),
    getTable:id=>this.request('/v1/member/community/tables/'+encodeURIComponent(id)),
    closeTable:(id,requestId)=>this.request('/v1/member/community/tables/'+encodeURIComponent(id)+'/close','POST',{requestId}),
    createInvite:input=>this.request('/v1/member/community/invites','POST',input),
    previewInvite:token=>this.request('/v1/member/community/invites/'+encodeURIComponent(token)),
    joinInvite:(token,requestId)=>this.request('/v1/member/community/invites/'+encodeURIComponent(token)+'/join','POST',{requestId}),
    listMeetups: (filters={}) => this.request('/v1/member/community/meetups?'+this.communityQuery(filters)),
    getMeetup: id => this.signedOut||this.options.loggedOut?.()||!this.options.token()?this.send('/v1/public/meetups/'+encodeURIComponent(id)+'?storeId='+encodeURIComponent(this.options.storeId),'GET',undefined,false):this.request('/v1/public/meetups/'+encodeURIComponent(id)+'?storeId='+encodeURIComponent(this.options.storeId)),
    createMeetup: input => this.request('/v1/member/community/meetups','POST',input),
    actMeetup: (id,action,requestId) => this.request('/v1/member/community/meetups/'+encodeURIComponent(id)+'/'+action,'POST',{requestId}),
    listPlays: (filters={}) => this.request('/v1/member/community/plays?'+this.communityQuery(filters)),
    getPlay: id => this.request('/v1/member/community/plays/'+encodeURIComponent(id)),
    savePlay: input => this.request('/v1/member/community/plays','POST',input),
    deletePlay: (id,expectedRevision,requestId) => this.request('/v1/member/community/plays/'+encodeURIComponent(id)+'/hide','POST',{expectedRevision,requestId})
  }
  private communityQuery(filters:Record<string,unknown>):string {
    return Object.entries(filters).filter(([,v])=>v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&')
  }
  private sessionPromise: Promise<void> | null = null
  private homePromise: Promise<MiniappHomeSnapshot> | null = null
  private signedOut = false

  constructor(private readonly options: HttpClientOptions) {}

  private resumeLogin():void {this.signedOut=false;this.options.setLoggedOut?.(false)}
  async logout():Promise<void> {
    await this.sessionPromise
    if (this.options.token()) await this.send('/v1/miniapp/logout','POST')
    this.signedOut=true
    this.options.setLoggedOut?.(true)
    this.options.clearToken()
  }

  private baseUrl(): string {
    const baseUrl = this.options.baseUrl.replace(/\/+$/, '')
    const localHttp =
      /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(baseUrl)
    if (!baseUrl.startsWith('https://') && !localHttp) {
      throw new Error('正式小程序 API 必须使用 HTTPS，本地联调仅允许 localhost')
    }
    return baseUrl
  }

  private send<T>(
    path: string,
    method: WechatMiniprogram.RequestOption['method'] = 'GET',
    data?: string | WechatMiniprogram.IAnyObject | ArrayBuffer,
    includeAuthorization = true
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const token = includeAuthorization ? this.options.token() : null
      const request: WechatMiniprogram.RequestOption<
        string | WechatMiniprogram.IAnyObject | ArrayBuffer
      > = {
        url: `${this.baseUrl()}${path}`,
        method,
        timeout: 10000,
        header: token ? { Authorization: `Bearer ${token}` } : {},
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(response.data as T)
          } else {
            const body = response.data as
              | { message?: string | string[]; fieldErrors?:Record<string,string> }
              | string
              | undefined
            const message =
              typeof body === 'string'
                ? body
                : Array.isArray(body?.message)
                  ? body.message.join('；')
                  : body?.message
            reject(
              new HttpRequestError(
                message || `服务请求失败：${response.statusCode}`,
                response.statusCode,
                typeof body==='object'?body?.fieldErrors??{}:{}
              )
            )
          }
        },
        fail: (error) => reject(new Error(error.errMsg))
      }
      if (data !== undefined) request.data = data
      wx.request(request)
    })
  }

  private async ensureSession(): Promise<void> {
    if (this.signedOut || this.options.loggedOut?.()) throw new Error('请先登录')
    if (this.options.token()) return
    if (this.sessionPromise) return this.sessionPromise
    this.sessionPromise = this.createSession()
      .then((session) => {
        this.options.saveToken(session.accessToken)
      })
      .finally(() => {
        this.sessionPromise = null
      })
    return this.sessionPromise
  }

  private async createSession(): Promise<MiniappSessionResult> {
    if (this.options.authMode === 'wechat') {
      const loginCode = await wxLogin()
      return this.send<MiniappSessionResult>(
        '/v1/miniapp/wechat-session',
        'POST',
        {
          storeId: this.options.storeId,
          loginCode
        },
        false
      )
    }

    const providerSubject = this.options.developmentProviderSubject?.trim()
    if (!providerSubject) {
      throw new Error('开发会话身份尚未配置，无法建立小程序会话')
    }
    return this.send<MiniappSessionResult>(
      '/v1/miniapp/development-session',
      'POST',
      {
        storeId: this.options.storeId,
        providerSubject
      },
      false
    )
  }

  private async request<T>(
    path: string,
    method: WechatMiniprogram.RequestOption['method'] = 'GET',
    data?: string | WechatMiniprogram.IAnyObject | ArrayBuffer,
    retryAfterUnauthorized = true
  ): Promise<T> {
    await this.ensureSession()
    try {
      return await this.send(path, method, data)
    } catch (error) {
      if (
        retryAfterUnauthorized &&
        error instanceof HttpRequestError &&
        error.statusCode === 401
      ) {
        this.options.clearToken()
        await this.ensureSession()
        return this.request(path, method, data, false)
      }
      throw error
    }
  }

  getIdentity(): Promise<MiniappIdentity> {
    if (this.signedOut || this.options.loggedOut?.()) return Promise.resolve({role:'guest'})
    return this.request('/v1/miniapp/session')
  }

  getHome(): Promise<MiniappHomeSnapshot> {
    if (this.homePromise) return this.homePromise
    this.homePromise = this.send<MiniappHomeSnapshot>(
      `/v1/public/home?storeId=${encodeURIComponent(this.options.storeId)}`,
      'GET', undefined, false
    ).finally(() => { this.homePromise = null })
    return this.homePromise
  }
  getPublicPricing():Promise<import('@zyapp/contracts').PublicPricing> {
    return this.send(`/v1/public/pricing?storeId=${encodeURIComponent(this.options.storeId)}`,'GET',undefined,false)
  }

  listActivities(): Promise<PublicActivitySummary[]> {
    return this.send(
      `/v1/public/activities?storeId=${encodeURIComponent(this.options.storeId)}`,
      'GET', undefined, false
    )
  }

  getGame(id: string): Promise<PublicBoardGameSummary> {
    const path = `/v1/public/games/${encodeURIComponent(id)}?storeId=${encodeURIComponent(this.options.storeId)}`
    return this.options.token() ? this.request(path) : this.send(path, 'GET', undefined, false)
  }

  listGames(
    filters: PublicBoardGameFilters = {}
  ): Promise<PublicBoardGameSummary[]> {
    const path = `/v1/public/games?${boardGameQuery(this.options.storeId, filters)}`
    return this.options.token() ? this.request(path) : this.send(path, 'GET', undefined, false)
  }

  getGameFilterOptions(): Promise<PublicBoardGameFilterOptions> {
    return this.send(
      `/v1/public/game-filter-options?storeId=${encodeURIComponent(this.options.storeId)}`,
      'GET', undefined, false
    )
  }

  listFavoriteGames(filters?:PublicBoardGameFilters): Promise<PublicBoardGameSummary[]> {
    return this.request('/v1/miniapp/favorite-games'+(filters?'?'+boardGameQuery(this.options.storeId,filters):''))
  }

  setGameLiked(
    gameId: string,
    input: SetBoardGameLikeRequest
  ): Promise<BoardGameLikeResult> {
    return this.request(
      `/v1/miniapp/board-games/${encodeURIComponent(gameId)}/like`,
      'PUT',
      input
    )
  }

  getMemberSummary(): Promise<MemberSelfServiceSummary | null> {
    if (this.signedOut || this.options.loggedOut?.()) return Promise.resolve(null)
    return this.request('/v1/member/self')
  }

  getMemberHistory(): Promise<MemberSelfServiceHistory> {
    return this.request('/v1/member/history')
  }

  getRechargeConfiguration(): Promise<MemberRechargeConfiguration> {
    return this.request('/v1/member/recharge-configuration')
  }

  requestPhoneVerification(
    phone: string
  ): Promise<PhoneVerificationChallenge> {
    this.resumeLogin()
    return this.request('/v1/member/verification/request', 'POST', { phone })
  }

  registerMember(
    input: MemberRegistrationInput
  ): Promise<MemberSelfServiceSummary> {
    this.resumeLogin()
    return this.request('/v1/member/register', 'POST', input)
  }

  loginWithWechatProfile(
    input: WechatOneTapLoginInput
  ): Promise<MemberSelfServiceSummary> {
    this.resumeLogin()
    return this.request('/v1/member/wechat-one-tap-login', 'POST', input)
  }

  updateMemberProfile(
    nickname: string
  ): Promise<MemberSelfServiceSummary> {
    return this.request('/v1/member/profile', 'POST', {
      requestId: profileRequestId(),
      nickname
    })
  }

  updateMemberProfileWithAvatar(
    nickname: string,
    localAvatarPath: string
  ): Promise<MemberSelfServiceSummary> {
    return this.uploadMemberProfile(
      nickname,
      localAvatarPath,
      profileRequestId(),
      true
    )
  }

  private async uploadMemberProfile(
    nickname: string,
    localAvatarPath: string,
    requestId: string,
    retryAfterUnauthorized: boolean
  ): Promise<MemberSelfServiceSummary> {
    await this.ensureSession()
    try {
      return await new Promise<MemberSelfServiceSummary>((resolve, reject) => {
        const token = this.options.token()
        wx.uploadFile({
          url: `${this.baseUrl()}/v1/member/profile-with-avatar`,
          filePath: localAvatarPath,
          name: 'avatar',
          header: token ? { Authorization: `Bearer ${token}` } : {},
          formData: { requestId, nickname },
          success: (response) => {
            let body: unknown
            try {
              body = response.data ? JSON.parse(response.data) : undefined
            } catch {
              reject(new Error('服务返回了无法识别的头像上传结果'))
              return
            }
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(body as MemberSelfServiceSummary)
              return
            }
            reject(
              new HttpRequestError(
                responseMessage(
                  body,
                  `头像上传失败：${response.statusCode}`
                ),
                response.statusCode
              )
            )
          },
          fail: (error) => reject(avatarUploadError(error.errMsg))
        })
      })
    } catch (error) {
      if (
        retryAfterUnauthorized &&
        error instanceof HttpRequestError &&
        error.statusCode === 401
      ) {
        this.options.clearToken()
        await this.ensureSession()
        return this.uploadMemberProfile(
          nickname,
          localAvatarPath,
          requestId,
          false
        )
      }
      throw error
    }
  }

  fillBirthday(
    month: number,
    day: number
  ): Promise<MemberSelfServiceSummary> {
    return this.request('/v1/member/birthday', 'POST', {
      requestId:
        `birthday-${Date.now()}-` + Math.random().toString(36).slice(2, 10),
      month,
      day
    })
  }

  createRechargeOrder(
    input: CreateMemberRechargeOrderRequest
  ): Promise<MemberRechargeOrderSummary> {
    return this.request('/v1/member/recharge-orders', 'POST', input)
  }

  getRechargeOrder(orderId: string): Promise<MemberRechargeOrderSummary> {
    return this.request(
      `/v1/member/recharge-orders/${encodeURIComponent(orderId)}`
    )
  }

  settleMockRechargeOrder(
    orderId: string
  ): Promise<MemberRechargeOrderSummary> {
    const mockSettlementPath = ['mock', 'settle'].join('-')
    return this.request(
      `/v1/member/recharge-orders/${encodeURIComponent(orderId)}/${mockSettlementPath}`,
      'POST'
    )
  }

  getMonthlyCardConfiguration(): Promise<MemberMonthlyCardConfiguration> {
    return this.request('/v1/member/monthly-card-configuration')
  }

  createMonthlyCardOrder(
    input: CreateMemberMonthlyCardOrderRequest
  ): Promise<MemberMonthlyCardOrderSummary> {
    return this.request('/v1/member/monthly-card-orders', 'POST', input)
  }

  getMonthlyCardOrder(
    orderId: string
  ): Promise<MemberMonthlyCardOrderSummary> {
    return this.request(
      `/v1/member/monthly-card-orders/${encodeURIComponent(orderId)}`
    )
  }

  settleMockMonthlyCardOrder(
    orderId: string
  ): Promise<MemberMonthlyCardOrderSummary> {
    const mockSettlementPath = ['mock', 'settle'].join('-')
    return this.request(
      `/v1/member/monthly-card-orders/${encodeURIComponent(orderId)}/${mockSettlementPath}`,
      'POST'
    )
  }

  enterStaffMode(
    username: string,
    password: string
  ): Promise<MiniappIdentity> {
    this.resumeLogin()
    return this.request('/v1/employee/mobile-login', 'POST', {
      username,
      password
    })
  }

  leaveStaffMode(): Promise<void> {
    return this.request('/v1/employee/mobile-logout', 'POST')
  }

  searchEmployeeMembers(
    query = ''
  ): Promise<EmployeeMobileMemberSummary[]> {
    return this.request(
      `/v1/employee/members?query=${encodeURIComponent(query)}&limit=50`
    )
  }

  getEmployeeMember(
    memberId: string
  ): Promise<EmployeeMobileMemberSummary> {
    return this.request(
      `/v1/employee/members/${encodeURIComponent(memberId)}`
    )
  }

  createEmployeeMember(
    input: EmployeeMobileCreateMemberRequest
  ): Promise<EmployeeMobileMemberSummary> {
    return this.request('/v1/employee/members', 'POST', input)
  }

  listEmployeeCashierCatalog(): Promise<CatalogItemSummary[]> {
    return this.request('/v1/employee/cashier-catalog')
  }

  createEmployeeCashierCommand(
    input: EmployeeMobileCreateCashierCommandRequest
  ): Promise<CashierCommandSummary> {
    return this.request('/v1/employee/cashier-commands', 'POST', input)
  }

  getEmployeeCashierCommand(
    commandId: string
  ): Promise<CashierCommandSummary> {
    return this.request(
      `/v1/employee/cashier-commands/${encodeURIComponent(commandId)}`
    )
  }

  cancelEmployeeCashierCommand(
    commandId: string
  ): Promise<CashierCommandSummary> {
    return this.request(
      `/v1/employee/cashier-commands/${encodeURIComponent(commandId)}/cancel`,
      'POST'
    )
  }

  createEmployeeFinancialCommand(
    input: EmployeeMobileCreateFinancialCommandRequest
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.request('/v1/employee/financial-commands', 'POST', input)
  }

  getEmployeeFinancialCommand(
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.request(
      `/v1/employee/financial-commands/${encodeURIComponent(commandId)}`
    )
  }

  cancelEmployeeFinancialCommand(
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.request(
      `/v1/employee/financial-commands/${encodeURIComponent(commandId)}/cancel`,
      'POST'
    )
  }

  listEmployeeActivities(): Promise<ActivitySummary[]> {
    return this.request('/v1/employee/activities')
  }

  createEmployeeActivity(
    input: EmployeeMobileCreateActivityRequest
  ): Promise<ActivitySummary> {
    return this.request('/v1/employee/activities', 'POST', input)
  }

  updateEmployeeActivity(
    input: EmployeeMobileUpdateActivityRequest
  ): Promise<ActivitySummary> {
    return this.request('/v1/employee/activities/update', 'POST', input)
  }

  setEmployeeActivityStatus(
    input: EmployeeMobileSetActivityStatusRequest
  ): Promise<ActivitySummary> {
    return this.request('/v1/employee/activities/status', 'POST', input)
  }

  getEmployeeBusinessReport(
    input: BusinessReportRequest
  ): Promise<BusinessReport> {
    return this.request(
      `/v1/employee/business-report?fromDate=${encodeURIComponent(
        input.fromDate
      )}&toDate=${encodeURIComponent(input.toDate)}`
    )
  }

  listEmployeeAnnouncements(): Promise<AnnouncementSummary[]> {
    return this.request('/v1/employee/announcements')
  }

  createEmployeeAnnouncement(
    input: EmployeeMobileCreateAnnouncementRequest
  ): Promise<AnnouncementSummary> {
    return this.request('/v1/employee/announcements', 'POST', input)
  }

  updateEmployeeAnnouncement(
    input: EmployeeMobileUpdateAnnouncementRequest
  ): Promise<AnnouncementSummary> {
    return this.request('/v1/employee/announcements/update', 'POST', input)
  }

  setEmployeeAnnouncementStatus(
    input: EmployeeMobileSetAnnouncementStatusRequest
  ): Promise<AnnouncementSummary> {
    return this.request('/v1/employee/announcements/status', 'POST', input)
  }

  listEmployeeBoardGames(): Promise<BoardGameSummary[]> {
    return this.request('/v1/employee/board-games')
  }

  updateEmployeeBoardGameOperations(
    input: EmployeeMobileUpdateBoardGameOperationsRequest
  ): Promise<BoardGameSummary> {
    return this.request('/v1/employee/board-games/operations', 'POST', input)
  }

  getEmployeeStoreProfile(): Promise<StoreProfileSummary> {
    return this.request('/v1/employee/store-status')
  }

  updateEmployeeStoreStatus(
    input: EmployeeMobileUpdateStoreStatusRequest
  ): Promise<StoreProfileSummary> {
    return this.request('/v1/employee/store-status', 'POST', input)
  }
}
