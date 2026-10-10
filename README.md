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

## Documentation

| Read | For |
|---|---|
| [`docs/receiver-guide.md`](docs/receiver-guide.md) | **Connecting anything to this server** (any language or engine): transports, sequence, errors, checklist, the Unity + Python reference integration |
| [`docs/architecture.md`](docs/architecture.md) | Components, routes, the formal receiver signaling contract (§4) |
| [`docs/project-overview.md`](docs/project-overview.md), [`docs/roadmap.md`](docs/roadmap.md), [`docs/tasks.md`](docs/tasks.md), [`docs/decisions.md`](docs/decisions.md) | Scope, plan, backlog, decisions |
| [`docs/ai_handoff.md`](docs/ai_handoff.md) | Current status for the next person or agent |

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

## Connecting a receiver (any language, any engine)

This application is the **camera source and signaling server**. It does not care what consumes the video: a Python/OpenCV/YOLO
script, a Unity or Unreal app, a Go or Rust service, `ffmpeg`, another browser. Anything that can speak HTTP + Socket.IO (and, for the
low-latency path, WebRTC) can be a receiver. **Start with [`docs/receiver-guide.md`](docs/receiver-guide.md)**: the technology-neutral
contract, the message sequence, the error table and the mistakes that cost the most time.

| Transport | How a receiver gets frames | Joins the room? | Uses tunnel quota? |
|---|---|---|---|
| **WebRTC** (lowest latency) | Socket.IO signaling + a WebRTC video track, peer to peer | Yes, as `webrtc-receiver` | Signaling only |
| **MJPEG** (simplest) | `GET /stream/<roomId>?pin=<accessPin>`, read by OpenCV, ffmpeg or any HTTP client | No | Yes, every frame |
| **Tunnel relay** (last resort) | `tunnel:frame` Socket.IO events carrying JPEG buffers | Yes, with `mediaMode: "tunnel-relay"` | Yes, every frame |

What every receiver needs to know:

- **Endpoints:** `GET /api/config` returns the ICE servers (build your peer connection from it); Socket.IO is on the base URL, default
  namespace; the viewer link a person sees is `http(s)://<host>/viewer?room=<roomId>` and **does not contain the PIN**.
- **One viewer per room.** A browser viewer open in the room blocks a receiver (and the reverse): the join is refused with
  `Room already has an active viewer/receiver.`
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

## Security Best Practices

- Change `ACCESS_PIN` in your `.env` file before exposing the server.
- The server does **not** store or record video feeds to disk.
- Signaling messages are strictly room-isolated and rate-limited.
