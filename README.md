# LAN Camera Streaming

Production-ready self-hosted WebRTC camera streaming application for Windows and local area networks.

## Features

- **Peer-to-Peer WebRTC Media**: Low-latency video transmission directly between sender and viewer on LAN without media passing through the server.
- **Node.js & Express Signaling**: In-memory room management with single-sender, single-viewer capacity enforcement.
- **Access Control & Rate Limiting**: Required shared PIN authentication, payload sanitization, and brute-force mitigation.
- **Real-Time Diagnostics**: Live connection state, candidate pair type (host vs. relay), RTT latency, FPS, and resolution stats.
- **Clean Hardware Release**: Camera tracks are explicitly stopped and cleared on stop or window close.
- **Mobile Friendly**: Front/back camera toggle, responsive layout, full-screen viewer support, and `playsinline` video elements.

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher (`v22.15.0+` tested).
- **Windows PC**: Acting as the local application and signaling server.
- **Client Devices**: Modern mobile browsers (iOS Safari, Android Chrome) or desktop browsers (Edge, Chrome, Firefox) on the same Wi-Fi/LAN.

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

## External Client Integration (Python, OpenCV, YOLO)

This Node.js application serves as the **camera capture source and WebRTC signaling server**. External clients (such as a separate Python project using `aiortc` or `cv2.VideoCapture`) can consume the live camera feed using either of two supported integration methods:

### Method 1: Direct WebRTC via Socket.IO Signaling (Recommended for Lowest Latency)

External applications (like Python `aiortc`) connect as an authorized receiver:
1. Connect via Socket.IO client to `https://<your-host-or-zrok-url>`.
2. Emit `room:join` with:
   ```json
   {
     "roomId": "<roomId>",
     "role": "webrtc-receiver",
     "pin": "123456"
   }
   ```
3. Exchange standard WebRTC SDP offer/answer (`webrtc:offer`, `webrtc:answer`) and ICE candidates (`webrtc:ice-candidate`).
4. WebRTC establishes a direct, ultra-low latency peer-to-peer media track.
5. Full event payload schemas and lifecycle transitions are specified in [`docs/architecture.md`](docs/architecture.md#4-external-webrtc-receiver-signaling-contract-version-10).

### Method 2: HTTP MJPEG Streaming Endpoint (Universal Fallback)

While a client is connected to it, the Node.js server provides an authenticated HTTP multipart video stream (the sender uploads JPEG frames only while a client is connected; connect Python to `localhost` to avoid tunnel traffic):
```text
http://<host>:3000/stream/<roomId>?pin=<accessPin>
```
Any external tool or script can read this stream directly with standard OpenCV:
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

---

## Security Best Practices

- Change `ACCESS_PIN` in your `.env` file before exposing the server.
- The server does **not** store or record video feeds to disk.
- Signaling messages are strictly room-isolated and rate-limited.
