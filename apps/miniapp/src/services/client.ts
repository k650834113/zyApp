import { HttpMiniappClient } from './http-client'
import { MockMiniappClient } from './mock-client'
import { accessTokenStorageKey } from './session-storage'
import type { MiniappClient } from './types'

const configuration = __ZYAPP_MINIAPP_BUILD_CONFIG__
const LEGACY_ACCESS_TOKEN_KEY = 'zyapp_access_token'

let client: MiniappClient | null = null

export function getMiniappClient(): MiniappClient {
  if (client) return client
  const tokenStorageKey = accessTokenStorageKey(
    configuration.apiBaseUrl,
    configuration.storeId
  )
  client = configuration.useMock
    ? new MockMiniappClient()
    : new HttpMiniappClient({
        baseUrl: configuration.apiBaseUrl,
        storeId: configuration.storeId,
        token: () => wx.getStorageSync<string>(tokenStorageKey) || null,
        saveToken: (token) => {
          wx.setStorageSync(tokenStorageKey, token)
          wx.removeStorageSync(LEGACY_ACCESS_TOKEN_KEY)
        },
        clearToken: () => wx.removeStorageSync(tokenStorageKey),
        loggedOut: () => wx.getStorageSync<boolean>(tokenStorageKey + '_signed_out') === true,
        setLoggedOut: value => wx.setStorageSync(tokenStorageKey + '_signed_out',value),
        authMode: configuration.authMode,
        developmentProviderSubject: configuration.developmentProviderSubject
      })
  return client
}

export function isMockMiniappBuild(): boolean {
  return configuration.useMock
}

export function isCustomerOnlyBuild(): boolean {
  return configuration.customerOnly
}

export function isRealWechatPaymentBuild(): boolean {
  return configuration.realWechatPayment
}
