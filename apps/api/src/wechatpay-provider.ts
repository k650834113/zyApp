import { randomBytes } from 'node:crypto'
import {
  buildAuthorization,
  decryptNotificationResource,
  signJsapiParameters,
  verifyWechatPaySignature
} from './wechatpay-crypto'
import type {
  CreatedWechatRechargePayment,
  CreateWechatRechargePaymentInput,
  VerifiedWechatPaymentNotification,
  WechatPaymentProvider,
  WechatPaymentState
} from './wechat-payment-provider'

const WECHAT_PAY_ORIGIN = 'https://api.mch.weixin.qq.com'

type WechatPayProviderOptions = {
  appId: string
  merchantId: string
  merchantCertificateSerial: string
  merchantPrivateKeyPem: string
  publicKeyId: string
  publicKeyPem: string
  apiV3Key: string
  notifyUrl: string
  fetch?: typeof fetch
  now?: () => Date
  nonce?: () => string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid WeChat Pay response')
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('invalid WeChat Pay transaction')
  }
  return value
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error('invalid WeChat Pay JSON response')
  }
}

function parseSuccessfulPayment(
  value: unknown
): Extract<WechatPaymentState, { state: 'success' }> {
  const transaction = record(value)
  const amount = record(transaction.amount)
  const payer = record(transaction.payer)
  const amountFen = amount.total
  if (!Number.isSafeInteger(amountFen) || (amountFen as number) <= 0) {
    throw new Error('invalid WeChat Pay transaction amount')
  }
  if (amount.currency !== 'CNY') {
    throw new Error('invalid WeChat Pay transaction currency')
  }
  if (transaction.trade_state !== 'SUCCESS') {
    throw new Error('invalid WeChat Pay transaction state')
  }

  return {
    state: 'success',
    outTradeNo: nonEmptyString(transaction.out_trade_no),
    transactionId: nonEmptyString(transaction.transaction_id),
    amountFen: amountFen as number,
    currency: 'CNY',
    appId: nonEmptyString(transaction.appid),
    merchantId: nonEmptyString(transaction.mchid),
    payerOpenId: nonEmptyString(payer.openid),
    paidAt: nonEmptyString(transaction.success_time)
  }
}

function formatChinaOffsetTime(value: string): string {
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime())) {
    throw new Error('invalid recharge payment expiry')
  }
  const chinaClock = new Date(instant.getTime() + 8 * 60 * 60 * 1000)
  return `${chinaClock.toISOString().slice(0, 19)}+08:00`
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const target = name.toLowerCase()
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error(`missing ${name} header`)
}

export class WechatPayProvider implements WechatPaymentProvider {
  readonly mode = 'wechat' as const
  private readonly fetchImplementation: typeof fetch
  private readonly currentTime: () => Date
  private readonly createNonce: () => string

  constructor(private readonly options: WechatPayProviderOptions) {
    this.fetchImplementation = options.fetch ?? fetch
    this.currentTime = options.now ?? (() => new Date())
    this.createNonce =
      options.nonce ?? (() => randomBytes(16).toString('hex'))
  }

  async createRechargePayment(
    input: CreateWechatRechargePaymentInput
  ): Promise<CreatedWechatRechargePayment> {
    const openId = input.payerSubject.startsWith('openid:')
      ? input.payerSubject.slice('openid:'.length)
      : ''
    if (!openId) {
      throw new Error('real WeChat payment requires an OpenID payer')
    }
    const requestBody = JSON.stringify({
      appid: this.options.appId,
      mchid: this.options.merchantId,
      description: input.description,
      out_trade_no: input.outTradeNo,
      time_expire: formatChinaOffsetTime(input.expiresAt),
      notify_url: this.options.notifyUrl,
      amount: { total: input.principalFen, currency: 'CNY' },
      payer: { openid: openId }
    })
    const body = await this.request(
      'POST',
      '/v3/pay/transactions/jsapi',
      requestBody
    )
    const response = record(parseJson(body))
    const prepayId = nonEmptyString(response.prepay_id)
    const now = this.currentTime()
    const clientParameters = signJsapiParameters({
      appId: this.options.appId,
      prepayId,
      privateKeyPem: this.options.merchantPrivateKeyPem,
      timestamp: String(Math.floor(now.getTime() / 1000)),
      nonce: this.createNonce()
    })
    return {
      providerMode: 'wechat',
      prepayId,
      clientPaymentParameters: clientParameters
    }
  }

  async queryRechargePayment(
    outTradeNo: string
  ): Promise<WechatPaymentState> {
    const path =
      '/v3/pay/transactions/out-trade-no/' +
      `${encodeURIComponent(outTradeNo)}?mchid=` +
      encodeURIComponent(this.options.merchantId)
    const body = await this.request('GET', path, '')
    const response = record(parseJson(body))
    const returnedOutTradeNo = nonEmptyString(response.out_trade_no)
    if (returnedOutTradeNo !== outTradeNo) {
      throw new Error('invalid WeChat Pay transaction order number')
    }
    if (response.trade_state === 'SUCCESS') {
      return parseSuccessfulPayment(response)
    }
    if (
      response.trade_state === 'NOTPAY' ||
      response.trade_state === 'USERPAYING'
    ) {
      return { state: 'pending', outTradeNo }
    }
    if (
      response.trade_state === 'CLOSED' ||
      response.trade_state === 'REVOKED' ||
      response.trade_state === 'PAYERROR'
    ) {
      return { state: 'closed', outTradeNo }
    }
    throw new Error('unsupported WeChat Pay transaction state')
  }

  async closeRechargePayment(
    outTradeNo: string
  ): Promise<'closed' | 'paid'> {
    const path =
      '/v3/pay/transactions/out-trade-no/' +
      `${encodeURIComponent(outTradeNo)}/close`
    const result = await this.signedFetch(
      'POST',
      path,
      JSON.stringify({ mchid: this.options.merchantId })
    )
    if (result.status === 204) return 'closed'
    const response = record(parseJson(result.body))
    if (result.status === 400 && response.code === 'ORDERPAID') {
      return 'paid'
    }
    throw new Error(
      `WeChat Pay close request failed with status ${result.status}`
    )
  }

  verifyNotification(input: {
    headers: Record<string, string | string[] | undefined>
    rawBody: string
  }): VerifiedWechatPaymentNotification {
    const timestamp = headerValue(
      input.headers,
      'Wechatpay-Timestamp'
    )
    const nonce = headerValue(input.headers, 'Wechatpay-Nonce')
    const serial = headerValue(input.headers, 'Wechatpay-Serial')
    const signature = headerValue(
      input.headers,
      'Wechatpay-Signature'
    )
    this.verifyPlatformMessage(
      serial,
      timestamp,
      nonce,
      input.rawBody,
      signature
    )

    const payload = record(parseJson(input.rawBody))
    if (
      nonEmptyString(payload.id).length === 0 ||
      payload.event_type !== 'TRANSACTION.SUCCESS'
    ) {
      throw new Error('unsupported WeChat Pay notification event')
    }
    const resource = record(payload.resource)
    if (resource.algorithm !== 'AEAD_AES_256_GCM') {
      throw new Error('unsupported WeChat Pay notification algorithm')
    }
    const plaintext = decryptNotificationResource({
      ciphertext: nonEmptyString(resource.ciphertext),
      associatedData:
        resource.associated_data === undefined
          ? ''
          : nonEmptyString(resource.associated_data),
      nonce: nonEmptyString(resource.nonce),
      apiV3Key: this.options.apiV3Key
    })
    return {
      eventId: nonEmptyString(payload.id),
      eventType: 'TRANSACTION.SUCCESS',
      payload,
      payment: parseSuccessfulPayment(parseJson(plaintext))
    }
  }

  private async request(
    method: string,
    requestTarget: string,
    body: string
  ): Promise<string> {
    const result = await this.signedFetch(method, requestTarget, body)
    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `WeChat Pay request failed with status ${result.status}`
      )
    }
    return result.body
  }

  private async signedFetch(
    method: string,
    requestTarget: string,
    body: string
  ): Promise<{ status: number; body: string }> {
    const now = this.currentTime()
    const timestamp = String(Math.floor(now.getTime() / 1000))
    const nonce = this.createNonce()
    const authorization = buildAuthorization({
      method,
      requestTarget,
      body,
      merchantId: this.options.merchantId,
      merchantCertificateSerial:
        this.options.merchantCertificateSerial,
      privateKeyPem: this.options.merchantPrivateKeyPem,
      timestamp,
      nonce
    })
    const request: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization
      }
    }
    if (method !== 'GET') request.body = body
    const response = await this.fetchImplementation(
      `${WECHAT_PAY_ORIGIN}${requestTarget}`,
      request
    )
    const responseBody = await response.text()
    this.verifyPlatformMessage(
      response.headers.get('Wechatpay-Serial'),
      response.headers.get('Wechatpay-Timestamp'),
      response.headers.get('Wechatpay-Nonce'),
      responseBody,
      response.headers.get('Wechatpay-Signature')
    )
    return { status: response.status, body: responseBody }
  }

  private verifyPlatformMessage(
    serial: string | null,
    timestamp: string | null,
    nonce: string | null,
    body: string,
    signature: string | null
  ): void {
    if (serial !== this.options.publicKeyId) {
      throw new Error('untrusted WeChat Pay key id')
    }
    if (!timestamp || !nonce || !signature) {
      throw new Error('missing WeChat Pay response signature headers')
    }
    verifyWechatPaySignature({
      timestamp,
      nonce,
      body,
      signatureBase64: signature,
      publicKeyPem: this.options.publicKeyPem
    })
  }
}
