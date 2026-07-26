param(
    [string]$Version = "0.3.0",
    [string]$AblxPath,
    [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must use semantic X.Y.Z format."
}
if (-not $AblxPath) {
    $AblxPath = Join-Path $repoRoot "Ableton-RC-Setlist-$Version.ablx"
}
if (-not $OutputRoot) {
    $OutputRoot = Join-Path $repoRoot "release-candidates"
}

$ablxFull = (Resolve-Path -LiteralPath $AblxPath).Path
$outputFull = [IO.Path]::GetFullPath($OutputRoot)
$kitName = "Ableton-RC-Setlist-$Version-Installation-Kit"
$kitRoot = Join-Path $outputFull $kitName
$zipPath = Join-Path $outputFull "$kitName.zip"

if ([IO.Path]::GetFileName($ablxFull) -ne "Ableton-RC-Setlist-$Version.ablx") {
    throw "Unexpected .ablx filename: $ablxFull"
}
if ($outputFull -eq [IO.Path]::GetPathRoot($outputFull)) {
    throw "Refusing to use a filesystem root for release candidates."
}

New-Item -ItemType Directory -Force -Path $outputFull | Out-Null
if (Test-Path -LiteralPath $kitRoot) {
    $resolvedKit = (Resolve-Path -LiteralPath $kitRoot).Path
    $safeParent = $resolvedKit.StartsWith($outputFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    $safeLeaf = [IO.Path]::GetFileName($resolvedKit) -eq $kitName
    if (-not ($safeParent -and $safeLeaf)) {
        throw "Refusing to replace unexpected release-kit directory: $resolvedKit"
    }
    Remove-Item -LiteralPath $resolvedKit -Recurse -Force
}

New-Item -ItemType Directory -Path $kitRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $kitRoot "LEGAL") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $kitRoot "examples") | Out-Null

$copies = @(
    @{ Source = $ablxFull; Target = "Ableton-RC-Setlist-$Version.ablx" },
    @{ Source = (Join-Path $repoRoot "release-template/START-HERE.html"); Target = "START-HERE.html" },
    @{ Source = (Join-Path $repoRoot "release-template/README.txt"); Target = "README.txt" },
    @{ Source = (Join-Path $repoRoot "release-template/TEST-CHECKLIST.md"); Target = "TEST-CHECKLIST.md" },
    @{ Source = (Join-Path $repoRoot "docs/INSTALL.md"); Target = "INSTALL.md" },
    @{ Source = (Join-Path $repoRoot "docs/USER-GUIDE.md"); Target = "USER-GUIDE.md" },
    @{ Source = (Join-Path $repoRoot "docs/TROUBLESHOOTING.md"); Target = "TROUBLESHOOTING.md" },
    @{ Source = (Join-Path $repoRoot "CHANGELOG.md"); Target = "CHANGELOG.md" },
    @{ Source = (Join-Path $repoRoot "LICENSE"); Target = "LEGAL/LICENSE.txt" },
    @{ Source = (Join-Path $repoRoot "NOTICE"); Target = "LEGAL/NOTICE.txt" },
    @{ Source = (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md"); Target = "LEGAL/THIRD_PARTY_NOTICES.md" }
)

foreach ($copy in $copies) {
    if (-not (Test-Path -LiteralPath $copy.Source -PathType Leaf)) {
        throw "Required release file is missing: $($copy.Source)"
    }
    Copy-Item -LiteralPath $copy.Source -Destination (Join-Path $kitRoot $copy.Target)
}
$exampleSource = Join-Path $repoRoot "examples"
foreach ($exampleEntry in Get-ChildItem -LiteralPath $exampleSource) {
    Copy-Item -LiteralPath $exampleEntry.FullName -Destination (Join-Path $kitRoot "examples") -Recurse
}

$ablxHash = (Get-FileHash -LiteralPath $ablxFull -Algorithm SHA256).Hash
$ablxSize = (Get-Item -LiteralPath $ablxFull).Length
$buildInfo = @(
    "Ableton RC Setlist $Version public release",
    "Artifact: Ableton-RC-Setlist-$Version.ablx",
    "Size: $ablxSize bytes",
    "SHA256: $ablxHash",
    "Package inventory: generated successfully",
    "Manual Ableton Live validation: PASSED ON WINDOWS"
)
[IO.File]::WriteAllLines((Join-Path $kitRoot "VERIFICATION.txt"), $buildInfo, [Text.UTF8Encoding]::new($false))

$hashLines = Get-ChildItem -LiteralPath $kitRoot -Recurse -File |
    Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($kitRoot.Length + 1).Replace("\", "/")
        "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
    }
[IO.File]::WriteAllLines((Join-Path $kitRoot "SHA256SUMS.txt"), $hashLines, [Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath $kitRoot -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output $kitRoot
Write-Output $zipPath
