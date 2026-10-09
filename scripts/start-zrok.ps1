<#
.SYNOPSIS
    Starts a public HTTPS share via zrok on Windows.
.DESCRIPTION
    Discovers the zrok/zrok2 CLI, confirms target port, and creates a public proxy share.
#>

$ErrorActionPreference = "Stop"

# Read .env file if present
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $varName = $parts[0].Trim()
            $varVal = $parts[1].Trim()
            if (-not [System.Environment]::GetEnvironmentVariable($varName)) {
                [System.Environment]::SetEnvironmentVariable($varName, $varVal)
            }
        }
    }
}

$port = if ($env:PORT) { $env:PORT } else { "3000" }
$targetUrl = "http://127.0.0.1:$port"
$zrokToken = $env:ZROK_TOKEN

# Discover zrok binary
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
    Write-Error "zrok executable was not found. Please install zrok or add it to your PATH."
    exit 1
}

# Auto-enable zrok environment if token is provided and environment is not enabled
if ($zrokToken) {
    $statusOut = & "$zrokBinary" status 2>&1 | Out-String
    if ($statusOut -match "Account Token\s+\|\s+<<SET>>") {
        Write-Host "zrok environment is already enabled." -ForegroundColor Green
    } else {
        Write-Host "Enabling zrok environment with configured ZROK_TOKEN..." -ForegroundColor Cyan
        & "$zrokBinary" enable $zrokToken --headless
    }
}

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " Publishing via zrok: $targetUrl" -ForegroundColor Green
Write-Host " Executable: $zrokBinary" -ForegroundColor Gray
Write-Host "=================================================" -ForegroundColor Cyan

# Check if target is responding
try {
    $response = Invoke-WebRequest -Uri "$targetUrl/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    Write-Host "Local server verified healthy ($($response.StatusCode))." -ForegroundColor Green
} catch {
    Write-Warning "Local server on $targetUrl did not respond to /health. Make sure npm start is running."
}

Write-Host "Starting public zrok share..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to terminate the share." -ForegroundColor Yellow

& "$zrokBinary" share public $targetUrl --backend-mode proxy --headless
