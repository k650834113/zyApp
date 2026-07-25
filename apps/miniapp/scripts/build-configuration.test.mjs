import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterCustomerAppManifest,
  readBuildConfiguration
} from './build-configuration.mjs'

const configuredEndpoints = {
  miniappTestApiBaseUrl: 'https://test-api.example.com',
  miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
}

test('defaults to offline Mock mode when no local endpoint file is configured', () => {
  const result = readBuildConfiguration({}, {})

  assert.equal(result.mode, 'mock')
  assert.equal(result.configuration.useMock, true)
  assert.equal(result.configuration.apiBaseUrl, '')
  assert.equal(result.configuration.storeId, '')
})

test('uses the configured WeChat test environment', () => {
  const result = readBuildConfiguration({}, configuredEndpoints)

  assert.equal(result.mode, 'test-wechat')
  assert.deepEqual(result.configuration, {
    useMock: false,
    testVirtualPhoneEnabled: true,
    authMode: 'wechat',
    apiBaseUrl: configuredEndpoints.miniappTestApiBaseUrl,
    storeId: configuredEndpoints.miniappTestStoreId,
    developmentProviderSubject: 'local-miniapp-user',
    customerOnly: false,
    realWechatPayment: false
  })
})

test('builds the customer-only production test against judian.icu', () => {
  const result = readBuildConfiguration(
    {
      ZYAPP_MINIAPP_MODE: 'production-test-wechat',
      ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false'
    },
    {
      miniappTestApiBaseUrl: 'https://judian.icu/test',
      miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
    }
  )

  assert.deepEqual(result.configuration, {
    useMock: false,
    testVirtualPhoneEnabled: false,
    authMode: 'wechat',
    apiBaseUrl: 'https://judian.icu/test',
    storeId: '11111111-1111-4111-8111-111111111111',
    developmentProviderSubject: '',
    customerOnly: true,
    realWechatPayment: true
  })
})

for (const invalidUrl of [
  'http://judian.icu/test',
  'https://124.220.69.209/test',
  'https://judian.icu'
]) {
  test(`rejects production-test endpoint ${invalidUrl}`, () => {
    assert.throws(
      () =>
        readBuildConfiguration(
          {
            ZYAPP_MINIAPP_MODE: 'production-test-wechat',
            ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false'
          },
          {
            miniappTestApiBaseUrl: invalidUrl,
            miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
          }
        ),
      /https:\/\/judian\.icu\/test/
    )
  })
}

test('rejects virtual phone login in the production test build', () => {
  assert.throws(
    () =>
      readBuildConfiguration(
        {
          ZYAPP_MINIAPP_MODE: 'production-test-wechat',
          ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'true'
        },
        {
          miniappTestApiBaseUrl: 'https://judian.icu/test',
          miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
        }
      ),
    /forbids virtual phone login/
  )
})

test('removes employee routes from the customer-only app manifest', () => {
  assert.deepEqual(
    filterCustomerAppManifest({
      pages: [
        'pages/home/index',
        'pages/activities/index',
        'pages/member/index',
        'pages/staff/index',
        'pages/manager/index',
        'pages/content/index'
      ],
      window: { navigationBarTitleText: '桌游吧' }
    }),
    {
      pages: [
        'pages/home/index',
        'pages/activities/index',
        'pages/member/index'
      ],
      window: { navigationBarTitleText: '桌游吧' }
    }
  )
})

test('keeps Mock mode available only when explicitly selected', () => {
  const result = readBuildConfiguration({ ZYAPP_MINIAPP_MODE: 'mock' })

  assert.equal(result.mode, 'mock')
  assert.equal(result.configuration.useMock, true)
  assert.equal(result.configuration.testVirtualPhoneEnabled, false)
})

test('does not allow the test build to downgrade to development auth', () => {
  assert.throws(
    () =>
      readBuildConfiguration({
        ZYAPP_MINIAPP_MODE: 'test-wechat',
        ZYAPP_MINIAPP_AUTH_MODE: 'development'
      }, configuredEndpoints),
    /must use WeChat authentication/
  )
})

test('allows the temporary virtual phone switch to be disabled', () => {
  const result = readBuildConfiguration(
    { ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false' },
    configuredEndpoints
  )

  assert.equal(result.configuration.testVirtualPhoneEnabled, false)
})

test('does not allow virtual phone login outside test-wechat mode', () => {
  assert.throws(
    () =>
      readBuildConfiguration({
        ZYAPP_MINIAPP_MODE: 'development-http',
        ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'true'
      }),
    /only allowed in test-wechat mode/
  )
})
