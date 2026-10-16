<#
.SYNOPSIS
    Registers or unregisters LAN Camera Streaming for automatic startup on Windows boot.

.DESCRIPTION
    Manages the Windows Current User Run key (HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\LanCameraStreaming).

.PARAMETER Enable
    Enables automatic startup on Windows boot.

.PARAMETER Disable
    Disables automatic startup.

.PARAMETER Status
    Displays the current auto-start registration status.

.PARAMETER Minimized
    Configures the application to launch minimized/headless to system tray on boot.
#>

[CmdletBinding(DefaultParameterSetName = "Status")]
param (
    [Parameter(ParameterSetName = "Enable")]
    [switch]$Enable,

    [Parameter(ParameterSetName = "Disable")]
    [switch]$Disable,

    [Parameter(ParameterSetName = "Status")]
    [switch]$Status,

    [Parameter(ParameterSetName = "Enable")]
    [string]$ExecutablePath = "",

    [Parameter(ParameterSetName = "Enable")]
    [switch]$Minimized
)

$ErrorActionPreference = "Stop"
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$ValueName = "LanCameraStreaming"

function Get-InstalledOrBuildPath {
    if ($ExecutablePath -and (Test-Path $ExecutablePath)) {
        return (Resolve-Path $ExecutablePath).Path
    }

    $candidates = @(
        "$env:ProgramFiles\LanCamera\lan-camera-streaming.exe",
        "$PSScriptRoot\..\dist\lan-camera-streaming.exe",
        "$PSScriptRoot\..\lan-camera-streaming.exe"
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            return (Resolve-Path $path).Path
        }
    }

    return ""
}

if ($Enable) {
    $targetPath = Get-InstalledOrBuildPath
    if (-not $targetPath) {
        Write-Error "Could not locate lan-camera-streaming.exe. Please specify -ExecutablePath <path>."
        exit 1
    }

    $commandValue = "`"$targetPath`""
    if ($Minimized) {
        $commandValue += " --minimized --tray"
    }

    Set-ItemProperty -Path $RegPath -Name $ValueName -Value $commandValue -Type String
    Write-Host "[OK] Enabled Windows Auto-Start for LAN Camera Streaming:" -ForegroundColor Green
    Write-Host "     Command: $commandValue" -ForegroundColor Cyan
    exit 0
}

if ($Disable) {
    if (Get-ItemProperty -Path $RegPath -Name $ValueName -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $RegPath -Name $ValueName -ErrorAction SilentlyContinue
        Write-Host "[OK] Disabled Windows Auto-Start for LAN Camera Streaming." -ForegroundColor Green
    } else {
        Write-Host "[INFO] LAN Camera Streaming was not registered for auto-start." -ForegroundColor Yellow
    }
    exit 0
}

# Status check
$current = (Get-ItemProperty -Path $RegPath -Name $ValueName -ErrorAction SilentlyContinue).$ValueName
if ($current) {
    Write-Host "[STATUS] Auto-Start: ENABLED" -ForegroundColor Green
    Write-Host "         Command: $current" -ForegroundColor Cyan
} else {
    Write-Host "[STATUS] Auto-Start: DISABLED" -ForegroundColor Yellow
}
