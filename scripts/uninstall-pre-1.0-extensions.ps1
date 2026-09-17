# Uninstall the pre-1.0 "Ableton RC Setlist" extension while keeping the new
# "RC Setlist" .ablx installed. Required when the consolidated build loads
# alongside a previously-installed 0.x extension and Live shows both panels
# in the Extensions menu.
#
# Run this from PowerShell on the machine that has both packages installed.
# It only touches the legacy install locations; the new RC Setlist .ablx in
# Packages/ is left alone.
#
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-pre-1.0-extensions.ps1
#
# Add -WhatIf to list the files that would be removed without deleting them.

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

# Live stores .ablx packages and unpacked extensions in multiple locations.
# Pre-1.0 packages lived in User Library\Extensions\, AppData\Local\Ableton\Extensions,
# or under the Live version folder. 1.0+ installs into Packages\ and is skipped.
$candidateRoots = @(
    (Join-Path $env:USERPROFILE 'Documents\Ableton\User Library\Extensions'),
    (Join-Path $env:LOCALAPPDATA 'Ableton\Extensions'),
    (Join-Path $env:LOCALAPPDATA 'Ableton\Live 12\Resources\Extensions'),
    (Join-Path $env:LOCALAPPDATA 'Ableton\Live 11\Resources\Extensions'),
    (Join-Path $env:PROGRAMDATA 'Ableton\Live 12\Resources\Extensions')
)

$legacyRegex = '^Ableton[ _-]?RC[ _-]?Setlist.*\.ablx$'
$legacyDirRegex = '^ntworm\.ableton-rc-setlist$'
$newRegex = '^RC-Setlist.*\.ablx$'

$removed = @()
$kept = @()

foreach ($root in $candidateRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $items = Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        if ($item.PSIsContainer -and ($item.Name -imatch $legacyDirRegex)) {
            if ($WhatIf -or $PSCmdlet.ShouldProcess($item.FullName, 'Remove legacy Ableton RC Setlist directory')) {
                Remove-Item -LiteralPath $item.FullName -Recurse -Force
                $removed += $item.FullName
            }
            continue
        }
        if (-not $item.PSIsContainer -and ($item.Extension -ieq '.ablx')) {
            if ($item.Name -match $newRegex) {
                $kept += $item.FullName
                continue
            }
            if ($item.Name -imatch $legacyRegex) {
                if ($WhatIf -or $PSCmdlet.ShouldProcess($item.FullName, 'Remove legacy Ableton RC Setlist package')) {
                    Remove-Item -LiteralPath $item.FullName -Force
                    $removed += $item.FullName
                }
            }
        }
    }
}

if ($WhatIf) {
    Write-Host '[uninstall] WhatIf: would have removed the following files:' -ForegroundColor Yellow
} else {
    Write-Host '[uninstall] Removed legacy packages:' -ForegroundColor Green
}

foreach ($path in $removed) { Write-Host "  - $path" }
foreach ($path in $kept) { Write-Host "[uninstall] Kept (1.0+):  $path" -ForegroundColor DarkGray }

if (-not $removed -and -not $WhatIf) {
    Write-Host '[uninstall] No legacy Ableton RC Setlist package was found.' -ForegroundColor DarkGray
}

Write-Host '[uninstall] Restart Ableton Live for the change to take effect.' -ForegroundColor Cyan
