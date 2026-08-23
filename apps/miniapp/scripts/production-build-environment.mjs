export function configureProductionBuildEnvironment(environment) {
  environment.ZYAPP_MINIAPP_MODE = 'production-wechat'

  delete environment.ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
  delete environment.ZYAPP_MINIAPP_API_BASE_URL
  delete environment.ZYAPP_MINIAPP_STORE_ID
  delete environment.ZYAPP_MINIAPP_AUTH_MODE

  return environment
}
