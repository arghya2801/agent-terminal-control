# Pretends to be Claude Code for ATC's state detection: sets the working/idle title
# markers Claude uses, prints output while "working", then stops on a question.
#   & fake-agent.ps1 -Name 'Fix login' -Work 20 -Question 'Do you want to make this edit to app.go?'
param(
    [string]$Name = 'Fake agent',
    [int]$Work = 20,
    [string]$Question = 'Do you want to proceed?',
    [int]$Rounds = 1
)
$ui = $host.UI.RawUI
for ($r = 0; $r -lt $Rounds; $r++) {
    $ui.WindowTitle = "$([char]0x25D0) $Name"
    $end = (Get-Date).AddSeconds($Work)
    $i = 0
    while ((Get-Date) -lt $end) {
        $i++
        Write-Host "  Reading src/file$i.ts ... $(Get-Random) tokens"
        Start-Sleep -Milliseconds 400
    }
    Write-Host ""
    Write-Host " $Question"
    Write-Host " $([char]0x276F) 1. Yes"
    Write-Host "   2. No"
    Write-Host ([string][char]0x256D + ([string][char]0x2500 * 40) + [char]0x256E)
    Write-Host ([string][char]0x2502 + ' >' + (' ' * 38) + [char]0x2502)
    Write-Host ([string][char]0x2570 + ([string][char]0x2500 * 40) + [char]0x256F)
    Write-Host "  ? for shortcuts"
    $ui.WindowTitle = "$([char]0x2733) $Name"
    if ($r -lt $Rounds - 1) { Start-Sleep 30 }
}
Start-Sleep 3600
