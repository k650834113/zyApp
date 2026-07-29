import type { MemberRechargeOrderSummary } from '@zyapp/contracts'
import { describe, expect, it, vi } from 'vitest'
import { runRechargeFlow } from './recharge-flow'

const paymentParameters = {
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
    orderId: 'order-original',
    requestId: 'request-original',
    principalFen: 1,
    giftFen: 0,
    totalCreditFen: 1,
    status,
    providerMode: 'wechat',
    clientPaymentParameters: paymentParameters,
    expiresAt: '2026-07-25T04:15:00.000Z',
    settledAt:
      status === 'settled' ? '2026-07-25T04:01:00.000Z' : null,
    createdAt: '2026-07-25T04:00:00.000Z',
    errorMessage: null
  }
}

describe('member recharge flow', () => {
  it('returns cancellation without displaying or polling the pending order', async () => {
    const createOrder = vi.fn(async () => order('pending_payment'))
    const requestPayment = vi.fn(async () => 'cancelled' as const)
    const getOrder = vi.fn(async () => order('pending_payment'))

    await expect(
      runRechargeFlow({ createOrder, requestPayment, getOrder })
    ).resolves.toEqual({ kind: 'cancelled' })
    expect(createOrder).toHaveBeenCalledOnce()
    expect(getOrder).not.toHaveBeenCalled()
  })

  it('polls the original order after an unknown payment error without creating twice', async () => {
    const createOrder = vi.fn(async () => order('pending_payment'))
    const requestPayment = vi.fn(async () => {
      throw new Error('requestPayment:fail system error')
    })
    const getOrder = vi.fn(async (orderId: string) => {
      expect(orderId).toBe('order-original')
      return order('settled')
    })

    await expect(
      runRechargeFlow({ createOrder, requestPayment, getOrder })
    ).resolves.toMatchObject({
      kind: 'confirmed',
      order: { orderId: 'order-original', status: 'settled' }
    })
    expect(createOrder).toHaveBeenCalledOnce()
    expect(getOrder).toHaveBeenCalledWith('order-original')
  })
})
