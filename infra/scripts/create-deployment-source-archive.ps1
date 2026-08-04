param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,

  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'

$workspace = [IO.Path]::GetFullPath($WorkspaceRoot)
$archive = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $workspace -PathType Container)) {
  throw "Workspace root not found: $workspace"
}

$repositoryRoot = (& git -C $workspace rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repositoryRoot)) {
  throw "Workspace is not a Git repository: $workspace"
}
if ([IO.Path]::GetFullPath($repositoryRoot) -cne $workspace) {
  throw "Workspace root must equal the Git repository root: $repositoryRoot"
}

$archiveDirectory = Split-Path -Parent $archive
[IO.Directory]::CreateDirectory($archiveDirectory) | Out-Null
if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

& git -C $workspace archive --format=tar.gz --output=$archive HEAD
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to create deployment archive from Git HEAD.'
}
if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  throw "Deployment archive was not created: $archive"
}

Write-Output "Deployment source archive created from Git HEAD: $archive"
