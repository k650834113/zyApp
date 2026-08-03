export type ApiConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  deploymentEnvironment: 'production' | 'test'
  port: number
  databaseUrl: string
  redisUrl: string
  deviceEnrollmentSecret: string
  desktopUpdateDirectory: string
  memberAvatarDirectory?: string
  miniappPublicBaseUrl?: string
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
  miniappDevelopmentAuthEnabled: boolean
  miniappWechatAuthMode?: 'mock' | 'wechat' | 'disabled'
  wechatMiniappAppId?: string | null
  wechatMiniappAppSecret?: string | null
  miniappTestVirtualPhone?: string | null
  bggMetadataMode: 'disabled' | 'xmlapi'
  bggXmlApiTokenFile: string | null
  bggPublicImagesEnabled: boolean
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

function miniappPublicBaseUrl(value: string | undefined): string {
  const normalized = required(value, 'MINIAPP_PUBLIC_BASE_URL').replace(
    /\/+$/,
    ''
  )
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('MINIAPP_PUBLIC_BASE_URL must be a valid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('MINIAPP_PUBLIC_BASE_URL must use HTTPS')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('MINIAPP_PUBLIC_BASE_URL cannot contain query or hash')
  }
  return normalized
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
  const publicBaseUrl = miniappPublicBaseUrl(
    environment.MINIAPP_PUBLIC_BASE_URL ?? 'https://localhost'
  )
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
    wechatPayNotifyUrl &&
    deploymentEnvironment === 'production' &&
    wechatPayNotifyUrl !==
      'https://judian.icu/v1/payments/wechat/recharge/notify'
  ) {
    throw new Error(
      'Production WECHAT_PAY_NOTIFY_URL must be https://judian.icu/v1/payments/wechat/recharge/notify'
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
    wechatPaymentMode === 'wechat'
  ) {
    throw new Error(
      'Real WeChat payment forbids MINIAPP_TEST_VIRTUAL_PHONE'
    )
  }
  const bggMetadataMode = environment.BGG_METADATA_MODE ?? 'disabled'
  if (bggMetadataMode !== 'disabled' && bggMetadataMode !== 'xmlapi') {
    throw new Error('BGG_METADATA_MODE must be disabled or xmlapi')
  }
  const bggXmlApiTokenFile = optionalText(
    environment.BGG_XML_API_TOKEN_FILE
  )
  if (bggMetadataMode === 'xmlapi' && !bggXmlApiTokenFile) {
    throw new Error(
      'BGG_XML_API_TOKEN_FILE is required when BGG_METADATA_MODE=xmlapi'
    )
  }
  const bggPublicImagesEnabled = booleanValue(
    environment.BGG_PUBLIC_IMAGES_ENABLED,
    false,
    'BGG_PUBLIC_IMAGES_ENABLED'
  )
  if (bggPublicImagesEnabled && bggMetadataMode !== 'xmlapi') {
    throw new Error(
      'BGG_PUBLIC_IMAGES_ENABLED requires BGG_METADATA_MODE=xmlapi'
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
    memberAvatarDirectory:
      environment.MEMBER_AVATAR_DIRECTORY?.trim() ||
      `./var/member-avatars/${deploymentEnvironment}`,
    miniappPublicBaseUrl: publicBaseUrl,
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
    miniappDevelopmentAuthEnabled: booleanValue(
      environment.MINIAPP_DEVELOPMENT_AUTH_ENABLED,
      nodeEnv !== 'production',
      'MINIAPP_DEVELOPMENT_AUTH_ENABLED'
    ),
    miniappWechatAuthMode,
    wechatMiniappAppId,
    wechatMiniappAppSecret,
    miniappTestVirtualPhone,
    bggMetadataMode,
    bggXmlApiTokenFile,
    bggPublicImagesEnabled
  }
}
