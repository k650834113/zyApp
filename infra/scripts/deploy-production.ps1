param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9.-]+$')]
  [string]$HostName,

  [string]$SshUser = 'ubuntu',

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [string]$RemoteDirectory = '/opt/zyapp',

  [string]$EnvironmentPath,

  [string]$BggTokenPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) {
  $EnvironmentPath = Join-Path $PSScriptRoot '..\deploy\production.env'
}
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$key = [IO.Path]::GetFullPath($KeyPath)
$environment = [IO.Path]::GetFullPath($EnvironmentPath)

if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
  throw "SSH private key not found: $key"
}
if (-not (Test-Path -LiteralPath $environment -PathType Leaf)) {
  throw "Production environment not found: $environment"
}
$bggSettings = (& (Join-Path $PSScriptRoot 'resolve-bgg-deployment-settings.ps1') `
  -EnvironmentPath $environment `
  -BggTokenPath $BggTokenPath) | ConvertFrom-Json
if ($RemoteDirectory -notmatch '^/[a-zA-Z0-9._/-]+$') {
  throw 'RemoteDirectory must be an absolute Linux path containing only letters, digits, dot, underscore, slash or dash.'
}

$requiredCommands = @('ssh', 'scp', 'tar')
foreach ($command in $requiredCommands) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required but was not found."
  }
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

$tempDirectory = Join-Path $workspace '.tmp\production-deploy'
[IO.Directory]::CreateDirectory($tempDirectory) | Out-Null
$archive = Join-Path $tempDirectory 'zyapp-source.tgz'
& (Join-Path $PSScriptRoot 'create-deployment-source-archive.ps1') `
  -WorkspaceRoot $workspace `
  -ArchivePath $archive
if ($LASTEXITCODE -ne 0) { throw 'Failed to create deployment archive.' }

$target = "$SshUser@$HostName"
$sshOptions = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new')

& ssh @sshOptions $target "mkdir -p /tmp/zyapp-deploy/updates"
if ($LASTEXITCODE -ne 0) { throw 'SSH connection failed.' }

& scp @sshOptions $archive "${target}:/tmp/zyapp-deploy/zyapp-source.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Source upload failed.' }
& scp @sshOptions $environment "${target}:/tmp/zyapp-deploy/production.env"
if ($LASTEXITCODE -ne 0) { throw 'Environment upload failed.' }
if ($bggSettings.enabled) {
  & scp @sshOptions $bggSettings.tokenPath "${target}:/tmp/zyapp-deploy/bgg-xml-api-token"
  if ($LASTEXITCODE -ne 0) { throw 'BGG token upload failed.' }
}
foreach ($file in $updateFiles) {
  & scp @sshOptions $file "${target}:/tmp/zyapp-deploy/updates/"
  if ($LASTEXITCODE -ne 0) { throw "Update upload failed: $file" }
}

$bggSecretInstallScript = if ($bggSettings.enabled) {
@"
sudo mkdir -p '$RemoteDirectory/secrets/bgg'
sudo chmod 0700 '$RemoteDirectory/secrets/bgg'
sudo install -o root -g root -m 0600 /tmp/zyapp-deploy/bgg-xml-api-token '$RemoteDirectory/secrets/bgg/xml-api-token'
rm -f /tmp/zyapp-deploy/bgg-xml-api-token
"@
} else {
  ''
}

$remoteScript = @"
set -euo pipefail
sudo mkdir -p '$RemoteDirectory'
sudo chmod 0755 '$RemoteDirectory'
sudo tar -xzf /tmp/zyapp-deploy/zyapp-source.tgz -C '$RemoteDirectory'
sudo mkdir -p '$RemoteDirectory/infra/deploy/updates/production/windows'
sudo install -m 0600 /tmp/zyapp-deploy/production.env '$RemoteDirectory/infra/deploy/production.env'
$bggSecretInstallScript
if ! command -v docker >/dev/null 2>&1; then
  sudo bash '$RemoteDirectory/infra/deploy/bootstrap-ubuntu.sh'
fi
cd '$RemoteDirectory'
site=`$(sudo sed -n 's/^APP_DOMAIN=//p' infra/deploy/production.env | tr -d '\r')
case "`$site" in
  http://*|https://*) origin="`$site" ;;
  *) origin="https://`$site" ;;
esac
test_version_before=`$(curl --fail --silent "`$origin/test/v1/desktop-updates/windows/latest.yml" | sed -n 's/^version: //p' | head -1)
sudo BACKUP_ENVIRONMENTS=production DEPLOY_DIR='$RemoteDirectory' bash infra/deploy/backup-postgres.sh
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml build --no-cache migrate api worker
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml run --rm --no-deps migrate
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml up -d --no-deps --force-recreate api worker
for attempt in `$(seq 1 36); do
  if curl --fail --silent --show-error "`$origin/v1/health/ready" >/dev/null && \
     curl --fail --silent --show-error "`$origin/test/v1/health/ready" >/dev/null; then
    sudo cp -f /tmp/zyapp-deploy/updates/* '$RemoteDirectory/infra/deploy/updates/production/windows/'
    production_version=`$(curl --fail --silent "`$origin/v1/desktop-updates/windows/latest.yml" | sed -n 's/^version: //p' | head -1)
    test_version_after=`$(curl --fail --silent "`$origin/test/v1/desktop-updates/windows/latest.yml" | sed -n 's/^version: //p' | head -1)
    production_migration=`$(sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml exec -T postgres sh -lc 'psql -U "`$POSTGRES_USER" -d "`$POSTGRES_DB" -Atc "SELECT version FROM cloud_schema_migration ORDER BY version DESC LIMIT 1"')
    if [ "`$production_version" != '$($manifest.version)' ]; then
      echo "Unexpected production desktop version: `$production_version" >&2
      exit 1
    fi
    if [ "`$production_migration" != '$expectedMigrationVersion' ]; then
      echo "Unexpected production migration version: `$production_migration" >&2
      exit 1
    fi
    if [ "`$test_version_after" != "`$test_version_before" ]; then
      echo "Test desktop version changed unexpectedly: `$test_version_before -> `$test_version_after" >&2
      exit 1
    fi
    echo "Production release healthy: production=`$production_version migration=`$production_migration test=`$test_version_after"
    exit 0
  fi
  sleep 5
done
echo "Deployment started, but HTTPS health check did not pass within 3 minutes." >&2
sudo docker compose --env-file infra/deploy/production.env -f infra/deploy/compose.production.yml logs --tail 120 api worker >&2
exit 1
"@

$remoteScriptPath = Join-Path $tempDirectory 'deploy-production.sh'
[IO.File]::WriteAllText(
  $remoteScriptPath,
  ($remoteScript -replace "`r", ''),
  [Text.UTF8Encoding]::new($false)
)
& scp @sshOptions $remoteScriptPath "${target}:/tmp/zyapp-deploy/deploy-production.sh"
if ($LASTEXITCODE -ne 0) { throw 'Remote deployment script upload failed.' }
& ssh @sshOptions $target 'sudo bash /tmp/zyapp-deploy/deploy-production.sh'
if ($LASTEXITCODE -ne 0) { throw 'Remote deployment failed.' }

$site = (Get-Content -LiteralPath $environment | Where-Object { $_ -like 'APP_DOMAIN=*' }) -replace '^APP_DOMAIN=', ''
$origin = if ($site -match '^https?://') { $site } else { "https://$site" }
Write-Output "Deployment completed: $origin"
