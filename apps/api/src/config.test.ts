import { describe, expect, it } from 'vitest'
import { readApiConfig } from './config'

function baseEnvironment(
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DEPLOYMENT_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgres://local/database',
    REDIS_URL: 'redis://local',
    DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
    MINIAPP_PUBLIC_BASE_URL: 'https://judian.icu/test',
    PHONE_VERIFICATION_SECRET:
      'local-phone-verification-secret-32-characters',
    MINIAPP_WECHAT_AUTH_MODE: 'wechat',
    WECHAT_MINIAPP_APP_ID: 'wx31ab6acf49352ce3',
    WECHAT_MINIAPP_APP_SECRET: 'wx-test-secret',
    ...overrides
  }
}

function completeWechatEnvironment(
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return baseEnvironment({
    WECHAT_PAYMENT_MODE: 'wechat',
    WECHAT_PAY_MERCHANT_ID: '1748654937',
    WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL:
      '5A287A96C7BCD2AC8089D405F7478385C4902A7B',
    WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE:
      '/run/secrets/wechatpay/apiclient_key.pem',
    WECHAT_PAY_PUBLIC_KEY_ID:
      'PUB_KEY_ID_0117486549372026072500000000000000',
    WECHAT_PAY_PUBLIC_KEY_FILE:
      '/run/secrets/wechatpay/wechatpay_public_key.pem',
    WECHAT_PAY_API_V3_KEY_FILE: '/run/secrets/wechatpay/apiv3.key',
    WECHAT_PAY_NOTIFY_URL:
      'https://judian.icu/test/v1/payments/wechat/recharge/notify',
    WECHAT_PAY_OUT_TRADE_NO_PREFIX: 'ZYT-',
    ...overrides
  })
}

describe('API configuration', () => {
  it('keeps BGG metadata disabled by default', () => {
    expect(readApiConfig(baseEnvironment())).toMatchObject({
      bggMetadataMode: 'disabled',
      bggXmlApiTokenFile: null,
      bggPublicImagesEnabled: false
    })
  })

  it('requires a token file for BGG XML API mode', () => {
    expect(() => readApiConfig(baseEnvironment({
      BGG_METADATA_MODE: 'xmlapi'
    }))).toThrow('BGG_XML_API_TOKEN_FILE')

    expect(readApiConfig(baseEnvironment({
      BGG_METADATA_MODE: 'xmlapi',
      BGG_XML_API_TOKEN_FILE: '/run/secrets/bgg/token',
      BGG_PUBLIC_IMAGES_ENABLED: 'true'
    }))).toMatchObject({
      bggMetadataMode: 'xmlapi',
      bggXmlApiTokenFile: '/run/secrets/bgg/token',
      bggPublicImagesEnabled: true
    })
  })

  it('forbids BGG public images while metadata integration is disabled', () => {
    expect(() => readApiConfig(baseEnvironment({
      BGG_PUBLIC_IMAGES_ENABLED: 'true'
    }))).toThrow(/BGG_PUBLIC_IMAGES_ENABLED/)
  })

  it('parses explicit local cloud configuration', () => {
    expect(
      readApiConfig({
        NODE_ENV: 'test',
        DEPLOYMENT_ENVIRONMENT: 'test',
        API_PORT: '3200',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
        DESKTOP_UPDATE_DIRECTORY: 'C:/updates/windows',
        MEMBER_AVATAR_DIRECTORY: 'C:/member-avatars/test',
        BOARD_GAME_COVER_DIRECTORY: 'C:/board-game-covers/test',
        MINIAPP_PUBLIC_BASE_URL: 'https://judian.icu/test',
        PHONE_VERIFICATION_SECRET:
          'local-phone-verification-secret-32-characters',
        PHONE_VERIFICATION_MODE: 'mock',
        WECHAT_PAYMENT_MODE: 'mock',
        MINIAPP_DEVELOPMENT_AUTH_ENABLED: 'true',
        MINIAPP_WECHAT_AUTH_MODE: 'wechat',
        WECHAT_MINIAPP_APP_ID: 'wx-test-appid',
        WECHAT_MINIAPP_APP_SECRET: 'wx-test-secret',
        MINIAPP_TEST_VIRTUAL_PHONE: '18888888888'
      })
    ).toEqual({
      nodeEnv: 'test',
      deploymentEnvironment: 'test',
      port: 3200,
      databaseUrl: 'postgres://local/database',
      redisUrl: 'redis://local',
      deviceEnrollmentSecret: 'local-enrollment-secret-32-characters',
      desktopUpdateDirectory: 'C:/updates/windows',
      memberAvatarDirectory: 'C:/member-avatars/test',
      boardGameCoverDirectory: 'C:/board-game-covers/test',
      miniappPublicBaseUrl: 'https://judian.icu/test',
      phoneVerificationSecret:
        'local-phone-verification-secret-32-characters',
      phoneVerificationMode: 'mock',
      wechatPaymentMode: 'mock',
      wechatPayMerchantId: null,
      wechatPayMerchantCertificateSerial: null,
      wechatPayMerchantPrivateKeyPath: null,
      wechatPayPublicKeyId: null,
      wechatPayPublicKeyPath: null,
      wechatPayApiV3KeyPath: null,
      wechatPayNotifyUrl: null,
      wechatPayOutTradeNoPrefix: 'ZY-',
      miniappDevelopmentAuthEnabled: true,
      miniappWechatAuthMode: 'wechat',
      wechatMiniappAppId: 'wx-test-appid',
      wechatMiniappAppSecret: 'wx-test-secret',
      miniappTestVirtualPhone: '18888888888',
      bggMetadataMode: 'disabled',
      bggXmlApiTokenFile: null,
      bggPublicImagesEnabled: false
    })
  })

  it('rejects missing infrastructure addresses and invalid ports', () => {
    expect(() => readApiConfig({ REDIS_URL: 'redis://local' })).toThrow(
      'DATABASE_URL'
    )
    expect(() =>
      readApiConfig({
        API_PORT: '70000',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters'
      })
    ).toThrow('API_PORT')
  })

  it('requires an HTTPS miniapp public base URL in production', () => {
    expect(() =>
      readApiConfig(
        baseEnvironment({
          MINIAPP_PUBLIC_BASE_URL: 'http://judian.icu/test'
        })
      )
    ).toThrow('MINIAPP_PUBLIC_BASE_URL must use HTTPS')
  })

  it('forbids mock verification in production', () => {
    expect(() =>
      readApiConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
        PHONE_VERIFICATION_SECRET:
          'local-phone-verification-secret-32-characters',
        PHONE_VERIFICATION_MODE: 'mock'
      })
    ).toThrow('forbidden in production')
  })

  it('forbids mock payment in production', () => {
    expect(() =>
      readApiConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
        PHONE_VERIFICATION_SECRET:
          'local-phone-verification-secret-32-characters',
        WECHAT_PAYMENT_MODE: 'mock'
      })
    ).toThrow('WECHAT_PAYMENT_MODE=mock is forbidden in production')
  })

  it('requires every WeChat Pay v3 setting in wechat mode', () => {
    expect(() =>
      readApiConfig(baseEnvironment({ WECHAT_PAYMENT_MODE: 'wechat' }))
    ).toThrow(/WECHAT_PAY_MERCHANT_ID/)
  })

  it('accepts real payment in the isolated test deployment', () => {
    const config = readApiConfig(completeWechatEnvironment())

    expect(config.wechatPaymentMode).toBe('wechat')
    expect(config.wechatPayMerchantId).toBe('1748654937')
    expect(config.wechatPayNotifyUrl).toBe(
      'https://judian.icu/test/v1/payments/wechat/recharge/notify'
    )
  })

  it('accepts formal production payment without dropping public member assets', () => {
    const config = readApiConfig(
      completeWechatEnvironment({
        DEPLOYMENT_ENVIRONMENT: 'production',
        MINIAPP_PUBLIC_BASE_URL: 'https://judian.icu',
        MEMBER_AVATAR_DIRECTORY: '/app/data/member-avatars',
        BOARD_GAME_COVER_DIRECTORY: '/app/data/board-game-covers',
        WECHAT_PAY_NOTIFY_URL:
          'https://judian.icu/v1/payments/wechat/recharge/notify',
        WECHAT_PAY_OUT_TRADE_NO_PREFIX: 'ZYP-'
      })
    )

    expect(config.wechatPaymentMode).toBe('wechat')
    expect(config.wechatPayNotifyUrl).toBe(
      'https://judian.icu/v1/payments/wechat/recharge/notify'
    )
    expect(config.memberAvatarDirectory).toBe('/app/data/member-avatars')
    expect(config.boardGameCoverDirectory).toBe(
      '/app/data/board-game-covers'
    )
    expect(config.miniappPublicBaseUrl).toBe('https://judian.icu')
  })

  it('rejects a test notification endpoint in formal production', () => {
    expect(() =>
      readApiConfig(
        completeWechatEnvironment({
          DEPLOYMENT_ENVIRONMENT: 'production',
          MINIAPP_PUBLIC_BASE_URL: 'https://judian.icu',
          WECHAT_PAY_NOTIFY_URL:
            'https://judian.icu/test/v1/payments/wechat/recharge/notify',
          WECHAT_PAY_OUT_TRADE_NO_PREFIX: 'ZYP-'
        })
      )
    ).toThrow(
      'Production WECHAT_PAY_NOTIFY_URL must be https://judian.icu/v1/payments/wechat/recharge/notify'
    )
  })

  it('forbids virtual phone login when real test payment is enabled', () => {
    expect(() =>
      readApiConfig(
        completeWechatEnvironment({
          MINIAPP_TEST_VIRTUAL_PHONE: '18888888888'
        })
      )
    ).toThrow(/Real WeChat payment forbids MINIAPP_TEST_VIRTUAL_PHONE/)
  })

  it('requires WeChat Mini Program secrets when real auth is enabled', () => {
    expect(() =>
      readApiConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
        MINIAPP_WECHAT_AUTH_MODE: 'wechat'
      })
    ).toThrow('WECHAT_MINIAPP_APP_ID')
  })

  it('rejects a virtual phone outside the isolated test deployment', () => {
    expect(() =>
      readApiConfig({
        NODE_ENV: 'production',
        DEPLOYMENT_ENVIRONMENT: 'production',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
        PHONE_VERIFICATION_SECRET:
          'local-phone-verification-secret-32-characters',
        MINIAPP_WECHAT_AUTH_MODE: 'wechat',
        WECHAT_MINIAPP_APP_ID: 'wx-test-appid',
        WECHAT_MINIAPP_APP_SECRET: 'wx-test-secret',
        MINIAPP_TEST_VIRTUAL_PHONE: '18888888888'
      })
    ).toThrow('only allowed in the test deployment environment')
  })

  it('rejects an invalid virtual phone number', () => {
    expect(() =>
      readApiConfig({
        NODE_ENV: 'test',
        DEPLOYMENT_ENVIRONMENT: 'test',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        DEVICE_ENROLLMENT_SECRET: 'local-enrollment-secret-32-characters',
        MINIAPP_TEST_VIRTUAL_PHONE: 'not-a-phone'
      })
    ).toThrow('must be a mainland China mobile number')
  })
})
