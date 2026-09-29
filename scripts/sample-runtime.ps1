param([Parameter(Mandatory)][int]$RootProcessId,[Parameter(Mandatory)][string]$Output,[int]$Samples=10)
$ErrorActionPreference='Stop'
$records=@()
foreach($sample in 1..$Samples){
 $all=@(Get-CimInstance Win32_Process)
 $ids=[System.Collections.Generic.HashSet[int]]::new()
 $ids.Add($RootProcessId)|Out-Null
 do{$added=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and $ids.Add([int]$p.ProcessId)){$added=$true}}}while($added)
 $processes=@()
 foreach($processId in $ids){$p=Get-Process -Id $processId -ErrorAction SilentlyContinue;if($p){$processes+=@{pid=$p.Id;name=$p.ProcessName;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;cpuSeconds=$p.TotalProcessorTime.TotalSeconds}}}
 $records+=@{timestamp=(Get-Date).ToUniversalTime().ToString('o');processes=$processes;workingSetBytes=($processes.workingSetBytes|Measure-Object -Sum).Sum;privateBytes=($processes.privateBytes|Measure-Object -Sum).Sum}
 Start-Sleep -Milliseconds 500
}
@{rootProcessId=$RootProcessId;samples=$records;note='Includes ATC, its WebView2 processes and shells. Working sets may double-count shared pages. Private bytes represent committed private memory.'}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $Output
