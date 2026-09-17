# Installs the RC Bridge remote script into Ableton Live's User Library.
# Also removes any pre-1.0 legacy .ablx from earlier versions so
# Live's Extensions menu only shows one RC Setlist entry after upgrade.
#
# Run it by double-clicking Install-RC-Bridge.cmd (this file is what that
# launcher runs). It copies the RCBridge folder that sits next to it into
#   %USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\RCBridge
# and prints the one step Live cannot do for you.
param(
    [string]$UserLibrary = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Ableton\User Library'),
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'

# --- Step 0: remove any pre-1.0 legacy .ablx and folders from legacy paths ---
# Live 12 reads .ablx from Packages/ (where 1.0 lives), User Library/Extensions/,
# and AppData\Local\Ableton\Extensions (where 0.x unpacked).
$legacyRoots = @(
    (Join-Path $UserLibrary 'Extensions'),
    (Join-Path $env:LOCALAPPDATA 'Ableton\Extensions'),
    (Join-Path $env:LOCALAPPDATA 'Ableton\Live 12\Resources\Extensions'),
    (Join-Path $env:LOCALAPPDATA 'Ableton\Live 11\Resources\Extensions'),
    (Join-Path $env:PROGRAMDATA 'Ableton\Live 12\Resources\Extensions')
)
$legacyRegex    = '^Ableton[ _-]?RC[ _-]?Setlist.*\.ablx$'
$legacyDirRegex = '^ntworm\.ableton-rc-setlist$'
$newRegex       = '^RC-Setlist.*\.ablx$'
foreach ($root in $legacyRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PSIsContainer -and ($_.Name -imatch $legacyDirRegex)) {
            Write-Host "[cleanup] Removing legacy extension directory: $($_.FullName)"
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
            return
        }
        if (-not $_.PSIsContainer -and ($_.Extension -ieq '.ablx')) {
            if ($_.Name -match $newRegex) { return }  # Never touch the 1.0+ package.
            if ($_.Name -imatch $legacyRegex) {
                Write-Host "[cleanup] Removing legacy package: $($_.FullName)"
                Remove-Item -LiteralPath $_.FullName -Force
            }
        }
    }
}

# --- Step 1: install RC Bridge remote script ---
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
Write-Host "Then, in Live's Extensions panel, open RC Setlist and press Start (or Restart)."
Write-Host ""
Write-Host "Se o Live ja estava aberto, feche e abra de novo para ele enxergar o script."
