$ErrorActionPreference = 'Stop'

$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

& pnpm.cmd --filter '@zyapp/merchant-desktop' package:win
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
