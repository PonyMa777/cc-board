$ErrorActionPreference = 'Stop'
$data = Join-Path $PSScriptRoot 'windows-data'
try { $health = Invoke-RestMethod 'http://127.0.0.1:4747/health' -TimeoutSec 2 } catch { Write-Output 'cc-board is not running.'; exit }
if ($health.app -ne 'cc-board' -or $health.data -ne $data) { throw 'This port belongs to a different service.' }
$proc = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$health.pid)
if ($proc.Name -ne 'node.exe' -or !$proc.CommandLine.Contains((Join-Path $PSScriptRoot 'server.mjs'))) { throw 'Process identity mismatch.' }
Stop-Process -Id $health.pid
Write-Output 'cc-board stopped. Codex sessions were not stopped.'
