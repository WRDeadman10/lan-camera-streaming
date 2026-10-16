# LAN Camera Streaming

Production-ready self-hosted WebRTC camera streaming application for Windows and local area networks.

## Features

- **Peer-to-Peer WebRTC Media**: Sub-100ms ultra-low latency video streaming directly between phone and viewer on LAN without media passing through the server.
- **Native Unity Package (`com.vcam.lancamera`)**: High-performance Unity package in `unity-package/` for direct in-engine MJPEG texture streaming without external sidecars or GC allocations.
- **Embedded RTSP 1.0 IP-Camera Server**: Broadcasts standard RFC 2326 & RFC 2435 JPEG over RTP on `rtsp://<host>:8554/live/<roomId>` for OBS Media Source, VLC, ffmpeg, Milestone, and NVRs.
- **Multi-Camera Studio Switcher Mode**: Connect multiple phone cameras (`studio-sender`) simultaneously to a single room with real-time viewer switching via the interactive Studio Switcher bar.
- **High-Performance Shared-Memory Bridge (ADR-022)**: Direct zero-copy video frame pumping into Win32 shared memory (`Local\LanCamSharedMemory_Video`) for DirectShow virtual webcam capture with zero HTTP overhead.
- **Windows Virtual Webcam ("LAN Phone Camera")**: Appears natively in Windows Camera app, Teams, Zoom, Chrome, OBS, and Unity via Media Foundation (Windows 11) and DirectShow (Windows 10/11) one-file installer.
- **Bidirectional Audio & Intercom (Talkback)**: Optional microphone streaming from camera phone, viewer audio controls (mute/volume), and push-to-talk dual-tone Web Audio chime synthesizer.
- **Hardware Camera Controls**: Flashlight/Torch toggle and smooth hardware zoom slider with automatic sensor constraint detection.
- **Adaptive Bitrate (ABR) & Dynamic Quality Scaling**: Automatic WebRTC bitrate adjustment (600 kbps, 1.5 Mbps, 4.0 Mbps) driven by real-time RTT & packet loss polling.
- **Local Recording, Snapshots & Replay Hub**: In-browser video recording (`MediaRecorder`), live recording timer HUD, and high-resolution PNG snapshot download.
- **mDNS / Zero-Conf LAN Auto-Discovery**: Automatic service discovery via multicast DNS (`lancam.local` on 224.0.0.251:5353) and `GET /api/discover`.
- **Standby Slate & Virtual Camera Fallback**: Displays SMPTE color bars in DirectShow and serves clean JFIF test pattern on MJPEG streams when camera is offline.
- **Mobile Battery & Thermal Saver Mode**: Screen WakeLock API integration and full OLED Blackout Saver mode to preserve battery and prevent thermal throttling during long broadcasts.
- **Quick-Join URL & QR Code Auto-Connect**: Deep link query parameter support (`?room=...&pin=...&autostart=1`) and one-click share link generator.
- **Stream Transformation & Framing HUD**: 90°/180°/270° orientation lock, horizontal mirror flip, and 3x3 rule-of-thirds grid.
- **Windows System Tray Companion & Auto-Start**: PowerShell system tray runner (`scripts/lan-camera-tray.ps1`) and Windows Registry auto-start manager (`scripts/register-autostart.ps1`).
- **Standalone Windows exe**: Single portable executable `lan-camera-streaming.exe` with all frontend assets and driver installer embedded; runs without Node.js installed.

---

## Documentation

| Read | For |
|---|---|
| [`unity-package/README.md`](unity-package/README.md) | **Native Unity UPM Package** (`com.vcam.lancamera`): installation, inspector setup, C# API, zero-GC texture streaming |
| [`docs/receiver-guide.md`](docs/receiver-guide.md) | **Connecting anything to this server** (any language or engine): transports, sequence, errors, checklist, the Unity + Python reference integration |
| [`docs/architecture.md`](docs/architecture.md) | Components, routes, receiver signaling contract (§4), multi-viewer (§11), virtual webcam (§12), RTSP server (§14), Unity package (§15) |
| [`vcam/docs/`](vcam/docs/architecture.md) | The Windows virtual camera driver and installer (separate repository, git submodule) |
| [`docs/project-overview.md`](docs/project-overview.md), [`docs/roadmap.md`](docs/roadmap.md), [`docs/tasks.md`](docs/tasks.md), [`docs/decisions.md`](docs/decisions.md) | Scope, plan, backlog, ADR-001 to ADR-026 |
| [`docs/ai_handoff.md`](docs/ai_handoff.md) | Current status for the next person or agent |

## Prerequisites

- **Node.js**: `v20.0.0` or higher (`v22.15.0+` tested).
- **Windows PC**: Acting as the local application and signaling server.
- **Client Devices**: Modern mobile browsers (iOS Safari, Android Chrome) or desktop browsers (Edge, Chrome, Firefox) on the same Wi-Fi/LAN.
- **Optional, for the virtual webcam**: Windows 11 (Windows Camera app support; Windows 10 gets the DirectShow camera only). Building the driver additionally needs Visual Studio 2022 (C++) and Inno Setup 6.

---

## Quick Start (Localhost & LAN)

### 1. Installation

```bash
git clone <repo-url>
cd lan-camera-streaming
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env`:

```bash
copy .env.example .env
```

Review the variables in `.env`:
- `PORT`: HTTP port (default `3000`).
- `ACCESS_PIN`: Security PIN required by sender and viewer to join rooms (default `123456`).
- `LOG_LEVEL`: Logging verbosity (`info`, `debug`, `warn`, `error`).
- `STUN_SERVERS`: Comma-separated STUN server URLs for ICE candidate discovery.
- `HTTPS_CERT_PATH` / `HTTPS_KEY_PATH`: optional, set together to serve HTTPS with your own certificate (`-LocalOnly` mode only).

### 3. Start the Server

```bash
npm start
```

For development with automatic restart on file change:
```bash
npm run dev
```

### 4. Run Automated Tests

```bash
npm test
```

### 5. Build & Run Standalone Single Executable (`.exe`)

You can compile the entire application into a single, self-contained Windows console `.exe` with zero external dependencies (no Node.js or `node_modules` required to run):

```bash
npm run build:exe
```

This generates `dist/lan-camera-streaming.exe`. You can run it directly from terminal or by double-clicking:

```powershell
# Run in local LAN mode (prints LAN IPs and terminal ASCII QR code)
.\dist\lan-camera-streaming.exe --local

# Run on custom port and PIN
.\dist\lan-camera-streaming.exe --local -p 8080 --pin 654321

# Run with zrok public HTTPS tunnel (if zrok is installed)
.\dist\lan-camera-streaming.exe --zrok
```

All frontend assets are embedded directly into the `.exe`. If you place a `public` folder next to the executable, it will serve your local customized files instead.

#### User Configuration via `.env` File

The executable does **not** hardcode your settings. When built, a `.env` configuration file is placed directly in `dist/` next to `lan-camera-streaming.exe`:

```
dist/
├── lan-camera-streaming.exe
├── .env          <-- Open and edit in Notepad!
└── .env.example
```

- **Customizing Values**: Open `dist/.env` in any text editor, adjust your `PORT`, `ACCESS_PIN`, `ZROK_TOKEN`, or `LOG_LEVEL`, and save. When you launch `lan-camera-streaming.exe`, it automatically reads and applies these values.
- **Portability**: If you copy `lan-camera-streaming.exe` to a new folder or machine without `.env`, it will automatically generate a clean `.env` template next to itself on first launch.
- **Custom Config Flag**: You can also point to any `.env` file explicitly using the `--env` flag:
  ```powershell
  .\dist\lan-camera-streaming.exe --env C:\path\to\custom.env
  ```

### 6. Build everything (exe + virtual camera driver installer)

```bash
build.bat
```

Run it from the repository root. It bumps the patch version, builds the Windows virtual camera driver and its Inno Setup installer (`vcam/build.bat`), then builds the exe. Outputs in `dist/`:

| File | What it is |
|---|---|
| `lan-camera-streaming.exe` | The server application (no Node.js needed to run it) |
| `lan-camera-setupv<version>.exe` | One-file installer for the "LAN Phone Camera" virtual webcam |
| `.env` | Editable settings next to the exe |

Building the driver needs the `vcam` submodule (`git submodule update --init`), Visual Studio 2022 with the C++ workload, and [Inno Setup 6](https://jrsoftware.org/isdl.php). Without them, `npm run build:exe` still builds the server exe; it just has no driver installer to serve.

---

## Windows virtual webcam ("LAN Phone Camera")

Use the phone camera as a normal webcam in Windows applications.

1. On the PC, open the viewer (`http://localhost:<port>/viewer`), join the room and wait for the live feed.
2. Click **Download Driver** (or open `/download/lan-camera-setup`) and run `lan-camera-setupv<version>.exe`. Accept the UAC prompt once. It installs to `C:\Program Files\LanCamera`, registers the camera, and adds an uninstaller to Windows "Installed apps".
3. Click **Set as Webcam** in the viewer. This remembers the room, PIN and server address for the camera; no UAC prompt appears.
4. Pick **LAN Phone Camera** in the app: Windows Camera, Teams, Zoom, Chrome, OBS or Unity. Reopen the app if it was already running.

Notes:

- Two cameras are installed. The **Windows (Media Foundation) camera** is what the Windows Camera app, Teams and other modern apps see; it needs **Windows 11**. The **DirectShow camera** serves OBS, ffmpeg and older software and works on Windows 10 as well.
- Video is 1280x720 at 30 FPS, letterboxed if the phone sends another size or orientation. Keep the viewer page open while using the camera: it is the one that forwards the frames.
- Silent install: `lan-camera-setupv<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`. Uninstall from "Installed apps" or run `"C:\Program Files\LanCamera\unins000.exe"`.
- If something fails, read `%ProgramData%\LanCamera\setup.log` (installer) and `mfsource.log` (the Windows camera). Details of the driver are in [`vcam/docs/`](vcam/docs/architecture.md).
- The installer is not code-signed, so Windows SmartScreen or antivirus may warn.

---

## Access Scenarios & HTTPS Configuration

Modern browsers require a **Secure Context (HTTPS or localhost)** to allow camera access via `navigator.mediaDevices.getUserMedia()`.

### Scenario A — Localhost Testing (Single Machine)

When testing sender and viewer on the same machine running the server:
- Sender URL: `http://localhost:3000/sender`
- Viewer URL: `http://localhost:3000/viewer`
- Browsers treat `localhost` as a secure context, so camera access is permitted immediately.

### Scenario B — Public HTTPS Tunnel (Recommended for Phone Testing)

To access the server securely from a mobile phone without installing custom SSL certificates on the phone, run the single entry point from the project root:
```bash
powershell -File start.ps1
```
It installs dependencies and creates `.env` on first run, enables zrok from `ZROK_TOKEN`, starts the server and the zrok share, prints the phone URL and a QR code, and releases the share and stops the server on Ctrl+C. (Alternatively run `npm start` plus your own [ngrok](https://ngrok.com/) or [zrok](https://zrok.io/) tunnel.)

Use the printed HTTPS URL on your phone (for example `https://lan.shares.zrok.io/sender`). The tunnel proxies HTTP pages and Socket.IO signaling over HTTPS. WebRTC will still negotiate a direct peer-to-peer media connection over your local network between the devices!

**Keep video off the tunnel:** WebRTC video is UDP and never passes through zrok/ngrok. On the same Wi-Fi it flows directly from the phone to the PC. To make sure the PC viewer does not use the tunnel either, open the viewer on the PC at `http://localhost:3000/viewer?room=<id>` (the sender page shows this link). The sender and viewer pages show a green **LAN direct** indicator once the video path is local. Only enable "Fallback - Video through zrok" if WebRTC cannot connect; it consumes tunnel quota.

If WebRTC fails on the same Wi-Fi, check: router AP/client isolation (or guest network), the Windows network profile (set Wi-Fi to Private), and VPN/virtual adapters.

### Scenario C — LAN-Only, No Tunnel

```bash
powershell -File start.ps1 -LocalOnly
```
Skips zrok entirely (no zrok quota) and prints the LAN sender URL and a QR code. Phone browsers block the camera on plain HTTP, so on the phone either:
- open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add the printed `http://<PC-LAN-IP>:3000` URL, enable it and relaunch Chrome (one time; signaling and PIN are unencrypted on your LAN), or
- serve HTTPS with your own trusted certificate by setting `HTTPS_CERT_PATH` and `HTTPS_KEY_PATH` in `.env`.

Open the viewer on the PC at `http://localhost:3000/viewer`. If the phone cannot reach the PC, allow Node.js through Windows Firewall on your Private network.

---

## Streaming Workflow

1. Open `/sender` on the camera device.
2. Enter the configured `Access PIN` (default: `123456`).
3. Click **Generate** or specify a Room ID.
4. Click **Start Streaming** and grant browser camera permissions.
5. Open `/viewer` on the watching device.
6. Enter the same `Access PIN` and `Room ID`.
7. Click **Join Room**. The live WebRTC stream will connect and play automatically.
8. Click **Stop Streaming** on the sender or **Leave Room** on the viewer to release resources.

---

---

## Connecting a receiver (any language, any engine)

This application is the **camera source and signaling server**. It does not care what consumes the video: a Python/OpenCV/YOLO
script, a Unity or Unreal app, a Go or Rust service, `ffmpeg`, another browser. Anything that can speak HTTP + Socket.IO (and, for the
low-latency path, WebRTC) can be a receiver. **Start with [`docs/receiver-guide.md`](docs/receiver-guide.md)**: the technology-neutral
contract, the message sequence, the error table and the mistakes that cost the most time.

| Transport | How a receiver gets frames | Joins the room? | Uses tunnel quota? |
|---|---|---|---|
| **WebRTC** (lowest latency) | Socket.IO signaling + a WebRTC video track, peer to peer | Yes, as `webrtc-receiver` | Signaling only |
| **Unity Package** (engine native) | `LanCameraReceiver` in `unity-package/` (`com.vcam.lancamera`) decodes MJPEG to `Texture2D` | No | Yes, every frame |
| **RTSP 1.0** (NVR / OBS / VLC) | `rtsp://<host>:8554/live/<roomId>` RFC 2326 & RFC 2435 JPEG over RTP | No | No (LAN port 8554) |
| **MJPEG** (universal HTTP) | `GET /stream/<roomId>?pin=<accessPin>`, read by OpenCV, ffmpeg or HTTP clients | No | Yes, every frame |
| **Tunnel relay** (last resort) | `tunnel:frame` Socket.IO events carrying JPEG buffers | Yes, with `mediaMode: "tunnel-relay"` | Yes, every frame |

What every receiver needs to know:

- **Endpoints:** `GET /api/config` returns the ICE servers (build your peer connection from it); Socket.IO is on the base URL, default
  namespace; the viewer link a person sees is `http(s)://<host>/viewer?room=<roomId>` and **does not contain the PIN**.
- **Several viewers per room.** A browser viewer and any number of receivers can be in the same room at once; the sender makes a
  separate offer for each. Only a second *sender* is refused (`Room already has an active sender.`).
- **Emit `room:join` on every Socket.IO `connect`, including reconnects.** The server drops a socket's membership when it
  disconnects.
- **The sender creates the WebRTC offer.** Build a new peer connection per offer, queue the sender's trickled candidates until the
  remote description is set, answer with `webrtc:answer`. Start order does not matter.
- **Never put the PIN on a command line or in a logged URL.**

### Method 1: Direct WebRTC via Socket.IO signaling (lowest latency)

1. `GET <base>/api/config` for the ICE servers.
2. Connect a Socket.IO v4 client to `<base>` (for example `https://<host-or-zrok-url>`).
3. On every `connect`, emit `room:join` and read the ack:
   ```json
   { "roomId": "<roomId>", "role": "webrtc-receiver", "pin": "123456", "mediaMode": "webrtc" }
   ```
   Success: `{ "success": true, "roomId", "role": "viewer", "mediaMode", "hasPeer", "peerSocketId" }`; failure:
   `{ "success": false, "error": "..." }` (see the error table in the guide).
4. Receive `webrtc:offer` `{ sdp, type, senderId }`, create the answer, emit `webrtc:answer` `{ sdp, type }`, and exchange
   `webrtc:ice-candidate` events.
5. The remote **video** track is the camera. Full schemas: [`docs/architecture.md` §4](docs/architecture.md#4-external-webrtc-receiver-signaling-contract-version-10).

### Method 2: HTTP MJPEG streaming endpoint (universal fallback)

While a client is connected to it, the server provides an authenticated HTTP multipart video stream (the sender uploads JPEG frames
only while a client is connected; connect to `localhost` to avoid tunnel traffic):
```text
http://<host>:3000/stream/<roomId>?pin=<accessPin>
```
Any tool that reads an MJPEG stream can use it, for example OpenCV:
```python
import cv2

cap = cv2.VideoCapture("http://localhost:3000/stream/room-abc?pin=123456")
while cap.isOpened():
    ret, frame = cap.read()
    if ret:
        # frame is ready for YOLO / PyTorch / OpenCV inference
        cv2.imshow("Stream", frame)
        if cv2.waitKey(1) == ord('q'):
            break
```
This route does not join the room, so it works while a browser viewer is open. The PIN is in the URL: do not log it.

### Method 3: Native Unity Receiver Package (com.vcam.lancamera)

For Unity projects, use the native package located in [`unity-package/`](unity-package/README.md):
```json
{
  "dependencies": {
    "com.vcam.lancamera": "file:../../unity-package"
  }
}
```
Attach [`LanCameraReceiver`](unity-package/Runtime/LanCameraReceiver.cs) to any GameObject, specify your server address, room, and PIN, and target a `RawImage` or `MeshRenderer` material. It streams JPEG frames directly into a cached GPU `Texture2D` with zero garbage collection allocations.

### Reference integration: the Viitorx Unity app with its Python sidecar

The first real receiver treats the phone as a webcam for a Unity pose-tracking app. To use it:

1. Start this server and open the **sender** page on the phone; press start.
2. In Unity, `AppBootstrap` > `Video Test Source`: tick **Track From Video**, paste the **viewer** link into **Video Source**, type
   the server's `ACCESS_PIN` into **Lan Camera Pin**, press Play. Close any browser viewer in that room first.
3. Five status lights in the Unity window (top right, F8 hides) show the sidecar, its watchdog, the source, the model and whether a
   person is being tracked.

The receiver is a Python module in that repository (`python-sidecar~/tools/video/lan_camera.py`) written to the receiver guide, and its
test suite drives **this** server with a fake phone (set `CAMERA_SERVER_DIR` to this folder). Details, what was verified and what was
not: [`docs/receiver-guide.md` section 9](docs/receiver-guide.md#9-reference-integration-the-viitorx-unity--python-sidecar).

---

## Native Unity Integration (UPM Package: com.vcam.lancamera)

The repository includes a production-ready, zero-allocation native Unity package located at [`unity-package/`](unity-package/README.md) (`com.vcam.lancamera`). It decodes live stream frames into a reusable GPU `Texture2D` without external sidecars, DLLs, or GC spikes.

### Installation

#### Method A: Unity Package Manager (Disk)
1. In the Unity Editor, open **Window > Package Manager**.
2. Click the `+` button in the top-left corner and select **Add package from disk...**.
3. Select [`unity-package/package.json`](unity-package/package.json) in this repository.

#### Method B: `Packages/manifest.json`
Add the relative file path to your Unity project's `Packages/manifest.json`:
```json
{
  "dependencies": {
    "com.vcam.lancamera": "file:../../lan-camera-streaming/unity-package"
  }
}
```

### Quick Setup in Unity Inspector
1. Add the `LanCameraReceiver` component to any GameObject: **Add Component > LanCamera > LAN Camera Receiver**.
2. Configure the Inspector fields:
   - **Host**: Server IP address (e.g., `127.0.0.1` or your LAN IP `192.168.1.X`).
   - **Port**: HTTP port (default `3000`).
   - **Room Id**: Target streaming room ID (e.g. `studio-cam-1`).
   - **Access Pin**: Room security PIN (default `123456`).
   - **Target Raw Image**: (Optional) Assign a UI `RawImage` for canvas display.
   - **Target Renderer**: (Optional) Assign a 3D `MeshRenderer` to paint onto in-world objects (monitors, billboards).
   - **Target Texture Property**: Shader texture property (defaults to `_MainTex`).
   - **Auto Connect On Start**: Automatically connects when the scene starts.
3. Enter Play Mode. The receiver connects to `/stream/<roomId>?pin=<accessPin>` and renders the incoming feed in real time.

### C# Scripting Example

Follows strict production C# patterns (explicit typing, K&R braces, zero GC allocations):

```csharp
using System;
using UnityEngine;
using UnityEngine.UI;
using LanCamera;

namespace MyProject {
    public class CameraDisplayController : MonoBehaviour {
        [SerializeField] private LanCameraReceiver receiver;
        [SerializeField] private RawImage previewImage;

        private void Awake() {
            if (receiver != null) {
                receiver.OnStateChanged += HandleStateChanged;
                receiver.OnFrameReceived += HandleFrameReceived;
                receiver.OnError += HandleError;
            }
        }

        private void OnDestroy() {
            if (receiver != null) {
                receiver.OnStateChanged -= HandleStateChanged;
                receiver.OnFrameReceived -= HandleFrameReceived;
                receiver.OnError -= HandleError;
            }
        }

        public void ConnectToRoom(string host, int port, string roomId, string pin) {
            LanCameraConfig config = new LanCameraConfig();
            config.Host = host;
            config.Port = port;
            config.RoomId = roomId;
            config.AccessPin = pin;

            receiver.Config = config;
            receiver.StartStream();
        }

        private void HandleStateChanged(LanCameraState newState) {
            Debug.Log(string.Format("LAN Camera state changed: {0}", newState));
        }

        private void HandleFrameReceived(Texture2D frameTexture) {
            if (previewImage != null && previewImage.texture != frameTexture) {
                previewImage.texture = frameTexture;
            }
        }

        private void HandleError(string errorMessage) {
            Debug.LogError(string.Format("LAN Camera error: {0}", errorMessage));
        }
    }
}
```

---

## Embedded RTSP 1.0 IP-Camera Server

The application includes an embedded RFC 2326 and RFC 2435 RTSP 1.0 server listening on port `8554`. It converts live camera frames into standard JPEG over RTP video streams for NVRs, OBS Studio, and media players.

### Stream URL Format
```text
rtsp://<server-ip>:8554/live/<roomId>
```

### OBS Studio Setup
1. In OBS, click **+** under **Sources** and select **Media Source**.
2. Uncheck **Local File**.
3. In **Input**, enter: `rtsp://127.0.0.1:8554/live/<roomId>` (replace `<roomId>` with your active room ID).
4. In **Input Format**, leave empty.
5. In **Network Buffering**, set to `1 MB` for minimal latency.
6. Check **Use hardware decoding when available**.
7. In advanced options or URL parameters, ensure transport is set to TCP if packet drops occur on Wi-Fi.
8. Click **OK**. The stream renders immediately inside your OBS canvas.

### VLC Media Player Setup
1. Open VLC Media Player.
2. Select **Media > Open Network Stream...** (Ctrl+N).
3. Enter `rtsp://<server-ip>:8554/live/<roomId>`.
4. Click **Play**.

### FFmpeg / FFplay Verification
```bash
ffplay -rtsp_transport tcp rtsp://127.0.0.1:8554/live/<roomId>
```

---

## Multi-Camera Studio Switcher Mode

Transform multiple phones into a professional multi-camera production switcher without complicated networking:

1. **Connecting Cameras**:
   - Open `/sender` on phone 1: enter room `studio` and PIN `123456`, click **Start Streaming**.
   - Open `/sender?studio=1` on phone 2: enter room `studio` and PIN `123456`, click **Start Streaming**.
   - Any number of cameras can join the same studio room concurrently with the `studio-sender` role.
2. **Director / Viewer Switching**:
   - Open `/viewer?room=studio` on the PC.
   - The interactive **Studio Switcher Bar** appears automatically across the top of the viewer.
   - Click any camera thumbnail/button in the switcher bar to instantly cut to that camera angle.
   - Real-time badges display resolution, current FPS, and latency metrics for each camera.

---

## Mobile Camera Controls, Audio Intercom & Framing HUD

The sender interface on mobile devices provides production broadcast tools:

- **Hardware Torch / Flashlight**: Toggle mobile camera LED flash with one tap directly from the UI for low-light or macro capture.
- **Hardware Zoom Slider**: Smooth optical/digital zoom slider with automatic sensor constraints detection.
- **Bidirectional Audio & Intercom (Talkback)**:
  - Stream microphone audio from phone to viewer.
  - Interactive viewer audio controls (mute toggle and linear volume slider).
  - Push-to-Talk intercom with dual-tone Web Audio synthesized chimes for operator direction.
- **Framing HUD & Transformations**:
  - 90°, 180°, and 270° orientation lock for vertical or inverted tripod rigs.
  - Horizontal mirror flip for front-facing vlogging.
  - 3x3 Rule-of-Thirds framing grid overlay.
- **Mobile Battery & Thermal Saver**:
  - Automatically activates the Screen WakeLock API to keep the phone screen awake during streaming.
  - One-tap **OLED Blackout Saver** turns the display pitch black while streaming continues in the background, minimizing heat generation and preventing thermal throttling on OLED devices.
- **Local Recording & Snapshots**:
  - In-browser `MediaRecorder` captures high-quality WebM video clips with elapsed time HUD.
  - Instant high-resolution PNG snapshot download button.

---

## Windows System Tray Companion & Auto-Start Configuration

For headless, 24/7, or background operation on Windows PCs:

### System Tray Companion (`lan-camera-tray.ps1`)
Runs the server hidden in the background with an icon in the Windows taskbar notification area (System Tray):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\lan-camera-tray.ps1
```
- **Left-Click**: Opens the viewer in your default browser.
- **Right-Click Context Menu**:
  - **Open Viewer**: Launches `http://localhost:3000/viewer`.
  - **Open Sender**: Launches `http://localhost:3000/sender`.
  - **Restart Server**: Restarts the background streaming daemon.
  - **Exit**: Gracefully stops the server and removes the tray icon.

### Auto-Start on Windows Login (`register-autostart.ps1`)
Registers the application in the Windows Registry (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) to launch automatically upon login:
```powershell
# Register single executable auto-start
powershell -ExecutionPolicy Bypass -File scripts\register-autostart.ps1

# Register system tray runner auto-start
powershell -ExecutionPolicy Bypass -File scripts\register-autostart.ps1 -Tray

# Remove auto-start registration
powershell -ExecutionPolicy Bypass -File scripts\register-autostart.ps1 -Uninstall
```

---

## Security Best Practices

- Change `ACCESS_PIN` in your `.env` file before exposing the server.
- The server does **not** store or record video feeds to disk.
- Signaling messages are strictly room-isolated and rate-limited.
