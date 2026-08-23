const employeePages = new Set([
  'pages/staff/index',
  'pages/manager/index',
  'pages/content/index'
])

export function filterCustomerAppManifest(manifest) {
  return {
    ...manifest,
    pages: manifest.pages.filter((page) => !employeePages.has(page))
  }
}

export function readBuildConfiguration(
  environment = process.env,
  publicEndpoints = {}
) {
  const retiredTestConfiguration = [
    environment.ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED,
    publicEndpoints.miniappTestApiBaseUrl,
    publicEndpoints.miniappTestStoreId
  ].some((value) => value?.trim())
  if (retiredTestConfiguration) {
    throw new Error(
      'The miniapp test release channel has been removed; use production-wechat for uploads'
    )
  }

  const mode = environment.ZYAPP_MINIAPP_MODE?.trim() || 'mock'
  if (
    ![
      'mock',
      'development-http',
      'production-wechat'
    ].includes(mode)
  ) {
    throw new Error(
      'ZYAPP_MINIAPP_MODE must be mock, development-http, or production-wechat'
    )
  }
  const production = mode === 'production-wechat'
  const customerRelease = production

  const defaultApiBaseUrl =
    production
      ? environment.ZYAPP_MINIAPP_PRODUCTION_API_BASE_URL?.trim() ||
        publicEndpoints.miniappProductionApiBaseUrl?.trim() ||
        ''
      : ''
  const apiBaseUrl =
    environment.ZYAPP_MINIAPP_API_BASE_URL?.trim() || defaultApiBaseUrl
  const defaultAuthMode =
    customerRelease ||
    (mode === 'development-http' && apiBaseUrl.startsWith('https://'))
      ? 'wechat'
      : 'development'
  const authMode =
    environment.ZYAPP_MINIAPP_AUTH_MODE?.trim() || defaultAuthMode
  if (authMode !== 'development' && authMode !== 'wechat') {
    throw new Error(
      'ZYAPP_MINIAPP_AUTH_MODE must be development or wechat'
    )
  }
  if (customerRelease && authMode !== 'wechat') {
    throw new Error(`${mode} mode must use WeChat authentication`)
  }
  if (production && apiBaseUrl !== 'https://judian.icu') {
    throw new Error(
      'production-wechat must use https://judian.icu'
    )
  }
  const productionStoreId =
    environment.ZYAPP_MINIAPP_PRODUCTION_STORE_ID?.trim() ||
    publicEndpoints.miniappProductionStoreId?.trim() ||
    ''
  const environmentStoreId =
    environment.ZYAPP_MINIAPP_STORE_ID?.trim() || ''
  if (production && !productionStoreId) {
    throw new Error(
      'production-wechat requires miniappProductionStoreId'
    )
  }
  if (
    production &&
    environmentStoreId &&
    environmentStoreId !== productionStoreId
  ) {
    throw new Error(
      'production-wechat store must match miniappProductionStoreId'
    )
  }

  const configuration = {
    useMock: mode === 'mock',
    authMode,
    apiBaseUrl,
    storeId: production
      ? productionStoreId
      : environmentStoreId,
    developmentProviderSubject:
      customerRelease
        ? ''
        : environment.ZYAPP_MINIAPP_DEVELOPMENT_SUBJECT?.trim() ||
          'local-miniapp-user',
    customerOnly: customerRelease,
    realWechatPayment: customerRelease
  }
  if (!configuration.useMock) {
    if (!configuration.apiBaseUrl) {
      throw new Error('ZYAPP_MINIAPP_API_BASE_URL is required for HTTP builds')
    }
    if (!configuration.storeId) {
      throw new Error('ZYAPP_MINIAPP_STORE_ID is required for HTTP builds')
    }
  }
  return { mode, configuration }
}
