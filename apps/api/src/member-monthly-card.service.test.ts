import { describe, expect, it, vi } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import { MemberMonthlyCardService } from './member-monthly-card.service'
import type { WechatPaymentProvider } from './wechat-payment-provider'
import type { ApiConfig } from './config'

const config = {
  wechatMiniappAppId: 'wx-app',
  wechatPayMerchantId: 'merchant-1'
} as ApiConfig

describe('member monthly card service', () => {
  it('resolves the default 200 yuan 30 day plan', async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('cloud_merchant_business_template')) {
          return { rows: [] }
        }
        if (sql.includes('cloud_monthly_card')) return { rows: [] }
        return { rows: [] }
      }
    } as unknown as Pool
    const provider = { mode: 'wechat' } as WechatPaymentProvider
    const service = new MemberMonthlyCardService(pool, provider, config)

    await expect(
      service.getConfiguration({
        tenantId: 'tenant-1',
        storeId: 'store-1',
        identityId: 'identity-1',
        provider: 'wechat',
        providerSubject: 'openid:openid-1',
        memberId: 'member-1',
        memberStatus: 'active',
        employeeId: null,
        employeeRole: null,
        employeeStatus: null,
        identity: {
          role: 'member',
          memberId: 'member-1',
          nickname: 'Member',
          phoneMasked: '138****8000',
          tier: 'ordinary'
        }
      })
    ).resolves.toMatchObject({
      planName: '30 天月卡',
      priceFen: 20_000,
      durationDays: 30,
      purchaseAllowed: true
    })
  })

  it('settles a verified WeChat order into a monthly card without touching wallets', async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, parameters: unknown[] = []) => {
        queries.push({ sql, parameters })
        if (
          sql.includes('FROM wechat_monthly_card_order order_row')
        ) {
          return {
            rows: [{
              id: 'order-1',
              tenant_id: 'tenant-1',
              store_id: 'store-1',
              member_id: 'member-1',
              identity_id: 'identity-1',
              request_id: 'monthly-request-1',
              request_hash: 'hash',
              out_trade_no: 'ZYM-ORDER-1',
              provider_mode: 'wechat',
              provider_transaction_id: null,
              plan_name: '30 天月卡',
              price_fen: 20_000,
              duration_days: 30,
              scope_type: 'store',
              client_payment_json: null,
              status: 'pending_payment',
              target_card_id: null,
              expires_before: null,
              expires_after: null,
              error_message: null,
              expires_at: '2026-07-25T04:15:00.000Z',
              settled_at: null,
              created_at: '2026-07-25T04:00:00.000Z',
              provider_subject: 'openid:openid-1'
            }]
          }
        }
        if (sql.includes('INSERT INTO payment_callback_inbox')) {
          return { rows: [{ event_id: 'event-monthly-1' }] }
        }
        if (sql.includes('SELECT status FROM cloud_member')) {
          return { rows: [{ status: 'active' }] }
        }
        if (sql.includes('FROM cloud_monthly_card') && sql.includes('FOR UPDATE')) {
          return { rows: [] }
        }
        if (sql.includes('INSERT INTO cloud_event')) {
          return { rows: [{ sequence: 51 }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const pool = {
      connect: vi.fn(async () => client)
    } as unknown as Pool
    const provider = { mode: 'wechat' } as WechatPaymentProvider
    const service = new MemberMonthlyCardService(pool, provider, config)

    await expect(
      service.handleWechatNotification({
        eventId: 'event-monthly-1',
        eventType: 'TRANSACTION.SUCCESS',
        payload: { id: 'event-monthly-1' },
        payment: {
          state: 'success',
          outTradeNo: 'ZYM-ORDER-1',
          transactionId: 'wx-transaction-1',
          amountFen: 20_000,
          currency: 'CNY',
          appId: 'wx-app',
          merchantId: 'merchant-1',
          payerOpenId: 'openid-1',
          paidAt: '2026-07-25T04:01:00.000Z'
        }
      })
    ).resolves.toBe(true)

    expect(
      queries.some(({ sql }) =>
        sql.includes('monthly_card_order_id') &&
        sql.includes('payment_callback_inbox')
      )
    ).toBe(true)
    expect(
      queries.some(({ sql }) =>
        sql.includes("payment_method, status") &&
        sql.includes("'wechat','active'")
      )
    ).toBe(true)
    expect(
      queries.some(({ sql }) =>
        sql.includes('monthly_card.wechat_purchased') &&
        sql.includes('cloud_audit_log')
      )
    ).toBe(true)
    expect(
      queries.some(({ sql }) => /wallet/i.test(sql))
    ).toBe(false)
    expect(queries.at(-1)?.sql).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('persists a failed callback audit after trusted-payment mismatch rollback', async () => {
    const transactionQueries: string[] = []
    const poolQueries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        transactionQueries.push(sql)
        if (sql.includes('FROM wechat_monthly_card_order order_row')) {
          return {
            rows: [{
              id: 'order-1',
              tenant_id: 'tenant-1',
              store_id: 'store-1',
              member_id: 'member-1',
              identity_id: 'identity-1',
              request_id: 'monthly-request-1',
              request_hash: 'hash',
              out_trade_no: 'ZYM-ORDER-1',
              provider_mode: 'wechat',
              provider_transaction_id: null,
              plan_name: '30 天月卡',
              price_fen: 20_000,
              duration_days: 30,
              scope_type: 'store',
              client_payment_json: null,
              status: 'pending_payment',
              target_card_id: null,
              expires_before: null,
              expires_after: null,
              error_message: null,
              expires_at: '2026-07-25T04:15:00.000Z',
              settled_at: null,
              created_at: '2026-07-25T04:00:00.000Z',
              provider_subject: 'openid:openid-1'
            }]
          }
        }
        if (sql.includes('INSERT INTO payment_callback_inbox')) {
          return { rows: [{ event_id: 'event-monthly-1' }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        poolQueries.push(sql)
        return { rows: [] }
      })
    } as unknown as Pool
    const service = new MemberMonthlyCardService(
      pool,
      { mode: 'wechat' } as WechatPaymentProvider,
      config
    )

    await expect(
      service.handleWechatNotification({
        eventId: 'event-monthly-1',
        eventType: 'TRANSACTION.SUCCESS',
        payload: { id: 'event-monthly-1' },
        payment: {
          state: 'success',
          outTradeNo: 'ZYM-ORDER-1',
          transactionId: 'wx-transaction-1',
          amountFen: 19_999,
          currency: 'CNY',
          appId: 'wx-app',
          merchantId: 'merchant-1',
          payerOpenId: 'openid-1',
          paidAt: '2026-07-25T04:01:00.000Z'
        }
      })
    ).rejects.toThrow('不匹配')

    expect(transactionQueries).toContain('ROLLBACK')
    expect(
      poolQueries.some((sql) =>
        sql.includes("'failed'") &&
        sql.includes('payment_callback_inbox')
      )
    ).toBe(true)
    expect(client.release).toHaveBeenCalledOnce()
  })
})
