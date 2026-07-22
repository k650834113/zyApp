import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('employee password hashing', () => {
  it('hashes and verifies a password without storing plaintext', async () => {
    const encoded = await hashPassword('cashier-demo-123')

    expect(encoded).not.toContain('cashier-demo-123')
    await expect(verifyPassword('cashier-demo-123', encoded)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', encoded)).resolves.toBe(false)
  })

  it('rejects short passwords and malformed hashes', async () => {
    await expect(hashPassword('short')).rejects.toThrow('at least 8')
    await expect(verifyPassword('anything', 'invalid')).resolves.toBe(false)
  })
})
