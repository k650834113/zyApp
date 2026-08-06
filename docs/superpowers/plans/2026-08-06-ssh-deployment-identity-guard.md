# SSH Deployment Identity Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every ZyApp deployment entry point select and verify the authorized SSH identity before reading artifacts or contacting the server, and install an idempotent local `zyapp-server` SSH profile.

**Architecture:** Store only the authorized public key and non-secret target metadata in the repository. A shared PowerShell resolver chooses the private key from an explicit argument or `ZYAPP_SSH_KEY_PATH`, compares its SHA-256 fingerprint with the tracked public key, and returns normalized connection settings to all four deployment scripts. The current Windows account keeps the private path in its SSH config and user environment, outside Git.

**Tech Stack:** PowerShell 5.1, Windows OpenSSH (`ssh`, `scp`, `ssh-keygen`), Node.js test runner, Git.

## Global Constraints

- The authorized target is `ubuntu@124.220.69.209`.
- The authorized public-key fingerprint is `SHA256:wiCYUxW2h/Y81rAWgN6uwYfq2IZ7HVuUdV67XhbdIS0`.
- The private key remains at `E:\证书\codex.pem` and must never enter Git, logs, fixtures, archives or deployment output.
- Existing callers may still pass `-HostName`, `-SshUser` and `-KeyPath`; all candidate private keys must pass fingerprint validation.
- SSH identity validation must run before archive creation, artifact reads, uploads or remote commands.
- Existing BGG parser changes and Mini Program working-tree changes are unrelated and must remain unstaged.
- This work does not alter server `authorized_keys`, services, databases, containers or firewall rules.

---

### Task 1: Add the Repository Identity Baseline and Resolver

**Files:**
- Create: `infra/deploy/zyapp-deploy.pub`
- Create: `infra/deploy/ssh-identity.json`
- Create: `infra/scripts/resolve-deployment-ssh-identity.ps1`
- Modify: `infra/scripts/test-release-contract.mjs`

**Interfaces:**
- Consumes: optional `-HostName`, `-SshUser`, `-KeyPath` and `-IdentityPath` PowerShell parameters.
- Produces: compact JSON with `hostName`, `sshUser`, `keyPath`, `expectedFingerprint` and `actualFingerprint`.
- Reads: explicit `-KeyPath`, then process-level `ZYAPP_SSH_KEY_PATH`, then user-level `ZYAPP_SSH_KEY_PATH`.

- [ ] **Step 1: Add failing resolver tests using temporary SSH keys**

Extend `infra/scripts/test-release-contract.mjs` with a helper that creates two temporary RSA key pairs:

```js
const createSshKeyPair = (directory, name) => {
  const keyPath = resolve(directory, name)
  const result = spawnSync(
    'ssh-keygen',
    ['-q', '-t', 'rsa', '-b', '2048', '-N', '', '-f', keyPath],
    { cwd: workspaceRoot, encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  return keyPath
}

const runSshResolver = (identityPath, args = [], env = process.env) =>
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(scriptDirectory, 'resolve-deployment-ssh-identity.ps1'),
      '-IdentityPath',
      identityPath,
      ...args
    ],
    { cwd: workspaceRoot, encoding: 'utf8', env }
  )
```

Add literal behavior tests that:

1. write a temporary `ssh-identity.json` referencing the first `.pub` file and expect its private key to resolve;
2. pass the second private key and expect a non-zero exit with `Deployment SSH private key fingerprint mismatch`;
3. set `ZYAPP_SSH_KEY_PATH` to the first key but explicitly pass the second key and expect mismatch, proving explicit precedence;
4. omit both argument and environment value and expect `Set ZYAPP_SSH_KEY_PATH or pass -KeyPath`.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run:

```powershell
node --test infra/scripts/test-release-contract.mjs
```

Expected: FAIL because `resolve-deployment-ssh-identity.ps1` and the repository identity files do not exist.

- [ ] **Step 3: Add the public key and non-secret identity configuration**

Create `infra/deploy/zyapp-deploy.pub` with the exact user-provided public key and `infra/deploy/ssh-identity.json` with:

```json
{
  "hostName": "124.220.69.209",
  "sshUser": "ubuntu",
  "publicKeyPath": "zyapp-deploy.pub",
  "keyPathEnvironmentVariable": "ZYAPP_SSH_KEY_PATH"
}
```

- [ ] **Step 4: Implement the minimal resolver**

Create `infra/scripts/resolve-deployment-ssh-identity.ps1` with these exact behaviors:

```powershell
param(
  [string]$HostName,
  [string]$SshUser,
  [string]$KeyPath,
  [string]$IdentityPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($IdentityPath)) {
  $IdentityPath = Join-Path $PSScriptRoot '..\deploy\ssh-identity.json'
}
$identityFile = [IO.Path]::GetFullPath($IdentityPath)
$identity = Get-Content -Raw -Encoding utf8 -LiteralPath $identityFile |
  ConvertFrom-Json
$resolvedHost = if ($HostName) { $HostName } else { $identity.hostName }
$resolvedUser = if ($SshUser) { $SshUser } else { $identity.sshUser }
$environmentName = [string]$identity.keyPathEnvironmentVariable
$candidateKey = $KeyPath
if ([string]::IsNullOrWhiteSpace($candidateKey)) {
  $candidateKey = [Environment]::GetEnvironmentVariable($environmentName)
}
if ([string]::IsNullOrWhiteSpace($candidateKey)) {
  $candidateKey = [Environment]::GetEnvironmentVariable($environmentName, 'User')
}
if ([string]::IsNullOrWhiteSpace($candidateKey)) {
  throw "Set $environmentName or pass -KeyPath."
}
```

Validate host/user syntax, require the identity file, public key, private key and `ssh-keygen`, parse field two from `ssh-keygen -lf` output, compare fingerprints with `-cne`, and return only the five documented JSON properties. Never emit key contents.

- [ ] **Step 5: Run resolver tests and verify GREEN**

Run:

```powershell
node --test infra/scripts/test-release-contract.mjs
```

Expected: all release-contract tests pass, including matching, mismatch, precedence and missing-path cases.

- [ ] **Step 6: Verify the committed public-key fingerprint**

Run:

```powershell
ssh-keygen -lf infra/deploy/zyapp-deploy.pub
```

Expected output contains exactly `SHA256:wiCYUxW2h/Y81rAWgN6uwYfq2IZ7HVuUdV67XhbdIS0`.

- [ ] **Step 7: Commit Task 1**

```powershell
git add infra/deploy/zyapp-deploy.pub infra/deploy/ssh-identity.json infra/scripts/resolve-deployment-ssh-identity.ps1 infra/scripts/test-release-contract.mjs
git commit -m "feat: validate deployment SSH identity"
```

---

### Task 2: Route Every Deployment Script Through the Resolver

**Files:**
- Modify: `infra/scripts/deploy-production.ps1`
- Modify: `infra/scripts/deploy-test-release.ps1`
- Modify: `infra/scripts/deploy-miniapp-production.ps1`
- Modify: `infra/scripts/deploy-miniapp-production-test.ps1`
- Modify: `infra/deploy/README.md`
- Modify: `infra/scripts/test-release-contract.mjs`

**Interfaces:**
- Consumes: JSON emitted by `resolve-deployment-ssh-identity.ps1`.
- Produces: existing `ssh`/`scp` calls with the validated `keyPath`, `sshUser` and `hostName`.
- Preserves: every existing deployment parameter and remote workflow other than making the three SSH identity parameters optional.

- [ ] **Step 1: Add a failing script preflight contract**

Add a release-contract test that creates `wrongKeyPath`, reads the current commit, and invokes the four scripts with these literal argument sets:

```js
const currentCommit = spawnSync(
  'git',
  ['rev-parse', 'HEAD'],
  { cwd: workspaceRoot, encoding: 'utf8' }
).stdout.trim()
const scriptCases = [
  {
    name: 'deploy-production.ps1',
    args: ['-KeyPath', wrongKeyPath]
  },
  {
    name: 'deploy-test-release.ps1',
    args: ['-KeyPath', wrongKeyPath]
  },
  {
    name: 'deploy-miniapp-production.ps1',
    args: [
      '-KeyPath', wrongKeyPath,
      '-ExpectedCommit', currentCommit,
      '-ValidateOnly'
    ]
  },
  {
    name: 'deploy-miniapp-production-test.ps1',
    args: [
      '-KeyPath', wrongKeyPath,
      '-EnvironmentPath', wrongKeyPath,
      '-ApiV3KeyPath', wrongKeyPath,
      '-MerchantCertificatePath', wrongKeyPath,
      '-MerchantPrivateKeyPath', wrongKeyPath,
      '-WechatPayPublicKeyPath', wrongKeyPath
    ]
  }
]
```

For each case, run `powershell -NoProfile -ExecutionPolicy Bypass -File <script> ...args` and assert a non-zero exit plus `Deployment SSH private key fingerprint mismatch`. This proves identity rejection occurs before manifests, worktree checks, payment-secret parsing or network access.

- [ ] **Step 2: Run the release-contract test and verify RED**

Run:

```powershell
node --test infra/scripts/test-release-contract.mjs
```

Expected: the new four-script contract fails because the scripts still accept any existing private-key file.

- [ ] **Step 3: Make SSH identity parameters optional and resolve them first**

In each deployment script, replace mandatory identity parameters with:

```powershell
[string]$HostName,
[string]$SshUser,
[string]$KeyPath,
```

Immediately after `$ErrorActionPreference = 'Stop'`, call:

```powershell
$sshIdentity = (& (Join-Path $PSScriptRoot 'resolve-deployment-ssh-identity.ps1') `
  -HostName $HostName `
  -SshUser $SshUser `
  -KeyPath $KeyPath) | ConvertFrom-Json
$HostName = $sshIdentity.hostName
$SshUser = $sshIdentity.sshUser
$key = $sshIdentity.keyPath
```

Remove later duplicate `GetFullPath($KeyPath)` / `Resolve-RequiredFile $KeyPath` assignments. Preserve existing connection timeouts, retry logic and all non-SSH validation.

- [ ] **Step 4: Improve authentication failure messages**

Where a script currently throws only `SSH connection failed`, include the validated target and fingerprint without printing the private path contents:

```powershell
throw (
  "SSH connection to $target failed after validating key fingerprint " +
  "$($sshIdentity.actualFingerprint). Check server authorized_keys."
)
```

Retry wrappers retain their current attempt counts; only the terminal error gains identity context.

- [ ] **Step 5: Update deployment documentation**

Update `infra/deploy/README.md` to document:

```powershell
[Environment]::SetEnvironmentVariable(
  'ZYAPP_SSH_KEY_PATH',
  'E:\证书\codex.pem',
  'User'
)
ssh zyapp-server true
powershell -NoProfile -ExecutionPolicy Bypass `
  -File infra/scripts/deploy-production.ps1 `
  -BggTokenPath E:\path\to\bgg-token
```

State that explicit overrides remain supported but are fingerprint-checked, and that the repository contains only the public key.

- [ ] **Step 6: Run contract tests and verify GREEN**

Run:

```powershell
node --test infra/scripts/test-release-contract.mjs
```

Expected: all release-contract tests pass and all four wrong-key invocations fail locally with the fingerprint mismatch message.

- [ ] **Step 7: Run static PowerShell parsing checks**

Run a PowerShell parser loop over the resolver and four deployment scripts:

```powershell
$files = @(
  'infra/scripts/resolve-deployment-ssh-identity.ps1',
  'infra/scripts/deploy-production.ps1',
  'infra/scripts/deploy-test-release.ps1',
  'infra/scripts/deploy-miniapp-production.ps1',
  'infra/scripts/deploy-miniapp-production-test.ps1'
)
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $file),
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  if ($errors.Count -gt 0) { throw "$file has parser errors: $errors" }
}
```

Expected: exit code 0 with no parser errors.

- [ ] **Step 8: Commit Task 2**

```powershell
git add infra/scripts/deploy-production.ps1 infra/scripts/deploy-test-release.ps1 infra/scripts/deploy-miniapp-production.ps1 infra/scripts/deploy-miniapp-production-test.ps1 infra/deploy/README.md infra/scripts/test-release-contract.mjs
git commit -m "fix: guard deployment SSH credentials"
```

---

### Task 3: Install and Verify the Current Windows SSH Profile

**Files:**
- Modify outside Git: `C:\Users\泉\.ssh\config`
- Modify outside Git: Windows user environment variable `ZYAPP_SSH_KEY_PATH`
- Verify: `E:\证书\codex.pem`

**Interfaces:**
- Consumes: the validated private key and repository identity resolver.
- Produces: idempotent `zyapp-server` SSH alias plus user-level default private-key path.

- [ ] **Step 1: Preserve existing SSH configuration and install the alias**

Read `C:\Users\泉\.ssh\config` if it exists. Replace only an existing `Host zyapp-server` block; otherwise append this block while preserving every other line:

```sshconfig
Host zyapp-server
  HostName 124.220.69.209
  User ubuntu
  IdentityFile E:/证书/codex.pem
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking accept-new
```

Write UTF-8 without a byte-order mark and ensure the current Windows user retains read/write access.

- [ ] **Step 2: Set the user-level private-key path**

Run:

```powershell
[Environment]::SetEnvironmentVariable(
  'ZYAPP_SSH_KEY_PATH',
  'E:\证书\codex.pem',
  'User'
)
$env:ZYAPP_SSH_KEY_PATH = 'E:\证书\codex.pem'
```

- [ ] **Step 3: Verify the alias and resolver with the authorized key**

Run:

```powershell
ssh -o ConnectTimeout=8 zyapp-server true
powershell -NoProfile -ExecutionPolicy Bypass `
  -File infra/scripts/resolve-deployment-ssh-identity.ps1
```

Expected: SSH exits 0; resolver JSON reports `ubuntu`, `124.220.69.209`, and matching expected/actual fingerprint `SHA256:wiCYUxW2h/Y81rAWgN6uwYfq2IZ7HVuUdV67XhbdIS0`.

- [ ] **Step 4: Verify the old key is rejected locally**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File infra/scripts/resolve-deployment-ssh-identity.ps1 `
  -KeyPath C:\Users\泉\.ssh\id_rsa
```

Expected: non-zero exit with `Deployment SSH private key fingerprint mismatch`; no SSH connection is attempted.

- [ ] **Step 5: Run final repository verification**

Run:

```powershell
node --test infra/scripts/test-release-contract.mjs
git diff --check
git status --short
```

Expected: tests pass; no whitespace errors; only intended SSH files plus the pre-existing BGG/Mini Program changes appear.

- [ ] **Step 6: Inspect for private-key leakage**

Run searches for private-key headers and the local private-key filename across tracked source and generated deployment archives. Expected findings are zero private-key headers; `codex.pem` may appear only as a documented local path, never as file contents.

- [ ] **Step 7: Record final evidence**

Report the two implementation commits, resolver test count, alias SSH exit code, matching fingerprint and old-key local rejection. Do not deploy production services as part of this task.
