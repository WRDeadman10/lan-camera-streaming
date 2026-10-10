<#
.SYNOPSIS
    Releases and unbinds any active or stale zrok shares from the zrok cloud controller dashboard.
#>

$ErrorActionPreference = "Stop"

$zrokCmd = Get-Command "zrok" -ErrorAction SilentlyContinue
if (-not $zrokCmd) {
    $zrokCmd = Get-Command "zrok2" -ErrorAction SilentlyContinue
}
if (-not $zrokCmd) {
    $possiblePaths = @(
        "C:\scrcpy-win64-v2.4\zrok2.exe",
        "$env:LOCALAPPDATA\Programs\zrok\zrok.exe",
        "C:\Program Files\zrok\zrok.exe"
    )
    foreach ($p in $possiblePaths) {
        if (Test-Path $p) {
            $zrokBinary = $p
            break
        }
    }
} else {
    $zrokBinary = $zrokCmd.Source
}

if (-not $zrokBinary) {
    Write-Error "zrok executable was not found."
    exit 1
}

Write-Host "Releasing reserved name 'public:lan'..." -ForegroundColor Cyan
cmd /c "`"$zrokBinary`" delete share public:lan 2>&1" | Out-Null

Write-Host "Querying zrok overview for any lingering shares..." -ForegroundColor Cyan
$overviewOut = cmd /c "`"$zrokBinary`" overview 2>&1"
$overviewLines = $overviewOut -split "`n"
$cleaned = 0

foreach ($line in $overviewLines) {
    if ($line -match "http://127\.0\.0\.1" -and $line -match "([a-z0-9]{10,16})") {
        $staleToken = $matches[1]
        Write-Host "Releasing share token '$staleToken'..." -ForegroundColor Yellow
        cmd /c "`"$zrokBinary`" delete share $staleToken 2>&1" | Out-Null
        $cleaned++
    }
}

if ($cleaned -eq 0) {
    Write-Host "No lingering shares found. zrok dashboard is clean." -ForegroundColor Green
} else {
    Write-Host "Successfully released $cleaned share(s) from zrok cloud controller." -ForegroundColor Green
}
