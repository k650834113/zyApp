import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDirectory, '../..')
const checkerPath = resolve(scriptDirectory, 'verify-release-contract.mjs')
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

test('rejects the committed pre-0.23.2 release fixture for every original contract gap', () => {
  const result = runChecker(preChangeFixture)

  assert.equal(
    result.status,
    1,
    `expected fixture rejection, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
  )
  const expectedFailures = [
    'root package version: expected "0.23.2", got "0.23.1"',
    'desktop package version: expected "0.23.2", got "0.23.1"',
    'release notes heading: expected true, got false',
    'miniapp README candidate version: expected true, got false',
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
    /\[release-contract\] 0\.23\.2 metadata and isolation gates verified/u
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
