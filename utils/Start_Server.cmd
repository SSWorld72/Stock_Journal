@echo off
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0Start_Server.ps1'; $b=Get-Content $p -Encoding Byte -TotalCount 3 -ErrorAction SilentlyContinue; if ($null -eq $b -or $b.Length -lt 3 -or $b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191) { Write-Host '[System] Auto-fixing UTF-8 BOM encoding...' -ForegroundColor DarkGray; $c=Get-Content $p -Raw -Encoding UTF8; [System.IO.File]::WriteAllText($p, $c, [System.Text.UTF8Encoding]::new($true)) }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_Server.ps1"
pause