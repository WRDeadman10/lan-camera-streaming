<#
.SYNOPSIS
    Single entry point: prepares everything, starts the Node.js server, and publishes it (or not).
.DESCRIPTION
    Default mode (zrok tunnel, phone gets an HTTPS URL from zrok):
      1. Installs npm dependencies and creates .env from .env.example when missing.
      2. Loads configuration from .env.
      3. Enables the zrok environment when ZROK_TOKEN is set, and releases stale shares.
      4. Starts the Node.js server and the zrok share bound to public:lan.
      5. Prints the phone URL and QR code, then releases the share and stops the server on Ctrl+C.

    -LocalOnly (no zrok at all, so no zrok quota is used):
      Serves the app on the LAN over plain HTTP (or HTTPS when HTTPS_CERT_PATH / HTTPS_KEY_PATH are set in
      .env) and prints the LAN sender URL and QR code. Phone browsers only allow the camera on HTTPS or
      localhost, so on the phone either use the Chrome flag chrome://flags/#unsafely-treat-insecure-origin-as-secure
      for the printed LAN URL, or use your own trusted certificate.
.PARAMETER LocalOnly
    Run without zrok; the phone connects directly to this PC over the LAN.
#>

param(
    [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"

# 0. First-run preparation: dependencies and .env
if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "Installing npm dependencies (first run)..." -ForegroundColor Cyan
    Push-Location $PSScriptRoot
    try {
        cmd /c "npm install"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "npm install failed." -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
}

$envFile = Join-Path $PSScriptRoot ".env"
$envExampleFile = Join-Path $PSScriptRoot ".env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envExampleFile)) {
    Copy-Item $envExampleFile $envFile
    Write-Host "Created .env from .env.example (set ZROK_TOKEN there for tunnel mode)." -ForegroundColor Yellow
}

# 1. Load configuration from .env
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
$pin = if ($env:ACCESS_PIN) { $env:ACCESS_PIN } else { "123456" }
$zrokToken = $env:ZROK_TOKEN

function Test-ServerHealthy {
    param([string]$ServerScheme, [string]$ServerPort)
    if ($ServerScheme -eq "https") {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $iar = $client.BeginConnect("127.0.0.1", [int]$ServerPort, $null, $null)
            if (-not $iar.AsyncWaitHandle.WaitOne(1000)) {
                return $false
            }
            $client.EndConnect($iar)
            return $true
        } catch {
            return $false
        } finally {
            $client.Close()
        }
    }
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:$ServerPort/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
        return ($res.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Get-LanAddresses {
    try {
        return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
            ForEach-Object { $_.IPAddress })
    } catch {
        return @()
    }
}

function Show-TerminalQr {
    param([string]$Url)
    try {
        node -e "import('qrcode-terminal').then(q => q.default.generate(process.argv[1], { small: true }))" "$Url"
    } catch {
        Write-Warning "Could not render terminal QR code."
    }
}

# A user-supplied certificate (HTTPS_CERT_PATH / HTTPS_KEY_PATH in .env) is honoured only without the
# tunnel, because zrok proxies plain HTTP to the local server.
if (-not $LocalOnly) {
    $env:HTTPS_CERT_PATH = $null
    $env:HTTPS_KEY_PATH = $null
}
$scheme = if ($env:HTTPS_CERT_PATH -and $env:HTTPS_KEY_PATH) { "https" } else { "http" }
$targetUrl = "${scheme}://127.0.0.1:$port"

Write-Host "=================================================" -ForegroundColor Cyan
if ($LocalOnly) {
    Write-Host " LAN Camera Streaming (local only, no zrok)" -ForegroundColor Green
} else {
    Write-Host " LAN Camera Streaming & zrok Public Tunnel" -ForegroundColor Green
}
Write-Host " Port: $port | Host: $hostAddress | PIN: $pin | Scheme: $scheme" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

$zrokBinary = $null
if (-not $LocalOnly) {
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
}

# 4. Check if port is already running Node server or needs spawning
$serverProcess = $null
$isHealthy = Test-ServerHealthy -ServerScheme $scheme -ServerPort $port
if ($isHealthy) {
    Write-Host "Node.js server is already running on $targetUrl." -ForegroundColor Green
}

if (-not $isHealthy) {
    Write-Host "Starting Node.js server in background..." -ForegroundColor Cyan
    $projectRoot = $PSScriptRoot
    $serverProcess = Start-Process -FilePath "node" -ArgumentList "src/server/index.js" -WorkingDirectory $projectRoot -PassThru -NoNewWindow

    # Wait for server to respond (up to 10 seconds)
    $attempts = 0
    while ($attempts -lt 20) {
        Start-Sleep -Milliseconds 500
        $attempts++
        if (Test-ServerHealthy -ServerScheme $scheme -ServerPort $port) {
            Write-Host "Node.js server verified healthy ($targetUrl)." -ForegroundColor Green
            break
        }
    }
}

# 4b. Local-only mode: no zrok, print LAN URLs and exit when the server stops
if ($LocalOnly) {
    $lanAddresses = Get-LanAddresses
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host " LOCAL MODE - no zrok traffic" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "Viewer on this PC: ${scheme}://localhost:$port/viewer" -ForegroundColor Yellow
    foreach ($addr in $lanAddresses) {
        Write-Host "Sender on phone:   ${scheme}://${addr}:$port/sender" -ForegroundColor Cyan
    }
    if ($lanAddresses.Count -eq 0) {
        Write-Warning "No private LAN IPv4 address was found. Check that this PC is connected to Wi-Fi/Ethernet."
    } else {
        Write-Host ""
        Show-TerminalQr -Url "${scheme}://$($lanAddresses[0]):$port/sender"
    }
    if ($scheme -eq "http") {
        Write-Warning "Phone browsers block the camera on plain HTTP. On the phone open chrome://flags/#unsafely-treat-insecure-origin-as-secure, add the sender URL above, enable it and relaunch Chrome."
    }
    Write-Host ""
    Write-Host "If the phone cannot open the URL, allow Node.js through Windows Firewall on your Private network." -ForegroundColor Yellow

    if ($serverProcess) {
        Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Yellow
        try {
            Wait-Process -Id $serverProcess.Id
        } finally {
            if (-not $serverProcess.HasExited) {
                Write-Host "Stopping background Node.js server (PID: $($serverProcess.Id))..." -ForegroundColor Cyan
                Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
            }
        }
    } else {
        Write-Host "Server was already running; nothing to supervise." -ForegroundColor Yellow
    }
    exit 0
}

# 5. Pre-flight cleanup of any stale shares
Write-Host "Checking for stale zrok shares..." -ForegroundColor Cyan
cmd /c "`"$zrokBinary`" delete share public:lan 2>&1" | Out-Null

$overviewOut = cmd /c "`"$zrokBinary`" overview 2>&1"
$overviewLines = $overviewOut -split "`n"
foreach ($line in $overviewLines) {
    if ($line -match "http://127\.0\.0\.1:$port" -and $line -match "([a-z0-9]{10,16})") {
        $staleToken = $matches[1]
        Write-Host "Cleaning up stale share token '$staleToken'..." -ForegroundColor Yellow
        cmd /c "`"$zrokBinary`" delete share $staleToken 2>&1" | Out-Null
    }
}

# 6. Launch zrok public share with reserved name
Write-Host ""
Write-Host "Starting zrok public share for $targetUrl..." -ForegroundColor Cyan

$activeShareUrl = $null
$activeShareToken = $null
$useReserved = $true

$zrokShareProcess = Start-Process -FilePath $zrokBinary -ArgumentList "share public $targetUrl -n public:lan --backend-mode proxy --headless" -PassThru -NoNewWindow
Start-Sleep -Seconds 2

if ($zrokShareProcess.HasExited) {
    Write-Warning "Could not bind to reserved name 'public:lan'. Starting dynamic public share..."
    $useReserved = $false
    $zrokShareProcess = Start-Process -FilePath $zrokBinary -ArgumentList "share public $targetUrl --backend-mode proxy --headless" -PassThru -NoNewWindow
    
    # Poll overview for the newly created dynamic share token targeting our port
    $attempts = 0
    while ($attempts -lt 15 -and -not $activeShareUrl) {
        Start-Sleep -Seconds 1
        $attempts++
        $ov = cmd /c "`"$zrokBinary`" overview 2>&1"
        $ovLines = $ov -split "`n"
        foreach ($l in $ovLines) {
            if ($l -match "http://127\.0\.0\.1:$port" -and $l -match "([a-z0-9]{10,16})") {
                $activeShareToken = $matches[1]
                $activeShareUrl = "https://$activeShareToken.shares.zrok.io"
                break
            }
        }
    }
} else {
    $activeShareUrl = "https://lan.shares.zrok.io"
}

# 7. Display QR Code and URLs for Phone Access
Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " SCAN TO CONNECT ON PHONE" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan

$displayUrl = if ($activeShareUrl) { $activeShareUrl } else { "http://localhost:$port" }
$senderDisplayUrl = "$displayUrl/sender"

Write-Host "Public Stream URL: $displayUrl" -ForegroundColor Yellow
Write-Host "Sender URL:        $senderDisplayUrl" -ForegroundColor Cyan
Write-Host "Viewer on this PC: http://localhost:$port/viewer  (no zrok traffic)" -ForegroundColor Yellow
Write-Host ""

# Generate ASCII QR Code in terminal using node qrcode-terminal
Show-TerminalQr -Url $senderDisplayUrl

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
        Write-Host "Stopping zrok share process (PID: $($zrokShareProcess.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $zrokShareProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Releasing share endpoints from zrok cloud controller..." -ForegroundColor Cyan
    cmd /c "`"$zrokBinary`" delete share public:lan 2>&1" | Out-Null
    if ($activeShareToken) {
        cmd /c "`"$zrokBinary`" delete share $activeShareToken 2>&1" | Out-Null
    }

    # Also clean any share targeting our port
    $ovAfter = cmd /c "`"$zrokBinary`" overview 2>&1"
    $ovAfterLines = $ovAfter -split "`n"
    foreach ($line in $ovAfterLines) {
        if ($line -match "http://127\.0\.0\.1:$port" -and $line -match "([a-z0-9]{10,16})") {
            $remToken = $matches[1]
            cmd /c "`"$zrokBinary`" delete share $remToken 2>&1" | Out-Null
        }
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Write-Host "Stopping background Node.js server (PID: $($serverProcess.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Shutdown complete. Endpoints released." -ForegroundColor Green
}


