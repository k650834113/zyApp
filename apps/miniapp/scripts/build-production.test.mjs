import assert from 'node:assert/strict'
import test from 'node:test'
import { configureProductionBuildEnvironment } from './production-build-environment.mjs'

test('production build ignores stale test endpoint and auth overrides', () => {
  const environment = {
    ZYAPP_MINIAPP_MODE: 'test-wechat',
    ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'true',
    ZYAPP_MINIAPP_API_BASE_URL: 'https://judian.icu/test',
    ZYAPP_MINIAPP_STORE_ID: 'test-store',
    ZYAPP_MINIAPP_AUTH_MODE: 'development'
  }

  assert.deepEqual(configureProductionBuildEnvironment(environment), {
    ZYAPP_MINIAPP_MODE: 'production-wechat'
  })
})
