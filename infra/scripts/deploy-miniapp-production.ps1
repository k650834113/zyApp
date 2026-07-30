param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9.-]+$')]
  [string]$HostName,

  [string]$SshUser = 'ubuntu',

  [Parameter(Mandatory = $true)]
  [string]$KeyPath,

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

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$key = Resolve-RequiredFile $KeyPath 'SSH private key'

if ($RemoteDirectory -notmatch '^/[a-zA-Z0-9._/-]+$') {
  throw 'RemoteDirectory must be an absolute safe Linux path.'
}

foreach ($command in @('ssh', 'scp', 'tar')) {
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
  '-o', 'StrictHostKeyChecking=accept-new'
)

$preflightScript = @'
set -euo pipefail
deploy_dir="$1"
enable_payment="$2"
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

curl --fail --silent --show-error \
  "https://judian.icu/v1/health/ready" >/dev/null
curl --fail --silent --show-error \
  "https://judian.icu/test/v1/health/ready" >/dev/null

cd "$deploy_dir"
database_name() {
  service="$1"
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T "$service" node -e '
      const value = process.env.DATABASE_URL
      const name = value ? decodeURIComponent(new URL(value).pathname.slice(1)) : ""
      if (!name) process.exit(1)
      console.log(name)
    '
}
production_database="$(database_name api)"
test_database="$(database_name api-test)"
if [ "$production_database" != 'zyapp' ]; then
  echo "Unexpected production database name: $production_database" >&2
  exit 1
fi
if [ "$test_database" != 'zyapp_test' ]; then
  echo "Unexpected test database name: $test_database" >&2
  exit 1
fi
if [ "$production_database" = "$test_database" ]; then
  echo 'Production and test APIs must use different databases.' >&2
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
echo "PRODUCTION_DATABASE=$production_database"
echo "TEST_DATABASE=$test_database"
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
  & scp @sshOptions `
    $preflightScriptPath `
    "${target}:$remotePreflightPath"
  if ($LASTEXITCODE -ne 0) {
    throw 'Production miniapp preflight upload failed.'
  }
  $preflightOutput = & ssh @sshOptions $target `
    "bash '$remotePreflightPath' '$RemoteDirectory' '$enablePaymentArgument'"
  if ($LASTEXITCODE -ne 0) {
    throw 'Production miniapp preflight failed.'
  }
  $preflightOutput | Write-Output
} finally {
  & ssh @sshOptions $target "rm -f '$remotePreflightPath'" 2>$null
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
  & tar -czf $archive `
    --exclude=.git `
    --exclude=.worktrees `
    --exclude=node_modules `
    --exclude=.tmp `
    --exclude=.tmp-artifact-acceptance `
    --exclude=outputs `
    --exclude=legacy-data `
    --exclude=apps/merchant-desktop/dist-installer `
    --exclude='infra/deploy/*.env*' `
    --exclude=secrets `
    --exclude='*证书*' `
    .
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the source archive.'
  }
} finally {
  Pop-Location
}

$remoteTemporaryDirectory = '/tmp/zyapp-miniapp-production'
& ssh @sshOptions $target `
  "rm -rf '$remoteTemporaryDirectory' && mkdir -p '$remoteTemporaryDirectory'"
if ($LASTEXITCODE -ne 0) {
  throw 'Remote deployment directory creation failed.'
}

try {
  & scp @sshOptions `
    $archive `
    "${target}:$remoteTemporaryDirectory/source.tgz"
  if ($LASTEXITCODE -ne 0) {
    throw 'Production source upload failed.'
  }

  $remoteScriptTemplate = @'
set -euo pipefail
remote_temp="/tmp/zyapp-miniapp-production"
deploy_dir="__REMOTE_DIRECTORY__"
expected_migration="__EXPECTED_MIGRATION__"
enable_payment="__ENABLE_PRODUCTION_PAYMENT__"
compose_file="$deploy_dir/infra/deploy/compose.production.yml"
env_file="$deploy_dir/infra/deploy/production.env"

cleanup() {
  rm -rf "$remote_temp"
}
trap cleanup EXIT

cd "$deploy_dir"
database_name() {
  service="$1"
  sudo docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T "$service" node -e '
      const value = process.env.DATABASE_URL
      const name = value ? decodeURIComponent(new URL(value).pathname.slice(1)) : ""
      if (!name) process.exit(1)
      console.log(name)
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

test_api_container_before="$(
  sudo docker compose --env-file "$env_file" -f "$compose_file" ps -q api-test
)"
test -n "$test_api_container_before"
production_database_before="$(database_name api)"
test_database_before="$(database_name api-test)"
test "$production_database_before" = 'zyapp'
test "$test_database_before" = 'zyapp_test'
test "$production_database_before" != "$test_database_before"
test_migration_before="$(database_migration "$test_database_before")"

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

environment_backup="$deploy_dir/infra/deploy/production.env.before-miniapp-go-live-$(date -u +%Y%m%dT%H%M%SZ)"
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
fi
sudo grep -Eq '^PRODUCTION_WECHAT_PAYMENT_MODE=wechat$' "$env_file"

sudo tar -xzf "$remote_temp/source.tgz" -C "$deploy_dir"
cd "$deploy_dir"
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml build --no-cache migrate api
migrate_database="$(
  sudo docker compose --env-file infra/deploy/production.env \
    -f infra/deploy/compose.production.yml run --rm --no-deps migrate \
    node -e '
      const value = process.env.DATABASE_URL
      const name = value ? decodeURIComponent(new URL(value).pathname.slice(1)) : ""
      if (!name) process.exit(1)
      console.log(name)
    '
)"
test "$migrate_database" = "$production_database_before"
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml run --rm --no-deps migrate
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml up -d --no-deps \
  --force-recreate api caddy

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
production_database_after="$(database_name api)"
test_database_after="$(database_name api-test)"
test_migration_after="$(database_migration "$test_database_after")"
test "$test_api_container_after" = "$test_api_container_before"
test "$production_database_after" = "$production_database_before"
test "$test_database_after" = "$test_database_before"
test "$test_migration_after" = "$test_migration_before"

sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml exec -T api sh -lc '
    test "$DEPLOYMENT_ENVIRONMENT" = production &&
    test "$WECHAT_PAYMENT_MODE" = wechat &&
    test "$WECHAT_PAY_NOTIFY_URL" = https://judian.icu/v1/payments/wechat/recharge/notify &&
    test "$WECHAT_PAY_OUT_TRADE_NO_PREFIX" = ZYP- &&
    test -z "${WECHAT_PAYMENT_TEST_AMOUNT_FEN:-}"
  '
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml exec -T api-test sh -lc '
    test "$DEPLOYMENT_ENVIRONMENT" = test &&
    test "$WECHAT_PAYMENT_MODE" = wechat &&
    test "$WECHAT_PAY_NOTIFY_URL" = https://judian.icu/test/v1/payments/wechat/recharge/notify &&
    test "$WECHAT_PAY_OUT_TRADE_NO_PREFIX" = ZYT- &&
    test -z "${WECHAT_PAYMENT_TEST_AMOUNT_FEN:-}"
  '

backup_size="$(sudo stat -c %s "$backup_file")"
echo "PRODUCTION_BACKUP=$(basename "$backup_file")"
echo "PRODUCTION_BACKUP_BYTES=$backup_size"
echo "PRODUCTION_BACKUP_SHA256=verified"
echo "PRODUCTION_ENVIRONMENT_BACKUP=$(basename "$environment_backup")"
echo "PRODUCTION_MIGRATION=$production_migration"
echo "PRODUCTION_DATABASE=$production_database_after"
echo "TEST_DATABASE=$test_database_after"
echo "TEST_MIGRATION=$test_migration_after"
echo 'TEST_API_CONTAINER=unchanged'
echo "PROFILE_ROUTE=$profile_status"
echo "AVATAR_ROUTE=$avatar_status"
echo 'PRODUCTION_PAYMENT_MODE=wechat'
echo 'PRODUCTION_API=healthy'
echo 'TEST_API=healthy'
'@
  $remoteScript = $remoteScriptTemplate.
    Replace('__REMOTE_DIRECTORY__', $RemoteDirectory).
    Replace('__EXPECTED_MIGRATION__', [string]$expectedMigrationVersion).
    Replace('__ENABLE_PRODUCTION_PAYMENT__', $enablePaymentArgument)
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
    throw 'Formal miniapp API deployment failed.'
  }
} finally {
  & ssh @sshOptions $target `
    "rm -rf '$remoteTemporaryDirectory'" 2>$null
}

Write-Output 'Formal miniapp API deployment completed.'
