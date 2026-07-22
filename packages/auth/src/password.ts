import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions
} from 'node:crypto'
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }
      resolve(derivedKey)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) {
    throw new RangeError('Password must contain at least 8 characters')
  }

  const salt = randomBytes(SALT_LENGTH)
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: 64 * 1024 * 1024
  })

  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$')
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, costValue, blockValue, parallelValue, saltValue, hashValue] =
    encodedHash.split('$')

  if (
    algorithm !== 'scrypt' ||
    !costValue ||
    !blockValue ||
    !parallelValue ||
    !saltValue ||
    !hashValue
  ) {
    return false
  }

  const expected = Buffer.from(hashValue, 'base64url')
  const actual = await deriveKey(password, Buffer.from(saltValue, 'base64url'), expected.length, {
    N: Number(costValue),
    r: Number(blockValue),
    p: Number(parallelValue),
    maxmem: 64 * 1024 * 1024
  })

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
