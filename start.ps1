<#
.SYNOPSIS
    Starts both the Node.js application server and the public zrok HTTPS tunnel in a single console session.
.DESCRIPTION
    1. Loads configuration from .env.
    2. Spawns the Node.js server as a background job/process.
    3. Waits for /health to become available.
    4. Auto-enables and starts the zrok public tunnel in the foreground.
    5. Cleanly terminates the Node.js server when the script exits (Ctrl+C).
#>

$ErrorActionPreference = "Stop"

# 1. Load configuration from .env
$envFile = Join-Path $PSScriptRoot ".env"
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
$hostAddress = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$targetUrl = "http://127.0.0.1:$port"
$pin = if ($env:ACCESS_PIN) { $env:ACCESS_PIN } else { "123456" }
$zrokToken = $env:ZROK_TOKEN

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " LAN Camera Streaming & zrok Public Tunnel" -ForegroundColor Green
Write-Host " Port: $port | Host: $hostAddress | PIN: $pin" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# 2. Discover zrok executable
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
    Write-Error "zrok executable was not found. Please install zrok or add it to PATH."
    exit 1
}

# 3. Enable zrok environment if needed
if ($zrokToken) {
    $statusOut = cmd /c "`"$zrokBinary`" status 2>&1"
    $statusStr = $statusOut -join "`n"
    if ($statusStr -match "Account Token" -and $statusStr -match "<<SET>>") {
        Write-Host "zrok environment is already enabled." -ForegroundColor Green
    } else {
        Write-Host "Enabling zrok environment with configured ZROK_TOKEN..." -ForegroundColor Cyan
        cmd /c "`"$zrokBinary`" enable $zrokToken --headless"
    }
}

# 4. Check if port is already running Node server or needs spawning
$serverProcess = $null
$isHealthy = $false
try {
    $res = Invoke-WebRequest -Uri "$targetUrl/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
    if ($res.StatusCode -eq 200) {
        $isHealthy = $true
        Write-Host "Node.js server is already running on $targetUrl." -ForegroundColor Green
    }
} catch {
    $isHealthy = $false
}

if (-not $isHealthy) {
    Write-Host "Starting Node.js server in background..." -ForegroundColor Cyan
    $projectRoot = $PSScriptRoot
    $serverProcess = Start-Process -FilePath "node" -ArgumentList "src/server/index.js" -WorkingDirectory $projectRoot -PassThru -NoNewWindow

    # Wait for server /health to respond (up to 10 seconds)
    $attempts = 0
    while ($attempts -lt 20) {
        Start-Sleep -Milliseconds 500
        $attempts++
        try {
            $check = Invoke-WebRequest -Uri "$targetUrl/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
            if ($check.StatusCode -eq 200) {
                Write-Host "Node.js server verified healthy ($targetUrl)." -ForegroundColor Green
                break
            }
        } catch {}
    }
}

# 5. Check / Ensure reserved name 'lan' in zrok namespace
$reservedUrl = $null
try {
    $overviewOut = cmd /c "`"$zrokBinary`" overview 2>&1"
    $overviewStr = $overviewOut -join "`n"
    if ($overviewStr -notmatch "lan\.shares\.zrok\.io") {
        Write-Host "Creating permanent reserved name 'lan' in zrok..." -ForegroundColor Cyan
        cmd /c "`"$zrokBinary`" create name lan"
    } else {
        Write-Host "Reserved domain 'lan.shares.zrok.io' is active." -ForegroundColor Green
    }
    $reservedUrl = "https://lan.shares.zrok.io"
} catch {
    Write-Warning "Could not verify reserved name 'lan': $_"
}

# 6. Display QR Code for Phone Access
Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " SCAN TO CONNECT ON PHONE" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan

# Spawn zrok public share in background so we can read its output
$zrokShareProcess = Start-Process -FilePath $zrokBinary -ArgumentList "share public $targetUrl --backend-mode proxy --headless" -PassThru -NoNewWindow

# Wait briefly for share to register
Start-Sleep -Seconds 3

# Discover generated share URL from zrok overview
$activeShareUrl = $null
$overviewOut = cmd /c "`"$zrokBinary`" overview 2>&1"
$overviewStr = $overviewOut -join "`n"
if ($overviewStr -match "([a-z0-9]{10,16}\.shares\.zrok\.io)") {
    $activeShareUrl = "https://" + $matches[1]
}

$displayUrl = if ($activeShareUrl) { $activeShareUrl } elseif ($reservedUrl) { $reservedUrl } else { "http://localhost:$port" }
$senderDisplayUrl = "$displayUrl/sender"

Write-Host "Public Stream URL: $displayUrl" -ForegroundColor Yellow
Write-Host "Sender URL:        $senderDisplayUrl" -ForegroundColor Cyan
Write-Host ""

# Generate ASCII QR Code in terminal using node qrcode-terminal
try {
    $qrNodeCmd = "import('qrcode-terminal').then(q => q.default.generate('$senderDisplayUrl', { small: true }))"
    node -e $qrNodeCmd
} catch {
    Write-Warning "Could not render terminal QR code."
}

Write-Host ""
Write-Host "Press Ctrl+C to terminate both zrok tunnel and server." -ForegroundColor Yellow
Write-Host ""

try {
    # Keep process active until user terminates
    Wait-Process -Id $zrokShareProcess.Id
} finally {
    Write-Host ""
    Write-Host "Shutting down..." -ForegroundColor Yellow
    if ($zrokShareProcess -and -not $zrokShareProcess.HasExited) {
        Write-Host "Stopping zrok share (PID: $($zrokShareProcess.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $zrokShareProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Write-Host "Stopping background Node.js server (PID: $($serverProcess.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Shutdown complete." -ForegroundColor Green
}
