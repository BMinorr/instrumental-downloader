@echo off
title Instrumental Downloader - instalare
echo Se descarca si se ruleaza installer-ul (are nevoie de internet)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; irm https://raw.githubusercontent.com/BMinorr/instrumental-downloader/main/install/install.ps1 | iex"
echo.
pause
