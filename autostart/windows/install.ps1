# Instaleaza serverul ca task care porneste automat la logon (Task Scheduler),
# fara fereastra de consola vizibila (foloseste un wrapper .vbs ascuns).
# NU cere drepturi de Administrator: task-ul e doar pentru utilizatorul curent.
# Ruleaza acest script din PowerShell, din folderul unde se afla (autostart/windows).

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ServerDir = Join-Path $ProjectDir "server"
$TaskName = "InstrumentalDownloaderServer"
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name # DOMENIU\utilizator

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
# Doar pentru utilizatorul curent (-User) si doar cand e logat (Interactive), fara privilegii ridicate
# (Limited): un trigger "la logon-ul oricarui utilizator" (fara -User) cere Administrator.
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
# -Priority 4 = normal. Task Scheduler's default is 7 (below normal), and the spawned yt-dlp/ffmpeg
# processes inherit it, so downloads/conversions would run at reduced priority on a busy PC.
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Priority 4

$AdminHint = "Ruleaza acest script o singura data intr-un PowerShell 'Run as administrator' (task-ul nou va fi pe utilizatorul tau si de atunci nu mai are nevoie de Admin), sau sterge task-ul '$TaskName' din Task Scheduler (taskschd.msc) si ruleaza din nou."

# Re-rulare: inlocuim task-ul existent. Unul creat cu drepturi de Administrator poate sa nu poata fi sters
# fara ele; daca deja arata corect (aceeasi actiune, prioritate 4), il pastram in loc sa dam eroare.
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    } catch {
        $looksRight = ($Existing.Actions | Where-Object { ([string]$_.Arguments).Contains($VbsPath) }) -and ($Existing.Settings.Priority -eq 4)
        if (-not $looksRight) {
            throw "Task-ul '$TaskName' exista deja (creat cu drepturi de Administrator) si nu poate fi inlocuit fara ele. $AdminHint"
        }
        Write-Host "Task-ul '$TaskName' exista deja (creat ca Administrator) si e configurat corect - il pastrez."
        Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Write-Host "Serverul porneste automat la fiecare logon."
        Write-Host "Verifica in browser: http://127.0.0.1:5177/health"
        return
    }
}

try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Porneste serverul local Instrumental Downloader la logon." -ErrorAction Stop | Out-Null
} catch {
    if (($_ | Out-String) -match "0x80070005|Access is denied") {
        throw "Nu am putut crea task-ul de pornire automata: acces refuzat. Cel mai des, un task '$TaskName' exista deja, creat cu drepturi de Administrator. $AdminHint"
    }
    throw
}

Start-ScheduledTask -TaskName $TaskName

Write-Host "Instalat pentru utilizatorul $CurrentUser. Serverul porneste automat la fiecare logon si ruleaza acum."
Write-Host "Verifica in browser: http://127.0.0.1:5177/health"
