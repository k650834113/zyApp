import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearRememberedLogin,
  loadRememberedLogin,
  saveRememberedLogin
} from './remembered-login'

const temporaryDirectories: string[] = []
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) =>
    value.toString('utf8').replace(/^encrypted:/, '')
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('remembered login', () => {
  it('stores an encrypted password and restores it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-login-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'credential.json')

    saveRememberedLogin(filePath, cipher, {
      username: 'manager',
      password: 'secret123'
    })

    expect(readFileSync(filePath, 'utf8')).not.toContain('secret123')
    expect(loadRememberedLogin(filePath, cipher)).toEqual({
      username: 'manager',
      password: 'secret123'
    })
    clearRememberedLogin(filePath)
    expect(loadRememberedLogin(filePath, cipher)).toBeNull()
  })

  it('does not read credentials without encryption support', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-login-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'credential.json')
    saveRememberedLogin(filePath, cipher, {
      username: 'manager',
      password: 'secret123'
    })

    expect(
      loadRememberedLogin(filePath, {
        ...cipher,
        isEncryptionAvailable: () => false
      })
    ).toBeNull()
  })
})
