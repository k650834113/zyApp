import type {
  MemberRechargeOrderSummary,
  WechatJsapiPaymentParameters
} from '@zyapp/contracts'
import {
  parseWechatPaymentParameters,
  pollRechargeOrder,
  type WechatPaymentRequestResult
} from './wechat-payment'

export type RechargeFlowResult =
  | { kind: 'cancelled' }
  | { kind: 'confirmed'; order: MemberRechargeOrderSummary }
  | { kind: 'pending'; order: MemberRechargeOrderSummary }

export async function runRechargeFlow(input: {
  createOrder(): Promise<MemberRechargeOrderSummary>
  requestPayment(
    parameters: WechatJsapiPaymentParameters
  ): Promise<WechatPaymentRequestResult>
  getOrder(orderId: string): Promise<MemberRechargeOrderSummary>
}): Promise<RechargeFlowResult> {
  const created = await input.createOrder()
  const parameters = parseWechatPaymentParameters(
    created.clientPaymentParameters
  )
  let paymentResult: WechatPaymentRequestResult | null = null
  try {
    paymentResult = await input.requestPayment(parameters)
  } catch {
    // A non-cancellation client error is not a trusted payment result.
    // The original server order remains the only source of truth.
  }
  if (paymentResult === 'cancelled') {
    return { kind: 'cancelled' }
  }

  const confirmed = await pollRechargeOrder({
    orderId: created.orderId,
    getOrder: input.getOrder
  })
  return confirmed.status === 'settled'
    ? { kind: 'confirmed', order: confirmed }
    : { kind: 'pending', order: confirmed }
}
