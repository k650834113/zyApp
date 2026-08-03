import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { ApiConfig } from './config'
import { MiniappSessionService } from './miniapp-session.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

const config: ApiConfig = {
  nodeEnv: 'test',
  deploymentEnvironment: 'test',
  port: 3100,
  databaseUrl: 'postgres://test',
  redisUrl: 'redis://test',
  deviceEnrollmentSecret: 'a'.repeat(32),
  desktopUpdateDirectory: 'C:/updates',
  phoneVerificationSecret: 'b'.repeat(32),
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
  bggMetadataMode: 'disabled',
  bggXmlApiTokenFile: null,
  bggPublicImagesEnabled: false
}

function fakePool(
  handler: (sql: string, parameters: unknown[]) => unknown[]
): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  const query = async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters })
    return { rows: handler(sql, parameters), rowCount: 0 }
  }
  const client = {
    query,
    release() {}
  }
  return {
    pool: {
      connect: async () => client,
      query
    } as unknown as Pool,
    calls
  }
}

describe('miniapp session employee identity', () => {
  it('returns staff permissions only while employee and mobile access are active', async () => {
    const query = async () => ({
      rows: [
        {
          identity_id: '11111111-1111-4111-8111-111111111111',
          tenant_id: '22222222-2222-4222-8222-222222222222',
          store_id: '33333333-3333-4333-8333-333333333333',
          provider: 'development',
          provider_subject: 'test-user',
          identity_status: 'active',
          member_id: null,
          member_status: null,
          nickname: null,
          phone: null,
          tier: null,
          employee_id: '44444444-4444-4444-8444-444444444444',
          employee_status: 'active',
          employee_display_name: 'Staff',
          employee_role: 'staff',
          mobile_access_enabled: true
        }
      ],
      rowCount: 1
    })
    const service = new MiniappSessionService(
      { query } as unknown as Pool,
      config
    )

    const authenticated = await service.authenticate('opaque-token')
    expect(authenticated.identity).toMatchObject({
      role: 'staff',
      employeeId: '44444444-4444-4444-8444-444444444444',
      displayName: 'Staff'
    })
    expect(authenticated.employeeId).toBe(
      '44444444-4444-4444-8444-444444444444'
    )
  })

  it('falls back to the member identity when mobile access is disabled', async () => {
    const query = async () => ({
      rows: [
        {
          identity_id: '11111111-1111-4111-8111-111111111111',
          tenant_id: '22222222-2222-4222-8222-222222222222',
          store_id: '33333333-3333-4333-8333-333333333333',
          provider: 'development',
          provider_subject: 'test-user',
          identity_status: 'active',
          member_id: '55555555-5555-4555-8555-555555555555',
          member_status: 'active',
          nickname: 'Member',
          phone: '13800138000',
          tier: 'ordinary',
          employee_id: '44444444-4444-4444-8444-444444444444',
          employee_status: 'active',
          employee_display_name: 'Staff',
          employee_role: 'staff',
          mobile_access_enabled: false
        }
      ],
      rowCount: 1
    })
    const service = new MiniappSessionService(
      { query } as unknown as Pool,
      config
    )

    const authenticated = await service.authenticate('opaque-token')
    expect(authenticated.identity).toMatchObject({
      role: 'member',
      nickname: 'Member'
    })
    expect(authenticated.employeeId).toBeNull()
  })

  it('creates a reusable WeChat session for an already bound member', async () => {
    const identityId = '11111111-1111-4111-8111-111111111111'
    const memberId = '55555555-5555-4555-8555-555555555555'
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM store')) {
        return [{ tenant_id: '22222222-2222-4222-8222-222222222222' }]
      }
      if (sql.includes('INSERT INTO miniapp_identity')) {
        return [{ id: identityId }]
      }
      if (sql.includes('FROM miniapp_identity i')) {
        return [
          {
            identity_id: identityId,
            tenant_id: '22222222-2222-4222-8222-222222222222',
            store_id: '33333333-3333-4333-8333-333333333333',
            provider: 'wechat',
            provider_subject: 'mock:stable-login-code',
            identity_status: 'active',
            member_id: memberId,
            member_status: 'active',
            nickname: 'Member',
            phone: '13800138000',
            tier: 'ordinary',
            employee_id: null,
            employee_status: null,
            employee_display_name: null,
            employee_role: null,
            mobile_access_enabled: null
          }
        ]
      }
      return []
    })
    const service = new MiniappSessionService(pool, config)

    const session = await service.createWechatSession({
      storeId: '33333333-3333-4333-8333-333333333333',
      loginCode: 'stable-login-code'
    })

    expect(session.accessToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(session.identity).toMatchObject({
      role: 'member',
      memberId,
      nickname: 'Member'
    })
    const identityInsert = calls.find((call) =>
      call.sql.includes('INSERT INTO miniapp_identity')
    )
    expect(identityInsert?.parameters[3]).toBe('wechat')
    expect(identityInsert?.parameters[4]).toBe('mock:stable-login-code')
  })
})
