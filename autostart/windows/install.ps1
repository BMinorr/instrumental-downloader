# Instaleaza serverul ca task care porneste automat la logon (Task Scheduler),
# fara fereastra de consola vizibila (foloseste un wrapper .vbs ascuns).
# Ruleaza acest script din PowerShell, din folderul unde se afla (autostart/windows).

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ServerDir = Join-Path $ProjectDir "server"
$TaskName = "InstrumentalDownloaderServer"

$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    Write-Error "Nu gasesc 'node' in PATH. Instaleaza-l intai (winget install OpenJS.NodeJS.LTS) si redeschide PowerShell."
    exit 1
}

# Wrapper .vbs care porneste node.exe fara sa deschida o fereastra de consola vizibila.
$VbsPath = Join-Path $ServerDir "run-hidden.vbs"
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$ServerDir"
WshShell.Run """$NodePath"" ""$ServerDir\server.js""", 0, False
"@
Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII

$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Porneste serverul local Instrumental Downloader la logon." | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "Instalat. Serverul porneste automat la fiecare logon si ruleaza acum."
Write-Host "Verifica in browser: http://127.0.0.1:5177/health"
