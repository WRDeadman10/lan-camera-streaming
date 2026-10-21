# LAN Camera Streaming — Project Overview

## 1. Purpose

Build a small self-hosted web application that lets a phone, tablet, or laptop share its camera through a browser URL, then lets another browser watch the live feed. The initial target is devices on the same local area network (LAN), with an optional HTTPS tunnel for convenient access during development or when a trusted local HTTPS setup is not yet available.

No native mobile app is required. Users open a web page, grant camera permission, and explicitly start or stop streaming.

## 2. Primary user flow

1. Start the application on a Windows PC.
2. Open the host's HTTPS URL on the camera device and navigate to the sender page.
3. Enter or create a room/pairing code, grant camera permission, and click **Start streaming**.
4. Open the viewer page on the receiving device and join the same room.
5. Watch the live feed. The sender can stop sharing at any time.

The first milestone was one sender and one viewer. Since ADR-018 a room accepts one sender and several viewers (one WebRTC connection per viewer). The phone camera can also be exposed to Windows applications as a virtual webcam (section 3, ADR-021/023). Multiple senders in one room remain out of scope.

## 3. Goals

- Run the signaling/web application on a Windows PC.
- Let modern mobile and desktop browsers capture a camera after an explicit user action.
- Provide two selectable media transport modes:
  - **Mode A (WebRTC Mode)**: Direct peer-to-peer live video with low latency over LAN or TURN relay.
  - **Mode B (Experimental zrok Tunnel Relay)**: Canvas capture and binary JPEG frames routed deliberately through the Windows server to measure latency and test against zrok's free daily transfer allowance (5 GB).
- Use Socket.IO for room coordination, WebRTC signaling, and binary frame relay.
- Support zrok as the primary public HTTPS tunnel provider for convenient, secure mobile browser access.
- Make stream state visible: waiting, connecting, live, disconnected, and stopped.
- Serve **external receivers** in any language or engine (a Python/OpenCV/YOLO script, a Unity app, a service) through a documented contract: WebRTC signaling, an MJPEG endpoint and the tunnel relay. See [`receiver-guide.md`](receiver-guide.md).
- Provide real-time diagnostics: frame rates, dropped frames, encoding latency, and data transfer rates.
- Distribute the server as a standalone Windows executable (`lan-camera-streaming.exe`) that needs no Node.js on the target PC.
- Offer a Windows **virtual webcam** ("LAN Phone Camera") so any Windows application can use the phone camera: a Media Foundation camera for the Windows Camera app, Teams, Zoom, Chrome and Unity (Windows 11), and a DirectShow camera for OBS, ffmpeg and older software. It ships as one Inno Setup installer (`lan-camera-setupv<version>.exe`) built from the `vcam` submodule.
- Offer **remote desktop control** for Windows desktop screen sharing: an authorized viewer can control the host mouse and keyboard via permanent password or temporary session PIN, using the native `remote-control-helper` submodule and WebRTC DataChannel / loopback IPC.
- Offer **mobile-optimized viewing & TeamViewer-style remote control**: universal pinch-to-zoom (1x-4x) and pan across all media sources, zoom-aware coordinate translation, touchpad-style Mouse mode and direct Touch mode, adaptive cursor overlay, mobile control toolbar, on-screen keyboard text input, modifier keys, and special shortcuts (ADR-038).
- Provide first-class hosting on **Ubuntu 24.04 LTS and POSIX Linux** with an automated startup supervisor (`start.sh`), zrok tunnel management, terminal QR codes, and LAN IP discovery (ADR-039).
- Avoid recording, storing, or uploading video to a cloud service.

## 4. Non-goals for the MVP

- Native iOS, Android, Windows, or macOS applications.
- Cloud video storage or recording.
- Video transcoding or an always-on media server.
- Guaranteed internet-wide connectivity without TURN configuration.
- Multiple senders in one room, group calls, or an SFU/media server for many viewers (the one-to-many mesh is practical for a few viewers only).
- A kernel-mode camera driver or code-signed installer (the virtual camera is user-mode and the installer is unsigned).
- User accounts, billing, or a public multi-tenant service.

## 5. Proposed technology

| Area | Choice | Responsibility |
|---|---|---|
| Runtime | Node.js | Runs the server on Windows |
| Distribution | Single Executable (`.exe`) | Standalone zero-dependency Windows console executable via Node SEA |
| Virtual webcam | C++ (MSVC, static CRT), DirectShow + Media Foundation, Inno Setup 6 | Separate repository mounted as the `vcam/` submodule; one installer `lan-camera-setupv<version>.exe` |
| Remote control helper | C++ (MSVC / CMake, SendInput), Winsock2 | Separate repository mounted as `remote-control-helper/` submodule; injects native OS input on Windows |
| HTTP server | Express | Serves the web pages, static assets, and optional MJPEG stream |
| Signaling & Relay | Socket.IO | Room membership, WebRTC signaling, binary tunnel frame relay, and control authorization |
| Camera capture | Browser `getUserMedia()` | Requests permission and captures local camera stream |
| Screen capture | Browser `getDisplayMedia()` | Captures desktop displays/windows with cursor exclusion option (ADR-028/030) |
| Standard media transport | WebRTC | Direct peer-to-peer live video and DataChannel control between sender and receiver (Mode A) |
| Experimental media transport | Binary Canvas JPEG | Relays binary frames through Windows server over WebSocket (Mode B) |
| External integration | Socket.IO WebRTC & HTTP MJPEG | Versioned contract for external clients (e.g. Python OpenCV / YOLO) |
| UI | HTML, CSS, browser JavaScript | Responsive sender and viewer interfaces with diagnostics panel and remote control controls |
| HTTPS / Tunnel | zrok (primary) | Provides public HTTPS tunnel with 5 GB/day free transfer |
| Media fallback | TURN server, if later required | Relays media when direct ICE connectivity cannot be established |

## 6. Network and privacy model

- Preferred media path: sender browser directly to viewer browser over the LAN using WebRTC.
- If the devices are not on the same reachable network, WebRTC may establish another direct path; it is not guaranteed.
- If direct connectivity fails, a configured TURN server may relay media. TURN bandwidth is separate from web/signaling traffic and can add latency.
- A public tunnel URL can make the web application reachable beyond the LAN. Treat it as public: require a pairing secret or PIN, validate room membership on the server, and do not expose administrative operations without authorization.
- Do not forward router ports as part of the MVP.
- Camera capture must begin only after the user explicitly clicks the start control. Stop all media tracks when streaming ends or the page is closed.
- The MVP does not save video to disk or send it to an application server for storage.

## 7. HTTPS requirement

Browser camera access generally requires a secure context. `localhost` is treated specially by browsers, but another device visiting a Windows PC's private IP over plain HTTP typically is not. Use a valid HTTPS origin for the sender page. A tunnel can provide convenient HTTPS for initial testing; for LAN-only deployment, a locally trusted certificate/CA is an alternative.

## 8. Initial scope and provisional targets

- One camera sender and one or more viewers (a few; each viewer adds an encoder on the camera device).
- Optional Windows virtual webcam fed by a PC viewer page (1280x720 at 30 FPS).
- Video only; audio is disabled unless explicitly added later.
- Target 720p at 30 FPS where the camera and browser support it. Actual resolution and frame rate must be read from the negotiated stream and measured rather than assumed.
- Test a 10-minute session on the same Wi-Fi without manual reconnection.
- Record observed connection setup time, frame rate, resolution, and end-to-end latency during testing. A sub-500 ms end-to-end latency target may be used as an initial LAN benchmark, not as a cross-network guarantee.

## 9. Definition of MVP complete

- A Windows host can be started using documented commands.
- Sender and viewer pages load over a camera-permission-compatible HTTPS origin.
- A sender can grant permission, start, and stop its camera.
- One or more viewers can join the same room and receive live video through WebRTC.
- The app exposes useful connection status and handles normal disconnects without silently remaining in a false `Live` state.
- The media path has been verified to be direct on the test LAN where possible; any TURN relay use is visible in diagnostics or test notes.
- A pairing code/token prevents an arbitrary visitor from joining a stream merely by discovering the public URL.
- The limitations and setup steps are documented.

### Viewport Controls Ribbon & Mobile Swipe Action Bar (ADR-043)
The viewer viewport features a dedicated non-intrusive stream controls ribbon situated directly below the video canvas (outside the video container). This completely unblocks the top-right corner of the video feed so Windows desktop controls (Close, Minimize, Maximize) are fully visible and clickable during remote control. On mobile devices, the ribbon provides smooth inertia horizontal scrolling with zero wrapping or off-screen clipping.

### UX Streamlining, Reachable LAN Pairing & Progressive Disclosure (ADR-044)
The user experience is designed for immediate, friction-free operation across both desktop and mobile devices:
- **Reachable LAN Pairing:** Localhost pairing automatically discovers host Wi-Fi/LAN IP addresses, ensuring mobile phone camera pairing works out of the box without loopback failures.
- **One-Click Viewer Sharing:** Generated share links and QR codes pre-fill the room and PIN for instant 1-click joining.
- **Centered Viewport Join Form:** Inactive desktop viewers can enter credentials and connect directly within the central video canvas, eliminating eye travel to the sidebar.
- **Progressive Disclosure:** First-time senders see only the 4 essential setup fields, with advanced video, transport, and remote-control options neatly organized in expandable settings.
- **Distraction-Free Backgrounds:** Clean local dark space styling eliminates failing 403 API calls on local networks.

### Security Hardening, Transport Compliance & Authorization Architecture (ADR-045)
Comprehensive hardening across the signaling server, media pipelines, and native helper ensures zero unauthorized access and strict RFC compliance:
- **Zero-Trust Remote Control:** WebRTC DataChannel control messages enforce sender-side controller lease verification; departing controllers automatically release all held keys and mouse buttons.
- **Protected Native Helper:** The native loopback helper mandates authentication token validation for `POST /input` and restricts CORS strictly to loopback origins (`localhost`, `127.0.0.1`, `[::1]`).
- **Sender Eviction Guard:** Senders receive a cryptographic `senderToken` upon room creation; rogue or duplicate senders cannot evict an active streamer without matching credentials.
- **Boundary & Header Hardening:** RTSP streams require PIN authentication or Basic Auth; `/api/vcam/bridge-frame` enforces PIN verification; SDP/ICE signaling targets are strictly validated within the room; MJPEG adheres to RFC 2046 MIME boundaries with TCP backpressure management.
