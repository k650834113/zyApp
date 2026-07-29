import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('customer release output contains only approved member page directories', () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ZYAPP_MINIAPP_MODE: 'production-test-wechat',
      ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false',
      ZYAPP_MINIAPP_API_BASE_URL: 'https://judian.icu/test',
      ZYAPP_MINIAPP_STORE_ID: '0f990a69-9783-4830-869f-8a2edc7601c0'
    }
  })

  assert.equal(
    result.status,
    0,
    `build failed:\n${result.stdout}\n${result.stderr}`
  )
  const pageDirectories = readdirSync(resolve(root, 'dist/pages'), {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  assert.deepEqual(pageDirectories, ['history', 'home', 'member'])
})
