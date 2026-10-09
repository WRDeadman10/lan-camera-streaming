<#
.SYNOPSIS
    Starts the LAN Camera Streaming Node.js Server on Windows.
.DESCRIPTION
    Validates environment variables, checks port availability, and launches the Express + Socket.IO server.
#>

$ErrorActionPreference = "Stop"

$port = if ($env:PORT) { $env:PORT } else { "3000" }
$hostAddress = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$pin = if ($env:ACCESS_PIN) { $env:ACCESS_PIN } else { "123456" }

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " LAN Camera Streaming Server" -ForegroundColor Green
Write-Host " Port: $port | Host: $hostAddress | PIN: $pin" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# Test if port is already bound
$activeTcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($activeTcp) {
    Write-Warning "Port $port is currently in use by process ID $($activeTcp.OwningProcess[0])."
    Write-Host "Terminate existing process or set a different PORT in .env." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting Node.js application..." -ForegroundColor Green
node src/server/index.js
