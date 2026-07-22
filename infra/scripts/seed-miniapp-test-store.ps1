$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$compose = Join-Path $root 'infra\docker\compose.yml'
$envFile = Join-Path $root 'infra\docker\cloud.env'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'infra/docker/cloud.env was not found. Run pnpm cloud:up first so the local test environment is created.'
}

$envValues = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    $envValues[$matches[1].Trim()] = $matches[2].Trim()
  }
}

$database = $envValues['POSTGRES_DB']
if (-not $database) {
  $database = 'zyapp_test'
}
$user = $envValues['POSTGRES_USER']
if (-not $user) {
  $user = 'zyapp'
}

if ($database -ne 'zyapp_test') {
  throw "Refusing to seed '$database'. This script is only for the zyapp_test database."
}

$tenantId = '11111111-1111-4111-8111-111111111111'
$storeId = '22222222-2222-4222-8222-222222222222'
$activityId = '33333333-3333-4333-8333-333333333333'

$sql = @"
INSERT INTO tenant (id, name, status)
VALUES ('$tenantId', '据点桌游测试租户', 'active')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'active',
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO store (
  id, tenant_id, name, timezone, status, address, contact_phone,
  business_open_minute, business_close_minute, status_override,
  custom_status_text
)
VALUES (
  '$storeId', '$tenantId', '据点桌游', 'Asia/Shanghai', 'active',
  '测试数据库固定门店', NULL, 780, 1380, 'open', '测试营业中'
)
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  name = EXCLUDED.name,
  timezone = EXCLUDED.timezone,
  status = 'active',
  address = EXCLUDED.address,
  contact_phone = EXCLUDED.contact_phone,
  business_open_minute = EXCLUDED.business_open_minute,
  business_close_minute = EXCLUDED.business_close_minute,
  status_override = EXCLUDED.status_override,
  custom_status_text = EXCLUDED.custom_status_text,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO cloud_recharge_gift_tier (
  id, tenant_id, store_id, principal_fen, gift_fen, active,
  server_version, created_at, updated_at
)
VALUES
  ('44444444-4444-4444-8444-444444444441', '$tenantId', '$storeId', 30000, 2000, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('44444444-4444-4444-8444-444444444442', '$tenantId', '$storeId', 50000, 5000, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('44444444-4444-4444-8444-444444444443', '$tenantId', '$storeId', 100000, 20000, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (store_id, principal_fen) DO UPDATE SET
  gift_fen = EXCLUDED.gift_fen,
  active = TRUE,
  server_version = EXCLUDED.server_version,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO cloud_activity_campaign (
  id, tenant_id, store_id, title, summary, content, activity_type, status,
  starts_at, ends_at, pinned, allow_stored_value, allow_wechat,
  recharge_tiers_json, server_version, created_at, updated_at
)
VALUES (
  '$activityId', '$tenantId', '$storeId', 'Test recharge campaign',
  '300 gives 20, 500 gives 50, 1000 gives 200',
  'Only for local and test database integration.',
  'recharge', 'published',
  '2026-01-01T00:00:00.000Z',
  '2030-12-31T15:59:59.000Z',
  TRUE, FALSE, TRUE,
  '[{"principalFen":30000,"giftFen":2000},{"principalFen":50000,"giftFen":5000},{"principalFen":100000,"giftFen":20000}]'::jsonb,
  0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content = EXCLUDED.content,
  activity_type = EXCLUDED.activity_type,
  status = 'published',
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  pinned = TRUE,
  allow_stored_value = FALSE,
  allow_wechat = TRUE,
  recharge_tiers_json = EXCLUDED.recharge_tiers_json,
  server_version = EXCLUDED.server_version,
  updated_at = CURRENT_TIMESTAMP;
"@

if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $previousOutputEncoding = $OutputEncoding
  $OutputEncoding = [Text.UTF8Encoding]::new($false)
}
try {
  $sql | docker compose --env-file $envFile -f $compose exec -T postgres `
    psql -U $user -d $database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to seed the miniapp test store.'
  }
} finally {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $OutputEncoding = $previousOutputEncoding
  }
}

Write-Output "Miniapp test store is ready."
Write-Output "ZYAPP_MINIAPP_STORE_ID=$storeId"
