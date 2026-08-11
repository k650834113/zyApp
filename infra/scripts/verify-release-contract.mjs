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
  'docs/0.23.4PC桌游管理生产更新验收.md',
  true
)

requireEqual(rootPackage.version, '0.23.4', 'root package version')
requireEqual(desktopPackage.version, '0.23.4', 'desktop package version')
requireEqual(
  releaseNotes.startsWith('# 0.23.4\n'),
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
      candidateVersion: '0.23.4',
      desktopChannels: ['production'],
      backendDeployment: false,
      databaseMigration: false,
      deploymentSource: 'git-head',
      requiredChecks: [
        'release-contract',
        'desktop-typecheck',
        'desktop-build',
        'artifact-sha256',
        'production-update-0.23.4',
        'production-range-download',
        'test-channel-unchanged',
        'backend-unchanged',
        'database-unchanged'
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
  console.log('[release-contract] 0.23.4 production desktop-only release gates verified')
}
