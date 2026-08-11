param(
  [string]$HostName,

  [string]$SshUser,

  [string]$KeyPath,

  [string]$IdentityPath
)

$ErrorActionPreference = 'Stop'

function Resolve-RequiredFile(
  [string]$Path,
  [string]$Description
) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "$Description path is required."
  }
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "$Description not found: $resolved"
  }
  return $resolved
}

function Get-SshFingerprint(
  [string]$Path,
  [string]$Description
) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& ssh-keygen -lf $Path 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "$Description fingerprint could not be read: $($output -join ' ')"
  }
  $parts = @(([string]$output[0]) -split '\s+')
  if ($parts.Count -lt 2 -or $parts[1] -notmatch '^SHA256:[A-Za-z0-9+/]+$') {
    throw "$Description returned an invalid SHA-256 fingerprint."
  }
  return $parts[1]
}

function Assert-SshPrivateKey(
  [string]$Path
) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& ssh-keygen -y -f $Path 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $publicKey = ($output -join '').Trim()
  $parts = @($publicKey -split '\s+')
  if (
    $exitCode -ne 0 -or
    $parts.Count -lt 2 -or
    $parts[0] -notmatch '^(ssh-(rsa|ed25519)|ecdsa-sha2-[^ ]+)$' -or
    $parts[1] -notmatch '^[A-Za-z0-9+/=]+$'
  ) {
    throw 'Deployment SSH private key must be a readable private key.'
  }
}

if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
  throw 'ssh-keygen is required but was not found.'
}

if ([string]::IsNullOrWhiteSpace($IdentityPath)) {
  $IdentityPath = Join-Path $PSScriptRoot '..\deploy\ssh-identity.json'
}
$identityFile = Resolve-RequiredFile $IdentityPath 'Deployment SSH identity'
$identity = Get-Content -Raw -Encoding utf8 -LiteralPath $identityFile |
  ConvertFrom-Json

$resolvedHost = if ([string]::IsNullOrWhiteSpace($HostName)) {
  [string]$identity.hostName
} else {
  $HostName.Trim()
}
if ($resolvedHost -notmatch '^[a-zA-Z0-9.-]+$') {
  throw 'Deployment SSH host name is invalid.'
}

$resolvedUser = if ([string]::IsNullOrWhiteSpace($SshUser)) {
  [string]$identity.sshUser
} else {
  $SshUser.Trim()
}
if ($resolvedUser -notmatch '^[a-z_][a-zA-Z0-9_-]*$') {
  throw 'Deployment SSH user is invalid.'
}

$environmentName = [string]$identity.keyPathEnvironmentVariable
if ($environmentName -notmatch '^[A-Z][A-Z0-9_]*$') {
  throw 'Deployment SSH key-path environment variable name is invalid.'
}

$candidateKey = $KeyPath
if ([string]::IsNullOrWhiteSpace($candidateKey)) {
  $candidateKey = [Environment]::GetEnvironmentVariable($environmentName)
}
if ([string]::IsNullOrWhiteSpace($candidateKey)) {
  $candidateKey = [Environment]::GetEnvironmentVariable(
    $environmentName,
    'User'
  )
}
if ([string]::IsNullOrWhiteSpace($candidateKey)) {
  throw "Set $environmentName or pass -KeyPath."
}

$identityDirectory = Split-Path -Parent $identityFile
$configuredPublicKey = [string]$identity.publicKeyPath
$publicKeyCandidate = if ([IO.Path]::IsPathRooted($configuredPublicKey)) {
  $configuredPublicKey
} else {
  Join-Path $identityDirectory $configuredPublicKey
}
$publicKey = Resolve-RequiredFile $publicKeyCandidate 'Deployment SSH public key'
$privateKey = Resolve-RequiredFile $candidateKey 'Deployment SSH private key'
Assert-SshPrivateKey $privateKey
$expectedFingerprint = Get-SshFingerprint $publicKey 'Deployment SSH public key'
$actualFingerprint = Get-SshFingerprint $privateKey 'Deployment SSH private key'

if ($actualFingerprint -cne $expectedFingerprint) {
  throw (
    'Deployment SSH private key fingerprint mismatch. ' +
    "Expected $expectedFingerprint, got $actualFingerprint."
  )
}

[ordered]@{
  hostName = $resolvedHost
  sshUser = $resolvedUser
  keyPath = $privateKey
  expectedFingerprint = $expectedFingerprint
  actualFingerprint = $actualFingerprint
  sshOptions = @(
    '-i',
    $privateKey,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new'
  )
} | ConvertTo-Json -Compress
