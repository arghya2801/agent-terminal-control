# Exercises the session watcher by hand: appends to an existing fixture session on a
# timer, then creates a brand new one partway through. Watch the sidebar while this
# runs -- the new session should appear within ~1s, and the debug overlay's render
# counter should tick a handful of times, not dozens per second.
#
#   ./scripts/play-churn.ps1 -Seconds 30
param(
    [int]$Seconds = 30,
    [int]$IntervalMs = 250
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root 'fixtures/claude-projects/D--Coding-game-tracker-app'
$existing = Join-Path $proj 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jsonl'
$newId = 'cafe0000-9999-4999-8999-{0}' -f (Get-Random -Minimum 100000000000 -Maximum 999999999999)
$newFile = Join-Path $proj "$newId.jsonl"

$deadline = (Get-Date).AddSeconds($Seconds)
$spawnAt = (Get-Date).AddSeconds([math]::Floor($Seconds / 3))
$spawned = $false
$i = 0

Write-Host "churning for $Seconds s; new session will appear as $newId"
while ((Get-Date) -lt $deadline) {
    $i++
    # Append to the live session: size and mtime change, but the head does not --
    # this is exactly the case the index cache fast-path must not re-parse.
    $line = '{"type":"assistant","message":{"role":"assistant","content":"tick ' + $i + '"},"timestamp":"' + (Get-Date -Format o) + '"}'
    Add-Content -Path $existing -Value $line -Encoding utf8

    if (-not $spawned -and (Get-Date) -ge $spawnAt) {
        $spawned = $true
        @(
            '{"type":"mode","mode":"normal"}'
            '{"type":"ai-title","aiTitle":"Churn test session"}'
            '{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"spawned mid-run by play-churn"},"origin":{"kind":"human"},"promptSource":"typed","cwd":"D:\Coding\game_tracker_app","gitBranch":"main","userType":"external"}'
        ) | Set-Content -Path $newFile -Encoding utf8
        Write-Host "created $newFile"
    }
    Start-Sleep -Milliseconds $IntervalMs
}

Remove-Item -Force $newFile -ErrorAction SilentlyContinue
Write-Host "done; removed the spawned session. run ./scripts/play-reset.ps1 to restore fixtures."
