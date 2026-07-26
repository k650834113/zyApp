import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WECHAT_PAYMENT_PROVIDER
} from './infrastructure.module'
import { MemberRechargeService } from './member-recharge.service'
import { MemberMonthlyCardService } from './member-monthly-card.service'
import { WechatPaymentController } from './wechat-payment.controller'

describe('WeChat payment notification controller', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('passes the exact raw body to verification and returns 204', async () => {
    const verified = {
      eventId: 'event-1',
      eventType: 'TRANSACTION.SUCCESS' as const,
      payload: { id: 'event-1' },
      payment: {
        state: 'success' as const,
        outTradeNo: 'ZYT-ORDER-1',
        transactionId: '4200000001202607250000000001',
        amountFen: 1,
        currency: 'CNY' as const,
        appId: 'wx-test-appid',
        merchantId: '1748654937',
        payerOpenId: 'openid-test',
        paidAt: '2026-07-25T12:01:00+08:00'
      }
    }
    const provider = {
      verifyNotification: vi.fn(() => verified)
    }
    const recharges = {
      handleWechatNotification: vi.fn(async () => ({ status: 'settled' }))
    }
    const monthlyCards = {
      handleWechatNotification: vi.fn(async () => false)
    }
    const module = await Test.createTestingModule({
      controllers: [WechatPaymentController],
      providers: [
        { provide: WECHAT_PAYMENT_PROVIDER, useValue: provider },
        { provide: MemberRechargeService, useValue: recharges },
        { provide: MemberMonthlyCardService, useValue: monthlyCards }
      ]
    }).compile()
    app = module.createNestApplication({ rawBody: true })
    app.setGlobalPrefix('v1')
    await app.init()
    const rawBody =
      '{"id":"event-1","event_type":"TRANSACTION.SUCCESS"}'

    const response = await request(app.getHttpServer())
      .post('/v1/payments/wechat/recharge/notify')
      .set('content-type', 'application/json')
      .set('Wechatpay-Timestamp', '1784952000')
      .set('Wechatpay-Nonce', 'platformnonce')
      .set('Wechatpay-Serial', 'PUB_KEY_ID_TEST')
      .set('Wechatpay-Signature', 'signature')
      .send(rawBody)

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect(provider.verifyNotification).toHaveBeenCalledWith({
      headers: expect.any(Object),
      rawBody
    })
    expect(recharges.handleWechatNotification).toHaveBeenCalledWith(
      verified
    )
  })

  it('routes ZYM notifications to monthly-card settlement only', async () => {
    const verified = {
      eventId: 'event-monthly-1',
      eventType: 'TRANSACTION.SUCCESS' as const,
      payload: { id: 'event-monthly-1' },
      payment: {
        state: 'success' as const,
        outTradeNo: 'ZYM-ORDER-1',
        transactionId: '4200000001202607250000000002',
        amountFen: 20_000,
        currency: 'CNY' as const,
        appId: 'wx-test-appid',
        merchantId: '1748654937',
        payerOpenId: 'openid-test',
        paidAt: '2026-07-25T12:01:00+08:00'
      }
    }
    const provider = {
      verifyNotification: vi.fn(() => verified)
    }
    const recharges = {
      handleWechatNotification: vi.fn()
    }
    const monthlyCards = {
      handleWechatNotification: vi.fn(async () => true)
    }
    const module = await Test.createTestingModule({
      controllers: [WechatPaymentController],
      providers: [
        { provide: WECHAT_PAYMENT_PROVIDER, useValue: provider },
        { provide: MemberRechargeService, useValue: recharges },
        { provide: MemberMonthlyCardService, useValue: monthlyCards }
      ]
    }).compile()
    app = module.createNestApplication({ rawBody: true })
    app.setGlobalPrefix('v1')
    await app.init()

    const response = await request(app.getHttpServer())
      .post('/v1/payments/wechat/recharge/notify')
      .set('content-type', 'application/json')
      .send('{"id":"event-monthly-1"}')

    expect(response.status).toBe(204)
    expect(monthlyCards.handleWechatNotification).toHaveBeenCalledWith(
      verified
    )
    expect(recharges.handleWechatNotification).not.toHaveBeenCalled()
  })

  it('returns a safe 4xx response when verification fails', async () => {
    const provider = {
      verifyNotification: vi.fn(() => {
        throw new Error('signature detail must not escape')
      })
    }
    const recharges = {
      handleWechatNotification: vi.fn()
    }
    const monthlyCards = {
      handleWechatNotification: vi.fn()
    }
    const module = await Test.createTestingModule({
      controllers: [WechatPaymentController],
      providers: [
        { provide: WECHAT_PAYMENT_PROVIDER, useValue: provider },
        { provide: MemberRechargeService, useValue: recharges },
        { provide: MemberMonthlyCardService, useValue: monthlyCards }
      ]
    }).compile()
    app = module.createNestApplication({ rawBody: true })
    app.setGlobalPrefix('v1')
    await app.init()

    const response = await request(app.getHttpServer())
      .post('/v1/payments/wechat/recharge/notify')
      .set('content-type', 'application/json')
      .send('{"id":"invalid"}')

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(response.body).toEqual({
      code: 'FAIL',
      message: 'invalid notification'
    })
    expect(recharges.handleWechatNotification).not.toHaveBeenCalled()
  })
})
