import { randomUUID } from 'node:crypto'

export type CreateWechatRechargePaymentInput = {
  outTradeNo: string
  principalFen: number
  payerSubject: string
  description: string
  expiresAt: string
}

export type CreatedWechatRechargePayment = {
  providerMode: 'mock' | 'wechat'
  prepayId: string
  clientPaymentParameters: Record<string, string>
}

export type WechatPaymentState =
  | { state: 'pending'; outTradeNo: string }
  | { state: 'closed'; outTradeNo: string }
  | {
      state: 'success'
      outTradeNo: string
      transactionId: string
      amountFen: number
      currency: 'CNY'
      appId: string
      merchantId: string
      payerOpenId: string
      paidAt: string
    }

export type VerifiedWechatPaymentNotification = {
  eventId: string
  eventType: 'TRANSACTION.SUCCESS'
  payload: unknown
  payment: Extract<WechatPaymentState, { state: 'success' }>
}

export interface WechatPaymentProvider {
  readonly mode: 'mock' | 'wechat' | 'disabled'
  createRechargePayment(
    input: CreateWechatRechargePaymentInput
  ): Promise<CreatedWechatRechargePayment>
  queryRechargePayment(outTradeNo: string): Promise<WechatPaymentState>
  closeRechargePayment(outTradeNo: string): Promise<'closed' | 'paid'>
  verifyNotification(input: {
    headers: Record<string, string | string[] | undefined>
    rawBody: string
  }): VerifiedWechatPaymentNotification
}

export class MockWechatPaymentProvider implements WechatPaymentProvider {
  readonly mode = 'mock' as const

  async createRechargePayment(
    input: CreateWechatRechargePaymentInput
  ): Promise<CreatedWechatRechargePayment> {
    const prepayId = `mock-prepay-${randomUUID()}`
    return {
      providerMode: 'mock',
      prepayId,
      clientPaymentParameters: {
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: randomUUID().replaceAll('-', ''),
        package: `prepay_id=${prepayId}`,
        signType: 'MOCK',
        paySign: `mock:${input.outTradeNo}:${input.principalFen}`
      }
    }
  }

  async queryRechargePayment(
    outTradeNo: string
  ): Promise<WechatPaymentState> {
    return { state: 'pending', outTradeNo }
  }

  async closeRechargePayment(): Promise<'closed'> {
    return 'closed'
  }

  verifyNotification(): VerifiedWechatPaymentNotification {
    throw new Error('Mock WeChat payment notifications are unsupported')
  }
}

export class DisabledWechatPaymentProvider implements WechatPaymentProvider {
  readonly mode = 'disabled' as const

  async createRechargePayment(): Promise<CreatedWechatRechargePayment> {
    throw new Error('微信支付商户配置尚未启用')
  }

  async queryRechargePayment(): Promise<WechatPaymentState> {
    throw new Error('WeChat payment is disabled')
  }

  async closeRechargePayment(): Promise<'closed' | 'paid'> {
    throw new Error('WeChat payment is disabled')
  }

  verifyNotification(): VerifiedWechatPaymentNotification {
    throw new Error('WeChat payment is disabled')
  }
}
