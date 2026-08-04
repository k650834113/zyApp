import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const defaultWorkspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..'
)
const workspaceRoot = process.argv[2]
  ? resolve(process.argv[2])
  : defaultWorkspaceRoot
const failures = []

function readWorkspaceFile(relativePath, optional = false) {
  try {
    return readFileSync(resolve(workspaceRoot, relativePath), 'utf8')
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null
    throw error
  }
}

function requireEqual(actual, expected, description) {
  if (actual !== expected) {
    failures.push(
      `${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    )
  }
}

function requireDeepEqual(actual, expected, description) {
  if (!isDeepStrictEqual(actual, expected)) {
    failures.push(
      `${description}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    )
  }
}

const rootPackage = JSON.parse(readWorkspaceFile('package.json'))
const desktopPackage = JSON.parse(
  readWorkspaceFile('apps/merchant-desktop/package.json')
)
const releaseNotes = readWorkspaceFile(
  'apps/merchant-desktop/release-notes.md'
)
const acceptance = readWorkspaceFile(
  'docs/0.23.3桌游快速录入发布验收.md',
  true
)

requireEqual(rootPackage.version, '0.23.3', 'root package version')
requireEqual(desktopPackage.version, '0.23.3', 'desktop package version')
requireEqual(
  releaseNotes.startsWith('# 0.23.3\n'),
  true,
  'release notes heading'
)

const contractMatch = acceptance?.match(
  /<!-- zyapp-release-contract\n([\s\S]*?)\n-->/u
) ?? null
if (!contractMatch) {
  failures.push(
    'acceptance document is missing the structured release-isolation contract'
  )
} else {
  try {
    const contract = JSON.parse(contractMatch[1])
    const expectedContract = {
      candidateVersion: '0.23.3',
      desktopChannels: ['test', 'production'],
      localSqliteSchemaVersion: 30,
      cloudDatabaseMigrationVersion: 20,
      deploymentSource: 'git-head',
      requiredChecks: [
        'release-contract',
        'targeted-tests',
        'typecheck',
        'build',
        'artifact-sha256',
        'test-health',
        'test-migration-20',
        'test-update-0.23.3',
        'production-backup',
        'production-health',
        'production-migration-20',
        'production-update-0.23.3',
        'test-still-0.23.3'
      ]
    }
    requireDeepEqual(
      contract,
      expectedContract,
      'release-isolation contract'
    )
  } catch (error) {
    failures.push(
      `release-isolation contract is not valid JSON: ${error.message}`
    )
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[release-contract] ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log('[release-contract] 0.23.3 dual-channel release gates verified')
}
