param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9.-]+$')]
  [string]$HostName,

  [string]$SshUser = 'ubuntu',

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ExpectedCommit,

  [string]$RemoteDirectory = '/opt/zyapp',

  [switch]$ValidateOnly,

  [switch]$PreflightOnly,

  [switch]$EnableProductionPayment
)

$ErrorActionPreference = 'Stop'

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

function Invoke-RetryableNativeCommand(
  [scriptblock]$Action,
  [string]$Description,
  [int]$MaximumAttempts = 4
) {
  for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt += 1) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $Action
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -eq 0) {
      return
    }
    if ($attempt -eq $MaximumAttempts) {
      throw "$Description failed after $MaximumAttempts attempts."
    }
    $delaySeconds = 5 * $attempt
    Write-Warning (
      "$Description failed with exit code $exitCode; retrying in " +
      "$delaySeconds seconds (attempt $attempt of $MaximumAttempts)."
    )
    Start-Sleep -Seconds $delaySeconds
  }
}

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$key = Resolve-RequiredFile $KeyPath 'SSH private key'
$candidateCommit = (& git -C $workspace rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $candidateCommit -cne $ExpectedCommit) {
  throw "Expected candidate commit $ExpectedCommit, got $candidateCommit."
}
$trackedChanges = @(
  & git -C $workspace status --porcelain --untracked-files=no
)
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to inspect the candidate worktree.'
}
if ($trackedChanges.Count -gt 0) {
  throw 'Tracked files must be clean before a production deployment.'
}
$candidateVersion = (
  Get-Content -Raw -Encoding utf8 (Join-Path $workspace 'package.json') |
    ConvertFrom-Json
).version
if ($candidateVersion -cne '0.23.2') {
  throw "Expected candidate version 0.23.2, got $candidateVersion."
}

if ($RemoteDirectory -notmatch '^/[a-zA-Z0-9._/-]+$') {
  throw 'RemoteDirectory must be an absolute safe Linux path.'
}

foreach ($command in @('git', 'ssh', 'scp')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required but was not found."
  }
}

$tempDirectory = [IO.Path]::GetFullPath(
  (Join-Path $workspace '.tmp\miniapp-production-deploy')
)
[IO.Directory]::CreateDirectory($tempDirectory) | Out-Null
$archive = [IO.Path]::GetFullPath(
  (Join-Path $tempDirectory 'zyapp-source.tgz')
)
if (
  -not $archive.StartsWith(
    $tempDirectory + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )
) {
  throw 'Deployment archive resolved outside the temporary directory.'
}

if ($ValidateOnly) {
  Write-Output 'Production miniapp deployment inputs are valid.'
  return
}

$expectedMigrationVersion = Get-ChildItem -LiteralPath (
  Join-Path $workspace 'packages\cloud-db\migrations'
) -File |
  Where-Object { $_.Name -match '^(\d{4})_[a-z0-9_]+\.sql$' } |
  ForEach-Object { [int]$Matches[1] } |
  Sort-Object -Descending |
  Select-Object -First 1
if (-not $expectedMigrationVersion) {
  throw 'No cloud database migrations were found.'
}

$target = "$SshUser@$HostName"
$sshOptions = @(
  '-i', $key,
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=12'
)

$preflightScript = @'
set -euo pipefail
deploy_dir="$1"
enable_payment="$2"
expected_migration="$3"
expected_formal_store_id='7755df34-4309-43ed-8800-c0dc2049bb17'
expected_production_database_identity='postgres:5432/zyapp'
expected_test_database_identity='postgres:5432/zyapp_test'
compose_file="$deploy_dir/infra/deploy/compose.production.yml"
env_file="$deploy_dir/infra/deploy/production.env"
secret_dir="$deploy_dir/secrets/wechatpay"

test -f "$env_file"
test "$(sudo stat -c %a "$env_file")" = "600"
for name in WECHAT_PAY_MERCHANT_ID \
  WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL \
  WECHAT_PAY_PUBLIC_KEY_ID \
  WECHAT_MINIAPP_APP_ID \
  WECHAT_MINIAPP_APP_SECRET; do
  sudo grep -Eq "^${name}=.+$" "$env_file"
done
for name in apiclient_key.pem wechatpay_public_key.pem apiv3.key; do
  sudo test -s "$secret_dir/$name"
done
if sudo grep -Eq '^PRODUCTION_WECHAT_PAYMENT_MODE=wechat$' "$env_file"; then
  payment_change='not-required'
elif [ "$enable_payment" = 'true' ]; then
  payment_change='required'
else
  echo 'Production WeChat payment is disabled; pass -EnableProductionPayment for a formal go-live.' >&2
  exit 1
fi
if sudo grep -Eq '^MINIAPP_WECHAT_AUTH_MODE=wechat$' "$env_file"; then
  auth_change='not-required'
elif [ "$enable_payment" = 'true' ]; then
  auth_change='required'
else
  echo 'Production WeChat authentication is disabled; pass -EnableProductionPayment for a formal go-live.' >&2
  exit 1
fi

curl --fail --silent --show-error \
  "https://judian.icu/v1/health/ready" >/dev/null
curl --fail --silent --show-error \
  "https://judian.icu/test/v1/health/ready" >/dev/null

cd "$deploy_dir"
database_identity() {
  service="$1"
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T "$service" node -e '
      const value = process.env.DATABASE_URL
      const url = value ? new URL(value) : null
      const name = url ? decodeURIComponent(url.pathname.slice(1)) : ""
      if (!url || !url.hostname || !name) process.exit(1)
      console.log(`${url.hostname.toLowerCase()}:${url.port || "5432"}/${name}`)
    '
}
migrate_database_identity="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    run --rm --no-deps migrate node -e '
      const value = process.env.DATABASE_URL
      const url = value ? new URL(value) : null
      const name = url ? decodeURIComponent(url.pathname.slice(1)) : ""
      if (!url || !url.hostname || !name) process.exit(1)
      console.log(`${url.hostname.toLowerCase()}:${url.port || "5432"}/${name}`)
    '
)"
production_database_identity="$(database_identity api)"
test_database_identity="$(database_identity api-test)"
production_database="${production_database_identity##*/}"
test_database="${test_database_identity##*/}"
if [ "$production_database_identity" != "$expected_production_database_identity" ]; then
  echo "Unexpected production database identity: $production_database_identity" >&2
  exit 1
fi
if [ "$test_database_identity" != "$expected_test_database_identity" ]; then
  echo "Unexpected test database identity: $test_database_identity" >&2
  exit 1
fi
if [ "$production_database" = "$test_database" ]; then
  echo 'Production and test APIs must use different databases.' >&2
  exit 1
fi
if [ "$migrate_database_identity" != "$production_database_identity" ]; then
  echo 'The migration service must target the same database as the production API.' >&2
  exit 1
fi
production_migration="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T postgres sh -lc \
    "psql -U \"\$POSTGRES_USER\" -d '$production_database' -Atc 'SELECT version FROM cloud_schema_migration ORDER BY version DESC LIMIT 1'"
)"
if [ "$production_migration" != "$expected_migration" ]; then
  echo "Expected production migration $expected_migration before deployment; found $production_migration." >&2
  exit 1
fi
store_sql="SELECT tenant_id::text || '|' || id::text || '|' || name || '|' || status FROM store ORDER BY id"
stores="$(
  printf '%s\n' "$store_sql" |
    sudo docker compose --env-file "$env_file" -f "$compose_file" \
      exec -T postgres sh -lc \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
)"
active_stores="$(
  printf '%s\n' "$stores" | awk -F'|' '$4 == "active"'
)"
store_count="$(
  printf '%s\n' "$active_stores" | sed '/^$/d' | wc -l | tr -d ' '
)"
if [ "$store_count" != "1" ]; then
  echo "Expected exactly one active formal store; found $store_count." >&2
  exit 1
fi
formal_store="$(printf '%s\n' "$active_stores" | head -1)"
formal_store_id="$(printf '%s\n' "$formal_store" | cut -d'|' -f2)"
if [ "$formal_store_id" != "$expected_formal_store_id" ]; then
  echo "Expected formal store $expected_formal_store_id; found $formal_store_id." >&2
  exit 1
fi

template_sql="SELECT (tier->>'principalFen') || '|' || (tier->>'giftFen') FROM cloud_merchant_business_template template LEFT JOIN cloud_store_business_template_override override ON override.tenant_id = template.tenant_id AND override.store_id = '${formal_store_id}'::uuid AND override.template_id = template.id AND override.active = TRUE CROSS JOIN LATERAL jsonb_array_elements(COALESCE(override.payload_json, template.payload_json)->'tiers') tier WHERE template.tenant_id = (SELECT tenant_id FROM store WHERE id = '${formal_store_id}'::uuid) AND template.template_type = 'recharge_gift_tier' AND template.active = TRUE ORDER BY (tier->>'principalFen')::bigint"
gift_tiers="$(
  printf '%s\n' "$template_sql" |
    sudo docker compose --env-file "$env_file" -f "$compose_file" \
      exec -T postgres sh -lc \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
)"
if [ -z "$gift_tiers" ]; then
  projected_sql="SELECT principal_fen::text || '|' || gift_fen::text FROM cloud_recharge_gift_tier WHERE store_id = '${formal_store_id}'::uuid AND active = TRUE ORDER BY principal_fen"
  gift_tiers="$(
    printf '%s\n' "$projected_sql" |
      sudo docker compose --env-file "$env_file" -f "$compose_file" \
        exec -T postgres sh -lc \
        'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
  )"
fi
if [ -z "$gift_tiers" ]; then
  echo "The formal store has no active recharge gift rules." >&2
  exit 1
fi
if ! printf '%s\n' "$gift_tiers" |
  awk -F'|' 'NF != 2 || $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ { exit 1 }'
then
  echo "The formal recharge gift rules are invalid." >&2
  exit 1
fi

echo "FORMAL_STORE=$formal_store"
printf '%s\n' "$gift_tiers" | sed 's/^/GIFT_TIER=/'
echo "PRODUCTION_PAYMENT_CHANGE=$payment_change"
echo "PRODUCTION_AUTH_CHANGE=$auth_change"
echo "PRODUCTION_DATABASE=$production_database"
echo "TEST_DATABASE=$test_database"
echo "PRODUCTION_DATABASE_IDENTITY=$production_database_identity"
echo "TEST_DATABASE_IDENTITY=$test_database_identity"
echo "MIGRATE_DATABASE_IDENTITY=$migrate_database_identity"
echo "PRODUCTION_MIGRATION=$production_migration"
'@

$preflightScriptPath = Join-Path $tempDirectory 'preflight.sh'
[IO.File]::WriteAllText(
  $preflightScriptPath,
  ($preflightScript -replace "`r", ''),
  [Text.UTF8Encoding]::new($false)
)
$remotePreflightPath = '/tmp/zyapp-miniapp-production-preflight.sh'
try {
  $enablePaymentArgument = if ($EnableProductionPayment) {
    'true'
  } else {
    'false'
  }
  Invoke-RetryableNativeCommand `
    -Description 'Production miniapp preflight upload' `
    -Action {
      & scp @sshOptions `
        $preflightScriptPath `
        "${target}:$remotePreflightPath"
    }
  $preflightOutput = @(
    Invoke-RetryableNativeCommand `
      -Description 'Production miniapp preflight' `
      -Action {
        & ssh @sshOptions $target `
          "bash -n '$remotePreflightPath' && bash '$remotePreflightPath' '$RemoteDirectory' '$enablePaymentArgument' '$expectedMigrationVersion'"
      }
  )
  $preflightOutput | Write-Output
} finally {
  try {
    Invoke-RetryableNativeCommand `
      -Description 'Production miniapp preflight cleanup' `
      -MaximumAttempts 2 `
      -Action {
        & ssh @sshOptions $target "rm -f '$remotePreflightPath'" 2>$null
      }
  } catch {
    Write-Warning $_
  }
}
if ($PreflightOnly) {
  Write-Output 'Production miniapp remote preflight passed.'
  return
}

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

Push-Location $workspace
try {
  & git archive `
    --format=tar.gz `
    "--output=$archive" `
    $ExpectedCommit
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the immutable source archive.'
  }
} finally {
  Pop-Location
}

$remoteTemporaryDirectory = '/tmp/zyapp-miniapp-production'
Invoke-RetryableNativeCommand `
  -Description 'Remote deployment directory creation' `
  -Action {
    & ssh @sshOptions $target `
      "rm -rf '$remoteTemporaryDirectory' && mkdir -p '$remoteTemporaryDirectory'"
  }

try {
  Invoke-RetryableNativeCommand `
    -Description 'Production source upload' `
    -Action {
      & scp @sshOptions `
        $archive `
        "${target}:$remoteTemporaryDirectory/source.tgz"
    }

  $remoteScriptTemplate = @'
set -euo pipefail
remote_temp="/tmp/zyapp-miniapp-production"
deploy_dir="__REMOTE_DIRECTORY__"
expected_migration="__EXPECTED_MIGRATION__"
enable_payment="__ENABLE_PRODUCTION_PAYMENT__"
candidate_commit="__CANDIDATE_COMMIT__"
expected_production_database_identity='postgres:5432/zyapp'
expected_test_database_identity='postgres:5432/zyapp_test'
compose_file="$deploy_dir/infra/deploy/compose.production.yml"
env_file="$deploy_dir/infra/deploy/production.env"
candidate_dir="$remote_temp/candidate"
candidate_compose_file="$candidate_dir/infra/deploy/compose.production.yml"
environment_backup=''
previous_api_image=''
previous_api_image_name=''
rollback_api_tag=''

cleanup() {
  status="$?"
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ] &&
    [ -n "$environment_backup" ] &&
    [ -n "$previous_api_image" ] &&
    [ -n "$rollback_api_tag" ] &&
    sudo test -s "$environment_backup"
  then
    echo 'Deployment failed; restoring the previous production environment and API image.' >&2
    sudo cp --preserve=mode,ownership,timestamps \
      "$environment_backup" "$env_file"
    sudo chmod 0600 "$env_file"
    sudo docker image tag "$rollback_api_tag" "$previous_api_image_name"
    sudo docker compose --env-file "$env_file" -f "$compose_file" \
      up -d --no-deps --force-recreate api caddy
    rollback_health=''
    for rollback_attempt in $(seq 1 36); do
      rollback_health="$(
        curl --silent --output /dev/null --write-out '%{http_code}' \
          'https://judian.icu/v1/health/ready' || true
      )"
      if [ "$rollback_health" = '200' ]; then
        echo 'Previous production environment and API image restored.' >&2
        break
      fi
      sleep 5
    done
    if [ "$rollback_health" != '200' ]; then
      echo 'Automatic API rollback did not become healthy; manual recovery is required.' >&2
      sudo docker compose --env-file "$env_file" -f "$compose_file" \
        logs --tail 120 api caddy >&2
    fi
  fi
  rm -rf "$remote_temp"
  exit "$status"
}
trap cleanup EXIT

cd "$deploy_dir"
database_identity() {
  service="$1"
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T "$service" node -e '
      const value = process.env.DATABASE_URL
      const url = value ? new URL(value) : null
      const name = url ? decodeURIComponent(url.pathname.slice(1)) : ""
      if (!url || !url.hostname || !name) process.exit(1)
      console.log(`${url.hostname.toLowerCase()}:${url.port || "5432"}/${name}`)
    '
}
database_migration() {
  database="$1"
  case "$database" in
    *[!a-zA-Z0-9_]*|'')
      echo "Unsafe database name: $database" >&2
      exit 1
      ;;
  esac
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T postgres sh -lc \
    "psql -U \"\$POSTGRES_USER\" -d '$database' -Atc 'SELECT version FROM cloud_schema_migration ORDER BY version DESC LIMIT 1'"
}

api_container_before="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" ps -q api
)"
test_api_container_before="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" ps -q api-test
)"
test -n "$api_container_before"
test -n "$test_api_container_before"
previous_api_image="$(
  sudo docker inspect --format '{{.Image}}' "$api_container_before"
)"
previous_api_image_name="$(
  sudo docker inspect --format '{{.Config.Image}}' "$api_container_before"
)"
test -n "$previous_api_image"
test -n "$previous_api_image_name"
rollback_api_tag="zyapp-cloud-api:rollback-${candidate_commit}"
sudo docker image tag "$previous_api_image" "$rollback_api_tag"
production_database_identity_before="$(database_identity api)"
test_database_identity_before="$(database_identity api-test)"
production_database_before="${production_database_identity_before##*/}"
test_database_before="${test_database_identity_before##*/}"
test "$production_database_identity_before" = "$expected_production_database_identity"
test "$test_database_identity_before" = "$expected_test_database_identity"
test "$production_database_identity_before" != "$test_database_identity_before"
test_migration_before="$(database_migration "$test_database_before")"
production_migration_before="$(database_migration "$production_database_before")"
test "$production_migration_before" = "$expected_migration"
test_payment_test_amount_before="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T api-test sh -lc \
    'printf "%s" "${WECHAT_PAYMENT_TEST_AMOUNT_FEN:-}"'
)"
test_auth_mode_before="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T api-test sh -lc \
    'printf "%s" "${MINIAPP_WECHAT_AUTH_MODE:-}"'
)"

sudo BACKUP_ENVIRONMENTS=production DEPLOY_DIR="$deploy_dir" \
  bash infra/deploy/backup-postgres.sh
backup_file="$(
  sudo find "$deploy_dir/infra/deploy/backups" \
    -maxdepth 1 -type f -name 'zyapp-production-*.dump' \
    -printf '%T@|%p\n' |
    sort -nr | head -1 | cut -d'|' -f2-
)"
test -n "$backup_file"
sudo test -s "$backup_file"
sudo test -s "$backup_file.sha256"
sudo sh -lc "cd '$(dirname "$backup_file")' && sha256sum -c '$(basename "$backup_file").sha256'"

mkdir -p "$candidate_dir"
tar -xzf "$remote_temp/source.tgz" -C "$candidate_dir"
test -f "$candidate_compose_file"

cd "$candidate_dir"
sudo docker compose --env-file "$env_file" \
  -f "$candidate_compose_file" build --no-cache migrate api
migrate_database_identity="$(
  sudo docker compose --env-file "$env_file" \
    -f "$candidate_compose_file" run --rm --no-deps migrate \
    node -e '
      const value = process.env.DATABASE_URL
      const url = value ? new URL(value) : null
      const name = url ? decodeURIComponent(url.pathname.slice(1)) : ""
      if (!url || !url.hostname || !name) process.exit(1)
      console.log(`${url.hostname.toLowerCase()}:${url.port || "5432"}/${name}`)
    '
)"
test "$migrate_database_identity" = "$production_database_identity_before"
sudo docker compose --env-file "$env_file" \
  -f "$candidate_compose_file" run --rm --no-deps migrate

environment_backup_directory='/var/backups/zyapp-config'
sudo install -d -o root -g root -m 0700 "$environment_backup_directory"
environment_backup="$environment_backup_directory/production.env.before-miniapp-go-live-$(date -u +%Y%m%dT%H%M%SZ)"
sudo cp --preserve=mode,ownership,timestamps "$env_file" "$environment_backup"
sudo chmod 0600 "$environment_backup"

if [ "$enable_payment" = 'true' ]; then
  if sudo grep -Eq '^PRODUCTION_WECHAT_PAYMENT_MODE=' "$env_file"; then
    sudo sed -i \
      's/^PRODUCTION_WECHAT_PAYMENT_MODE=.*/PRODUCTION_WECHAT_PAYMENT_MODE=wechat/' \
      "$env_file"
  else
    printf '%s\n' 'PRODUCTION_WECHAT_PAYMENT_MODE=wechat' |
      sudo tee -a "$env_file" >/dev/null
  fi
  if sudo grep -Eq '^MINIAPP_WECHAT_AUTH_MODE=' "$env_file"; then
    sudo sed -i \
      's/^MINIAPP_WECHAT_AUTH_MODE=.*/MINIAPP_WECHAT_AUTH_MODE=wechat/' \
      "$env_file"
  else
    printf '%s\n' 'MINIAPP_WECHAT_AUTH_MODE=wechat' |
      sudo tee -a "$env_file" >/dev/null
  fi
fi
sudo grep -Eq '^PRODUCTION_WECHAT_PAYMENT_MODE=wechat$' "$env_file"
sudo grep -Eq '^MINIAPP_WECHAT_AUTH_MODE=wechat$' "$env_file"

sudo tar -xzf "$remote_temp/source.tgz" -C "$deploy_dir"
cd "$deploy_dir"
sudo docker compose --env-file "$env_file" -f "$compose_file" \
  up -d --no-build --no-deps --force-recreate api caddy

for attempt in $(seq 1 36); do
  production_health="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      'https://judian.icu/v1/health/ready' || true
  )"
  test_health="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      'https://judian.icu/test/v1/health/ready' || true
  )"
  profile_status="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      --request POST 'https://judian.icu/v1/member/profile' || true
  )"
  avatar_status="$(
    curl --silent --output /dev/null --write-out '%{http_code}' \
      --request POST 'https://judian.icu/v1/member/profile-with-avatar' || true
  )"
  if [ "$production_health" = '200' ] &&
    [ "$test_health" = '200' ] &&
    [ "$profile_status" = '401' ] &&
    [ "$avatar_status" = '401' ]
  then
    break
  fi
  if [ "$attempt" = "36" ]; then
    echo "Formal verification failed (production_health=$production_health, test_health=$test_health, profile=$profile_status, avatar=$avatar_status)." >&2
    sudo docker compose --env-file infra/deploy/production.env \
      -f infra/deploy/compose.production.yml logs --tail 120 api caddy >&2
    exit 1
  fi
  sleep 5
done

production_migration="$(
  sudo docker compose --env-file infra/deploy/production.env \
    -f infra/deploy/compose.production.yml exec -T postgres sh -lc \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version FROM cloud_schema_migration ORDER BY version DESC LIMIT 1"'
)"
test "$production_migration" = "$expected_migration"

test_api_container_after="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" ps -q api-test
)"
production_database_identity_after="$(database_identity api)"
test_database_identity_after="$(database_identity api-test)"
production_database_after="${production_database_identity_after##*/}"
test_database_after="${test_database_identity_after##*/}"
test_migration_after="$(database_migration "$test_database_after")"
test_payment_test_amount_after="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T api-test sh -lc \
    'printf "%s" "${WECHAT_PAYMENT_TEST_AMOUNT_FEN:-}"'
)"
test_auth_mode_after="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T api-test sh -lc \
    'printf "%s" "${MINIAPP_WECHAT_AUTH_MODE:-}"'
)"
if [ "$test_api_container_after" != "$test_api_container_before" ]; then
  echo 'Test API container changed during the production deployment.' >&2
  exit 1
fi
if [ "$production_database_identity_after" != "$production_database_identity_before" ]; then
  echo 'Production database identity changed during the deployment.' >&2
  exit 1
fi
if [ "$test_database_identity_after" != "$test_database_identity_before" ]; then
  echo 'Test database identity changed during the production deployment.' >&2
  exit 1
fi
if [ "$test_migration_after" != "$test_migration_before" ]; then
  echo 'Test database migration changed during the production deployment.' >&2
  exit 1
fi
if [ "$test_payment_test_amount_after" != "$test_payment_test_amount_before" ]; then
  echo 'Test payment amount configuration changed during the production deployment.' >&2
  exit 1
fi
if [ "$test_auth_mode_after" != "$test_auth_mode_before" ]; then
  echo 'Test WeChat authentication mode changed during the production deployment.' >&2
  exit 1
fi
echo 'DATABASE_AND_TEST_ISOLATION=verified'

sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml exec -T api sh -lc '
    test "$DEPLOYMENT_ENVIRONMENT" = production ||
      { echo "Unexpected production deployment environment." >&2; exit 1; }
    test "$MINIAPP_WECHAT_AUTH_MODE" = wechat ||
      { echo "Production WeChat authentication mode is not enabled." >&2; exit 1; }
    test "$WECHAT_PAYMENT_MODE" = wechat ||
      { echo "Production WeChat payment mode is not enabled." >&2; exit 1; }
    test "$WECHAT_PAY_NOTIFY_URL" = https://judian.icu/v1/payments/wechat/recharge/notify ||
      { echo "Unexpected production payment callback." >&2; exit 1; }
    test "$WECHAT_PAY_OUT_TRADE_NO_PREFIX" = ZYP- ||
      { echo "Unexpected production payment order prefix." >&2; exit 1; }
    test -z "${WECHAT_PAYMENT_TEST_AMOUNT_FEN:-}" ||
      { echo "Production payment test amount must be empty." >&2; exit 1; }
  '
echo 'PRODUCTION_PAYMENT_ENVIRONMENT=verified'
echo 'PRODUCTION_AUTHENTICATION_ENVIRONMENT=verified'
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml exec -T api-test sh -lc '
    test "$DEPLOYMENT_ENVIRONMENT" = test ||
      { echo "Unexpected test deployment environment." >&2; exit 1; }
    test "$MINIAPP_WECHAT_AUTH_MODE" = wechat ||
      { echo "Test WeChat authentication mode changed." >&2; exit 1; }
    test "$WECHAT_PAYMENT_MODE" = wechat ||
      { echo "Test WeChat payment mode changed." >&2; exit 1; }
    test "$WECHAT_PAY_NOTIFY_URL" = https://judian.icu/test/v1/payments/wechat/recharge/notify ||
      { echo "Unexpected test payment callback." >&2; exit 1; }
    test "$WECHAT_PAY_OUT_TRADE_NO_PREFIX" = ZYT- ||
      { echo "Unexpected test payment order prefix." >&2; exit 1; }
  '
echo 'TEST_PAYMENT_ENVIRONMENT=verified'
echo 'TEST_PAYMENT_TEST_AMOUNT=unchanged'
echo 'TEST_AUTH_MODE=unchanged'

backup_size="$(sudo stat -c %s "$backup_file")"
echo "PRODUCTION_BACKUP=$(basename "$backup_file")"
echo "PRODUCTION_BACKUP_BYTES=$backup_size"
echo "PRODUCTION_BACKUP_SHA256=verified"
echo "PRODUCTION_ENVIRONMENT_BACKUP=$(basename "$environment_backup")"
echo "CANDIDATE_COMMIT=$candidate_commit"
echo "PRODUCTION_MIGRATION=$production_migration"
echo "PRODUCTION_DATABASE=$production_database_after"
echo "TEST_DATABASE=$test_database_after"
echo "PRODUCTION_DATABASE_IDENTITY=$production_database_identity_after"
echo "TEST_DATABASE_IDENTITY=$test_database_identity_after"
echo "MIGRATE_DATABASE_IDENTITY=$migrate_database_identity"
echo "TEST_MIGRATION=$test_migration_after"
echo 'TEST_API_CONTAINER=unchanged'
echo "PROFILE_ROUTE=$profile_status"
echo "AVATAR_ROUTE=$avatar_status"
echo 'PRODUCTION_PAYMENT_MODE=wechat'
echo 'PRODUCTION_AUTH_MODE=wechat'
echo 'PRODUCTION_API=healthy'
echo 'TEST_API=healthy'
sudo docker image rm "$rollback_api_tag" >/dev/null 2>&1 || true
'@
  $remoteScript = $remoteScriptTemplate.
    Replace('__REMOTE_DIRECTORY__', $RemoteDirectory).
    Replace('__EXPECTED_MIGRATION__', [string]$expectedMigrationVersion).
    Replace('__ENABLE_PRODUCTION_PAYMENT__', $enablePaymentArgument).
    Replace('__CANDIDATE_COMMIT__', $ExpectedCommit)
  $remoteScriptPath = Join-Path $tempDirectory 'deploy.sh'
  [IO.File]::WriteAllText(
    $remoteScriptPath,
    ($remoteScript -replace "`r", ''),
    [Text.UTF8Encoding]::new($false)
  )

  Invoke-RetryableNativeCommand `
    -Description 'Remote deployment script upload' `
    -Action {
      & scp @sshOptions `
        $remoteScriptPath `
        "${target}:$remoteTemporaryDirectory/deploy.sh"
    }
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & ssh @sshOptions $target `
      "bash -n '$remoteTemporaryDirectory/deploy.sh' && sudo bash '$remoteTemporaryDirectory/deploy.sh'"
    $deploymentExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($deploymentExitCode -ne 0) {
    throw 'Formal miniapp API deployment failed.'
  }
} finally {
  try {
    Invoke-RetryableNativeCommand `
      -Description 'Remote deployment cleanup' `
      -MaximumAttempts 2 `
      -Action {
        & ssh @sshOptions $target `
          "rm -rf '$remoteTemporaryDirectory'" 2>$null
      }
  } catch {
    Write-Warning $_
  }
}

Write-Output 'Formal miniapp API deployment completed.'
