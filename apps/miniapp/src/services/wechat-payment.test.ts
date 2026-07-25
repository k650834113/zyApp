import { describe, expect, it, vi } from 'vitest'
import type { MemberRechargeOrderSummary } from '@zyapp/contracts'
import {
  parseWechatPaymentParameters,
  pollRechargeOrder,
  requestWechatPayment
} from './wechat-payment'

const validParameters = {
  timeStamp: '1721880000',
  nonceStr: 'fixednonce',
  package: 'prepay_id=wx-prepay',
  signType: 'RSA',
  paySign: 'base64-signature'
}

function order(
  status: MemberRechargeOrderSummary['status']
): MemberRechargeOrderSummary {
  return {
    orderId: 'order-1',
    requestId: 'request-1',
    principalFen: 1,
    giftFen: 0,
    totalCreditFen: 1,
    status,
    providerMode: 'wechat',
    clientPaymentParameters: validParameters,
    expiresAt: '2026-07-25T04:15:00.000Z',
    settledAt:
      status === 'settled' ? '2026-07-25T04:01:00.000Z' : null,
    createdAt: '2026-07-25T04:00:00.000Z',
    errorMessage: null
  }
}

describe('WeChat JSAPI payment client', () => {
  it('accepts exactly the real RSA payment parameters', () => {
    expect(parseWechatPaymentParameters(validParameters)).toEqual(
      validParameters
    )
  })

  it.each([
    null,
    { ...validParameters, signType: 'MOCK' },
    { ...validParameters, package: 'wx-prepay' },
    { ...validParameters, paySign: '' },
    { ...validParameters, nonceStr: 123 }
  ])('rejects invalid payment parameters %#', (value) => {
    expect(() =>
      parseWechatPaymentParameters(
        value as unknown as Record<string, string> | null
      )
    ).toThrow(/payment parameters/)
  })

  it('passes exactly five parameters to wx.requestPayment', async () => {
    const invoke = vi.fn((options: Record<string, unknown>) => {
      ;(options.success as (value: { errMsg: string }) => void)({
        errMsg: 'requestPayment:ok'
      })
    })

    await expect(
      requestWechatPayment(
        parseWechatPaymentParameters(validParameters),
        invoke as never
      )
    ).resolves.toBe('completed')
    expect(invoke).toHaveBeenCalledWith({
      ...validParameters,
      success: expect.any(Function),
      fail: expect.any(Function)
    })
  })

  it('maps an explicit user cancellation without claiming success', async () => {
    const invoke = (options: Record<string, unknown>) => {
      ;(options.fail as (value: { errMsg: string }) => void)({
        errMsg: 'requestPayment:fail cancel'
      })
    }

    await expect(
      requestWechatPayment(
        parseWechatPaymentParameters(validParameters),
        invoke as never
      )
    ).resolves.toBe('cancelled')
  })

  it('rejects other requestPayment failures', async () => {
    const invoke = (options: Record<string, unknown>) => {
      ;(options.fail as (value: { errMsg: string }) => void)({
        errMsg: 'requestPayment:fail system error'
      })
    }

    await expect(
      requestWechatPayment(
        parseWechatPaymentParameters(validParameters),
        invoke as never
      )
    ).rejects.toThrow(/system error/)
  })

  it.each(['settled', 'failed', 'expired'] as const)(
    'stops polling on %s',
    async (status) => {
      const getOrder = vi.fn(async () => order(status))
      const wait = vi.fn(async () => undefined)

      await expect(
        pollRechargeOrder({
          orderId: 'order-1',
          getOrder,
          wait,
          delays: [0, 800, 1500]
        })
      ).resolves.toMatchObject({ status })
      expect(getOrder).toHaveBeenCalledOnce()
      expect(wait).toHaveBeenCalledOnce()
    }
  )

  it('uses bounded delays and returns the last pending order', async () => {
    const pending = order('pending_payment')
    const getOrder = vi.fn(async () => pending)
    const wait = vi.fn(async (_milliseconds: number) => undefined)
    const delays = [0, 800, 1500, 2500, 4000] as const

    await expect(
      pollRechargeOrder({
        orderId: 'order-1',
        getOrder,
        wait,
        delays
      })
    ).resolves.toBe(pending)
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual(delays)
    expect(getOrder).toHaveBeenCalledTimes(delays.length)
  })
})
