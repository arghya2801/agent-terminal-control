# Captures the app window to a PNG, for verifying rendering by eye.
#
#   ./scripts/shot.ps1 -Out shot.png
#
# Manual-verification helper: WebView2 rendering, TUI layout, and whether the terminal
# looks right are not things a unit test can answer.
#
# Uses PrintWindow(PW_RENDERFULLCONTENT) rather than CopyFromScreen. CopyFromScreen
# reads screen pixels, so any overlapping window -- or simply losing the race for
# foreground -- silently produces a PNG of some other application. PrintWindow asks the
# window to render itself, which works while it is occluded or in the background.
param(
    [string]$Out = "shot.png",
    # Matched on process name, not window title: "ATC" as a title substring would
    # also match "Watch", "Patch" or "Dispatch" and capture the wrong window.
    [string]$ProcessName = "atc",
    # Picks one window when two ATC instances are running (e.g. release and dev).
    [int]$ProcessId = 0,
    [switch]$Foreground   # fall back to a screen grab (needed if PrintWindow comes back blank)
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = $(if ($ProcessId) { Get-Process -Id $ProcessId -ErrorAction SilentlyContinue } else { Get-Process -Name $ProcessName -ErrorAction SilentlyContinue }) |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "no window for process '$ProcessName'. Is the app running?" }
$h = $proc.MainWindowHandle

$r = New-Object Win32+RECT
[void][Win32]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if ($w -le 0 -or $ht -le 0) { throw "window has no size ($w x $ht)" }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)

if ($Foreground) {
    $ok = $false
    foreach ($try in 1..10) {
        [void][Win32]::ShowWindow($h, 9)   # SW_RESTORE
        [void][Win32]::SetForegroundWindow($h)
        Start-Sleep -Milliseconds 400
        if ([Win32]::GetForegroundWindow() -eq $h) { $ok = $true; break }
    }
    if (-not $ok) { throw "could not focus the window; a screen grab would capture the wrong app" }
    Start-Sleep -Milliseconds 700
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
} else {
    $hdc = $g.GetHdc()
    # 2 = PW_RENDERFULLCONTENT, required for DirectComposition surfaces like WebView2.
    $done = [Win32]::PrintWindow($h, $hdc, 2)
    $g.ReleaseHdc($hdc)
    if (-not $done) { throw "PrintWindow failed; retry with -Foreground" }
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Write-Host "saved $Out ($w x $ht) from PID $($proc.Id)"
