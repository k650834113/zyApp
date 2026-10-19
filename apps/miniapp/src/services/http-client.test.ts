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
  it('browses games without a login round trip and bounds request time',async()=>{
    installWxMock(request=>{expect(request.url).toContain('/v1/public/');expect(request.timeout).toBe(10000);respond(request,200,[])})
    const client=new HttpMiniappClient({baseUrl,storeId,authMode:'wechat',token:()=>null,saveToken:()=>{throw new Error('unexpected login')},clearToken:()=>{}})
    await client.listGames({limit:24});await client.getGameFilterOptions()
  })
  it('deduplicates concurrent home reads but fetches fresh content on the next visit',async()=>{
    const requests:WechatMiniprogram.RequestOption[]=[]
    installWxMock(request=>{requests.push(request as WechatMiniprogram.RequestOption)})
    const client=new HttpMiniappClient({baseUrl,storeId,authMode:'wechat',token:()=>null,saveToken:()=>{},clearToken:()=>{}})
    const a=client.getHome(),b=client.getHome();expect(requests).toHaveLength(1)
    respond(requests[0]!,200,{content:{revision:'one'}});await Promise.all([a,b])
    const c=client.getHome();expect(requests).toHaveLength(2);respond(requests[1]!,200,{content:{revision:'two'}})
    expect((await c).content?.revision).toBe('two')
  })
  it('revokes logout and keeps subsequent account reads in guest state without silently signing back in',async()=>{
    let token:string|null='valid',signedOut=false
    const requests:string[]=[]
    installWxMock(request=>{requests.push(request.url);respond(request,200,null)})
    const client=new HttpMiniappClient({baseUrl,storeId,authMode:'wechat',token:()=>token,saveToken:v=>{token=v},clearToken:()=>{token=null},loggedOut:()=>signedOut,setLoggedOut:v=>{signedOut=v}})
    await client.logout();expect(token).toBeNull();expect(signedOut).toBe(true)
    expect(await client.getMemberSummary()).toBeNull();expect(await client.getIdentity()).toEqual({role:'guest'})
    expect(requests).toHaveLength(1)
  })
  it('loads home and activities without login or an authorization header', async () => {
    const requests: string[] = []
    installWxMock(request => {
      requests.push(request.url)
      expect(request.header?.Authorization).toBeUndefined()
      respond(request, 200, [])
    })
    const client = new HttpMiniappClient({
      baseUrl, storeId, authMode: 'wechat', token: () => null,
      saveToken: () => { throw new Error('Public browsing must not create a session') },
      clearToken: () => {}
    })
    await client.getHome()
    await client.listActivities()
    expect(requests).toEqual([
      `${baseUrl}/v1/public/home?storeId=${storeId}`,
      `${baseUrl}/v1/public/activities?storeId=${storeId}`
    ])
  })

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

  it('serializes board-game filters and sends explicit like targets', async () => {
    const requests: RequestRecord[] = []
    installWxMock((request) => {
      requests.push({
        url: request.url,
        method: request.method,
        data: request.data,
        authorization: request.header?.Authorization as string | undefined
      })
      respond(
        request,
        200,
        request.url.endsWith('/like')
          ? { boardGameId: 'game-1', likedByViewer: true, likeCount: 8 }
          : []
      )
    })
    const client = new HttpMiniappClient({
      baseUrl,
      storeId,
      authMode: 'wechat',
      token: () => 'viewer-token',
      saveToken: () => undefined,
      clearToken: () => undefined
    })

    await client.listGames({
      query: '宝石',
      baseGameId: 'base-game-1',
      sort: 'mostLiked',
      categories: ['德式', '策略'],
      minPlayers: 3,
      maxPlayers: 6,
      minMinutes: 30,
      maxMinutes: 120,
      minComplexity: 1.5,
      maxComplexity: 3.5,
      limit: 24,
      offset: 48
    })
    await client.listFavoriteGames()
    await client.setGameLiked('game-1', {
      liked: true,
      requestId: 'like-request-001'
    })

    expect(requests[0]?.url).toContain(`storeId=${storeId}`)
    expect(requests[0]?.url).toContain('query=%E5%AE%9D%E7%9F%B3')
    expect(requests[0]?.url).toContain('baseGameId=base-game-1')
    expect(requests[0]?.url).toContain('sort=mostLiked')
    expect(requests[0]?.url).toContain('categories=%E5%BE%B7%E5%BC%8F')
    expect(requests[0]?.url).toContain('categories=%E7%AD%96%E7%95%A5')
    expect(requests[0]?.url).toContain('minPlayers=3')
    expect(requests[0]?.url).toContain('maxComplexity=3.5')
    expect(requests[0]?.url).toContain('limit=24')
    expect(requests[0]?.url).toContain('offset=48')
    expect(requests[1]?.url).toBe(`${baseUrl}/v1/miniapp/favorite-games`)
    expect(requests[2]).toMatchObject({
      url: `${baseUrl}/v1/miniapp/board-games/game-1/like`,
      method: 'PUT',
      data: { liked: true, requestId: 'like-request-001' },
      authorization: 'Bearer viewer-token'
    })
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

it('opens public meetup details without authentication, including after explicit logout',async()=>{
  installWxMock(request=>{expect(request.url).toContain('/v1/public/meetups/m?storeId=');expect(request.header?.Authorization).toBeUndefined();respond(request,200,{id:'m'})})
  const c=new HttpMiniappClient({baseUrl,storeId,authMode:'wechat',token:()=>null,saveToken:()=>{throw Error('unexpected login')},clearToken:()=>{}})
  expect((await c.community.getMeetup('m')).id).toBe('m');await c.logout();expect((await c.community.getMeetup('m')).id).toBe('m')
})
