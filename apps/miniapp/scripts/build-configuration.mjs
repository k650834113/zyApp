function booleanValue(value, defaultValue, name) {
  if (value === undefined || value.trim() === '') return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
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
  if (!['mock', 'development-http', 'test-wechat'].includes(mode)) {
    throw new Error(
      'ZYAPP_MINIAPP_MODE must be mock, development-http, or test-wechat'
    )
  }

  const defaultApiBaseUrl =
    mode === 'test-wechat'
      ? publicEndpoints.miniappTestApiBaseUrl?.trim() || ''
      : ''
  const apiBaseUrl =
    environment.ZYAPP_MINIAPP_API_BASE_URL?.trim() || defaultApiBaseUrl
  const defaultAuthMode =
    mode === 'test-wechat' ||
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
  if (mode === 'test-wechat' && authMode !== 'wechat') {
    throw new Error('test-wechat mode must use WeChat authentication')
  }
  const testVirtualPhoneEnabled = booleanValue(
    environment.ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED,
    mode === 'test-wechat',
    'ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED'
  )
  if (testVirtualPhoneEnabled && mode !== 'test-wechat') {
    throw new Error(
      'ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED is only allowed in test-wechat mode'
    )
  }

  const configuration = {
    useMock: mode === 'mock',
    testVirtualPhoneEnabled,
    authMode,
    apiBaseUrl,
    storeId:
      environment.ZYAPP_MINIAPP_STORE_ID?.trim() ||
      publicEndpoints.miniappTestStoreId?.trim() ||
      '',
    developmentProviderSubject:
      environment.ZYAPP_MINIAPP_DEVELOPMENT_SUBJECT?.trim() ||
      'local-miniapp-user'
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
