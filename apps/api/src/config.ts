export type ApiConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  deploymentEnvironment: 'production' | 'test'
  port: number
  databaseUrl: string
  redisUrl: string
  deviceEnrollmentSecret: string
  desktopUpdateDirectory: string
  phoneVerificationSecret: string
  phoneVerificationMode: 'mock' | 'disabled'
  wechatPaymentMode: 'mock' | 'wechat' | 'disabled'
  wechatPayMerchantId: string | null
  wechatPayMerchantCertificateSerial: string | null
  wechatPayMerchantPrivateKeyPath: string | null
  wechatPayPublicKeyId: string | null
  wechatPayPublicKeyPath: string | null
  wechatPayApiV3KeyPath: string | null
  wechatPayNotifyUrl: string | null
  wechatPayOutTradeNoPrefix: string
  wechatPaymentTestAmountFen: number | null
  miniappDevelopmentAuthEnabled: boolean
  miniappWechatAuthMode?: 'mock' | 'wechat' | 'disabled'
  wechatMiniappAppId?: string | null
  wechatMiniappAppSecret?: string | null
  miniappTestVirtualPhone?: string | null
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function enrollmentSecret(value: string | undefined): string {
  const secret = required(value, 'DEVICE_ENROLLMENT_SECRET')
  if (secret.length < 32) {
    throw new Error('DEVICE_ENROLLMENT_SECRET must contain at least 32 characters')
  }
  return secret
}

function port(value: string | undefined): number {
  const parsed = Number(value ?? '3100')
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('API_PORT must be an integer from 1 to 65535')
  }
  return parsed
}

function booleanValue(
  value: string | undefined,
  defaultValue: boolean,
  name: string
): boolean {
  if (value === undefined || value.trim() === '') return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function optionalPositiveInteger(
  value: string | undefined,
  name: string
): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

export function readApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): ApiConfig {
  const nodeEnv = environment.NODE_ENV ?? 'development'
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production')
  }
  const databaseUrl = required(environment.DATABASE_URL, 'DATABASE_URL')
  const deploymentEnvironment =
    environment.DEPLOYMENT_ENVIRONMENT ??
    (nodeEnv === 'production' ? 'production' : 'test')
  if (
    deploymentEnvironment !== 'production' &&
    deploymentEnvironment !== 'test'
  ) {
    throw new Error('DEPLOYMENT_ENVIRONMENT must be production or test')
  }
  const redisUrl = required(environment.REDIS_URL, 'REDIS_URL')
  const deviceEnrollmentSecret = enrollmentSecret(
    environment.DEVICE_ENROLLMENT_SECRET
  )
  const phoneVerificationSecret =
    environment.PHONE_VERIFICATION_SECRET?.trim() ||
    (nodeEnv === 'production' ? '' : deviceEnrollmentSecret)
  if (phoneVerificationSecret.length < 32) {
    throw new Error(
      'PHONE_VERIFICATION_SECRET must contain at least 32 characters'
    )
  }
  const phoneVerificationMode =
    environment.PHONE_VERIFICATION_MODE ??
    (nodeEnv === 'production' ? 'disabled' : 'mock')
  if (
    phoneVerificationMode !== 'mock' &&
    phoneVerificationMode !== 'disabled'
  ) {
    throw new Error('PHONE_VERIFICATION_MODE must be mock or disabled')
  }
  if (nodeEnv === 'production' && phoneVerificationMode === 'mock') {
    throw new Error('PHONE_VERIFICATION_MODE=mock is forbidden in production')
  }
  const wechatPaymentMode =
    environment.WECHAT_PAYMENT_MODE ??
    (nodeEnv === 'production' ? 'disabled' : 'mock')
  if (
    wechatPaymentMode !== 'mock' &&
    wechatPaymentMode !== 'wechat' &&
    wechatPaymentMode !== 'disabled'
  ) {
    throw new Error('WECHAT_PAYMENT_MODE must be mock, wechat, or disabled')
  }
  if (nodeEnv === 'production' && wechatPaymentMode === 'mock') {
    throw new Error('WECHAT_PAYMENT_MODE=mock is forbidden in production')
  }
  const wechatPayMerchantId = optionalText(
    environment.WECHAT_PAY_MERCHANT_ID
  )
  const wechatPayMerchantCertificateSerial = optionalText(
    environment.WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL
  )
  const wechatPayMerchantPrivateKeyPath = optionalText(
    environment.WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE
  )
  const wechatPayPublicKeyId = optionalText(
    environment.WECHAT_PAY_PUBLIC_KEY_ID
  )
  const wechatPayPublicKeyPath = optionalText(
    environment.WECHAT_PAY_PUBLIC_KEY_FILE
  )
  const wechatPayApiV3KeyPath = optionalText(
    environment.WECHAT_PAY_API_V3_KEY_FILE
  )
  const wechatPayNotifyUrl = optionalText(
    environment.WECHAT_PAY_NOTIFY_URL
  )
  const wechatPayOutTradeNoPrefix =
    optionalText(environment.WECHAT_PAY_OUT_TRADE_NO_PREFIX) ?? 'ZY-'
  const wechatPaymentTestAmountFen = optionalPositiveInteger(
    environment.WECHAT_PAYMENT_TEST_AMOUNT_FEN,
    'WECHAT_PAYMENT_TEST_AMOUNT_FEN'
  )
  if (wechatPaymentMode === 'wechat') {
    required(wechatPayMerchantId ?? undefined, 'WECHAT_PAY_MERCHANT_ID')
    required(
      wechatPayMerchantCertificateSerial ?? undefined,
      'WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL'
    )
    required(
      wechatPayMerchantPrivateKeyPath ?? undefined,
      'WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE'
    )
    required(
      wechatPayPublicKeyId ?? undefined,
      'WECHAT_PAY_PUBLIC_KEY_ID'
    )
    required(
      wechatPayPublicKeyPath ?? undefined,
      'WECHAT_PAY_PUBLIC_KEY_FILE'
    )
    required(
      wechatPayApiV3KeyPath ?? undefined,
      'WECHAT_PAY_API_V3_KEY_FILE'
    )
    required(wechatPayNotifyUrl ?? undefined, 'WECHAT_PAY_NOTIFY_URL')
  }
  if (wechatPayMerchantId && !/^\d+$/.test(wechatPayMerchantId)) {
    throw new Error('WECHAT_PAY_MERCHANT_ID must contain only digits')
  }
  if (
    wechatPayMerchantCertificateSerial &&
    !/^[0-9A-F]+$/i.test(wechatPayMerchantCertificateSerial)
  ) {
    throw new Error(
      'WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL must be hexadecimal'
    )
  }
  if (
    wechatPayPublicKeyId &&
    !/^PUB_KEY_ID_[0-9A-Za-z]+$/.test(wechatPayPublicKeyId)
  ) {
    throw new Error('WECHAT_PAY_PUBLIC_KEY_ID must start with PUB_KEY_ID_')
  }
  if (
    !/^[A-Z0-9-]{1,8}$/.test(wechatPayOutTradeNoPrefix)
  ) {
    throw new Error(
      'WECHAT_PAY_OUT_TRADE_NO_PREFIX must contain 1 to 8 uppercase letters, digits, or hyphens'
    )
  }
  if (
    wechatPayNotifyUrl &&
    deploymentEnvironment === 'test' &&
    wechatPayNotifyUrl !==
      'https://judian.icu/test/v1/payments/wechat/recharge/notify'
  ) {
    throw new Error(
      'Test WECHAT_PAY_NOTIFY_URL must be https://judian.icu/test/v1/payments/wechat/recharge/notify'
    )
  }
  if (
    wechatPaymentTestAmountFen !== null &&
    (deploymentEnvironment !== 'test' || wechatPaymentMode !== 'wechat')
  ) {
    throw new Error(
      'WECHAT_PAYMENT_TEST_AMOUNT_FEN is only allowed in the test deployment with real WeChat payment'
    )
  }
  const wechatMiniappAppId = optionalText(environment.WECHAT_MINIAPP_APP_ID)
  const wechatMiniappAppSecret = optionalText(
    environment.WECHAT_MINIAPP_APP_SECRET
  )
  const defaultMiniappWechatAuthMode =
    wechatMiniappAppId && wechatMiniappAppSecret
      ? 'wechat'
      : nodeEnv === 'production'
        ? 'disabled'
        : 'mock'
  const miniappWechatAuthMode =
    environment.MINIAPP_WECHAT_AUTH_MODE ?? defaultMiniappWechatAuthMode
  if (
    miniappWechatAuthMode !== 'mock' &&
    miniappWechatAuthMode !== 'wechat' &&
    miniappWechatAuthMode !== 'disabled'
  ) {
    throw new Error(
      'MINIAPP_WECHAT_AUTH_MODE must be mock, wechat, or disabled'
    )
  }
  if (nodeEnv === 'production' && miniappWechatAuthMode === 'mock') {
    throw new Error('MINIAPP_WECHAT_AUTH_MODE=mock is forbidden in production')
  }
  if (
    miniappWechatAuthMode === 'wechat' &&
    (!wechatMiniappAppId || !wechatMiniappAppSecret)
  ) {
    throw new Error(
      'WECHAT_MINIAPP_APP_ID and WECHAT_MINIAPP_APP_SECRET are required when MINIAPP_WECHAT_AUTH_MODE=wechat'
    )
  }
  const miniappTestVirtualPhone = optionalText(
    environment.MINIAPP_TEST_VIRTUAL_PHONE
  )
  if (miniappTestVirtualPhone && !/^1\d{10}$/.test(miniappTestVirtualPhone)) {
    throw new Error(
      'MINIAPP_TEST_VIRTUAL_PHONE must be a mainland China mobile number'
    )
  }
  if (miniappTestVirtualPhone && deploymentEnvironment !== 'test') {
    throw new Error(
      'MINIAPP_TEST_VIRTUAL_PHONE is only allowed in the test deployment environment'
    )
  }
  if (miniappTestVirtualPhone && miniappWechatAuthMode !== 'wechat') {
    throw new Error(
      'MINIAPP_TEST_VIRTUAL_PHONE requires MINIAPP_WECHAT_AUTH_MODE=wechat'
    )
  }
  if (
    miniappTestVirtualPhone &&
    wechatPaymentMode === 'wechat' &&
    wechatPaymentTestAmountFen !== null
  ) {
    throw new Error(
      'Real test payment forbids MINIAPP_TEST_VIRTUAL_PHONE'
    )
  }
  return {
    nodeEnv,
    deploymentEnvironment,
    port: port(environment.API_PORT),
    databaseUrl,
    redisUrl,
    deviceEnrollmentSecret,
    desktopUpdateDirectory:
      environment.DESKTOP_UPDATE_DIRECTORY?.trim() ||
      './var/desktop-updates/windows',
    phoneVerificationSecret,
    phoneVerificationMode,
    wechatPaymentMode,
    wechatPayMerchantId,
    wechatPayMerchantCertificateSerial,
    wechatPayMerchantPrivateKeyPath,
    wechatPayPublicKeyId,
    wechatPayPublicKeyPath,
    wechatPayApiV3KeyPath,
    wechatPayNotifyUrl,
    wechatPayOutTradeNoPrefix,
    wechatPaymentTestAmountFen,
    miniappDevelopmentAuthEnabled: booleanValue(
      environment.MINIAPP_DEVELOPMENT_AUTH_ENABLED,
      nodeEnv !== 'production',
      'MINIAPP_DEVELOPMENT_AUTH_ENABLED'
    ),
    miniappWechatAuthMode,
    wechatMiniappAppId,
    wechatMiniappAppSecret,
    miniappTestVirtualPhone
  }
}
