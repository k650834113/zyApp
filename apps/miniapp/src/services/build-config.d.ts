type ZyAppMiniappBuildConfig = {
  useMock: boolean
  authMode: 'development' | 'wechat'
  apiBaseUrl: string
  storeId: string
  developmentProviderSubject: string
  customerOnly: boolean
  realWechatPayment: boolean
}

declare const __ZYAPP_MINIAPP_BUILD_CONFIG__: ZyAppMiniappBuildConfig
