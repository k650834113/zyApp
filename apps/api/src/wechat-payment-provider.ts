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

export interface WechatPaymentProvider {
  readonly mode: 'mock' | 'disabled'
  createRechargePayment(
    input: CreateWechatRechargePaymentInput
  ): Promise<CreatedWechatRechargePayment>
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
}

export class DisabledWechatPaymentProvider implements WechatPaymentProvider {
  readonly mode = 'disabled' as const

  async createRechargePayment(): Promise<CreatedWechatRechargePayment> {
    throw new Error('微信支付商户配置尚未启用')
  }
}
