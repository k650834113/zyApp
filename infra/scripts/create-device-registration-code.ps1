param(
  [ValidateSet('production', 'test')]
  [string]$Environment = 'test',

  [ValidateRange(5, 1440)]
  [int]$ExpiresInMinutes = 30,

  [string]$EnvironmentPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) {
  $EnvironmentPath = Join-Path $PSScriptRoot '..\deploy\production.env'
}
$environmentFile = [IO.Path]::GetFullPath($EnvironmentPath)
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw "Deployment environment file not found: $environmentFile"
}

$values = @{}
foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $environmentFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  $values[$name.Trim()] = $value.Trim()
}

$site = $values['APP_DOMAIN']
if ([string]::IsNullOrWhiteSpace($site)) {
  throw 'APP_DOMAIN is missing from the deployment environment file.'
}
$origin = if ($site -match '^https?://') { $site.TrimEnd('/') } else { "https://$site" }
$secretName = if ($Environment -eq 'production') {
  'DEVICE_ENROLLMENT_SECRET'
} else {
  'TEST_DEVICE_ENROLLMENT_SECRET'
}
$administratorSecret = $values[$secretName]
if ([string]::IsNullOrWhiteSpace($administratorSecret)) {
  throw "$secretName is missing from the deployment environment file."
}
$prefix = if ($Environment -eq 'test') { '/test' } else { '' }
$uri = "$origin$prefix/v1/devices/registration-codes"
$response = Invoke-RestMethod `
  -Method Post `
  -Uri $uri `
  -Headers @{ 'x-zyapp-enrollment-secret' = $administratorSecret } `
  -ContentType 'application/json' `
  -Body (@{ expiresInMinutes = $ExpiresInMinutes } | ConvertTo-Json -Compress)

[pscustomobject]@{
  Environment = $response.environment
  RegistrationCode = $response.code
  ExpiresAt = $response.expiresAt
  ApiAddress = if ($Environment -eq 'test') { "$origin/test" } else { $origin }
}
