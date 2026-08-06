param(
  [Parameter(Mandatory = $true)]
  [string]$EnvironmentPath,

  [string]$BggTokenPath
)

$ErrorActionPreference = 'Stop'

$environment = [IO.Path]::GetFullPath($EnvironmentPath)
if (-not (Test-Path -LiteralPath $environment -PathType Leaf)) {
  throw "Deployment environment not found: $environment"
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $environment -Encoding utf8) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
    $values[$Matches[1]] = $Matches[2].Trim()
  }
}

$mode = if ($values.ContainsKey('BGG_METADATA_MODE')) {
  $values['BGG_METADATA_MODE']
} else {
  'disabled'
}
if ($mode -notin @('disabled', 'xmlapi')) {
  throw 'BGG_METADATA_MODE must be disabled or xmlapi.'
}

$publicImages = if ($values.ContainsKey('BGG_PUBLIC_IMAGES_ENABLED')) {
  switch ($values['BGG_PUBLIC_IMAGES_ENABLED'].ToLowerInvariant()) {
    'true' { $true }
    'false' { $false }
    default { throw 'BGG_PUBLIC_IMAGES_ENABLED must be true or false.' }
  }
} else {
  $false
}
if ($publicImages -and $mode -ne 'xmlapi') {
  throw 'BGG_PUBLIC_IMAGES_ENABLED requires BGG_METADATA_MODE=xmlapi.'
}

$token = $null
if ($mode -eq 'xmlapi') {
  if ([string]::IsNullOrWhiteSpace($BggTokenPath)) {
    throw 'BggTokenPath is required when BGG_METADATA_MODE=xmlapi.'
  }
  $token = [IO.Path]::GetFullPath($BggTokenPath)
  if (-not (Test-Path -LiteralPath $token -PathType Leaf)) {
    throw "BGG XML API token file not found: $token"
  }
  if ([string]::IsNullOrWhiteSpace((Get-Content -Raw -LiteralPath $token -Encoding utf8))) {
    throw 'BGG XML API token file must not be empty.'
  }
}

[ordered]@{
  enabled = $mode -eq 'xmlapi'
  mode = $mode
  publicImagesEnabled = $publicImages
  tokenPath = $token
} | ConvertTo-Json -Compress
