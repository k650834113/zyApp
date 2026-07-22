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
  MemberRechargeOrderSummary,
  CreateMemberRechargeOrderRequest,
  MiniappHomeSnapshot,
  MiniappIdentity,
  MiniappSessionResult,
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

type HttpClientOptions = {
  baseUrl: string
  storeId: string
  token(): string | null
  saveToken(token: string): void
  clearToken(): void
  authMode: 'development' | 'wechat'
  developmentProviderSubject?: string
}

class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
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

export class HttpMiniappClient implements MiniappClient {
  private sessionPromise: Promise<void> | null = null

  constructor(private readonly options: HttpClientOptions) {}

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
        header: token ? { Authorization: `Bearer ${token}` } : {},
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(response.data as T)
          } else {
            const body = response.data as
              | { message?: string | string[] }
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
                response.statusCode
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
    return this.request('/v1/miniapp/session')
  }

  getHome(): Promise<MiniappHomeSnapshot> {
    return this.request(
      `/v1/public/home?storeId=${encodeURIComponent(this.options.storeId)}`
    )
  }

  listActivities(): Promise<PublicActivitySummary[]> {
    return this.request(
      `/v1/public/activities?storeId=${encodeURIComponent(this.options.storeId)}`
    )
  }

  listGames(query = ''): Promise<PublicBoardGameSummary[]> {
    return this.request(
      `/v1/public/games?storeId=${encodeURIComponent(
        this.options.storeId
      )}&query=${encodeURIComponent(query)}`
    )
  }

  getMemberSummary(): Promise<MemberSelfServiceSummary | null> {
    return this.request('/v1/member/self')
  }

  getMemberHistory(): Promise<MemberSelfServiceHistory> {
    return this.request('/v1/member/history')
  }

  requestPhoneVerification(
    phone: string
  ): Promise<PhoneVerificationChallenge> {
    return this.request('/v1/member/verification/request', 'POST', { phone })
  }

  registerMember(
    input: MemberRegistrationInput
  ): Promise<MemberSelfServiceSummary> {
    return this.request('/v1/member/register', 'POST', input)
  }

  loginWithWechatProfile(
    input: WechatOneTapLoginInput
  ): Promise<MemberSelfServiceSummary> {
    return this.request('/v1/member/wechat-one-tap-login', 'POST', input)
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
    return this.request(
      `/v1/member/recharge-orders/${encodeURIComponent(orderId)}/mock-settle`,
      'POST'
    )
  }

  enterStaffMode(
    username: string,
    password: string
  ): Promise<MiniappIdentity> {
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
