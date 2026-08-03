import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type Redis from 'ioredis'
import type { ApiConfig } from './config'
import type { MiniappPrincipal } from './miniapp-auth'
import {
  hashPhoneVerificationCode
} from './member-self-service'
import { MemberSelfService } from './member-self-service.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

function config(): ApiConfig {
  return {
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
}

function principal(): MiniappPrincipal {
  return {
    identityId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    storeId: '33333333-3333-4333-8333-333333333333',
    provider: 'development',
    providerSubject: 'test-user',
    memberId: null,
    memberStatus: null,
    employeeId: null,
    employeeStatus: null,
    employeeRole: null,
    identity: { role: 'guest' }
  }
}

function memberPrincipal(): MiniappPrincipal {
  return {
    ...principal(),
    memberId: '55555555-5555-4555-8555-555555555555',
    memberStatus: 'active',
    identity: {
      role: 'member',
      memberId: '55555555-5555-4555-8555-555555555555',
      nickname: 'Member',
      phoneMasked: '138****8000',
      tier: 'ordinary'
    }
  }
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

function fakeRedis(setResult: 'OK' | null = 'OK'): Redis {
  return {
    set: async () => setResult,
    del: async () => 1
  } as unknown as Redis
}

describe('member self-service transactions', () => {
  it('updates only the authenticated member profile and marks it complete', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('FOR UPDATE')) {
        return [
          {
            id: memberPrincipal().memberId,
            member_number: 'M5555555555',
            phone: '13800138000',
            nickname: '微信用户',
            tier: 'ordinary',
            status: 'active',
            birthday_month: null,
            birthday_day: null,
            birthday_source: null,
            note: null,
            source: 'miniapp',
            age_gate_status: 'confirmed_at_least_14',
            created_at: '2026-06-14T00:00:00.000Z',
            updated_at: '2026-06-14T00:00:00.000Z'
          }
        ]
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 606 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: memberPrincipal().memberId,
            phone: '13800138000',
            nickname: '林小满',
            avatar_url: null,
            profile_completed: true,
            tier: 'ordinary',
            birthday_month: null,
            birthday_day: null,
            age_gate_status: 'confirmed_at_least_14',
            principal_balance_fen: 0,
            gift_balance_fen: 0,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), config())

    const result = await service.updateProfile(memberPrincipal(), {
      requestId: 'profile-20260725-1',
      nickname: ' 林小满 '
    })

    expect(result).toMatchObject({
      memberId: memberPrincipal().memberId,
      nickname: '林小满',
      profileCompleted: true
    })
    const update = calls.find(
      (call) =>
        call.sql.includes('UPDATE cloud_member') &&
        call.sql.includes('profile_completed = TRUE')
    )
    expect(update?.parameters[1]).toBe(memberPrincipal().memberId)
    expect(update?.parameters[2]).toBe('林小满')
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toContain('"action":"member.profile_updated"')
  })

  it('returns a mock code without storing the plaintext code', async () => {
    const { pool, calls } = fakePool(() => [])
    const service = new MemberSelfService(pool, fakeRedis(), config())

    const result = await service.requestPhoneVerification(principal(), {
      phone: '13800138000'
    })

    expect(result.mockCode).toMatch(/^\d{6}$/)
    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO phone_verification_challenge')
    )
    expect(insert).toBeDefined()
    expect(insert?.parameters).not.toContain(result.mockCode)
    expect(String(insert?.parameters[5])).toHaveLength(64)
  })

  it('commits a failed verification attempt instead of rolling it back', async () => {
    const challengeId = '44444444-4444-4444-8444-444444444444'
    const cfg = config()
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM miniapp_identity')) {
        return [{ member_id: null, status: 'active' }]
      }
      if (sql.includes('FROM phone_verification_challenge')) {
        return [
          {
            identity_id: principal().identityId,
            phone: '13800138000',
            purpose: 'member_registration',
            code_hash: hashPhoneVerificationCode(
              cfg.phoneVerificationSecret,
              challengeId,
              '123456'
            ),
            attempts: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    await expect(
      service.registerMember(principal(), {
        requestId: 'register-request-1',
        challengeId,
        verificationCode: '654321',
        phone: '13800138000',
        nickname: 'Member',
        confirmedAtLeast14: true
      })
    ).rejects.toThrow('验证码不正确')

    expect(
      calls.some((call) =>
        call.sql.includes('SET attempts = attempts + 1')
      )
    ).toBe(true)
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(1)
    expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(false)
  })

  it('binds an existing phone member without overwriting the old profile', async () => {
    const challengeId = '44444444-4444-4444-8444-444444444444'
    const memberId = '55555555-5555-4555-8555-555555555555'
    const cfg = config()
    const existing = {
      id: memberId,
      member_number: 'M5555555555',
      phone: '13800138000',
      nickname: '旧系统昵称',
      avatar_url: null,
      profile_completed: false,
      tier: 'advanced',
      status: 'active',
      birthday_month: 2,
      birthday_day: 29,
      birthday_source: 'legacy',
      note: '旧会员',
      source: 'legacy',
      age_gate_status: 'confirmed_at_least_14',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z'
    } as const
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM miniapp_identity')) {
        return [{ member_id: null, status: 'active' }]
      }
      if (sql.includes('FROM phone_verification_challenge')) {
        return [
          {
            identity_id: principal().identityId,
            phone: '13800138000',
            purpose: 'member_registration',
            code_hash: hashPhoneVerificationCode(
              cfg.phoneVerificationSecret,
              challengeId,
              '123456'
            ),
            attempts: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null
          }
        ]
      }
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('phone = $2')) {
        return [existing]
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 701 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: memberId,
            phone: '13800138000',
            nickname: '旧系统昵称',
            avatar_url: null,
            profile_completed: true,
            tier: 'advanced',
            birthday_month: 2,
            birthday_day: 29,
            age_gate_status: 'confirmed_at_least_14',
            principal_balance_fen: 50_000,
            gift_balance_fen: 5_000,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    const result = await service.registerMember(principal(), {
      requestId: 'register-request-2',
      challengeId,
      verificationCode: '123456',
      phone: '13800138000',
      nickname: '新输入昵称',
      confirmedAtLeast14: false
    })

    expect(result).toMatchObject({
      memberId,
      nickname: '旧系统昵称',
      avatarUrl: null,
      profileCompleted: true,
      tier: 'advanced',
      principalBalanceFen: 50_000,
      giftBalanceFen: 5_000,
      ageGate: 'confirmed_at_least_14'
    })
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_member'))
    ).toBe(false)
    expect(
      calls.some((call) => call.sql.includes('profile_completed = TRUE'))
    ).toBe(true)
    expect(
      calls.some((call) =>
        call.sql.includes("'member.profile_completion_reconciled'")
      )
    ).toBe(true)
    expect(
      calls.some((call) => call.sql.includes('UPDATE miniapp_identity'))
    ).toBe(true)
  })

  it('binds an existing phone member from WeChat without requiring profile completion', async () => {
    const memberId = '55555555-5555-4555-8555-555555555555'
    const cfg = config()
    const existing = {
      id: memberId,
      member_number: 'M5555555555',
      phone: '13800138000',
      nickname: '旧系统昵称',
      avatar_url: null,
      profile_completed: false,
      tier: 'advanced',
      status: 'active',
      birthday_month: 2,
      birthday_day: 29,
      birthday_source: 'legacy',
      note: '旧会员',
      source: 'legacy',
      age_gate_status: 'confirmed_at_least_14',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z'
    } as const
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM miniapp_identity')) {
        return [{ member_id: null, status: 'active' }]
      }
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('phone = $2')) {
        return [existing]
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 702 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: memberId,
            phone: existing.phone,
            nickname: existing.nickname,
            avatar_url: null,
            profile_completed: true,
            tier: existing.tier,
            birthday_month: existing.birthday_month,
            birthday_day: existing.birthday_day,
            age_gate_status: existing.age_gate_status,
            principal_balance_fen: 50_000,
            gift_balance_fen: 5_000,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    const result = await service.loginWithWechatProfile(principal(), {
      requestId: 'wechat-existing-member-1',
      phoneCode: 'mock-phone:13800138000',
      nickname: '微信用户',
      avatarUrl: null,
      confirmedAtLeast14: true
    })

    expect(result).toMatchObject({
      memberId,
      nickname: '旧系统昵称',
      avatarUrl: null,
      profileCompleted: true,
      tier: 'advanced'
    })
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_member'))
    ).toBe(false)
    expect(
      calls.some((call) => call.sql.includes('SET nickname ='))
    ).toBe(false)
    expect(
      calls.some((call) => call.sql.includes('profile_completed = TRUE'))
    ).toBe(true)
  })

  it('creates a cloud member event that can flow down to the PC', async () => {
    const challengeId = '44444444-4444-4444-8444-444444444444'
    const cfg = config()
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM miniapp_identity')) {
        return [{ member_id: null, status: 'active' }]
      }
      if (sql.includes('FROM phone_verification_challenge')) {
        return [
          {
            identity_id: principal().identityId,
            phone: '13900139000',
            purpose: 'member_registration',
            code_hash: hashPhoneVerificationCode(
              cfg.phoneVerificationSecret,
              challengeId,
              '123456'
            ),
            attempts: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null
          }
        ]
      }
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('phone = $2')) {
        return []
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 101 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: '55555555-5555-4555-8555-555555555555',
            phone: '13900139000',
            nickname: 'New Member',
            tier: 'ordinary',
            birthday_month: null,
            birthday_day: null,
            age_gate_status: 'recharge_disabled',
            principal_balance_fen: null,
            gift_balance_fen: null,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    const result = await service.registerMember(principal(), {
      requestId: 'register-request-3',
      challengeId,
      verificationCode: '123456',
      phone: '13900139000',
      nickname: 'New Member',
      confirmedAtLeast14: false
    })

    expect(result.ageGate).toBe('recharge_disabled')
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toContain('"source":"miniapp"')
    expect(event?.parameters[4]).toContain('"ageGate":"recharge_disabled"')
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_member'))
    ).toBe(true)
  })

  it('creates a member from WeChat one-tap login and stores the avatar URL', async () => {
    const cfg = config()
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM miniapp_identity')) {
        return [{ member_id: null, status: 'active' }]
      }
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('phone = $2')) {
        return []
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 303 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: '55555555-5555-4555-8555-555555555555',
            phone: '13900139001',
            nickname: '微信玩家',
            avatar_url: 'wxfile://avatar',
            tier: 'ordinary',
            birthday_month: null,
            birthday_day: null,
            age_gate_status: 'confirmed_at_least_14',
            principal_balance_fen: null,
            gift_balance_fen: null,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    const result = await service.loginWithWechatProfile(principal(), {
      requestId: 'wechat-login-request-1',
      phoneCode: 'mock-phone:13900139001',
      nickname: ' 微信玩家 ',
      avatarUrl: ' wxfile://avatar ',
      confirmedAtLeast14: true
    })

    expect(result).toMatchObject({
      nickname: '微信玩家',
      avatarUrl: 'wxfile://avatar',
      ageGate: 'confirmed_at_least_14'
    })
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toContain('"avatarUrl":"wxfile://avatar"')
    const insert = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_member')
    )
    expect(insert?.parameters[6]).toBe('wxfile://avatar')
  })

  it('reactivates a disabled member from WeChat one-tap login without inserting a duplicate', async () => {
    const disabledMemberId = '66666666-6666-4666-8666-666666666666'
    const cfg = config()
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('FROM miniapp_identity')) {
        return [{ member_id: null, status: 'active' }]
      }
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('phone = $2')) {
        return [
          {
            id: disabledMemberId,
            member_number: 'M6666666666',
            phone: '13900139002',
            nickname: '旧微信玩家',
            avatar_url: 'https://example.test/member-avatar.webp',
            profile_completed: true,
            tier: 'advanced',
            status: 'disabled',
            birthday_month: 1,
            birthday_day: 2,
            birthday_source: 'customer',
            note: '旧备注',
            source: 'miniapp',
            age_gate_status: 'confirmed_at_least_14',
            created_at: '2026-06-14T00:00:00.000Z',
            updated_at: '2026-06-15T00:00:00.000Z'
          }
        ]
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 404 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: disabledMemberId,
            phone: '13900139002',
            nickname: '旧微信玩家',
            avatar_url: 'https://example.test/member-avatar.webp',
            profile_completed: true,
            tier: 'ordinary',
            birthday_month: null,
            birthday_day: null,
            age_gate_status: 'confirmed_at_least_14',
            principal_balance_fen: null,
            gift_balance_fen: null,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    const result = await service.loginWithWechatProfile(principal(), {
      requestId: 'wechat-login-request-disabled',
      phoneCode: 'mock-phone:13900139002',
      nickname: '新微信玩家',
      avatarUrl: 'wxfile://new-avatar',
      confirmedAtLeast14: true
    })

    expect(result).toMatchObject({
      nickname: '旧微信玩家',
      avatarUrl: 'https://example.test/member-avatar.webp',
      profileCompleted: true,
      tier: 'ordinary',
      phoneMasked: '139****9002'
    })
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_member'))
    ).toBe(false)
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toContain('"action":"member.enabled"')
    const update = calls.find((call) =>
      call.sql.includes('UPDATE cloud_member') && call.sql.includes("status = 'active'")
    )
    expect(update?.parameters[1]).toBe(disabledMemberId)
    expect(update?.parameters[2]).toBe('旧微信玩家')
    expect(update?.parameters[3]).toBe('https://example.test/member-avatar.webp')
  })

  it('rejects mock WeChat phone codes outside the mock verification mode', async () => {
    const cfg = { ...config(), nodeEnv: 'production' as const }
    const { pool, calls } = fakePool(() => [])
    const service = new MemberSelfService(pool, fakeRedis(), cfg)

    await expect(
      service.loginWithWechatProfile(principal(), {
        requestId: 'wechat-login-request-2',
        phoneCode: 'mock-phone:13900139001',
        nickname: 'Member',
        confirmedAtLeast14: true
      })
    ).rejects.toThrow('Mock WeChat phone login is not available')
    expect(calls).toHaveLength(0)
  })

  it('fills birthday once and emits a complete member update event', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('FOR UPDATE')) {
        return [
          {
            id: memberPrincipal().memberId,
            member_number: 'M5555555555',
            phone: '13800138000',
            nickname: 'Member',
            tier: 'ordinary',
            status: 'active',
            birthday_month: null,
            birthday_day: null,
            birthday_source: null,
            note: null,
            source: 'miniapp',
            age_gate_status: 'confirmed_at_least_14',
            created_at: '2026-06-14T00:00:00.000Z',
            updated_at: '2026-06-14T00:00:00.000Z'
          }
        ]
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return [{ sequence: 202 }]
      }
      if (sql.includes('LEFT JOIN cloud_wallet_account')) {
        return [
          {
            id: memberPrincipal().memberId,
            phone: '13800138000',
            nickname: 'Member',
            tier: 'ordinary',
            birthday_month: 2,
            birthday_day: 29,
            age_gate_status: 'confirmed_at_least_14',
            principal_balance_fen: 0,
            gift_balance_fen: 0,
            monthly_card_status: null,
            monthly_card_expires_at: null
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), config())

    const result = await service.fillBirthday(memberPrincipal(), {
      requestId: 'birthday-request-1',
      month: 2,
      day: 29
    })

    expect(result).toMatchObject({
      birthdayMonth: 2,
      birthdayDay: 29,
      birthdayCanBeFilled: false
    })
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[4]).toContain('"birthdayMonth":2')
    expect(event?.parameters[4]).toContain('"birthdaySource":"customer"')
    expect(
      calls.some(
        (call) =>
          call.sql.includes('UPDATE cloud_member') &&
          call.parameters[4] === 202
      )
    ).toBe(true)
  })

  it('rejects a second birthday fill and rolls back the transaction', async () => {
    const { pool, calls } = fakePool((sql) => {
      if (sql.includes('INSERT INTO api_idempotency')) {
        return [{ key: 'reserved' }]
      }
      if (sql.includes('FROM cloud_member') && sql.includes('FOR UPDATE')) {
        return [
          {
            id: memberPrincipal().memberId,
            member_number: 'M5555555555',
            phone: '13800138000',
            nickname: 'Member',
            tier: 'ordinary',
            status: 'active',
            birthday_month: 2,
            birthday_day: 29,
            birthday_source: 'customer',
            note: null,
            source: 'miniapp',
            age_gate_status: 'confirmed_at_least_14',
            created_at: '2026-06-14T00:00:00.000Z',
            updated_at: '2026-06-14T00:00:00.000Z'
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), config())

    await expect(
      service.fillBirthday(memberPrincipal(), {
        requestId: 'birthday-request-2',
        month: 3,
        day: 1
      })
    ).rejects.toThrow('already been filled')

    expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true)
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_event'))
    ).toBe(false)
  })

  it('maps member history amounts as integer fen', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('FROM cloud_sales_order')) {
        return [
          {
            id: '66666666-6666-4666-8666-666666666666',
            order_number: 'SO001',
            total_fen: '4000',
            payment_method: 'stored_value',
            completed_at: '2026-06-14T01:00:00.000Z'
          }
        ]
      }
      if (sql.includes('FROM cloud_wallet_ledger')) {
        return [
          {
            operation_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
            event_type: 'wallet.cash_recharged',
            principal_delta_fen: '50000',
            gift_delta_fen: '5000',
            reason: '门店现金充值',
            occurred_at: '2026-06-14T00:50:00.000Z'
          },
          {
            operation_id: '77777777-7777-4777-8777-777777777777',
            event_type: 'wallet.recharged',
            principal_delta_fen: '30000',
            gift_delta_fen: '2000',
            reason: '充值',
            occurred_at: '2026-06-14T00:30:00.000Z'
          },
          {
            operation_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
            event_type: 'wallet.cash_recharge_reversed',
            principal_delta_fen: '-50000',
            gift_delta_fen: '-5000',
            reason: '现金充值冲正',
            occurred_at: '2026-06-14T00:20:00.000Z'
          }
        ]
      }
      if (sql.includes('FROM wechat_recharge_order')) {
        return [
          {
            id: '88888888-8888-4888-8888-888888888888',
            out_trade_no: 'ZYT-202607250001',
            principal_fen: '10000',
            gift_fen: '1000',
            settled_at: '2026-06-14T00:45:00.000Z'
          }
        ]
      }
      if (sql.includes('FROM cloud_monthly_card_event')) {
        return [
          {
            operation_id: '99999999-9999-4999-8999-999999999999',
            card_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            event_type: 'purchased',
            reason: '月卡续费',
            occurred_at: '2026-06-14T00:15:00.000Z'
          }
        ]
      }
      return []
    })
    const service = new MemberSelfService(pool, fakeRedis(), config())

    const history = await service.getHistory(memberPrincipal())

    expect(history.orders[0]?.totalFen).toBe(4000)
    expect(
      history.walletEntries.find(
        (item) =>
          item.operationId === '77777777-7777-4777-8777-777777777777'
      )
    ).toMatchObject({
      principalDeltaFen: 30000,
      giftDeltaFen: 2000
    })
    expect(history.activities.map((item) => item.title)).toEqual([
      '桌位消费',
      '线下充值',
      '微信充值',
      '线下充值冲正',
      '月卡续费'
    ])
    expect(
      history.activities.filter((item) => item.kind === 'consumption')
    ).toHaveLength(1)
    expect(history.activities[1]).toMatchObject({
      amountFen: 55000,
      direction: 'credit',
      status: 'settled'
    })
    expect(history.activities[3]).toMatchObject({
      amountFen: 55000,
      direction: 'debit',
      status: 'reversed'
    })
    expect(history.walletEntries).toHaveLength(3)
  })
})
