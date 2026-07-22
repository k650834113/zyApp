$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$desktopRoot = Join-Path $root 'apps\merchant-desktop'
$packagePath = Join-Path $desktopRoot 'package.json'
$outputDirectory = Join-Path $desktopRoot 'dist-installer'
$releaseNotesPath = Join-Path $desktopRoot 'release-notes.md'
$desktopPackage = Get-Content -Raw -Encoding utf8 $packagePath | ConvertFrom-Json
$version = $desktopPackage.version
$productName = $desktopPackage.build.productName

& (Join-Path $PSScriptRoot 'package-win.ps1')
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$installerName = "$productName Setup $version.exe"
$installerPath = Join-Path $outputDirectory $installerName
$blockmapPath = "$installerPath.blockmap"
$latestPath = Join-Path $outputDirectory 'latest.yml'
foreach ($path in @($installerPath, $blockmapPath, $latestPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Desktop release artifact is missing: $path"
  }
}

$files = @($installerPath, $blockmapPath, $latestPath) | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  [ordered]@{
    name = $item.Name
    size = $item.Length
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$currentVersion = [version]$version
$installerPattern = '^' + [regex]::Escape($productName) +
  ' Setup ([0-9]+\.[0-9]+\.[0-9]+)\.exe$'
$rollback = Get-ChildItem -LiteralPath $outputDirectory -File |
  Where-Object { $_.Name -match $installerPattern } |
  ForEach-Object {
    $candidateVersion = [version]$Matches[1]
    if ($candidateVersion -lt $currentVersion) {
      [pscustomobject]@{
        version = $candidateVersion
        name = $_.Name
        path = $_.FullName
      }
    }
  } |
  Sort-Object version -Descending |
  Select-Object -First 1

$manifest = [ordered]@{
  version = $version
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  releaseNotes = (Get-Content -Raw -Encoding utf8 $releaseNotesPath).Trim()
  files = $files
  rollback = if ($rollback) {
    [ordered]@{
      version = $rollback.version.ToString()
      installer = $rollback.name
      sha256 = (Get-FileHash -LiteralPath $rollback.path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  } else {
    $null
  }
}

$manifestPath = Join-Path $outputDirectory 'release-manifest.json'
$json = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
  $manifestPath,
  $json,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output "Desktop release $version prepared: $manifestPath"
