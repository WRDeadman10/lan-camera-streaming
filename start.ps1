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

function Get-ZrokShares {
    param([string]$BinaryPath)
    try {
        $raw = cmd /c "`"$BinaryPath`" overview 2>nul"
        if (-not $raw) { return @() }
        $str = $raw -join "`n"
        $sIdx = $str.IndexOf('{')
        $eIdx = $str.LastIndexOf('}')
        if ($sIdx -ge 0 -and $eIdx -gt $sIdx) {
            $jsonStr = $str.Substring($sIdx, $eIdx - $sIdx + 1)
            $parsed = $jsonStr | ConvertFrom-Json -ErrorAction SilentlyContinue
            $shares = @()
            if ($parsed.environments) {
                foreach ($env in $parsed.environments) {
                    if ($env.shares) {
                        foreach ($s in $env.shares) {
                            $shares += $s
                        }
                    }
                }
            }
            return $shares
        }
    } catch {}
    return @()
}

function Find-ExistingZrokShare {
    param(
        [array]$Shares,
        [string]$Port
    )
    if (-not $Shares -or $Shares.Count -eq 0) { return $null }

    foreach ($s in $Shares) {
        if ($s.reserved -eq $true -and $s.backendProxyEndpoint -and $s.backendProxyEndpoint -match ":$Port") {
            return $s
        }
    }
    foreach ($s in $Shares) {
        if ($s.reserved -eq $true) {
            return $s
        }
    }
    foreach ($s in $Shares) {
        if ($s.backendProxyEndpoint -and $s.backendProxyEndpoint -match ":$Port") {
            return $s
        }
    }
    return $Shares[0]
}

function Reserve-NewZrokShare {
    param(
        [string]$BinaryPath,
        [string]$Target
    )
    $suffixes = @('stream', 'live', 'cam', 'view', 'feed', 'hub', 'node', 'air', 'cast', 'lens', 'scope', 'link')
    $candidates = @('lancam', 'lancamera')
    foreach ($s in $suffixes) {
        $candidates += "lancam$s"
    }
    for ($i = 0; $i -lt 5; $i++) {
        $rand = (-join ((97..122) | Get-Random -Count 4 | ForEach-Object { [char]$_ }))
        $candidates += "lancam$rand"
    }

    foreach ($word in $candidates) {
        Write-Host "Attempting to reserve share name '$word'..." -ForegroundColor Cyan
        $out = cmd /c "`"$BinaryPath`" reserve public `"$Target`" -n `"$word`" --backend-mode proxy --json-output 2>&1"
        $outStr = $out -join "`n"
        $sIdx = $outStr.IndexOf('{')
        $eIdx = $outStr.LastIndexOf('}')
        if ($sIdx -ge 0 -and $eIdx -gt $sIdx) {
            $parsed = $outStr.Substring($sIdx, $eIdx - $sIdx + 1) | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($parsed -and $parsed.token) {
                Write-Host "Successfully reserved share '$($parsed.token)'!" -ForegroundColor Green
                $ep = if ($parsed.frontend_endpoints -and $parsed.frontend_endpoints.Count -gt 0) { $parsed.frontend_endpoints[0] } else { "https://$($parsed.token).share.zrok.io" }
                return @{ token = $parsed.token; url = $ep }
            }
        }
        Write-Host "Could not reserve '$word'. Generating another name..." -ForegroundColor Yellow
    }

    Write-Host "Reserving public share with auto-generated name..." -ForegroundColor Cyan
    $out = cmd /c "`"$BinaryPath`" reserve public `"$Target`" --backend-mode proxy --json-output 2>&1"
    $outStr = $out -join "`n"
    $sIdx = $outStr.IndexOf('{')
    $eIdx = $outStr.LastIndexOf('}')
    if ($sIdx -ge 0 -and $eIdx -gt $sIdx) {
        $parsed = $outStr.Substring($sIdx, $eIdx - $sIdx + 1) | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($parsed -and $parsed.token) {
            Write-Host "Successfully reserved share '$($parsed.token)'!" -ForegroundColor Green
            $ep = if ($parsed.frontend_endpoints -and $parsed.frontend_endpoints.Count -gt 0) { $parsed.frontend_endpoints[0] } else { "https://$($parsed.token).share.zrok.io" }
            return @{ token = $parsed.token; url = $ep }
        }
    }
    return $null
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

# 5. Check if already any reserved share exists or reserve a new one
Write-Host "Configuring zrok public share for $targetUrl..." -ForegroundColor Cyan

$activeShareUrl = $null
$activeShareToken = $null
$isReserved = $false

$existingShares = Get-ZrokShares -BinaryPath $zrokBinary
$chosenShare = Find-ExistingZrokShare -Shares $existingShares -Port $port

if ($chosenShare) {
    $activeShareToken = $chosenShare.shareToken
    $activeShareUrl = if ($chosenShare.frontendEndpoint) { $chosenShare.frontendEndpoint } else { "https://$activeShareToken.share.zrok.io" }
    $isReserved = $true
    Write-Host "Found existing reserved share '$activeShareToken' ($activeShareUrl)." -ForegroundColor Green
    Write-Host "Hosting on existing reserved share '$activeShareToken'..." -ForegroundColor Cyan
} else {
    Write-Host "No existing reserved share found. Reserving a new share for future runs..." -ForegroundColor Cyan
    $newRes = Reserve-NewZrokShare -BinaryPath $zrokBinary -Target $targetUrl
    if ($newRes) {
        $activeShareToken = $newRes.token
        $activeShareUrl = $newRes.url
        $isReserved = $true
        Write-Host "Hosting on newly reserved share '$activeShareToken'..." -ForegroundColor Cyan
    }
}

# 6. Launch zrok share
if ($activeShareToken) {
    $zrokShareProcess = Start-Process -FilePath $zrokBinary -ArgumentList "share reserved $activeShareToken --override-endpoint $targetUrl --headless" -PassThru -NoNewWindow
    Start-Sleep -Seconds 2

    if ($zrokShareProcess.HasExited) {
        Write-Warning "Could not start reserved share '$activeShareToken'. Falling back to dynamic public share..."
        $activeShareToken = $null
        $activeShareUrl = $null
        $isReserved = $false
    }
}

if (-not $activeShareToken) {
    Write-Host "Starting dynamic public share..." -ForegroundColor Cyan
    $zrokShareProcess = Start-Process -FilePath $zrokBinary -ArgumentList "share public $targetUrl --backend-mode proxy --headless" -PassThru -NoNewWindow

    # Poll overview for the newly created dynamic share token targeting our port
    $attempts = 0
    while ($attempts -lt 15 -and -not $activeShareUrl) {
        Start-Sleep -Seconds 1
        $attempts++
        $shares = Get-ZrokShares -BinaryPath $zrokBinary
        $match = $shares | Where-Object { $_.backendProxyEndpoint -and $_.backendProxyEndpoint -match ":$port" } | Select-Object -Last 1
        if (-not $match -and $shares.Count -gt 0) { $match = $shares[-1] }
        if ($match -and $match.shareToken) {
            $activeShareToken = $match.shareToken
            $activeShareUrl = if ($match.frontendEndpoint) { $match.frontendEndpoint } else { "https://$($match.shareToken).share.zrok.io" }
            break
        }
    }
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

    if (-not $isReserved -and $activeShareToken) {
        Write-Host "Releasing dynamic share endpoint '$activeShareToken'..." -ForegroundColor Cyan
        cmd /c "`"$zrokBinary`" release $activeShareToken 2>&1" | Out-Null
    }

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Write-Host "Stopping background Node.js server (PID: $($serverProcess.Id))..." -ForegroundColor Cyan
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Shutdown complete. Resources released." -ForegroundColor Green
}


