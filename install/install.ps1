# Installer Windows - Instrumental Downloader.
# Se ruleaza cu Install-Windows.bat (sau direct din PowerShell:
#   irm https://raw.githubusercontent.com/BMinorr/instrumental-downloader/main/install/install.ps1 | iex ).
# Poate fi rulat de cate ori vrei: reinstaleaza ce lipseste si aduce ultima versiune.
# Fara diacritice si doar ASCII, ca sa mearga la fel prin "irm | iex".

$ErrorActionPreference = "Stop"

$Repo = if ($env:ID_REPO) { $env:ID_REPO } else { "https://github.com/BMinorr/instrumental-downloader.git" }
$InstallDir = if ($env:ID_DIR) { $env:ID_DIR } else { Join-Path $env:USERPROFILE "InstrumentalDownloader" }
$Port = 5177

function Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Have($command) {
    return [bool](Get-Command $command -ErrorAction SilentlyContinue)
}

# Programele instalate acum de winget apar in PATH-ul din registru, nu si in aceasta sesiune.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $links = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    $env:Path = "$machine;$user;$links"
}

function Install-Program($wingetId, $command, $label) {
    if (Have $command) {
        Write-Host "  $label : deja instalat"
        return
    }
    Write-Host "  $label : se instaleaza (Windows poate cere permisiunea ta)..."
    winget install --id $wingetId --exact --silent --accept-source-agreements --accept-package-agreements
    Update-SessionPath
    if (-not (Have $command)) {
        throw "$label a fost instalat, dar nu il gasesc inca. Inchide fereastra, deschide din nou installer-ul si ruleaza-l inca o data."
    }
}

function Test-Command($description) {
    if ($LASTEXITCODE -ne 0) { throw "$description a esuat." }
}

try {
    Write-Host ""
    Write-Host "Instrumental Downloader - instalare" -ForegroundColor Green
    Write-Host "Instalez tot ce e nevoie. Dureaza cateva minute; nu inchide fereastra."

    Step "1/5 Programele necesare (Git, Node.js, ffmpeg, yt-dlp)"
    Update-SessionPath
    if (-not (Have "winget")) {
        throw "Nu gasesc 'winget'. Deschide Microsoft Store, cauta 'App Installer' si actualizeaza-l, apoi ruleaza din nou installer-ul."
    }
    Install-Program "Git.Git" "git" "Git"
    Install-Program "OpenJS.NodeJS.LTS" "node" "Node.js"
    Install-Program "Gyan.FFmpeg" "ffmpeg" "ffmpeg"
    Install-Program "yt-dlp.yt-dlp" "yt-dlp" "yt-dlp"

    Step "2/5 Descarc aplicatia in $InstallDir"
    if (Test-Path (Join-Path $InstallDir ".git")) {
        git -C $InstallDir pull --ff-only
        Test-Command "Actualizarea aplicatiei (git pull)"
    } elseif ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force | Select-Object -First 1)) {
        throw "Folderul $InstallDir exista deja si nu e o instalare a aplicatiei. Muta-l sau sterge-l si ruleaza din nou."
    } else {
        git clone $Repo $InstallDir
        Test-Command "Descarcarea aplicatiei (git clone)"
    }

    Step "3/5 Instalez dependentele serverului"
    Push-Location (Join-Path $InstallDir "server")
    npm.cmd install --no-audit --no-fund
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { throw "npm install a esuat." }

    Step "4/5 Pornire automata a serverului la fiecare logon"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir "autostart\windows\install.ps1")
    Test-Command "Instalarea pornirii automate"
    $healthy = $false
    for ($i = 0; $i -lt 20 -and -not $healthy; $i++) {
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($health.ok) { $healthy = $true }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    if ($healthy) { Write-Host "  Serverul ruleaza." } else { Write-Host "  Serverul nu raspunde inca - repornirea calculatorului il porneste." -ForegroundColor Yellow }

    Step "5/5 Extensia din Chrome (singurul pas manual)"
    $extensionDir = Join-Path $InstallDir "extension"
    Set-Clipboard -Value $extensionDir
    Start-Process explorer.exe $extensionDir
    try { Start-Process "chrome.exe" "chrome://extensions" } catch { Write-Host "  Deschide manual Chrome si scrie chrome://extensions in bara de adrese." -ForegroundColor Yellow }

    Write-Host ""
    Write-Host "Aproape gata! In fereastra Chrome care s-a deschis:" -ForegroundColor Green
    Write-Host "  1. Porneste 'Developer mode' (comutatorul din dreapta sus)"
    Write-Host "  2. Apasa 'Load unpacked'"
    Write-Host "  3. Lipeste calea (Ctrl+V - e deja copiata) sau alege folderul deschis, apoi 'Select Folder':"
    Write-Host "     $extensionDir" -ForegroundColor Yellow
    Write-Host "  4. (optional) Apasa iconita de puzzle din Chrome si fixeaza extensia."
    Write-Host ""
    Write-Host "Dupa asta, actualizarile se fac din extensie: Settings -> Updates." -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "EROARE: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Poti rula installer-ul din nou oricand - continua de unde a ramas."
    exit 1
}
