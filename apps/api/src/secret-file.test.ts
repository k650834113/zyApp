import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSingleLineSecret } from './secret-file'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function secretFile(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-secret-'))
  directories.push(directory)
  const path = join(directory, 'secret')
  writeFileSync(path, content, 'utf8')
  return path
}

describe('single-line secret files', () => {
  it('reads exactly one 32-character APIv3 line', () => {
    const path = secretFile('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6\n')

    expect(
      readSingleLineSecret(path, 'WECHAT_PAY_API_V3_KEY_FILE', 32)
    ).toBe('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6')
  })

  it('rejects multiline secrets', () => {
    const path = secretFile('first-line\nsecond-line\n')

    expect(() => readSingleLineSecret(path, 'TEST_SECRET')).toThrow(
      /single line/
    )
  })

  it('rejects a secret with the wrong exact length', () => {
    const path = secretFile('too-short\n')

    expect(() =>
      readSingleLineSecret(path, 'WECHAT_PAY_API_V3_KEY_FILE', 32)
    ).toThrow(/exactly 32/)
  })
})
