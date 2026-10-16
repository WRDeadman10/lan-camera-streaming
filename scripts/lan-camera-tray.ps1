<#
.SYNOPSIS
    LAN Camera Streaming Windows System Tray Companion.

.DESCRIPTION
    Docks the LAN Camera Streaming service into the Windows System Tray (Notification Area),
    providing quick-launch shortcuts, stream status, and auto-start toggle.

.PARAMETER Port
    HTTP Port of the local server (default: 3000).

.PARAMETER RtspPort
    RTSP Port of the local server (default: 8554).
#>

param (
    [int]$Port = 3000,
    [int]$RtspPort = 8554
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

# Icon setup
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "LAN Camera Streaming (Port $Port)"
$notifyIcon.Visible = $true

# Context Menu Items
$itemViewer = $contextMenu.Items.Add("Open Web Viewer (Localhost)")
$itemViewer.add_Click({
    Start-Process "http://127.0.0.1:$Port/viewer"
})

$itemSender = $contextMenu.Items.Add("Open Phone Sender")
$itemSender.add_Click({
    Start-Process "http://127.0.0.1:$Port/sender"
})

$itemRtsp = $contextMenu.Items.Add("RTSP Stream Info")
$itemRtsp.add_Click({
    $notifyIcon.ShowBalloonTip(3000, "RTSP IP-Camera URL", "rtsp://127.0.0.1:$RtspPort/live/default-room", [System.Windows.Forms.ToolTipIcon]::Info)
})

$null = $contextMenu.Items.Add("-")

$itemAutoStart = $contextMenu.Items.Add("Toggle Windows Auto-Start")
$itemAutoStart.add_Click({
    $script = Join-Path $PSScriptRoot "register-autostart.ps1"
    if (Test-Path $script) {
        $status = & powershell -ExecutionPolicy Bypass -File $script -Status
        if ($status -like "*ENABLED*") {
            & powershell -ExecutionPolicy Bypass -File $script -Disable
            $notifyIcon.ShowBalloonTip(2000, "Auto-Start Disabled", "LAN Camera will not launch on Windows startup.", [System.Windows.Forms.ToolTipIcon]::Info)
        } else {
            & powershell -ExecutionPolicy Bypass -File $script -Enable -Minimized
            $notifyIcon.ShowBalloonTip(2000, "Auto-Start Enabled", "LAN Camera will launch minimized on Windows startup.", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    }
})

$null = $contextMenu.Items.Add("-")

$itemExit = $contextMenu.Items.Add("Exit LAN Camera Tray")
$itemExit.add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Show initial balloon
$notifyIcon.ShowBalloonTip(3000, "LAN Camera Streaming Active", "Running in tray. Right-click icon for controls and viewer link.", [System.Windows.Forms.ToolTipIcon]::Info)

# Run message loop
[System.Windows.Forms.Application]::Run()
