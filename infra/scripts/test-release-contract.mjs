import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
const bggSettingsHelperPath = resolve(
  scriptDirectory,
  'resolve-bgg-deployment-settings.ps1'
)
const sshIdentityHelperPath = resolve(
  scriptDirectory,
  'resolve-deployment-ssh-identity.ps1'
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

function createSshKeyPair(directory, name) {
  const keyPath = resolve(directory, name)
  const result = spawnSync(
    'ssh-keygen',
    ['-q', '-t', 'rsa', '-b', '2048', '-N', '', '-f', keyPath],
    { cwd: workspaceRoot, encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  return keyPath
}

function createSshIdentityFixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'zyapp-ssh-identity-'))
  const authorizedKeyPath = createSshKeyPair(directory, 'authorized')
  const wrongKeyPath = createSshKeyPair(directory, 'wrong')
  const identityPath = resolve(directory, 'ssh-identity.json')
  const environmentName =
    `ZYAPP_TEST_SSH_KEY_${randomUUID().replaceAll('-', '').toUpperCase()}`
  writeFileSync(
    identityPath,
    JSON.stringify({
      hostName: 'server.example.test',
      sshUser: 'deployer',
      publicKeyPath: 'authorized.pub',
      keyPathEnvironmentVariable: environmentName
    }),
    'utf8'
  )
  return {
    directory,
    authorizedKeyPath,
    wrongKeyPath,
    identityPath,
    environmentName
  }
}

function runSshResolver(identityPath, args = [], environment = {}) {
  return spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      sshIdentityHelperPath,
      '-IdentityPath',
      identityPath,
      ...args
    ],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...environment
      }
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

test('approved BGG mode reaches both API services while public images stay disabled', () => {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      resolve(workspaceRoot, 'infra/deploy/production.env.example'),
      '-f',
      resolve(workspaceRoot, 'infra/deploy/compose.production.yml'),
      'config',
      '--format',
      'json'
    ],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        BGG_METADATA_MODE: 'xmlapi',
        BGG_PUBLIC_IMAGES_ENABLED: 'false'
      }
    }
  )
  assert.equal(
    result.status,
    0,
    `compose config failed: stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
  )

  const compose = JSON.parse(result.stdout)
  assert.equal(compose.services.api.environment.BGG_METADATA_MODE, 'xmlapi')
  assert.equal(
    compose.services['api-test'].environment.BGG_METADATA_MODE,
    'xmlapi'
  )
  assert.equal(
    compose.services.api.environment.BGG_PUBLIC_IMAGES_ENABLED,
    'false'
  )
  assert.equal(
    compose.services['api-test'].environment.BGG_PUBLIC_IMAGES_ENABLED,
    'false'
  )
})

test('BGG deployment settings require a non-empty server-only token in xmlapi mode', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'zyapp-bgg-deploy-'))
  const environmentPath = resolve(directory, 'production.env')
  const tokenPath = resolve(directory, 'xml-api-token')

  try {
    writeFileSync(
      environmentPath,
      'BGG_METADATA_MODE=xmlapi\nBGG_PUBLIC_IMAGES_ENABLED=false\n',
      'utf8'
    )
    let result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        bggSettingsHelperPath,
        '-EnvironmentPath',
        environmentPath
      ],
      { cwd: workspaceRoot, encoding: 'utf8' }
    )
    assert.notEqual(result.status, 0)

    writeFileSync(tokenPath, 'server-only-token\n', 'utf8')
    result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        bggSettingsHelperPath,
        '-EnvironmentPath',
        environmentPath,
        '-BggTokenPath',
        tokenPath
      ],
      { cwd: workspaceRoot, encoding: 'utf8' }
    )
    assert.equal(
      result.status,
      0,
      `BGG settings helper failed: stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
    )
    const settings = JSON.parse(result.stdout)
    assert.equal(settings.enabled, true)
    assert.equal(settings.publicImagesEnabled, false)
    assert.equal(settings.tokenPath, tokenPath)
    assert.doesNotMatch(result.stdout, /server-only-token/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('deployment SSH identity resolves a private key matching the authorized public key', () => {
  const fixture = createSshIdentityFixture()
  try {
    const result = runSshResolver(
      fixture.identityPath,
      ['-KeyPath', fixture.authorizedKeyPath]
    )

    assert.equal(
      result.status,
      0,
      `resolver failed: stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
    )
    const identity = JSON.parse(result.stdout)
    assert.equal(identity.hostName, 'server.example.test')
    assert.equal(identity.sshUser, 'deployer')
    assert.equal(identity.keyPath, fixture.authorizedKeyPath)
    assert.equal(identity.actualFingerprint, identity.expectedFingerprint)
    assert.match(identity.actualFingerprint, /^SHA256:[A-Za-z0-9+/]+$/u)
    assert.deepEqual(identity.sshOptions, [
      '-i',
      fixture.authorizedKeyPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new'
    ])
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('deployment SSH identity rejects a private key with the wrong fingerprint', () => {
  const fixture = createSshIdentityFixture()
  try {
    const result = runSshResolver(
      fixture.identityPath,
      ['-KeyPath', fixture.wrongKeyPath]
    )

    assert.notEqual(result.status, 0)
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Deployment SSH private key fingerprint mismatch/u
    )
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('deployment SSH identity reads the private key from its configured environment', () => {
  const fixture = createSshIdentityFixture()
  try {
    const result = runSshResolver(
      fixture.identityPath,
      [],
      { [fixture.environmentName]: fixture.authorizedKeyPath }
    )

    assert.equal(
      result.status,
      0,
      `resolver failed: stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
    )
    const identity = JSON.parse(result.stdout)
    assert.equal(identity.keyPath, fixture.authorizedKeyPath)
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('explicit deployment SSH key takes precedence over the environment', () => {
  const fixture = createSshIdentityFixture()
  try {
    const result = runSshResolver(
      fixture.identityPath,
      ['-KeyPath', fixture.wrongKeyPath],
      { [fixture.environmentName]: fixture.authorizedKeyPath }
    )

    assert.notEqual(result.status, 0)
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Deployment SSH private key fingerprint mismatch/u
    )
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('deployment SSH identity explains how to provide a missing private key', () => {
  const fixture = createSshIdentityFixture()
  try {
    const result = runSshResolver(fixture.identityPath)

    assert.notEqual(result.status, 0)
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`Set ${fixture.environmentName} or pass -KeyPath`, 'u')
    )
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('deployment SSH identity rejects an authorized public key used as the private key', () => {
  const fixture = createSshIdentityFixture()
  try {
    const result = runSshResolver(
      fixture.identityPath,
      ['-KeyPath', `${fixture.authorizedKeyPath}.pub`]
    )

    assert.notEqual(result.status, 0)
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Deployment SSH private key must be a readable private key/u
    )
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('every deployment entry point rejects the wrong SSH key before other work', () => {
  const fixture = createSshIdentityFixture()
  try {
    const commit = spawnSync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: workspaceRoot, encoding: 'utf8' }
    )
    assert.equal(commit.status, 0, commit.stderr)
    const currentCommit = commit.stdout.trim()
    const scriptCases = [
      {
        name: 'deploy-production.ps1',
        args: ['-KeyPath', fixture.wrongKeyPath]
      },
      {
        name: 'deploy-test-release.ps1',
        args: ['-KeyPath', fixture.wrongKeyPath]
      },
      {
        name: 'deploy-miniapp-production.ps1',
        args: [
          '-KeyPath', fixture.wrongKeyPath,
          '-ExpectedCommit', currentCommit,
          '-ValidateOnly'
        ]
      },
      {
        name: 'deploy-miniapp-production-test.ps1',
        args: [
          '-KeyPath', fixture.wrongKeyPath,
          '-EnvironmentPath', fixture.wrongKeyPath,
          '-ApiV3KeyPath', fixture.wrongKeyPath,
          '-MerchantCertificatePath', fixture.wrongKeyPath,
          '-MerchantPrivateKeyPath', fixture.wrongKeyPath,
          '-WechatPayPublicKeyPath', fixture.wrongKeyPath
        ]
      }
    ]

    for (const scriptCase of scriptCases) {
      const result = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          resolve(scriptDirectory, scriptCase.name),
          ...scriptCase.args
        ],
        { cwd: workspaceRoot, encoding: 'utf8' }
      )
      assert.notEqual(result.status, 0, `${scriptCase.name} accepted the wrong key`)
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /Deployment SSH private key fingerprint mismatch/u,
        `${scriptCase.name} did not fail at the SSH identity boundary`
      )
    }
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('rejects the committed pre-0.23.2 fixture against the 0.24.0 release contract', () => {
  const result = runChecker(preChangeFixture)

  assert.equal(
    result.status,
    1,
    `expected fixture rejection, got stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`
  )
  const expectedFailures = [
    'root package version: expected "0.24.0", got "0.23.1"',
    'desktop package version: expected "0.24.3", got "0.23.1"',
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
    /\[release-contract\] 0\.24\.0 expansion release gates verified/u
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

test('general production deployment cannot disable formal WeChat services', () => {
  const deploymentScript = readFileSync(
    resolve(scriptDirectory, 'deploy-production.ps1'),
    'utf8'
  )

  assert.match(
    deploymentScript,
    /Production environment must set \$requiredWechatMode=wechat\./u
  )
  for (const setting of [
    'MINIAPP_WECHAT_AUTH_MODE',
    'TEST_MINIAPP_WECHAT_AUTH_MODE',
    'PRODUCTION_WECHAT_PAYMENT_MODE',
    'TEST_WECHAT_PAYMENT_MODE'
  ]) {
    assert.match(deploymentScript, new RegExp(`'${setting}'`))
  }

  const preflightPosition = deploymentScript.indexOf(
    'Production environment must set $requiredWechatMode=wechat.'
  )
  const firstNetworkPosition = deploymentScript.indexOf('& ssh @sshOptions')
  const serviceActivationPosition = deploymentScript.indexOf(
    'up -d --no-deps --force-recreate api worker'
  )
  const authenticationVerificationPosition = deploymentScript.indexOf(
    'Production WeChat authentication mode is not enabled.'
  )
  const paymentVerificationPosition = deploymentScript.indexOf(
    'Production WeChat payment mode is not enabled.'
  )

  assert.ok(preflightPosition >= 0)
  assert.ok(firstNetworkPosition > preflightPosition)
  assert.ok(authenticationVerificationPosition > serviceActivationPosition)
  assert.ok(paymentVerificationPosition > serviceActivationPosition)
})
