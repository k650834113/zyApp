import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
