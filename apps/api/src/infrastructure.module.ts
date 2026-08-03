import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown
} from '@nestjs/common'
import { checkCloudDatabase, createPostgresPool } from '@zyapp/cloud-db'
import type { Pool } from '@zyapp/cloud-db'
import Redis from 'ioredis'
import { readFileSync } from 'node:fs'
import { readApiConfig, type ApiConfig } from './config'
import { readSingleLineSecret } from './secret-file'
import {
  DisabledWechatPaymentProvider,
  MockWechatPaymentProvider,
  type WechatPaymentProvider
} from './wechat-payment-provider'
import { WechatPayProvider } from './wechatpay-provider'
import {
  BOARD_GAME_METADATA_ADAPTER,
  BggBoardGameMetadataAdapter,
  DisabledBoardGameMetadataAdapter
} from './board-game-metadata/bgg-adapter'

export const API_CONFIG = Symbol('API_CONFIG')
export const POSTGRES_POOL = Symbol('POSTGRES_POOL')
export const REDIS_CLIENT = Symbol('REDIS_CLIENT')
export const WECHAT_PAYMENT_PROVIDER = Symbol('WECHAT_PAYMENT_PROVIDER')

function requiredPaymentConfig(
  value: string | null | undefined,
  name: string
): string {
  if (!value) throw new Error(`${name} is required`)
  return value
}

function createWechatPaymentProvider(
  config: ApiConfig
): WechatPaymentProvider {
  if (config.wechatPaymentMode === 'mock') {
    return new MockWechatPaymentProvider()
  }
  if (config.wechatPaymentMode === 'disabled') {
    return new DisabledWechatPaymentProvider()
  }

  const merchantPrivateKeyPath = requiredPaymentConfig(
    config.wechatPayMerchantPrivateKeyPath,
    'WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE'
  )
  const publicKeyPath = requiredPaymentConfig(
    config.wechatPayPublicKeyPath,
    'WECHAT_PAY_PUBLIC_KEY_FILE'
  )
  const apiV3KeyPath = requiredPaymentConfig(
    config.wechatPayApiV3KeyPath,
    'WECHAT_PAY_API_V3_KEY_FILE'
  )
  return new WechatPayProvider({
    appId: requiredPaymentConfig(
      config.wechatMiniappAppId,
      'WECHAT_MINIAPP_APP_ID'
    ),
    merchantId: requiredPaymentConfig(
      config.wechatPayMerchantId,
      'WECHAT_PAY_MERCHANT_ID'
    ),
    merchantCertificateSerial: requiredPaymentConfig(
      config.wechatPayMerchantCertificateSerial,
      'WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL'
    ),
    merchantPrivateKeyPem: readFileSync(
      merchantPrivateKeyPath,
      'utf8'
    ),
    publicKeyId: requiredPaymentConfig(
      config.wechatPayPublicKeyId,
      'WECHAT_PAY_PUBLIC_KEY_ID'
    ),
    publicKeyPem: readFileSync(publicKeyPath, 'utf8'),
    apiV3Key: readSingleLineSecret(
      apiV3KeyPath,
      'WECHAT_PAY_API_V3_KEY_FILE',
      32
    ),
    notifyUrl: requiredPaymentConfig(
      config.wechatPayNotifyUrl,
      'WECHAT_PAY_NOTIFY_URL'
    )
  })
}

@Injectable()
export class InfrastructureLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect()
    await this.pool.end()
  }
}

@Injectable()
export class InfrastructureHealthService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  async check(): Promise<{
    postgres: { ok: true; version: string; databaseTime: string }
    redis: { ok: true; response: string }
  }> {
    const database = await checkCloudDatabase(this.pool)
    if (this.redis.status === 'wait') await this.redis.connect()
    const response = await this.redis.ping()
    return {
      postgres: {
        ok: true,
        version: database.postgresVersion,
        databaseTime: database.databaseTime
      },
      redis: { ok: true, response }
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: API_CONFIG,
      useFactory: readApiConfig
    },
    {
      provide: POSTGRES_POOL,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => createPostgresPool(config.databaseUrl)
    },
    {
      provide: REDIS_CLIENT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 5_000
        })
    },
    {
      provide: WECHAT_PAYMENT_PROVIDER,
      inject: [API_CONFIG],
      useFactory: createWechatPaymentProvider
    },
    {
      provide: BOARD_GAME_METADATA_ADAPTER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => {
        if (config.bggMetadataMode === 'disabled') {
          return new DisabledBoardGameMetadataAdapter()
        }
        if (!config.bggXmlApiTokenFile) {
          throw new Error('BGG_XML_API_TOKEN_FILE is required')
        }
        return new BggBoardGameMetadataAdapter({
          token: readSingleLineSecret(
            config.bggXmlApiTokenFile,
            'BGG_XML_API_TOKEN_FILE'
          ),
          imagesEnabled: config.bggPublicImagesEnabled
        })
      }
    },
    InfrastructureLifecycle,
    InfrastructureHealthService
  ],
  exports: [
    API_CONFIG,
    POSTGRES_POOL,
    REDIS_CLIENT,
    WECHAT_PAYMENT_PROVIDER,
    BOARD_GAME_METADATA_ADAPTER,
    InfrastructureHealthService
  ]
})
export class InfrastructureModule {}
