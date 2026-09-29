param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$Path,[switch]$Cancel)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ATCDialog {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from,uint to,bool attach);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 public static void Foreground(IntPtr h) { uint p;var t=GetWindowThreadProcessId(GetForegroundWindow(),out p);var me=GetCurrentThreadId();var attached=t!=0 && t!=me && AttachThreadInput(t,me,true);ShowWindow(h,9);BringWindowToTop(h);SetForegroundWindow(h);if(attached)AttachThreadInput(t,me,false); }
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 public static string Describe(IntPtr h) {uint p;GetWindowThreadProcessId(h,out p);var s=new StringBuilder(256);GetClassName(h,s,256);return $"handle={h} pid={p} class={s} visible={IsWindowVisible(h)} enabled={IsWindowEnabled(h)}";}
 public static IntPtr Find(uint pid) { IntPtr result=IntPtr.Zero; EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid && IsWindowVisible(h)){var s=new StringBuilder(256);GetClassName(h,s,256);if(s.ToString()=="#32770"){result=h;return false;}}return true;},IntPtr.Zero);return result; }
}
"@
$automation=[System.Windows.Automation.AutomationElement]
$deadline=[DateTime]::UtcNow.AddSeconds(20)
$dialog=$null
while([DateTime]::UtcNow -lt $deadline){
 $handle=[ATCDialog]::Find([uint32]$ProcessId)
 if($handle -ne [IntPtr]::Zero){$dialog=$automation::FromHandle($handle)}
 if($dialog){break}
 Start-Sleep -Milliseconds 100
}
if(-not $dialog){throw 'ATC save dialog did not open'}
Start-Sleep -Milliseconds 500
Write-Output ('Native dialog: '+$dialog.Current.Name+' '+[ATCDialog]::Describe($handle))
foreach($attempt in 1..10){
 [ATCDialog]::Foreground($handle)
 Start-Sleep -Milliseconds 350
 if([ATCDialog]::GetForegroundWindow() -eq $handle){break}
 }
 if([ATCDialog]::GetForegroundWindow() -ne $handle){throw ('Save dialog is not foreground; refusing to type. Foreground: '+[ATCDialog]::Describe([ATCDialog]::GetForegroundWindow()))}
if(-not $Cancel){
 [System.Windows.Forms.SendKeys]::SendWait('%n')
 [System.Windows.Forms.SendKeys]::SendWait('^a')
 $literal=[regex]::Replace($Path,'[+^%~(){}]',{param($m) '{'+$m.Value+'}'})
 [System.Windows.Forms.SendKeys]::SendWait($literal)
 [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
} else {
 [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
}
$deadline=[DateTime]::UtcNow.AddSeconds(10)
while([ATCDialog]::IsWindowVisible($handle) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
if([ATCDialog]::IsWindowVisible($handle)){throw 'Save dialog remained open after input'}
Write-Output 'Native save dialog handled'
