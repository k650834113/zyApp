import {
  createCipheriv,
  createSign,
  generateKeyPairSync,
  verify
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAuthorization,
  decryptNotificationResource,
  signJsapiParameters,
  verifyWechatPaySignature
} from './wechatpay-crypto'

function rsaKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    }
  })
  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey
  }
}

function authorizationSignature(authorization: string): string {
  const match = authorization.match(/signature="([^"]+)"/)
  if (!match?.[1]) throw new Error('missing authorization signature')
  return match[1]
}

function platformSignature(
  message: string,
  privateKeyPem: string
): string {
  const signer = createSign('RSA-SHA256')
  signer.update(message)
  signer.end()
  return signer.sign(privateKeyPem, 'base64')
}

describe('WeChat Pay v3 cryptography', () => {
  it('signs the exact HTTP request canonical message', () => {
    const { privateKeyPem, publicKeyPem } = rsaKeyPair()
    const body = '{"amount":{"total":1}}'
    const authorization = buildAuthorization({
      method: 'POST',
      requestTarget: '/v3/pay/transactions/jsapi',
      body,
      merchantId: '1748654937',
      merchantCertificateSerial:
        '5A287A96C7BCD2AC8089D405F7478385C4902A7B',
      privateKeyPem,
      timestamp: '1721880000',
      nonce: 'fixednonce'
    })

    const message =
      `POST\n/v3/pay/transactions/jsapi\n1721880000\nfixednonce\n${body}\n`
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(message),
        publicKeyPem,
        Buffer.from(authorizationSignature(authorization), 'base64')
      )
    ).toBe(true)
    expect(authorization).toMatch(
      /^WECHATPAY2-SHA256-RSA2048 mchid="1748654937",nonce_str="fixednonce",timestamp="1721880000",serial_no="[0-9A-F]+",signature="[A-Za-z0-9+/=]+"$/
    )
  })

  it('signs exact JSAPI payment parameters', () => {
    const { privateKeyPem, publicKeyPem } = rsaKeyPair()
    const parameters = signJsapiParameters({
      appId: 'wx-test-appid',
      prepayId: 'wx-prepay',
      privateKeyPem,
      timestamp: '1721880000',
      nonce: 'fixednonce'
    })

    expect(parameters).toEqual({
      timeStamp: '1721880000',
      nonceStr: 'fixednonce',
      package: 'prepay_id=wx-prepay',
      signType: 'RSA',
      paySign: expect.any(String)
    })
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(
          'wx-test-appid\n1721880000\nfixednonce\nprepay_id=wx-prepay\n'
        ),
        publicKeyPem,
        Buffer.from(parameters.paySign, 'base64')
      )
    ).toBe(true)
  })

  it('accepts a valid platform signature and rejects a modified body', () => {
    const { privateKeyPem, publicKeyPem } = rsaKeyPair()
    const body = '{"event_type":"TRANSACTION.SUCCESS"}'
    const signatureBase64 = platformSignature(
      `1721880000\nfixednonce\n${body}\n`,
      privateKeyPem
    )

    expect(() =>
      verifyWechatPaySignature({
        timestamp: '1721880000',
        nonce: 'fixednonce',
        body,
        signatureBase64,
        publicKeyPem
      })
    ).not.toThrow()
    expect(() =>
      verifyWechatPaySignature({
        timestamp: '1721880000',
        nonce: 'fixednonce',
        body: '{"event_type":"TRANSACTION.CLOSED"}',
        signatureBase64,
        publicKeyPem
      })
    ).toThrow(/signature verification failed/)
  })

  it('rejects a signature made for a different public key', () => {
    const signer = rsaKeyPair()
    const verifier = rsaKeyPair()
    const authorization = buildAuthorization({
      method: 'GET',
      requestTarget: '/v3/pay/transactions/out-trade-no/order-1',
      body: '',
      merchantId: '1748654937',
      merchantCertificateSerial: 'ABCD',
      privateKeyPem: signer.privateKeyPem,
      timestamp: '1721880000',
      nonce: 'fixednonce'
    })

    expect(() =>
      verifyWechatPaySignature({
        timestamp: '1721880000',
        nonce: 'fixednonce',
        body: '',
        signatureBase64: authorizationSignature(authorization),
        publicKeyPem: verifier.publicKeyPem
      })
    ).toThrow(/signature verification failed/)
  })

  it('decrypts a valid AES-256-GCM notification resource', () => {
    const apiV3Key = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'
    const nonce = '0123456789ab'
    const associatedData = 'transaction'
    const plaintext = '{"out_trade_no":"ZYT-ORDER-1"}'
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key),
      Buffer.from(nonce)
    )
    cipher.setAAD(Buffer.from(associatedData))
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag()
    ])

    expect(
      decryptNotificationResource({
        ciphertext: encrypted.toString('base64'),
        associatedData,
        nonce,
        apiV3Key
      })
    ).toBe(plaintext)
  })

  it('rejects a modified AES-GCM authentication tag', () => {
    const apiV3Key = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'
    const nonce = '0123456789ab'
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key),
      Buffer.from(nonce)
    )
    const encrypted = Buffer.concat([
      cipher.update('secret', 'utf8'),
      cipher.final(),
      cipher.getAuthTag()
    ])
    const finalByteIndex = encrypted.length - 1
    encrypted[finalByteIndex] = encrypted[finalByteIndex]! ^ 1

    expect(() =>
      decryptNotificationResource({
        ciphertext: encrypted.toString('base64'),
        associatedData: '',
        nonce,
        apiV3Key
      })
    ).toThrow(/notification decryption failed/)
  })

  it('rejects APIv3 keys that are not exactly 32 bytes', () => {
    expect(() =>
      decryptNotificationResource({
        ciphertext: Buffer.alloc(17).toString('base64'),
        associatedData: '',
        nonce: '0123456789ab',
        apiV3Key: 'short-key'
      })
    ).toThrow(/exactly 32 bytes/)
  })
})
