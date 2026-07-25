import {
  createCipheriv,
  createSign,
  generateKeyPairSync
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { WechatPayProvider } from './wechatpay-provider'

const merchantId = '1748654937'
const merchantCertificateSerial =
  '5A287A96C7BCD2AC8089D405F7478385C4902A7B'
const publicKeyId = 'PUB_KEY_ID_0117486549372026072500000000000000'
const apiV3Key = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'

function rsaKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return {
    privateKeyPem: pair.privateKey,
    publicKeyPem: pair.publicKey
  }
}

function signPlatformMessage(
  body: string,
  privateKeyPem: string,
  timestamp = '1784952000',
  nonce = 'platformnonce'
): string {
  const signer = createSign('RSA-SHA256')
  signer.update(`${timestamp}\n${nonce}\n${body}\n`)
  signer.end()
  return signer.sign(privateKeyPem, 'base64')
}

function signedResponse(
  body: string,
  privateKeyPem: string,
  options: { status?: number; serial?: string } = {}
): Response {
  return new Response(options.status === 204 ? null : body, {
    status: options.status ?? 200,
    headers: {
      'content-type': 'application/json',
      'Wechatpay-Timestamp': '1784952000',
      'Wechatpay-Nonce': 'platformnonce',
      'Wechatpay-Serial': options.serial ?? publicKeyId,
      'Wechatpay-Signature': signPlatformMessage(body, privateKeyPem)
    }
  })
}

function providerWith(
  fetchImplementation: typeof fetch,
  keys = rsaKeyPair()
): {
  provider: WechatPayProvider
  keys: { privateKeyPem: string; publicKeyPem: string }
} {
  return {
    keys,
    provider: new WechatPayProvider({
      appId: 'wx-test-appid',
      merchantId,
      merchantCertificateSerial,
      merchantPrivateKeyPem: keys.privateKeyPem,
      publicKeyId,
      publicKeyPem: keys.publicKeyPem,
      apiV3Key,
      notifyUrl:
        'https://judian.icu/test/v1/payments/wechat/recharge/notify',
      fetch: fetchImplementation,
      now: () => new Date('2026-07-25T04:00:00.000Z'),
      nonce: () => 'fixednonce'
    })
  }
}

function successfulTransaction(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    appid: 'wx-test-appid',
    mchid: merchantId,
    out_trade_no: 'ZYT-ORDER-1',
    transaction_id: '4200000001202607250000000001',
    trade_state: 'SUCCESS',
    success_time: '2026-07-25T12:01:00+08:00',
    payer: { openid: 'openid-test' },
    amount: { total: 1, payer_total: 1, currency: 'CNY' },
    ...overrides
  }
}

describe('real WeChat Pay JSAPI provider', () => {
  it('creates a signed JSAPI payment and signs client parameters', async () => {
    const platformKeys = rsaKeyPair()
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} })
      return signedResponse(
        '{"prepay_id":"wx-prepay"}',
        platformKeys.privateKeyPem
      )
    }) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    const result = await provider.createRechargePayment({
      outTradeNo: 'ZYT-ORDER-1',
      principalFen: 1,
      payerSubject: 'openid:openid-test',
      description: '桌游吧会员储值',
      expiresAt: '2026-07-25T04:15:00.000Z'
    })

    const request = requests[0]
    expect(request?.url).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi'
    )
    expect(request?.init.method).toBe('POST')
    expect(JSON.parse(String(request?.init.body))).toEqual({
      appid: 'wx-test-appid',
      mchid: merchantId,
      description: '桌游吧会员储值',
      out_trade_no: 'ZYT-ORDER-1',
      time_expire: '2026-07-25T12:15:00+08:00',
      notify_url:
        'https://judian.icu/test/v1/payments/wechat/recharge/notify',
      amount: { total: 1, currency: 'CNY' },
      payer: { openid: 'openid-test' }
    })
    expect(
      (request?.init.headers as Record<string, string>).Authorization
    ).toMatch(/^WECHATPAY2-SHA256-RSA2048 /)
    expect(result).toMatchObject({
      providerMode: 'wechat',
      prepayId: 'wx-prepay',
      clientPaymentParameters: {
        timeStamp: '1784952000',
        nonceStr: 'fixednonce',
        package: 'prepay_id=wx-prepay',
        signType: 'RSA',
        paySign: expect.any(String)
      }
    })
  })

  it.each([
    ['NOTPAY', { state: 'pending', outTradeNo: 'ZYT-ORDER-1' }],
    ['CLOSED', { state: 'closed', outTradeNo: 'ZYT-ORDER-1' }]
  ])('maps a signed %s query', async (tradeState, expected) => {
    const platformKeys = rsaKeyPair()
    const body = JSON.stringify({
      out_trade_no: 'ZYT-ORDER-1',
      trade_state: tradeState
    })
    const fetchMock = vi.fn(async () =>
      signedResponse(body, platformKeys.privateKeyPem)
    ) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    await expect(
      provider.queryRechargePayment('ZYT-ORDER-1')
    ).resolves.toEqual(expected)
  })

  it('maps a signed successful query without coercing payment fields', async () => {
    const platformKeys = rsaKeyPair()
    const body = JSON.stringify(successfulTransaction())
    const fetchMock = vi.fn(async () =>
      signedResponse(body, platformKeys.privateKeyPem)
    ) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    await expect(
      provider.queryRechargePayment('ZYT-ORDER-1')
    ).resolves.toEqual({
      state: 'success',
      outTradeNo: 'ZYT-ORDER-1',
      transactionId: '4200000001202607250000000001',
      amountFen: 1,
      currency: 'CNY',
      appId: 'wx-test-appid',
      merchantId,
      payerOpenId: 'openid-test',
      paidAt: '2026-07-25T12:01:00+08:00'
    })
  })

  it('maps signed close outcomes', async () => {
    const platformKeys = rsaKeyPair()
    const responses = [
      signedResponse('', platformKeys.privateKeyPem, { status: 204 }),
      signedResponse(
        '{"code":"ORDERPAID","message":"order paid"}',
        platformKeys.privateKeyPem,
        { status: 400 }
      )
    ]
    const fetchMock = vi.fn(async () => responses.shift()!) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    await expect(provider.closeRechargePayment('ORDER-1')).resolves.toBe(
      'closed'
    )
    await expect(provider.closeRechargePayment('ORDER-2')).resolves.toBe(
      'paid'
    )
  })

  it('rejects a response with an invalid signature before trusting JSON', async () => {
    const platformKeys = rsaKeyPair()
    const attackerKeys = rsaKeyPair()
    const fetchMock = vi.fn(async () =>
      signedResponse(
        '{"prepay_id":"attacker-prepay"}',
        attackerKeys.privateKeyPem
      )
    ) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    await expect(
      provider.createRechargePayment({
        outTradeNo: 'ZYT-ORDER-1',
        principalFen: 1,
        payerSubject: 'openid:openid-test',
        description: '桌游吧会员储值',
        expiresAt: '2026-07-25T04:15:00.000Z'
      })
    ).rejects.toThrow(/signature verification failed/)
  })

  it('rejects a signed response from an unconfigured key id', async () => {
    const platformKeys = rsaKeyPair()
    const fetchMock = vi.fn(async () =>
      signedResponse(
        '{"prepay_id":"wx-prepay"}',
        platformKeys.privateKeyPem,
        { serial: 'PUB_KEY_ID_UNKNOWN' }
      )
    ) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    await expect(
      provider.createRechargePayment({
        outTradeNo: 'ZYT-ORDER-1',
        principalFen: 1,
        payerSubject: 'openid:openid-test',
        description: '桌游吧会员储值',
        expiresAt: '2026-07-25T04:15:00.000Z'
      })
    ).rejects.toThrow(/untrusted WeChat Pay key id/)
  })

  it('verifies and decrypts a successful notification', () => {
    const platformKeys = rsaKeyPair()
    const { provider } = providerWith(vi.fn() as unknown as typeof fetch, platformKeys)
    const resourcePlaintext = JSON.stringify(successfulTransaction())
    const nonce = '0123456789ab'
    const associatedData = 'transaction'
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key),
      Buffer.from(nonce)
    )
    cipher.setAAD(Buffer.from(associatedData))
    const ciphertext = Buffer.concat([
      cipher.update(resourcePlaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag()
    ]).toString('base64')
    const body = JSON.stringify({
      id: 'event-1',
      event_type: 'TRANSACTION.SUCCESS',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext,
        associated_data: associatedData,
        nonce
      }
    })

    expect(
      provider.verifyNotification({
        headers: {
          'wechatpay-timestamp': '1784952000',
          'wechatpay-nonce': 'platformnonce',
          'wechatpay-serial': publicKeyId,
          'wechatpay-signature': signPlatformMessage(
            body,
            platformKeys.privateKeyPem
          )
        },
        rawBody: body
      })
    ).toEqual({
      eventId: 'event-1',
      eventType: 'TRANSACTION.SUCCESS',
      payload: JSON.parse(body),
      payment: {
        state: 'success',
        outTradeNo: 'ZYT-ORDER-1',
        transactionId: '4200000001202607250000000001',
        amountFen: 1,
        currency: 'CNY',
        appId: 'wx-test-appid',
        merchantId,
        payerOpenId: 'openid-test',
        paidAt: '2026-07-25T12:01:00+08:00'
      }
    })
  })

  it('rejects non-integer success amounts instead of coercing them', async () => {
    const platformKeys = rsaKeyPair()
    const body = JSON.stringify(
      successfulTransaction({
        amount: { total: '1', currency: 'CNY' }
      })
    )
    const fetchMock = vi.fn(async () =>
      signedResponse(body, platformKeys.privateKeyPem)
    ) as unknown as typeof fetch
    const { provider } = providerWith(fetchMock, platformKeys)

    await expect(
      provider.queryRechargePayment('ZYT-ORDER-1')
    ).rejects.toThrow(/invalid WeChat Pay transaction/)
  })
})
