@echo off
rem Launches Migrate-RC-Setlist-Data.ps1 in the same folder. Double-click me.
rem Requires Windows PowerShell 5.1 (ships with Windows 10/11).

setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Migrate-RC-Setlist-Data.ps1"
endlocal
