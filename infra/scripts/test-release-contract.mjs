import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDirectory, '../..')
const checkerPath = resolve(scriptDirectory, 'verify-release-contract.mjs')
const archiveHelperPath = resolve(
  scriptDirectory,
  'create-deployment-source-archive.ps1'
)
const preChangeFixture = resolve(
  scriptDirectory,
  'fixtures/pre-0.23.2'
)

function runChecker(candidateRoot) {
  return spawnSync(
    process.execPath,
    candidateRoot ? [checkerPath, candidateRoot] : [checkerPath],
    {
      cwd: workspaceRoot,
      encoding: 'utf8'
    }
  )
}

test('deployment source archive contains committed HEAD and excludes dirty workspace state', () => {
  const repository = mkdtempSync(resolve(tmpdir(), 'zyapp-deploy-archive-'))
  const archive = resolve(repository, 'output', 'source.tgz')
  const extracted = resolve(repository, 'extracted')

  try {
    const git = (...args) =>
      spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
    assert.equal(git('init').status, 0)
    assert.equal(git('config', 'user.email', 'release-test@zyapp.local').status, 0)
    assert.equal(git('config', 'user.name', 'ZyApp Release Test').status, 0)
    assert.equal(git('config', 'core.autocrlf', 'false').status, 0)
    writeFileSync(resolve(repository, 'tracked.txt'), 'committed\n', 'utf8')
    assert.equal(git('add', 'tracked.txt').status, 0)
    assert.equal(git('commit', '-m', 'fixture').status, 0)

    writeFileSync(resolve(repository, 'tracked.txt'), 'dirty\n', 'utf8')
    writeFileSync(resolve(repository, 'untracked.txt'), 'must-not-ship\n', 'utf8')

    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        archiveHelperPath,
        '-WorkspaceRoot',
        repository,
        '-ArchivePath',
        archive
      ],
      { cwd: workspaceRoot, encoding: 'utf8' }
    )
    assert.equal(
      result.status,
      0,
      `archive helper failed: stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
    )

    mkdirSync(extracted)
    const extract = spawnSync('tar', ['-xzf', archive, '-C', extracted], {
      encoding: 'utf8'
    })
    assert.equal(extract.status, 0)
    assert.equal(readFileSync(resolve(extracted, 'tracked.txt'), 'utf8'), 'committed\n')
    assert.equal(existsSync(resolve(extracted, 'untracked.txt')), false)
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

test('rejects the committed pre-0.23.2 fixture against the 0.23.3 release contract', () => {
  const result = runChecker(preChangeFixture)

  assert.equal(
    result.status,
    1,
    `expected fixture rejection, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
  )
  const expectedFailures = [
    'root package version: expected "0.23.3", got "0.23.1"',
    'desktop package version: expected "0.23.3", got "0.23.1"',
    'release notes heading: expected true, got false',
    'acceptance document is missing the structured release-isolation contract'
  ]
  for (const failure of expectedFailures) {
    assert.match(result.stderr, new RegExp(failure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('accepts the current repository release candidate', () => {
  const result = runChecker()

  assert.equal(
    result.status,
    0,
    `expected current candidate acceptance, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
  )
  assert.match(
    result.stdout,
    /\[release-contract\] 0\.23\.3 dual-channel release gates verified/u
  )
})

test('formal production deployment enables and verifies WeChat authentication', () => {
  const deploymentScript = readFileSync(
    resolve(scriptDirectory, 'deploy-miniapp-production.ps1'),
    'utf8'
  )
  const remoteDeploymentScript = deploymentScript.slice(
    deploymentScript.indexOf("$remoteScriptTemplate = @'")
  )

  assert.match(
    deploymentScript,
    /PRODUCTION_AUTH_CHANGE=\$auth_change/u
  )
  assert.match(
    deploymentScript,
    /MINIAPP_WECHAT_AUTH_MODE=wechat/u
  )
  assert.match(
    deploymentScript,
    /test "\$MINIAPP_WECHAT_AUTH_MODE" = wechat/u
  )
  assert.match(
    deploymentScript,
    /PRODUCTION_AUTH_MODE=wechat/u
  )
  assert.match(
    deploymentScript,
    /test_auth_mode_before/u
  )
  assert.match(
    deploymentScript,
    /test_auth_mode_after/u
  )
  assert.match(
    deploymentScript,
    /TEST_AUTH_MODE=unchanged/u
  )

  const databaseBackupPosition = remoteDeploymentScript.indexOf(
    'sudo BACKUP_ENVIRONMENTS=production'
  )
  const imageBuildPosition = remoteDeploymentScript.indexOf(
    'build --no-cache migrate api'
  )
  const migrationPosition = remoteDeploymentScript.lastIndexOf(
    'run --rm --no-deps migrate'
  )
  const environmentBackupPosition = remoteDeploymentScript.indexOf(
    'environment_backup="$environment_backup_directory'
  )
  const paymentMutationPosition = remoteDeploymentScript.indexOf(
    "'s/^PRODUCTION_WECHAT_PAYMENT_MODE=.*/PRODUCTION_WECHAT_PAYMENT_MODE=wechat/'"
  )
  const authenticationMutationPosition = remoteDeploymentScript.indexOf(
    "'s/^MINIAPP_WECHAT_AUTH_MODE=.*/MINIAPP_WECHAT_AUTH_MODE=wechat/'"
  )
  const serviceActivationPosition = remoteDeploymentScript.indexOf(
    'up -d --no-build --no-deps --force-recreate api caddy'
  )

  assert.ok(databaseBackupPosition >= 0)
  assert.ok(imageBuildPosition > databaseBackupPosition)
  assert.ok(migrationPosition > imageBuildPosition)
  assert.ok(environmentBackupPosition > migrationPosition)
  assert.ok(paymentMutationPosition > environmentBackupPosition)
  assert.ok(authenticationMutationPosition > environmentBackupPosition)
  assert.ok(serviceActivationPosition > authenticationMutationPosition)
  assert.ok(serviceActivationPosition > paymentMutationPosition)
})
