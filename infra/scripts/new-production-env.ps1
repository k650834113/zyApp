param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$')]
  [string]$Domain,

  [string]$OutputPath,

  [switch]$HttpOnly,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $PSScriptRoot '..\deploy\production.env'
}

function New-UrlSafeSecret {
  param([int]$ByteCount = 32)

  $bytes = New-Object byte[] $ByteCount
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
  } finally {
    $random.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
if ((Test-Path -LiteralPath $resolvedOutput) -and -not $Force) {
  throw "Production environment already exists: $resolvedOutput. Use -Force only when intentionally rotating every deployment secret."
}

$postgresPassword = New-UrlSafeSecret
$redisPassword = New-UrlSafeSecret
$deviceSecret = New-UrlSafeSecret 48
$testDeviceSecret = New-UrlSafeSecret 48
$phoneSecret = New-UrlSafeSecret 48
$testPhoneSecret = New-UrlSafeSecret 48
$siteAddress = if ($HttpOnly) { "http://$Domain" } else { $Domain }
$parsedIp = $null
$isIpAddress = [Net.IPAddress]::TryParse($Domain, [ref]$parsedIp)
$caddyfilePath = if ($isIpAddress -and -not $HttpOnly) {
  './Caddyfile.ip-https'
} else {
  './Caddyfile'
}

$content = @"
APP_DOMAIN=$siteAddress
CADDYFILE_PATH=$caddyfilePath
ACME_CA=https://acme-v02.api.letsencrypt.org/directory
POSTGRES_DB=zyapp
TEST_POSTGRES_DB=zyapp_test
POSTGRES_USER=zyapp
POSTGRES_PASSWORD=$postgresPassword
DATABASE_URL=postgres://zyapp:$postgresPassword@postgres:5432/zyapp
TEST_DATABASE_URL=postgres://zyapp:$postgresPassword@postgres:5432/zyapp_test
REDIS_PASSWORD=$redisPassword
REDIS_URL=redis://:$redisPassword@redis:6379/0
TEST_REDIS_URL=redis://:$redisPassword@redis:6379/1
DEVICE_ENROLLMENT_SECRET=$deviceSecret
TEST_DEVICE_ENROLLMENT_SECRET=$testDeviceSecret
PHONE_VERIFICATION_SECRET=$phoneSecret
TEST_PHONE_VERIFICATION_SECRET=$testPhoneSecret
MINIAPP_WECHAT_AUTH_MODE=disabled
TEST_MINIAPP_WECHAT_AUTH_MODE=disabled
WECHAT_MINIAPP_APP_ID=
WECHAT_MINIAPP_APP_SECRET=
TEST_MINIAPP_VIRTUAL_PHONE=
WORKER_QUEUE_NAME=zyapp-maintenance
TEST_WORKER_QUEUE_NAME=zyapp-maintenance-test
"@

$parent = Split-Path -Parent $resolvedOutput
[IO.Directory]::CreateDirectory($parent) | Out-Null
[IO.File]::WriteAllText(
  $resolvedOutput,
  $content,
  (New-Object Text.UTF8Encoding($false))
)

Write-Output "Production environment created: $resolvedOutput"
if ($HttpOnly) {
  Write-Warning 'HTTP-only mode is for server smoke testing. Do not enroll a cashier device or transmit business data until HTTPS is enabled.'
}
