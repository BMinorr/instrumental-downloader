# Opreste si dezinstaleaza pornirea automata a serverului la logon.

$TaskName = "InstrumentalDownloaderServer"
$ServerDir = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "server"
$VbsPath = Join-Path $ServerDir "run-hidden.vbs"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "ATENTIE: task-ul '$TaskName' nu a putut fi sters (probabil creat cu drepturi de Administrator)." -ForegroundColor Yellow
    Write-Host "Ruleaza acest script intr-un PowerShell 'Run as administrator' sau sterge task-ul din Task Scheduler (taskschd.msc)." -ForegroundColor Yellow
}
Remove-Item -Path $VbsPath -ErrorAction SilentlyContinue

# wscript.exe iese imediat dupa ce porneste node.exe (Task Scheduler nu-l mai tine in evidenta),
# deci oprim procesul node care ruleaza server.js direct, dupa linia de comanda.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*server.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Dezinstalat. Serverul nu mai porneste automat la logon."
Write-Host "Poti in continuare sa-l pornesti manual cu: cd server; npm start"
