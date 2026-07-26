param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$allowlistPath = Join-Path $repoRoot "public-files.txt"
$destinationFull = [IO.Path]::GetFullPath($Destination)
$destinationLeaf = [IO.Path]::GetFileName($destinationFull.TrimEnd([IO.Path]::DirectorySeparatorChar))

if (-not (Test-Path -LiteralPath $allowlistPath -PathType Leaf)) {
    throw "Public allowlist not found: $allowlistPath"
}
if ($destinationFull -eq [IO.Path]::GetPathRoot($destinationFull)) {
    throw "Refusing to use a filesystem root as the public destination."
}
if ($destinationFull.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The sanitized public repository must be outside the source repository."
}

if (Test-Path -LiteralPath $destinationFull) {
    $hasContent = @(Get-ChildItem -Force -LiteralPath $destinationFull).Count -gt 0
    if ($hasContent -and -not $Force) {
        throw "Destination is not empty. Re-run with -Force only after confirming the exact target: $destinationFull"
    }
    if ($hasContent -and $Force) {
        if ($destinationLeaf -ne "rc-setlist") {
            throw "Force cleanup is restricted to a destination directory named rc-setlist."
        }
        Remove-Item -LiteralPath $destinationFull -Recurse -Force
    }
}

New-Item -ItemType Directory -Force -Path $destinationFull | Out-Null
$entries = Get-Content -LiteralPath $allowlistPath -Encoding UTF8 |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") }

foreach ($entry in $entries) {
    if ([IO.Path]::IsPathRooted($entry) -or $entry.Contains("..")) {
        throw "Unsafe allowlist entry: $entry"
    }

    $normalized = $entry.Replace("/", [IO.Path]::DirectorySeparatorChar).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $repoRoot $normalized))
    $targetPath = [IO.Path]::GetFullPath((Join-Path $destinationFull $normalized))

    if (-not $sourcePath.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Allowlist source escaped the repository: $entry"
    }
    if (-not $targetPath.StartsWith($destinationFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Allowlist target escaped the destination: $entry"
    }
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Allowlisted path does not exist: $entry"
    }

    $targetParent = Split-Path -Parent $targetPath
    New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Recurse -Force
}

& node (Join-Path $destinationFull "scripts/verify-public-snapshot.mjs") $destinationFull
if ($LASTEXITCODE -ne 0) {
    throw "Sanitized snapshot verification failed."
}

Write-Output $destinationFull
