type ZyAppMiniappBuildConfig = {
  useMock: boolean
  testVirtualPhoneEnabled: boolean
  authMode: 'development' | 'wechat'
  apiBaseUrl: string
  storeId: string
  developmentProviderSubject: string
}

declare const __ZYAPP_MINIAPP_BUILD_CONFIG__: ZyAppMiniappBuildConfig
