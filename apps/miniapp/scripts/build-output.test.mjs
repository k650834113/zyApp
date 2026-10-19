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
          ZYAPP_MINIAPP_MODE: 'production-wechat',
          ZYAPP_MINIAPP_PRODUCTION_API_BASE_URL: 'https://judian.icu',
          ZYAPP_MINIAPP_PRODUCTION_STORE_ID:
            '22222222-2222-4222-8222-222222222222'
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
      'about',
      'activities',
      'activity-detail',
      'community-invite',
      'favorites',
      'friends',
      'game-detail',
      'game-expansions',
      'games',
      'history',
      'home',
      'login',
      'lottery-register',
      'meetup-create',
      'meetup-detail',
      'meetup-success',
      'meetups',
      'member',
      'messages',
      'monthly-card',
      'my-meetups',
      'notice-settings',
      'notice-test',
      'play-create',
      'play-detail',
      'plays',
      'pricing',
      'profile',
      'recharge',
      'recommendations',
      'settings',
      'staff-transactions',
      'staff-workbench',
      'tool-coin',
      'tool-dice',
      'tool-first-player',
      'tool-score',
      'tool-teams',
      'tool-wheel',
      'tools'
    ])
    assert.equal(
      existsSync(sharedClientPath) ? readFileSync(sharedClientPath, 'utf8') : null,
      sharedClientBefore
    )
    const community = readFileSync(resolve(output, 'services/community-page.js'), 'utf8')
    const editor = readFileSync(resolve(output, 'services/community-cloud-page.js'), 'utf8')
    const rules = readFileSync(resolve(output, 'services/play-rules.js'), 'utf8')
    assert.doesNotMatch(editor + rules, /require\(["']@zyapp\//)
    assert.match(rules, /rankPlayPlayers/)
    assert.match(rules, /playFieldErrors/)
    assert.doesNotMatch(community, /savePlay|demo-meetup|state\.meetups|state\.plays/)
    const account = readFileSync(resolve(output, 'services/account-page.js'), 'utf8')
    assert.doesNotMatch(account, /settleMockMonthlyCardOrder|settleMockRechargeOrder|测试门店预存款已到账/)
    assert.equal(existsSync(resolve(output, 'services/account-page.js.map')), false)
    assert.doesNotMatch(readFileSync(resolve(output, 'pages/recharge/index.wxml'), 'utf8'), /完成测试支付|settleMockRecharge/)
    assert.doesNotMatch(readFileSync(resolve(output, 'services/ui-demo.js'), 'utf8'), /璀璨宝石轻松局/)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
