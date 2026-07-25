import type {
  MemberRechargeOrderSummary,
  WechatJsapiPaymentParameters
} from '@zyapp/contracts'

function invalidParameters(): never {
  throw new Error('Invalid WeChat payment parameters')
}

export function parseWechatPaymentParameters(
  value: Record<string, string> | null
): WechatJsapiPaymentParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidParameters()
  }
  if (
    Object.values(value).some((entry) => typeof entry !== 'string')
  ) {
    return invalidParameters()
  }
  const { timeStamp, nonceStr, package: packageValue, signType, paySign } =
    value
  if (
    typeof timeStamp !== 'string' ||
    !/^\d+$/.test(timeStamp) ||
    typeof nonceStr !== 'string' ||
    nonceStr.length === 0 ||
    typeof packageValue !== 'string' ||
    !/^prepay_id=.+/.test(packageValue) ||
    signType !== 'RSA' ||
    typeof paySign !== 'string' ||
    paySign.length === 0
  ) {
    return invalidParameters()
  }
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign
  }
}

type RequestPayment = (
  options: WechatMiniprogram.RequestPaymentOption
) => unknown

export function requestWechatPayment(
  parameters: WechatJsapiPaymentParameters,
  invoke: RequestPayment = wx.requestPayment.bind(wx)
): Promise<'completed' | 'cancelled'> {
  return new Promise((resolve, reject) => {
    invoke({
      ...parameters,
      success: () => resolve('completed'),
      fail: (error) => {
        if (error.errMsg.toLowerCase().includes('cancel')) {
          resolve('cancelled')
          return
        }
        reject(new Error(error.errMsg || 'WeChat payment failed'))
      }
    })
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

export async function pollRechargeOrder(input: {
  orderId: string
  getOrder: (
    orderId: string
  ) => Promise<MemberRechargeOrderSummary>
  wait?: (milliseconds: number) => Promise<void>
  delays?: readonly number[]
}): Promise<MemberRechargeOrderSummary> {
  const wait = input.wait ?? delay
  const delays = input.delays ?? [0, 800, 1500, 2500, 4000]
  let lastOrder: MemberRechargeOrderSummary | null = null
  for (const milliseconds of delays) {
    await wait(milliseconds)
    lastOrder = await input.getOrder(input.orderId)
    if (
      lastOrder.status === 'settled' ||
      lastOrder.status === 'failed' ||
      lastOrder.status === 'expired'
    ) {
      return lastOrder
    }
  }
  if (!lastOrder) {
    throw new Error('Recharge order polling requires at least one delay')
  }
  return lastOrder
}
