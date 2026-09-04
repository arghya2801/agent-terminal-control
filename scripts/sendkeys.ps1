# Sends real Windows keystrokes to the app window, which is the only way to exercise
# WebView2's accelerator handling -- a synthetic DOM event would bypass exactly the
# layer under test.
#
# Windows refuses SetForegroundWindow to a process that does not already own the
# foreground, so this attaches to the current foreground thread's input queue first,
# which is the documented way to inherit that right. It still verifies afterwards and
# refuses to send unless the app really has focus, so keys can never land elsewhere.
param(
    [Parameter(Mandatory = $true)][string]$Keys,
    # Matched on process name, not window title: "ATC" as a title substring would
    # also match "Watch", "Patch" or "Dispatch" and capture the wrong window.
    [string]$ProcessName = "atc",
    [int]$SettleMs = 900
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "no window for process '$ProcessName'" }
$h = $proc.MainWindowHandle

$ok = $false
foreach ($try in 1..10) {
    $fg = [Fg]::GetForegroundWindow()
    $fgThread = [Fg]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
    $meThread = [Fg]::GetCurrentThreadId()
    $attached = $false
    if ($fgThread -ne 0 -and $fgThread -ne $meThread) {
        $attached = [Fg]::AttachThreadInput($fgThread, $meThread, $true)
    }
    [void][Fg]::ShowWindow($h, 9)   # SW_RESTORE
    [void][Fg]::BringWindowToTop($h)
    [void][Fg]::SetForegroundWindow($h)
    if ($attached) { [void][Fg]::AttachThreadInput($fgThread, $meThread, $false) }

    Start-Sleep -Milliseconds 350
    if ([Fg]::GetForegroundWindow() -eq $h) { $ok = $true; break }
}
if (-not $ok) { throw "app is not in the foreground; refusing to send keys somewhere else" }

Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds $SettleMs
Write-Host "sent '$Keys' to PID $($proc.Id)"
