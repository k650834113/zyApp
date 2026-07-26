import { beforeEach, describe, expect, it } from 'vitest'
import { HttpMiniappClient } from './http-client'

type RequestRecord = {
  url: string
  method: string | undefined
  data: unknown
  authorization: string | undefined
}

const baseUrl = 'http://127.0.0.1:3100'
const storeId = '22222222-2222-4222-8222-222222222222'

function installWxMock(
  handler: (
    request: WechatMiniprogram.RequestOption<
      string | WechatMiniprogram.IAnyObject | ArrayBuffer
    >
) => void
) {
  const globalWithWx = globalThis as unknown as { wx: WechatMiniprogram.Wx }
  globalWithWx.wx = {
    login: ({ success }: WechatMiniprogram.LoginOption) => {
      success?.({
        code: 'wx-login-code',
        errMsg: 'login:ok'
      } as WechatMiniprogram.LoginSuccessCallbackResult)
    },
    request: handler
  } as unknown as WechatMiniprogram.Wx
}

function respond(
  request: WechatMiniprogram.RequestOption<
    string | WechatMiniprogram.IAnyObject | ArrayBuffer
  >,
  statusCode: number,
  data: unknown
): void {
  request.success?.({
    statusCode,
    data,
    header: {},
    cookies: [],
    errMsg: 'request:ok'
  } as unknown as WechatMiniprogram.RequestSuccessCallbackResult<
    string | WechatMiniprogram.IAnyObject | ArrayBuffer
  >)
}

describe('HTTP miniapp client authentication', () => {
  beforeEach(() => {
    delete (globalThis as unknown as { wx?: unknown }).wx
  })

  it('uses wx.login to create a silent WeChat session before requests', async () => {
    let token: string | null = null
    const requests: RequestRecord[] = []
    installWxMock((request) => {
      requests.push({
        url: request.url,
        method: request.method,
        data: request.data,
        authorization: request.header?.Authorization as string | undefined
      })
      if (request.url.endsWith('/v1/miniapp/wechat-session')) {
        respond(request, 200, {
          accessToken: 'session-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          identity: { role: 'guest' }
        })
        return
      }
      respond(request, 200, { role: 'guest' })
    })
    const client = new HttpMiniappClient({
      baseUrl,
      storeId,
      authMode: 'wechat',
      token: () => token,
      saveToken: (value) => {
        token = value
      },
      clearToken: () => {
        token = null
      }
    })

    await expect(client.getIdentity()).resolves.toEqual({ role: 'guest' })

    expect(token).toBe('session-token')
    expect(requests[0]).toMatchObject({
      url: `${baseUrl}/v1/miniapp/wechat-session`,
      method: 'POST',
      data: { storeId, loginCode: 'wx-login-code' }
    })
    expect(requests[1]).toMatchObject({
      url: `${baseUrl}/v1/miniapp/session`,
      authorization: 'Bearer session-token'
    })
  })

  it('refreshes the WeChat session once when a stored token has expired', async () => {
    let token: string | null = 'expired-token'
    const requests: RequestRecord[] = []
    installWxMock((request) => {
      requests.push({
        url: request.url,
        method: request.method,
        data: request.data,
        authorization: request.header?.Authorization as string | undefined
      })
      if (
        request.url.endsWith('/v1/miniapp/session') &&
        request.header?.Authorization === 'Bearer expired-token'
      ) {
        respond(request, 401, { message: 'Miniapp session is invalid' })
        return
      }
      if (request.url.endsWith('/v1/miniapp/wechat-session')) {
        respond(request, 200, {
          accessToken: 'fresh-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          identity: { role: 'member' }
        })
        return
      }
      respond(request, 200, { role: 'member' })
    })
    const client = new HttpMiniappClient({
      baseUrl,
      storeId,
      authMode: 'wechat',
      token: () => token,
      saveToken: (value) => {
        token = value
      },
      clearToken: () => {
        token = null
      }
    })

    await expect(client.getIdentity()).resolves.toEqual({ role: 'member' })

    expect(token).toBe('fresh-token')
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/v1/miniapp/session`,
      `${baseUrl}/v1/miniapp/wechat-session`,
      `${baseUrl}/v1/miniapp/session`
    ])
    expect(requests[2]?.authorization).toBe('Bearer fresh-token')
  })

  it('uploads a member avatar with the current session and profile fields', async () => {
    let token: string | null = 'member-token'
    let upload:
      | WechatMiniprogram.UploadFileOption
      | undefined
    installWxMock(() => {
      throw new Error('wx.request should not be called')
    })
    ;((globalThis as unknown as { wx: unknown }).wx as {
      uploadFile(options: WechatMiniprogram.UploadFileOption): void
    }).uploadFile = (options) => {
      upload = options
      options.success?.({
        statusCode: 200,
        data: JSON.stringify({
          memberId: 'member-1',
          nickname: '林小满',
          avatarUrl:
            'https://judian.icu/test/v1/public/member-avatars/avatar.jpg',
          profileCompleted: true
        }),
        errMsg: 'uploadFile:ok'
      } as WechatMiniprogram.UploadFileSuccessCallbackResult)
    }
    const client = new HttpMiniappClient({
      baseUrl: 'https://judian.icu/test',
      storeId,
      authMode: 'wechat',
      token: () => token,
      saveToken: (value) => {
        token = value
      },
      clearToken: () => {
        token = null
      }
    })

    await expect(
      client.updateMemberProfileWithAvatar('林小满', 'wxfile://avatar')
    ).resolves.toMatchObject({ nickname: '林小满', profileCompleted: true })
    expect(upload).toMatchObject({
      url: 'https://judian.icu/test/v1/member/profile-with-avatar',
      filePath: 'wxfile://avatar',
      name: 'avatar',
      header: { Authorization: 'Bearer member-token' },
      formData: {
        nickname: '林小满'
      }
    })
    expect(upload?.formData?.requestId).toMatch(/^profile-/)
  })

  it('turns an upload domain rejection into an actionable message', async () => {
    let token: string | null = 'member-token'
    installWxMock(() => {
      throw new Error('wx.request should not be called')
    })
    ;((globalThis as unknown as { wx: unknown }).wx as {
      uploadFile(options: WechatMiniprogram.UploadFileOption): void
    }).uploadFile = (options) => {
      options.fail?.({
        errMsg: 'uploadFile:fail url not in domain list'
      } as WechatMiniprogram.GeneralCallbackResult)
    }
    const client = new HttpMiniappClient({
      baseUrl: 'https://judian.icu/test',
      storeId,
      authMode: 'wechat',
      token: () => token,
      saveToken: (value) => {
        token = value
      },
      clearToken: () => {
        token = null
      }
    })

    await expect(
      client.updateMemberProfileWithAvatar('林小满', 'wxfile://avatar')
    ).rejects.toThrow('头像上传域名尚未生效')
  })

  it('uses the member monthly-card configuration and order routes', async () => {
    let token: string | null = 'member-token'
    const requests: RequestRecord[] = []
    installWxMock((request) => {
      requests.push({
        url: request.url,
        method: request.method,
        data: request.data,
        authorization: request.header?.Authorization as string | undefined
      })
      respond(request, 200, {})
    })
    const client = new HttpMiniappClient({
      baseUrl,
      storeId,
      authMode: 'wechat',
      token: () => token,
      saveToken: (value) => {
        token = value
      },
      clearToken: () => {
        token = null
      }
    })

    await client.getMonthlyCardConfiguration()
    await client.createMonthlyCardOrder({ requestId: 'monthly-request-1' })
    await client.getMonthlyCardOrder('monthly/order 1')
    await client.settleMockMonthlyCardOrder('monthly/order 1')

    expect(requests).toEqual([
      expect.objectContaining({
        url: `${baseUrl}/v1/member/monthly-card-configuration`,
        authorization: 'Bearer member-token'
      }),
      expect.objectContaining({
        url: `${baseUrl}/v1/member/monthly-card-orders`,
        method: 'POST',
        data: { requestId: 'monthly-request-1' }
      }),
      expect.objectContaining({
        url: `${baseUrl}/v1/member/monthly-card-orders/monthly%2Forder%201`
      }),
      expect.objectContaining({
        url: `${baseUrl}/v1/member/monthly-card-orders/monthly%2Forder%201/mock-settle`,
        method: 'POST'
      })
    ])
  })
})
