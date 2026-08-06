param(
  [ValidatePattern('^[a-zA-Z0-9.-]+$')]
  [string]$HostName,

  [string]$SshUser,

  [string]$KeyPath,

  [string]$RemoteDirectory = '/opt/zyapp',

  [string]$EnvironmentPath,

  [string]$BggTokenPath
)

$ErrorActionPreference = 'Stop'
$sshIdentity = (& (Join-Path $PSScriptRoot 'resolve-deployment-ssh-identity.ps1') `
  -HostName $HostName `
  -SshUser $SshUser `
  -KeyPath $KeyPath) | ConvertFrom-Json
$HostName = $sshIdentity.hostName
$SshUser = $sshIdentity.sshUser
$key = $sshIdentity.keyPath
if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) {
  $EnvironmentPath = Join-Path $PSScriptRoot '..\deploy\production.env'
}
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$environment = [IO.Path]::GetFullPath($EnvironmentPath)
if (-not (Test-Path -LiteralPath $environment -PathType Leaf)) {
  throw "Deployment environment not found: $environment"
}
$bggSettings = (& (Join-Path $PSScriptRoot 'resolve-bgg-deployment-settings.ps1') `
  -EnvironmentPath $environment `
  -BggTokenPath $BggTokenPath) | ConvertFrom-Json
if ($RemoteDirectory -notmatch '^/[a-zA-Z0-9._/-]+$') {
  throw 'RemoteDirectory is invalid.'
}

$manifestPath = Join-Path $workspace 'apps\merchant-desktop\dist-installer\release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Desktop release manifest not found: $manifestPath"
}
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$updateDirectory = Split-Path -Parent $manifestPath
$expectedMigrationVersion = Get-ChildItem -LiteralPath (Join-Path $workspace 'packages\cloud-db\migrations') -File |
  Where-Object { $_.Name -match '^(\d{4})_[a-z0-9_]+\.sql$' } |
  ForEach-Object { [int]$Matches[1] } |
  Sort-Object -Descending |
  Select-Object -First 1
if (-not $expectedMigrationVersion) {
  throw 'No cloud database migrations were found.'
}
$updateFiles = @($manifest.files | ForEach-Object { Join-Path $updateDirectory $_.name })
$updateFiles += $manifestPath
if ($manifest.rollback -and $manifest.rollback.installer) {
  $updateFiles += Join-Path $updateDirectory $manifest.rollback.installer
}
foreach ($file in $updateFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "Desktop update file not found: $file"
  }
}

$tempDirectory = Join-Path $workspace '.tmp\test-release-deploy'
[IO.Directory]::CreateDirectory($tempDirectory) | Out-Null
$archive = Join-Path $tempDirectory 'zyapp-source.tgz'
& (Join-Path $PSScriptRoot 'create-deployment-source-archive.ps1') `
  -WorkspaceRoot $workspace `
  -ArchivePath $archive
if ($LASTEXITCODE -ne 0) { throw 'Failed to create deployment archive.' }

$target = "$SshUser@$HostName"
$sshOptions = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new')
& ssh @sshOptions $target 'mkdir -p /tmp/zyapp-test-release/updates'
if ($LASTEXITCODE -ne 0) {
  throw (
    "SSH connection to $target failed after validating key fingerprint " +
    "$($sshIdentity.actualFingerprint). Check server authorized_keys."
  )
}
& scp @sshOptions $archive "${target}:/tmp/zyapp-test-release/zyapp-source.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Source upload failed.' }
& scp @sshOptions $environment "${target}:/tmp/zyapp-test-release/production.env"
if ($LASTEXITCODE -ne 0) { throw 'Environment upload failed.' }
if ($bggSettings.enabled) {
  & scp @sshOptions $bggSettings.tokenPath "${target}:/tmp/zyapp-test-release/bgg-xml-api-token"
  if ($LASTEXITCODE -ne 0) { throw 'BGG token upload failed.' }
}
foreach ($file in $updateFiles) {
  & scp @sshOptions $file "${target}:/tmp/zyapp-test-release/updates/"
  if ($LASTEXITCODE -ne 0) { throw "Update upload failed: $file" }
}

$bggSecretInstallScript = if ($bggSettings.enabled) {
@"
sudo mkdir -p '$RemoteDirectory/secrets/bgg'
sudo chmod 0700 '$RemoteDirectory/secrets/bgg'
sudo install -o root -g root -m 0600 /tmp/zyapp-test-release/bgg-xml-api-token '$RemoteDirectory/secrets/bgg/xml-api-token'
rm -f /tmp/zyapp-test-release/bgg-xml-api-token
"@
} else {
  ''
}

$remoteScript = @"
set -euo pipefail
sudo mkdir -p '$RemoteDirectory'
sudo tar -xzf /tmp/zyapp-test-release/zyapp-source.tgz -C '$RemoteDirectory'
sudo install -m 0600 /tmp/zyapp-test-release/production.env '$RemoteDirectory/infra/deploy/production.env'
$bggSecretInstallScript
sudo mkdir -p '$RemoteDirectory/infra/deploy/updates/test/windows'
sudo cp -f /tmp/zyapp-test-release/updates/* '$RemoteDirectory/infra/deploy/updates/test/windows/'
cd '$RemoteDirectory'
sudo BACKUP_ENVIRONMENTS=test DEPLOY_DIR='$RemoteDirectory' bash infra/deploy/backup-postgres.sh
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml build --no-cache migrate-test api-test worker-test
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml run --rm --no-deps migrate-test
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml up -d --no-deps --force-recreate api-test worker-test
site=`$(sudo sed -n 's/^APP_DOMAIN=//p' infra/deploy/production.env | tr -d '\r')
case "`$site" in
  http://*|https://*) origin="`$site" ;;
  *) origin="https://`$site" ;;
esac
for attempt in `$(seq 1 36); do
  if curl --fail --silent --show-error "`$origin/v1/health/ready" >/dev/null && \
     curl --fail --silent --show-error "`$origin/test/v1/health/ready" >/dev/null; then
    test_version=`$(curl --fail --silent "`$origin/test/v1/desktop-updates/windows/latest.yml" | sed -n 's/^version: //p' | head -1)
    production_version=`$(curl --fail --silent "`$origin/v1/desktop-updates/windows/latest.yml" | sed -n 's/^version: //p' | head -1)
    test_migration=`$(sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml exec -T postgres sh -lc 'psql -U "`$POSTGRES_USER" -d "`$TEST_POSTGRES_DB" -Atc "SELECT version FROM cloud_schema_migration ORDER BY version DESC LIMIT 1"')
    if [ "`$test_version" != '$($manifest.version)' ]; then
      echo "Unexpected test desktop version: `$test_version" >&2
      exit 1
    fi
    if [ "`$test_migration" != '$expectedMigrationVersion' ]; then
      echo "Unexpected test migration version: `$test_migration" >&2
      exit 1
    fi
    echo "Test release healthy: test=`$test_version migration=`$test_migration production=`$production_version"
    exit 0
  fi
  sleep 5
done
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml logs --tail 120 api-test worker-test >&2
exit 1
"@
$remoteScriptPath = Join-Path $tempDirectory 'deploy-test-release.sh'
[IO.File]::WriteAllText(
  $remoteScriptPath,
  ($remoteScript -replace "`r", ''),
  [Text.UTF8Encoding]::new($false)
)
& scp @sshOptions $remoteScriptPath "${target}:/tmp/zyapp-test-release/deploy-test-release.sh"
if ($LASTEXITCODE -ne 0) { throw 'Remote deployment script upload failed.' }
& ssh @sshOptions $target 'sudo bash /tmp/zyapp-test-release/deploy-test-release.sh'
if ($LASTEXITCODE -ne 0) { throw 'Test release deployment failed.' }
Write-Output "Test release deployed to https://$HostName/test"
