# Copies RC Setlist data from the 0.x layout to the 1.0 layout.
#
# Source: %LOCALAPPDATA%\Ableton\Extensions Data\ntworm.ableton-rc-setlist
# Destination: %LOCALAPPDATA%\Ableton\Extensions Data\ntworm.rc-setlist
#
# Behaviour:
#   - Never moves or deletes anything in the source.
#   - Never overwrites a file that already exists in the destination.
#   - Skips the migration entirely if the destination already has profiles/.
#   - Idempotent: running it again is a no-op.
#   - Prints what was copied and what was skipped.

$ErrorActionPreference = 'Stop'

$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) {
  Write-Host "Could not resolve %LOCALAPPDATA%. Open Settings > System > About > Advanced system settings and check the user profile path, then run this again."
  exit 1
}

$extensionsData = Join-Path $localAppData 'Ableton\Extensions Data'
$source = Join-Path $extensionsData 'ntworm.ableton-rc-setlist'
$dest = Join-Path $extensionsData 'ntworm.rc-setlist'

$entries = @('profiles', 'project-setlists', 'token', 'ui-locale', 'auto-start', 'certs')

function Copy-IfMissing {
  param(
    [string]$SourcePath,
    [string]$DestPath
  )
  if (-not (Test-Path -LiteralPath $DestPath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DestPath) | Out-Null
    Copy-Item -LiteralPath $SourcePath -Destination $DestPath -Force
    return $true
  }
  return $false
}

function Copy-Tree {
  param(
    [string]$SourcePath,
    [string]$DestPath
  )
  if (-not (Test-Path -LiteralPath $SourcePath)) {
    return @{ copied = @(); skipped = @() }
  }
  if (-not (Test-Path -LiteralPath $DestPath)) {
    New-Item -ItemType Directory -Force -Path $DestPath | Out-Null
  }
  $copied = @()
  $skipped = @()
  Get-ChildItem -LiteralPath $SourcePath -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($SourcePath.Length).TrimStart('\', '/')
    $target = Join-Path $DestPath $relative
    if (Test-Path -LiteralPath $target) {
      $skipped += $relative
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
      $copied += $relative
    }
  }
  return @{ copied = $copied; skipped = $skipped }
}

if (-not (Test-Path -LiteralPath $source)) {
  Write-Host "Source directory not found: $source"
  Write-Host "Nothing to migrate. If you never installed the 0.x version you can ignore this."
  exit 1
}

if ((Test-Path -LiteralPath $dest) -and (Test-Path -LiteralPath (Join-Path $dest 'profiles'))) {
  Write-Host "Destination already has profiles/: $dest"
  Write-Host "Nothing to copy."
  exit 0
}

Write-Host "Migrating RC Setlist data:"
Write-Host "  from: $source"
Write-Host "  to:   $dest"
Write-Host ""

New-Item -ItemType Directory -Force -Path $dest | Out-Null

foreach ($entry in $entries) {
  $srcPath = Join-Path $source $entry
  if (-not (Test-Path -LiteralPath $srcPath)) {
    Write-Host "  $entry: not present in source, skipped"
    continue
  }
  $dstPath = Join-Path $dest $entry
  if ((Test-Path -LiteralPath $srcPath) -and (Test-Path -LiteralPath $dstPath -PathType Leaf)) {
    Write-Host "  $entry: already present at destination, skipped"
    continue
  }
  if ((Get-Item -LiteralPath $srcPath).PSIsContainer) {
    $result = Copy-Tree -SourcePath $srcPath -DestPath $dstPath
    if ($result.copied.Count -eq 0 -and $result.skipped.Count -eq 0) {
      Write-Host "  $entry: empty, skipped"
    } else {
      Write-Host "  $entry: merged"
      foreach ($c in $result.copied) { Write-Host "    + $c" }
      foreach ($s in $result.skipped) { Write-Host "    = $s (already present)" }
    }
  } else {
    if (Copy-IfMissing -SourcePath $srcPath -DestPath $dstPath) {
      Write-Host "  $entry: copied"
    } else {
      Write-Host "  $entry: already present, skipped"
    }
  }
}

Write-Host ""
Write-Host "Done. The 0.x data in $source was left untouched."
Write-Host "Open Ableton Live, open the RC Setlist extension and press Start."
