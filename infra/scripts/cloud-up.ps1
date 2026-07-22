$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$compose = Join-Path $root 'infra\docker\compose.yml'
$envFile = Join-Path $root 'infra\docker\cloud.env'
$example = Join-Path $root 'infra\docker\cloud.env.example'

if (-not (Test-Path -LiteralPath '\\.\pipe\dockerDesktopLinuxEngine')) {
  throw 'Docker Linux engine is not running. Start Docker Desktop and run pnpm cloud:up again.'
}

docker info | Out-Null

if (-not (Test-Path -LiteralPath $envFile)) {
  Copy-Item -LiteralPath $example -Destination $envFile
}

docker compose --env-file $envFile -f $compose up --build -d
if ($LASTEXITCODE -ne 0) {
  throw 'Local cloud containers failed to start.'
}

docker compose --env-file $envFile -f $compose ps
