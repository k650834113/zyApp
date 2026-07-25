import {
  createDecipheriv,
  createSign,
  createVerify
} from 'node:crypto'

function rsaSha256Signature(
  message: string,
  privateKeyPem: string
): string {
  const signer = createSign('RSA-SHA256')
  signer.update(message)
  signer.end()
  return signer.sign(privateKeyPem, 'base64')
}

export function buildAuthorization(input: {
  method: string
  requestTarget: string
  body: string
  merchantId: string
  merchantCertificateSerial: string
  privateKeyPem: string
  timestamp: string
  nonce: string
}): string {
  const message =
    `${input.method.toUpperCase()}\n` +
    `${input.requestTarget}\n` +
    `${input.timestamp}\n` +
    `${input.nonce}\n` +
    `${input.body}\n`
  const signature = rsaSha256Signature(message, input.privateKeyPem)

  return (
    'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${input.merchantId}",` +
    `nonce_str="${input.nonce}",` +
    `timestamp="${input.timestamp}",` +
    `serial_no="${input.merchantCertificateSerial}",` +
    `signature="${signature}"`
  )
}

export function signJsapiParameters(input: {
  appId: string
  prepayId: string
  privateKeyPem: string
  timestamp: string
  nonce: string
}): {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
} {
  const packageValue = `prepay_id=${input.prepayId}`
  const message =
    `${input.appId}\n` +
    `${input.timestamp}\n` +
    `${input.nonce}\n` +
    `${packageValue}\n`

  return {
    timeStamp: input.timestamp,
    nonceStr: input.nonce,
    package: packageValue,
    signType: 'RSA',
    paySign: rsaSha256Signature(message, input.privateKeyPem)
  }
}

export function verifyWechatPaySignature(input: {
  timestamp: string
  nonce: string
  body: string
  signatureBase64: string
  publicKeyPem: string
}): void {
  const message =
    `${input.timestamp}\n${input.nonce}\n${input.body}\n`
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(message)
    verifier.end()
    const verified = verifier.verify(
      input.publicKeyPem,
      input.signatureBase64,
      'base64'
    )
    if (!verified) throw new Error('invalid')
  } catch {
    throw new Error('WeChat Pay signature verification failed')
  }
}

export function decryptNotificationResource(input: {
  ciphertext: string
  associatedData: string
  nonce: string
  apiV3Key: string
}): string {
  const key = Buffer.from(input.apiV3Key, 'utf8')
  if (key.byteLength !== 32) {
    throw new Error('WeChat Pay APIv3 key must be exactly 32 bytes')
  }

  try {
    const encrypted = Buffer.from(input.ciphertext, 'base64')
    if (encrypted.byteLength <= 16) throw new Error('invalid ciphertext')
    const authTag = encrypted.subarray(encrypted.byteLength - 16)
    const ciphertext = encrypted.subarray(0, encrypted.byteLength - 16)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(input.nonce, 'utf8')
    )
    decipher.setAuthTag(authTag)
    decipher.setAAD(Buffer.from(input.associatedData, 'utf8'))
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new Error('WeChat Pay notification decryption failed')
  }
}
