param(
  [ValidatePattern('^[a-zA-Z0-9.-]+$')]
  [string]$HostName,

  [string]$SshUser,

  [string]$KeyPath,

  [string]$RemoteDirectory = '/opt/zyapp',

  [Parameter(Mandatory = $true)]
  [string]$EnvironmentPath,

  [Parameter(Mandatory = $true)]
  [string]$ApiV3KeyPath,

  [Parameter(Mandatory = $true)]
  [string]$MerchantCertificatePath,

  [Parameter(Mandatory = $true)]
  [string]$MerchantPrivateKeyPath,

  [Parameter(Mandatory = $true)]
  [string]$WechatPayPublicKeyPath
)

$ErrorActionPreference = 'Stop'
$sshIdentity = (& (Join-Path $PSScriptRoot 'resolve-deployment-ssh-identity.ps1') `
  -HostName $HostName `
  -SshUser $SshUser `
  -KeyPath $KeyPath) | ConvertFrom-Json
$HostName = $sshIdentity.hostName
$SshUser = $sshIdentity.sshUser
$key = $sshIdentity.keyPath

function Resolve-RequiredFile(
  [string]$Path,
  [string]$Description
) {
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "$Description not found: $resolved"
  }
  return $resolved
}

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$environment = Resolve-RequiredFile $EnvironmentPath 'Deployment environment'
$apiV3Key = Resolve-RequiredFile $ApiV3KeyPath 'WeChat Pay APIv3 key file'
$merchantCertificate = Resolve-RequiredFile `
  $MerchantCertificatePath `
  'WeChat Pay merchant certificate'
$merchantPrivateKey = Resolve-RequiredFile `
  $MerchantPrivateKeyPath `
  'WeChat Pay merchant private key'
$wechatPayPublicKey = Resolve-RequiredFile `
  $WechatPayPublicKeyPath `
  'WeChat Pay public key'

if ($RemoteDirectory -notmatch '^/[a-zA-Z0-9._/-]+$') {
  throw 'RemoteDirectory must be an absolute safe Linux path.'
}

foreach ($command in @('ssh', 'scp', 'tar')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required but was not found."
  }
}

$apiV3Bytes = [IO.File]::ReadAllBytes($apiV3Key)
if (
  $apiV3Bytes.Length -gt 0 -and
  $apiV3Bytes[$apiV3Bytes.Length - 1] -eq 10
) {
  $apiV3Bytes = $apiV3Bytes[0..($apiV3Bytes.Length - 2)]
  if (
    $apiV3Bytes.Length -gt 0 -and
    $apiV3Bytes[$apiV3Bytes.Length - 1] -eq 13
  ) {
    $apiV3Bytes = $apiV3Bytes[0..($apiV3Bytes.Length - 2)]
  }
}
if ($apiV3Bytes.Length -ne 32) {
  throw 'The APIv3 key file must contain one 32-character line.'
}
foreach ($byte in $apiV3Bytes) {
  $isDigit = $byte -ge 48 -and $byte -le 57
  $isUpper = $byte -ge 65 -and $byte -le 90
  $isLower = $byte -ge 97 -and $byte -le 122
  if (-not ($isDigit -or $isUpper -or $isLower)) {
    throw 'The APIv3 key file must contain only ASCII letters and digits.'
  }
}
$apiV3Bytes = $null

$tempDirectory = Join-Path $workspace '.tmp\miniapp-production-test-deploy'
[IO.Directory]::CreateDirectory($tempDirectory) | Out-Null
$archive = Join-Path $tempDirectory 'zyapp-source.tgz'
$resolvedTemp = [IO.Path]::GetFullPath($tempDirectory)
$resolvedArchive = [IO.Path]::GetFullPath($archive)
if (-not $resolvedArchive.StartsWith(
  $resolvedTemp + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw 'Deployment archive resolved outside the temporary directory.'
}
if (Test-Path -LiteralPath $resolvedArchive) {
  Remove-Item -LiteralPath $resolvedArchive -Force
}

Push-Location $workspace
try {
  & tar -czf $resolvedArchive `
    --exclude=.git `
    --exclude=.worktrees `
    --exclude=node_modules `
    --exclude=.tmp `
    --exclude=outputs `
    --exclude=legacy-data `
    --exclude=infra/deploy/production.env `
    --exclude=infra/deploy/production.env.before-domain-20260725 `
    --exclude=secrets `
    --exclude='*证书*' `
    .
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the source archive.'
  }
} finally {
  Pop-Location
}

$target = "$SshUser@$HostName"
$sshOptions = @(
  '-i', $key,
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new'
)
$remoteTemporaryDirectory = '/tmp/zyapp-miniapp-payment'

& ssh @sshOptions $target `
  "rm -rf '$remoteTemporaryDirectory' && mkdir -p '$remoteTemporaryDirectory'"
if ($LASTEXITCODE -ne 0) {
  throw (
    "SSH connection to $target failed after validating key fingerprint " +
    "$($sshIdentity.actualFingerprint). Check server authorized_keys."
  )
}

$uploads = @(
  @{ Local = $resolvedArchive; Remote = 'source.tgz' },
  @{ Local = $environment; Remote = 'production.env' },
  @{ Local = $apiV3Key; Remote = 'apiv3.key' },
  @{ Local = $merchantCertificate; Remote = 'apiclient_cert.pem' },
  @{ Local = $merchantPrivateKey; Remote = 'apiclient_key.pem' },
  @{ Local = $wechatPayPublicKey; Remote = 'wechatpay_public_key.pem' }
)
try {
  foreach ($upload in $uploads) {
    & scp @sshOptions `
      $upload.Local `
      "${target}:$remoteTemporaryDirectory/$($upload.Remote)"
    if ($LASTEXITCODE -ne 0) {
      throw "Upload failed for $($upload.Remote)."
    }
  }

  $remoteScript = @"
set -euo pipefail
cleanup() {
  rm -rf '$remoteTemporaryDirectory'
}
trap cleanup EXIT

sudo mkdir -p '$RemoteDirectory'
sudo chmod 0755 '$RemoteDirectory'
sudo tar -xzf '$remoteTemporaryDirectory/source.tgz' -C '$RemoteDirectory'
sudo install -d -o root -g root -m 0700 '$RemoteDirectory/secrets/wechatpay'
sudo install -o root -g root -m 0600 '$remoteTemporaryDirectory/apiv3.key' '$RemoteDirectory/secrets/wechatpay/apiv3.key'
sudo install -o root -g root -m 0600 '$remoteTemporaryDirectory/apiclient_cert.pem' '$RemoteDirectory/secrets/wechatpay/apiclient_cert.pem'
sudo install -o root -g root -m 0600 '$remoteTemporaryDirectory/apiclient_key.pem' '$RemoteDirectory/secrets/wechatpay/apiclient_key.pem'
sudo install -o root -g root -m 0600 '$remoteTemporaryDirectory/wechatpay_public_key.pem' '$RemoteDirectory/secrets/wechatpay/wechatpay_public_key.pem'
sudo install -o root -g root -m 0600 '$remoteTemporaryDirectory/production.env' '$RemoteDirectory/infra/deploy/production.env'

if ! command -v docker >/dev/null 2>&1; then
  sudo bash '$RemoteDirectory/infra/deploy/bootstrap-ubuntu.sh'
fi

cd '$RemoteDirectory'
production_container_before=`$(sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml ps -q api)
caddy_container_before=`$(sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml ps -q caddy)
if [ -z "`$production_container_before" ] || [ -z "`$caddy_container_before" ]; then
  echo 'Production API and Caddy must already be running before a test-only deployment.' >&2
  exit 1
fi

sudo BACKUP_ENVIRONMENTS=test DEPLOY_DIR='$RemoteDirectory' bash infra/deploy/backup-postgres.sh
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml build --no-cache migrate-test api-test
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml run --rm --no-deps migrate-test
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml up -d --no-deps --force-recreate api-test

production_container_after=`$(sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml ps -q api)
caddy_container_after=`$(sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml ps -q caddy)
if [ "`$production_container_before" != "`$production_container_after" ]; then
  echo 'Test deployment changed the production API container; aborting verification.' >&2
  exit 1
fi
if [ "`$caddy_container_before" != "`$caddy_container_after" ]; then
  echo 'Test deployment changed the Caddy container; aborting verification.' >&2
  exit 1
fi

for attempt in `$(seq 1 36); do
  test_health=`$(curl --silent --output /dev/null --write-out '%{http_code}' 'https://judian.icu/test/v1/health/ready' || true)
  production_health=`$(curl --silent --output /dev/null --write-out '%{http_code}' 'https://judian.icu/v1/health/ready' || true)
  profile_status=`$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST 'https://judian.icu/test/v1/member/profile' || true)
  avatar_status=`$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST 'https://judian.icu/test/v1/member/profile-with-avatar' || true)
  if [ "`$test_health" = '200' ] &&
     [ "`$production_health" = '200' ] &&
     [ "`$profile_status" = '401' ] &&
     [ "`$avatar_status" = '401' ]; then
    echo 'Test API is healthy, profile routes exist, and production containers remained unchanged.'
    exit 0
  fi
  sleep 5
done

echo "Deployment verification failed (test_health=`$test_health, production_health=`$production_health, profile=`$profile_status, avatar=`$avatar_status)." >&2
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml logs --tail 120 api-test >&2
exit 1
"@

  $remoteScriptPath = Join-Path $tempDirectory 'deploy.sh'
  [IO.File]::WriteAllText(
    $remoteScriptPath,
    ($remoteScript -replace "`r", ''),
    [Text.UTF8Encoding]::new($false)
  )
  & scp @sshOptions `
    $remoteScriptPath `
    "${target}:$remoteTemporaryDirectory/deploy.sh"
  if ($LASTEXITCODE -ne 0) {
    throw 'Remote deployment script upload failed.'
  }
  & ssh @sshOptions $target `
    "sudo bash '$remoteTemporaryDirectory/deploy.sh'"
  if ($LASTEXITCODE -ne 0) {
    throw 'Remote miniapp production-test deployment failed.'
  }
} finally {
  & ssh @sshOptions $target "rm -rf '$remoteTemporaryDirectory'" 2>$null
}

Write-Output 'Miniapp production-test deployment completed.'
