param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$data = Join-Path $root 'windows-data'
$taskTemp = Join-Path 'D:\ChatGPT-Temp' ('cc-board-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $data,$taskTemp | Out-Null
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$env:TMPDIR = $taskTemp
$env:CCBOARD_DATA = $data
$env:CCBOARD_TMUX_SOCKET = Join-Path $data 'tmux.sock'
$env:CCBOARD_WORKSPACE = Split-Path $root -Parent
$config = Join-Path $data 'config.json'
if (!(Test-Path -LiteralPath $config)) {
  [IO.File]::WriteAllText($config, '{"codex":true,"autoContinue":false,"autoTidy":false}', [Text.UTF8Encoding]::new($false))
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$health = $null
try { $health = Invoke-RestMethod 'http://127.0.0.1:4747/health' -TimeoutSec 2 } catch {}
if ($health -and ($health.app -ne 'cc-board' -or $health.data -ne $data)) { throw 'Port 4747 is occupied by another service.' }
if (!$health) {
  Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $root 'server.mjs') + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'server.log') -RedirectStandardError (Join-Path $data 'error.log') | Out-Null
  for ($i=0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod 'http://127.0.0.1:4747/health' -TimeoutSec 1; break } catch {}
  }
}
if (!$health) { throw ('Startup failed. See ' + (Join-Path $data 'error.log')) }
if (!$NoBrowser) {
  $token = (Get-Content -LiteralPath (Join-Path $data '.token') -Raw).Trim()
  $url = 'http://127.0.0.1:4747/?lang=zh&k=' + $token
  $edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe','C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($edge) { Start-Process -FilePath $edge -ArgumentList ('--app="' + $url + '"') } else { Start-Process $url }
}
Write-Output 'cc-board is running at 127.0.0.1:4747.'
