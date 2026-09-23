# Aduce ultimele modificari din Git, actualizeaza dependentele si reporneste serverul (Windows).
# Dupa rulare: in chrome://extensions apasa refresh pe extensie daca s-a schimbat ceva in extension\.
# Rulare (PowerShell, nu necesita Admin): .\autostart\update.ps1

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$TaskName = "InstrumentalDownloaderServer"

Set-Location $ProjectDir
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull a esuat." }

Push-Location (Join-Path $ProjectDir "server")
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install a esuat." }
Pop-Location

# Opreste procesul node care ruleaza server.js (daca exista), apoi porneste din nou task-ul.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*server.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Server repornit."
} else {
    Write-Host "Task-ul de auto-start nu e instalat - ruleaza autostart\windows\install.ps1 sau porneste manual (cd server; npm start)."
}

Write-Host "Gata. Daca s-a schimbat ceva in extension\, apasa refresh pe extensie in chrome://extensions."
