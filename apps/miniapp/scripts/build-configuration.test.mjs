import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterCustomerAppManifest,
  readBuildConfiguration
} from './build-configuration.mjs'

const productionEndpoints = {
  miniappProductionApiBaseUrl: 'https://judian.icu',
  miniappProductionStoreId: '22222222-2222-4222-8222-222222222222'
}

test('defaults to offline Mock mode even when production endpoints are configured', () => {
  const result = readBuildConfiguration({}, productionEndpoints)

  assert.equal(result.mode, 'mock')
  assert.deepEqual(result.configuration, {
    useMock: true,
    authMode: 'development',
    apiBaseUrl: '',
    storeId: '',
    developmentProviderSubject: 'local-miniapp-user',
    customerOnly: false,
    realWechatPayment: false
  })
})

test('builds the released customer app only against the production API', () => {
  const result = readBuildConfiguration(
    { ZYAPP_MINIAPP_MODE: 'production-wechat' },
    productionEndpoints
  )

  assert.deepEqual(result.configuration, {
    useMock: false,
    authMode: 'wechat',
    apiBaseUrl: 'https://judian.icu',
    storeId: '22222222-2222-4222-8222-222222222222',
    developmentProviderSubject: '',
    customerOnly: true,
    realWechatPayment: true
  })
})

test('accepts explicit production-only endpoint variables', () => {
  const result = readBuildConfiguration({
    ZYAPP_MINIAPP_MODE: 'production-wechat',
    ZYAPP_MINIAPP_PRODUCTION_API_BASE_URL: 'https://judian.icu',
    ZYAPP_MINIAPP_PRODUCTION_STORE_ID:
      '22222222-2222-4222-8222-222222222222'
  })

  assert.equal(result.configuration.apiBaseUrl, 'https://judian.icu')
  assert.equal(
    result.configuration.storeId,
    '22222222-2222-4222-8222-222222222222'
  )
})

for (const retiredMode of ['test-wechat', 'production-test-wechat']) {
  test(`rejects retired miniapp release mode ${retiredMode}`, () => {
    assert.throws(
      () => readBuildConfiguration({ ZYAPP_MINIAPP_MODE: retiredMode }),
      /must be mock, development-http, or production-wechat/
    )
  })
}

test('rejects retired miniapp test endpoint configuration', () => {
  assert.throws(
    () =>
      readBuildConfiguration({}, {
        miniappTestApiBaseUrl: 'https://judian.icu/test',
        miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
      }),
    /test release channel has been removed/
  )
})

test('rejects the retired virtual phone build switch', () => {
  assert.throws(
    () =>
      readBuildConfiguration({
        ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false'
      }),
    /test release channel has been removed/
  )
})

test('rejects a non-production store override in the released build', () => {
  assert.throws(
    () =>
      readBuildConfiguration(
        {
          ZYAPP_MINIAPP_MODE: 'production-wechat',
          ZYAPP_MINIAPP_STORE_ID:
            '11111111-1111-4111-8111-111111111111'
        },
        productionEndpoints
      ),
    /production-wechat store must match miniappProductionStoreId/
  )
})

for (const invalidUrl of [
  'http://judian.icu',
  'https://124.220.69.209',
  'https://judian.icu/test'
]) {
  test(`rejects production endpoint ${invalidUrl}`, () => {
    assert.throws(
      () =>
        readBuildConfiguration(
          {
            ZYAPP_MINIAPP_MODE: 'production-wechat',
            ZYAPP_MINIAPP_API_BASE_URL: invalidUrl
          },
          productionEndpoints
        ),
      /production-wechat must use https:\/\/judian\.icu/
    )
  })
}

test('keeps local HTTP development available without creating a release channel', () => {
  const result = readBuildConfiguration({
    ZYAPP_MINIAPP_MODE: 'development-http',
    ZYAPP_MINIAPP_AUTH_MODE: 'development',
    ZYAPP_MINIAPP_API_BASE_URL: 'http://127.0.0.1:3100',
    ZYAPP_MINIAPP_STORE_ID: '22222222-2222-4222-8222-222222222222'
  })

  assert.equal(result.configuration.customerOnly, false)
  assert.equal(result.configuration.realWechatPayment, false)
  assert.equal(result.configuration.authMode, 'development')
})

test('keeps only the approved member pages in the customer app manifest', () => {
  assert.deepEqual(
    filterCustomerAppManifest({
      pages: [
        'pages/home/index',
        'pages/games/index',
        'pages/game-expansions/index',
        'pages/tools/index',
        'pages/tool-first-player/index',
        'pages/tool-teams/index',
        'pages/tool-dice/index',
        'pages/tool-coin/index',
        'pages/tool-score/index',
        'pages/history/index',
        'pages/member/index',
        'pages/favorites/index',
        'pages/staff/index',
        'pages/manager/index',
        'pages/content/index'
      ],
      window: { navigationBarTitleText: '桌游吧' }
    }),
    {
      pages: [
        'pages/home/index',
        'pages/games/index',
        'pages/game-expansions/index',
        'pages/tools/index',
        'pages/tool-first-player/index',
        'pages/tool-teams/index',
        'pages/tool-dice/index',
        'pages/tool-coin/index',
        'pages/tool-score/index',
        'pages/history/index',
        'pages/member/index',
        'pages/favorites/index'
      ],
      window: { navigationBarTitleText: '桌游吧' }
    }
  )
})

test('source app manifest exposes only approved customer pages', async () => {
  const { readFile } = await import('node:fs/promises')
  const app = JSON.parse(
    await readFile(new URL('../src/app.json', import.meta.url), 'utf8')
  )

  assert.deepEqual(app.pages, [
    'pages/home/index',
    'pages/games/index',
    'pages/game-expansions/index',
    'pages/tools/index',
    'pages/tool-first-player/index',
    'pages/tool-teams/index',
    'pages/tool-dice/index',
    'pages/tool-coin/index',
    'pages/tool-score/index',
    'pages/history/index',
    'pages/member/index',
    'pages/favorites/index'
  ])
  assert.equal(JSON.stringify(app).includes('staff'), false)
  assert.equal(JSON.stringify(app).includes('manager'), false)
  assert.equal(JSON.stringify(app).includes('activities'), false)
})

test('requires explicit production configuration for a released build', () => {
  assert.throws(
    () =>
      readBuildConfiguration({
        ZYAPP_MINIAPP_MODE: 'production-wechat',
        ZYAPP_MINIAPP_PRODUCTION_API_BASE_URL: 'https://judian.icu'
      }),
    /requires miniappProductionStoreId/
  )
})
