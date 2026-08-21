import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('customer release output stays isolated from the shared dist directory', () => {
  const sharedClientPath = resolve(root, 'dist/services/client.js')
  const sharedClientBefore = existsSync(sharedClientPath)
    ? readFileSync(sharedClientPath, 'utf8')
    : null
  const temporaryRoot = resolve(root, '.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  const output = mkdtempSync(join(temporaryRoot, 'build-output-'))

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/build.mjs', '--output-directory', output],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ZYAPP_MINIAPP_MODE: 'production-test-wechat',
          ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false',
          ZYAPP_MINIAPP_API_BASE_URL: 'https://judian.icu/test',
          ZYAPP_MINIAPP_STORE_ID: '0f990a69-9783-4830-869f-8a2edc7601c0'
        }
      }
    )

    assert.equal(
      result.status,
      0,
      `build failed:\n${result.stdout}\n${result.stderr}`
    )
    const pageDirectories = readdirSync(resolve(output, 'pages'), {
      withFileTypes: true
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    assert.deepEqual(pageDirectories, [
      'favorites',
      'game-expansions',
      'games',
      'history',
      'home',
      'member'
    ])
    assert.equal(
      existsSync(sharedClientPath) ? readFileSync(sharedClientPath, 'utf8') : null,
      sharedClientBefore
    )
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
