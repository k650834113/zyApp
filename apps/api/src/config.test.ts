import { describe, expect, it } from 'vitest'
import { readApiConfig } from './config'

describe('API configuration', () => {
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
      phoneVerificationSecret:
        'local-phone-verification-secret-32-characters',
      phoneVerificationMode: 'mock',
      wechatPaymentMode: 'mock',
      miniappDevelopmentAuthEnabled: true,
      miniappWechatAuthMode: 'wechat',
      wechatMiniappAppId: 'wx-test-appid',
      wechatMiniappAppSecret: 'wx-test-secret',
      miniappTestVirtualPhone: '18888888888'
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
