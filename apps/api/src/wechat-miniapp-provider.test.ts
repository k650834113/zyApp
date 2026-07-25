import { describe, expect, it } from 'vitest'
import type { ApiConfig } from './config'
import {
  resolveWechatPhoneNumber,
  TEST_VIRTUAL_WECHAT_PHONE_CODE
} from './wechat-miniapp-provider'

const testConfig: ApiConfig = {
  nodeEnv: 'production',
  deploymentEnvironment: 'test',
  port: 3100,
  databaseUrl: 'postgres://local/database',
  redisUrl: 'redis://local',
  deviceEnrollmentSecret: 'local-enrollment-secret-32-characters',
  desktopUpdateDirectory: './updates',
  phoneVerificationSecret: 'phone-verification-secret-32-characters',
  phoneVerificationMode: 'disabled',
  wechatPaymentMode: 'disabled',
  wechatPayMerchantId: null,
  wechatPayMerchantCertificateSerial: null,
  wechatPayMerchantPrivateKeyPath: null,
  wechatPayPublicKeyId: null,
  wechatPayPublicKeyPath: null,
  wechatPayApiV3KeyPath: null,
  wechatPayNotifyUrl: null,
  wechatPayOutTradeNoPrefix: 'ZY-',
  wechatPaymentTestAmountFen: null,
  miniappDevelopmentAuthEnabled: false,
  miniappWechatAuthMode: 'wechat',
  wechatMiniappAppId: 'wx-test-appid',
  wechatMiniappAppSecret: 'wx-test-secret',
  miniappTestVirtualPhone: '18888888888'
}

const unusedRedis = {} as Parameters<typeof resolveWechatPhoneNumber>[1]

describe('WeChat Mini Program phone provider', () => {
  it('resolves the configured virtual phone in the test deployment', async () => {
    await expect(
      resolveWechatPhoneNumber(
        testConfig,
        unusedRedis,
        TEST_VIRTUAL_WECHAT_PHONE_CODE
      )
    ).resolves.toBe('18888888888')
  })

  it('rejects the virtual phone when the server switch is disabled', async () => {
    await expect(
      resolveWechatPhoneNumber(
        { ...testConfig, miniappTestVirtualPhone: null },
        unusedRedis,
        TEST_VIRTUAL_WECHAT_PHONE_CODE
      )
    ).rejects.toThrow('Test virtual phone login is not available')
  })

  it('rejects the virtual phone in the production deployment', async () => {
    await expect(
      resolveWechatPhoneNumber(
        { ...testConfig, deploymentEnvironment: 'production' },
        unusedRedis,
        TEST_VIRTUAL_WECHAT_PHONE_CODE
      )
    ).rejects.toThrow('Test virtual phone login is not available')
  })
})
