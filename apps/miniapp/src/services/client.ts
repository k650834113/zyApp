import { HttpMiniappClient } from './http-client'
import { MockMiniappClient } from './mock-client'
import { accessTokenStorageKey } from './session-storage'
import type { MiniappClient } from './types'

const configuration = __ZYAPP_MINIAPP_BUILD_CONFIG__
const TEST_VIRTUAL_PHONE_CODE = 'test-virtual-phone'
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
        authMode: configuration.authMode,
        developmentProviderSubject: configuration.developmentProviderSubject
      })
  return client
}

export function isMockMiniappBuild(): boolean {
  return configuration.useMock
}

export function isTestVirtualPhoneLoginEnabled(): boolean {
  return configuration.testVirtualPhoneEnabled
}

export function isCustomerOnlyBuild(): boolean {
  return configuration.customerOnly
}

export function isRealWechatPaymentBuild(): boolean {
  return configuration.realWechatPayment
}

export function testVirtualPhoneCode(): string {
  if (!configuration.testVirtualPhoneEnabled) {
    throw new Error('测试虚拟号码登录未启用')
  }
  return TEST_VIRTUAL_PHONE_CODE
}
