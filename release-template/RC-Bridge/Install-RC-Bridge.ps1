# Installs the RC Bridge remote script into Ableton Live's User Library.
#
# Run it by double-clicking Install-RC-Bridge.cmd (this file is what that
# launcher runs). It copies the RCBridge folder that sits next to it into
#   %USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\RCBridge
# and prints the one step Live cannot do for you.
param(
    [string]$UserLibrary = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Ableton\User Library')
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'RCBridge'
if (-not (Test-Path -LiteralPath (Join-Path $source 'abletonosc\constants.py') -PathType Leaf)) {
    Write-Host "The RCBridge folder was not found next to this script: $source"
    Write-Host "Unzip the whole installation kit first, then run this again."
    exit 1
}

$scripts = Join-Path $UserLibrary 'Remote Scripts'
$target = Join-Path $scripts 'RCBridge'
New-Item -ItemType Directory -Force -Path $target | Out-Null
# Replace the script but keep its logs folder: Live holds the log file open
# while it runs, and this installer must work with Live open.
Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.Name -ne 'logs' } | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
Get-ChildItem -LiteralPath $target -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$version = (Select-String -LiteralPath (Join-Path $target 'abletonosc\constants.py') -Pattern 'RCBRIDGE_VERSION\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
Write-Host ""
Write-Host "RC Bridge $version installed at:"
Write-Host "  $target"
Write-Host ""
Write-Host "One step left, inside Ableton Live:"
Write-Host "  Settings (Ctrl+,) > Link, Tempo & MIDI > Control Surface > choose RCBridge"
Write-Host "  (Input and Output can stay None.)"
Write-Host ""
Write-Host "Then, in Live's Extensions panel, open Ableton RC Setlist and press Start (or Restart)."
Write-Host ""
Write-Host "Se o Live ja estava aberto, feche e abra de novo para ele enxergar o script."
