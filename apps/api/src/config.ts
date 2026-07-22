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
  wechatPaymentMode: 'mock' | 'disabled'
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
  if (wechatPaymentMode !== 'mock' && wechatPaymentMode !== 'disabled') {
    throw new Error('WECHAT_PAYMENT_MODE must be mock or disabled')
  }
  if (nodeEnv === 'production' && wechatPaymentMode === 'mock') {
    throw new Error('WECHAT_PAYMENT_MODE=mock is forbidden in production')
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
