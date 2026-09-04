# Wipes the generated playground config + cache, and regenerates the fixture corpus.
# The real ~/.claude is never touched.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$cfg = Join-Path $root 'playground/config'
if (Test-Path $cfg) {
    Remove-Item -Recurse -Force $cfg
    Write-Host "removed $cfg"
}

node (Join-Path $root 'scripts/make-fixtures.mjs')
Write-Host 'playground reset. run: npm run play'
