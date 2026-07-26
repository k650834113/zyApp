function booleanValue(value, defaultValue, name) {
  if (value === undefined || value.trim() === '') return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

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
  const configuredTestEnvironment = Boolean(
    publicEndpoints.miniappTestApiBaseUrl?.trim() &&
      publicEndpoints.miniappTestStoreId?.trim()
  )
  const mode =
    environment.ZYAPP_MINIAPP_MODE?.trim() ||
    (configuredTestEnvironment ? 'test-wechat' : 'mock')
  if (
    ![
      'mock',
      'development-http',
      'test-wechat',
      'production-test-wechat',
      'production-wechat'
    ].includes(mode)
  ) {
    throw new Error(
      'ZYAPP_MINIAPP_MODE must be mock, development-http, test-wechat, production-test-wechat, or production-wechat'
    )
  }
  const productionTest = mode === 'production-test-wechat'
  const production = mode === 'production-wechat'
  const customerRelease = productionTest || production

  const defaultApiBaseUrl =
    production
      ? publicEndpoints.miniappProductionApiBaseUrl?.trim() || ''
      : mode === 'test-wechat' || productionTest
        ? publicEndpoints.miniappTestApiBaseUrl?.trim() || ''
        : ''
  const apiBaseUrl =
    environment.ZYAPP_MINIAPP_API_BASE_URL?.trim() || defaultApiBaseUrl
  const defaultAuthMode =
    mode === 'test-wechat' ||
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
  if (
    (mode === 'test-wechat' || customerRelease) &&
    authMode !== 'wechat'
  ) {
    throw new Error(`${mode} mode must use WeChat authentication`)
  }
  const testVirtualPhoneEnabled = booleanValue(
    environment.ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED,
    mode === 'test-wechat',
    'ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED'
  )
  if (testVirtualPhoneEnabled && mode !== 'test-wechat') {
    if (customerRelease) {
      throw new Error(`${mode} forbids virtual phone login`)
    }
    throw new Error(
      'ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED is only allowed in test-wechat mode'
    )
  }
  if (productionTest && apiBaseUrl !== 'https://judian.icu/test') {
    throw new Error(
      'production-test-wechat must use https://judian.icu/test'
    )
  }
  if (production && apiBaseUrl !== 'https://judian.icu') {
    throw new Error(
      'production-wechat must use https://judian.icu'
    )
  }
  const productionStoreId =
    publicEndpoints.miniappProductionStoreId?.trim() || ''
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
    testVirtualPhoneEnabled,
    authMode,
    apiBaseUrl,
    storeId: production
      ? productionStoreId
      : environmentStoreId ||
        publicEndpoints.miniappTestStoreId?.trim() ||
        '',
    developmentProviderSubject:
      customerRelease
        ? ''
        : environment.ZYAPP_MINIAPP_DEVELOPMENT_SUBJECT?.trim() ||
          'local-miniapp-user',
    customerOnly: customerRelease,
    realWechatPayment: productionTest
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
