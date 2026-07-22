$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$compose = Join-Path $root 'infra\docker\compose.yml'
$envFile = Join-Path $root 'infra\docker\cloud.env'
$arguments = @('compose')
if (Test-Path -LiteralPath $envFile) {
  $arguments += @('--env-file', $envFile)
}
$arguments += @('-f', $compose, 'ps')

& docker @arguments
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to read local cloud container status.'
}
