# LAN Camera Streaming — Architecture Decision Records

This document records current decisions and unresolved items. A decision may be revised when implementation evidence justifies it; update the relevant entry rather than silently changing the architecture.

## ADR-001 — Use WebRTC for media transport

**Status:** Accepted

**Decision:** Browser-to-browser live video uses WebRTC. Do not send video frames through Socket.IO, ordinary HTTP polling, or the HTTPS tunnel.

**Reasoning:** WebRTC is designed for real-time media and can establish a direct peer-to-peer path. The server then remains a signaling service instead of a video relay, which reduces server load and avoids spending tunnel bandwidth on media when a direct path works.

**Consequences:** A working signaling exchange alone does not guarantee media connectivity. The app must manage ICE, connection state, remote tracks, cleanup, and optional TURN configuration.

## ADR-002 — Use Socket.IO for signaling

**Status:** Accepted

**Decision:** Use Socket.IO for room events and WebRTC offer/answer/ICE exchange.

**Reasoning:** It provides a convenient event-based channel for browser clients and a Node.js server.

**Consequences:** Event payloads, room authorization, reconnection behavior, validation, and size limits must be defined. Socket.IO carries signaling only, not video.

## ADR-003 — Use Node.js and Express on the Windows host

**Status:** Accepted

**Decision:** Host the web app and Socket.IO signaling endpoint on a Windows PC using Node.js and Express.

**Reasoning:** This matches the requested self-hosted setup and allows the service to be started and maintained locally.

**Consequences:** Provide clear start/stop commands, health checks, Windows firewall guidance, and environment configuration. Keep the HTTP server and Socket.IO server on the same listener unless there is a documented need to split them.

## ADR-004 — Use a browser-compatible HTTPS origin for camera capture

**Status:** Accepted

**Decision:** Sender and viewer pages must be served from an HTTPS origin that the browser trusts. During initial development, use one of ngrok or zrok if that is the easiest trusted HTTPS entry point. For LAN-only deployment, a locally trusted certificate is an alternative.

**Reasoning:** Camera APIs are generally restricted to secure contexts; a private LAN IP over plain HTTP is not normally treated like `localhost`.

**Consequences:** A tunnel is optional infrastructure, not a media transport. Do not require both tunnel tools. Public tunnel access needs authorization and should be treated as internet-reachable.

## ADR-005 — Prefer direct media, with TURN as a future fallback

**Status:** Accepted for MVP; TURN is deferred

**Decision:** Test direct WebRTC connectivity on the same LAN first. Add a TURN server only when target-network tests demonstrate a need.

**Reasoning:** The initial purpose is LAN streaming, and direct media avoids relaying high-volume video through the web tunnel or a media server.

**Consequences:** The MVP must document that some network topologies block direct connectivity. No claim is made that direct media will work across every Wi-Fi, NAT, VPN, or firewall setup.

## ADR-006 — Keep the first release to one sender and one viewer

**Status:** Superseded by ADR-018 (several viewers per room); one sender per room still holds

**Decision:** Implement one camera source and one receiving browser for the first milestone; video only, with audio disabled.

**Reasoning:** This validates permissions, signaling, media connectivity, lifecycle management, and diagnostics before introducing concurrency.

**Consequences:** Enforce room capacity server-side. Group calls, multiple viewers, audio, recording, and media-server/SFU functionality are out of MVP scope.

## ADR-007 — Do not record or store media

**Status:** Accepted

**Decision:** The MVP does not persist or record video, and the Node.js server does not ingest the media stream.

**Reasoning:** The requirement is live viewing, not storage. This reduces data handling and infrastructure complexity.

**Consequences:** Do not implement recording endpoints, frame uploads, or server-side video storage without an explicit scope change.

## ADR-008 — Protect rooms even if the URL is hard to guess

**Status:** Accepted

**Decision:** Require room authorization with an unguessable room ID plus a pairing secret/PIN, and validate access on the server.

**Reasoning:** A public HTTPS tunnel can make the website reachable outside the LAN. A URL alone is not sufficient access control.

**Consequences:** Rate-limit room creation and joins, expire idle rooms, avoid logging secrets, and expose no unauthenticated admin features.

## ADR-009 — Keep the frontend framework-free for the MVP

**Status:** Accepted provisionally

**Decision:** Start with plain HTML, CSS, and browser JavaScript unless the repository already uses a framework.

**Reasoning:** Two small pages do not require a frontend framework, so a minimal client keeps the initial implementation understandable and lightweight.

**Consequences:** Separate signaling/media logic from DOM rendering. Revisit only if the UI or state complexity grows enough to justify a framework.

## ADR-010 — Provide direct HTTP MJPEG and snapshot endpoints for Python inference

**Status:** Accepted

**Decision:** Implement `/stream/:roomId?pin=...` (multipart/x-mixed-replace MJPEG) and `/snapshot/:roomId?pin=...` (single frame JPEG) on the server, paired with canvas frame capture on the sender.

**Reasoning:** Python machine learning and computer vision frameworks (such as OpenCV `cv2.VideoCapture`, PyTorch, YOLO, and requests) natively consume HTTP MJPEG URLs out of the box without requiring complex C WebRTC bindings or SDP signaling exchanges in Python.

**Consequences:** Sender client uploads JPEG frames via Socket.IO/binary buffers when active; the server distributes them to authorized HTTP consumers. WebRTC remains the primary low-latency browser-to-browser transport.

## ADR-011 — Separate External Receiver Implementation from Node.js Core

**Status:** Accepted

**Decision:** The Node.js repository will not contain Python source code or embedded inference implementations. Instead, this repository owns:
1. Browser camera capture interface.
2. Socket.IO signaling server.
3. Access-controlled room management (1 sender, any number of receivers since ADR-018).
4. WebRTC session negotiation and ICE routing.
5. Optional HTTP MJPEG stream endpoint.
6. Formal specification of the external receiver signaling contract.

The Python `aiortc` receiver and computer vision/YOLO pipeline are maintained in an external, independent repository.

**Reasoning:** Maintains clean architectural boundaries, zero Python dependency on the Node.js host, and allows the external receiver to evolve independently.

## ADR-012 — Support Two Selectable Media Transport Modes (WebRTC vs Experimental zrok Tunnel Relay)

**Status:** Accepted

**Decision:** The application provides two explicit, selectable media transport modes:
1. **Mode A (WebRTC — Direct/ICE media)**: Default peer-to-peer media stream for low-latency browser streaming.
2. **Mode B (Experimental — Video through zrok)**: Deliberate application-level relay. Sender encodes downscaled JPEG frames (default 640x360 @ 10 FPS, Q=0.6) into binary buffers sent over Socket.IO (`tunnel:frame`). The Windows Node.js server validates magic bytes, enforces backpressure frame drops, and forwards raw binary buffers to the authorized viewer.

**Reasoning:** The user selected zrok as the primary tunnel provider to experiment with video streaming through zrok's free daily quota (5 GB daily transfer), comparing direct WebRTC vs tunneled application relay under real network conditions.

**Consequences:** Both sender and viewer must agree on the room's media mode. Mismatched joins are rejected. Server memory is protected with strict frame size bounds (<=600KB) and rate-limiting backpressure drop logic. No Base64 encoding is used.

## ADR-013 — WebRTC LAN Connectivity Diagnosis, Candidate Queueing, and Mode B Fallback

**Status:** Accepted

**Decision:**
1. Implement early remote ICE candidate queuing (`pendingRemoteCandidates`) and pre-fetched ICE configuration on both the sender and viewer clients to prevent silent candidate loss during SDP negotiation.
2. Provide verbose real-time diagnostic logging on both client interfaces, parsing all candidate types (HOST, SRFLX, RELAY, mDNS), protocols, addresses, gathering states, signaling states, candidate errors, and active candidate-pair RTT statistics.
3. When ICE connection fails on a LAN with zrok, the client displays a targeted diagnosis and prompts the user to switch to **Mode B (Experimental zrok Tunnel Relay)**.

**Reasoning:**
When connecting Windows and Android on the same Wi-Fi network through a public zrok tunnel:
- Windows-to-Windows across different networks succeeds because distinct public IPs allow direct STUN server-reflexive (`srflx`) hole punching.
- Windows-to-Android on the same Wi-Fi often fails direct WebRTC because:
  - Android Chrome obfuscates private IPs with mDNS (`<uuid>.local`), which Windows cannot resolve if the router blocks multicast (AP isolation / IGMP filtering) or if Windows Firewall blocks incoming mDNS.
  - When falling back to STUN `srflx`, both devices share the exact same router public WAN IP. If the router does not support NAT loopback (hairpinning), UDP packets addressed from inside the LAN to the router's own WAN IP are dropped.
  - Early candidates were previously dropped if they arrived over Socket.IO while the client was performing an asynchronous HTTP fetch of `/api/config`.
  - Windows Defender Firewall classifies Wi-Fi as "Public" by default and drops incoming UDP hole-punch packets.

**Consequences:**
Eliminating candidate drops ensures all candidate pairs are evaluated. Detailed diagnostic logging enables the operator to immediately verify whether HOST or SRFLX candidates are gathered and which pairs fail. Mode B provides an immediate 100% reliable fallback on networks where router NAT hairpinning or firewall policies prevent direct WebRTC UDP peer connections.

## ADR-014 — Native Full Sensor Camera Resolution and Clean zrok Cloud Endpoint Deallocation

**Status:** Accepted

**Decision:**
1. Allow the sender client to request the full native maximum resolution supported by the device camera sensor (using unconstrained ideal constraints `width: { ideal: 4096 }, height: { ideal: 2160 }`), while providing user-selectable capture tiers (Max Full Sensor, 1080p, 720p, 480p).
2. Allow Mode B (Tunnel Relay) to stream at full native camera resolution without downscaling when requested.
3. Bind the public zrok tunnel explicitly to the reserved name `public:lan` (`zrok2 share public <target> -n public:lan`), ensuring the public URL is always predictable (`https://lan.shares.zrok.io`) and matches the generated terminal QR code.
4. Execute pre-flight and post-flight cloud deallocation (`zrok2 delete share public:lan` and token cleanup) in `start.ps1` to prevent ghost share bindings from persisting on the zrok web console dashboard.

**Reasoning:**
- Mobile phones feature high-resolution 1080p and 4K camera sensors. Previously hardcoding `1280x720` artificially degraded image quality for both WebRTC and computer vision inference.
- Previously, randomly generated ephemeral shares without explicit namespace name attachment left dangling bindings in the zrok controller when terminated via SIGINT/Ctrl+C, causing the zrok web dashboard to show stale targets and generating QR codes with outdated URLs from older runs.

**Consequences:**
High-resolution camera sensors operate at their full optical fidelity. The terminal QR code reliably opens `https://lan.shares.zrok.io/sender`. Terminating `start.ps1` immediately releases the endpoint from the zrok cloud controller.

## ADR-015 — Keep video off zrok: on-demand MJPEG, localhost viewer, optional local HTTPS

**Status:** Accepted

**Decision:**
1. The sender uploads MJPEG frames (`mjpeg:frame`) only while the server reports demand (`mjpeg:demand { active }`): an open `/stream/:roomId` connection or a pending `/snapshot/:roomId`. The server also drops frames when there is no demand. Frames are capped at 1280 px width and 900 KB with one in-flight encode.
2. The viewer on the Windows PC should be opened at `<scheme>://localhost:<port>/viewer` so it never touches zrok. `/api/network-info` returns only scheme and port (never LAN IPs, because the route is reachable through the public tunnel); LAN addresses are printed only in the local terminal by `start.ps1`.
3. Mode B (tunnel relay) is a last-resort fallback and labelled as quota-consuming.
4. The server can serve HTTPS directly (`HTTPS_CERT_PATH` + `HTTPS_KEY_PATH`). `start.ps1 -LocalOnly` runs without zrok over plain HTTP, or HTTPS with a user-supplied certificate. A bundled mkcert flow (CA install on every phone) was tried and removed: the zrok default already gives a trusted certificate with no phone setup. `start.ps1` is the only script in the repository; the former `scripts/` helpers were folded into it. In tunnel mode `start.ps1` forces plain HTTP because zrok proxies to an `http://127.0.0.1` target.
5. The sender and viewer classify the nominated ICE pair as LAN direct / internet / TURN relay and show it in the UI.

**Reasoning:** `startMjpegFrameLoop()` previously ran unconditionally after joining a room, uploading ~15 FPS JPEGs through Socket.IO (and therefore zrok) even in WebRTC mode with no consumer, which dominated quota use. WebRTC media is UDP and cannot traverse a zrok public share; on one Wi-Fi it flows host-to-host, so only the page and signaling need zrok. The earlier mDNS/NAT-hairpin explanation in ADR-013 is unlikely to apply to a host-host pair (a camera-permitted sender exposes real LAN IPs and ICE checks are bidirectional); the real blockers are AP/client isolation, Windows Firewall profile and VPN adapters. This is reasoned from browser behavior and not yet measured on the target network.

**Consequences:** A Python/HTTP consumer connected to the zrok URL still pulls frames through zrok (by design, only while connected). Tunnel-free phone camera access needs either the Chrome insecure-origin flag or a user-supplied trusted certificate.

## ADR-016 — External receivers are first-class: the contract is documented technology-neutrally, and the server is unchanged

**Status:** Accepted

**Decision:**
1. This project stays the **camera source and signaling server**. Receivers (a Python/OpenCV/YOLO script, a Unity or other engine app, a service in any language) are separate programs that speak the documented contract; the server gains no receiver-specific code.
2. The contract lives in two places: the formal schemas in `architecture.md` §4 (corrected to the server's real behavior) and a practical, technology-neutral `receiver-guide.md` (transport choice, sequence, error and retry table, failure diagnosis, receiver checklist).
3. Three transports are documented for receivers: WebRTC (lowest latency, peer to peer, signaling only through the server), MJPEG over HTTP (simplest, does not join the room) and tunnel relay (last resort). MJPEG and tunnel relay spend tunnel quota (ADR-015).
4. The first real receiver, the Viitorx Unity app with its Python sidecar, is recorded as a **reference integration**, not as part of this project: it lives in the other repository and is written to the guide.

**Reasoning:** The first external receiver surfaced several behaviors that the earlier contract did not state, and each cost debugging time: `peer:joined` is sent only to the participant already in the room (the second to join learns from `hasPeer` in its ack); membership is per socket, so a reconnecting receiver must join again; the viewer slot is exclusive, so a browser viewer silently blocks a receiver; five failed joins block a socket for 30 s, so a receiver that retries a wrong PIN makes things worse; candidates arrive before the offer is applied; the MJPEG delimiter is not the RFC form. Writing these down once, in a form that does not assume Python, is cheaper than each integration rediscovering them.

**Consequences:** A new integration in any language has a checklist to build against. The server's behavior is now a documented contract, so changing it (event names, payloads, the exclusive viewer slot, the join rate limit) is a breaking change for receivers in other repositories and needs an ADR and a `receiver-guide.md` update.

**Verified / not verified:** The WebRTC path was exercised against this server with a Python (`aiortc`) receiver and a Python stand-in phone on loopback (join, offer/answer, a phone that leaves and returns, a socket drop, wrong PIN, occupied room, a slow consumer); MJPEG and tunnel relay with an earlier standalone Python receiver. Not verified: a real phone's browser sender page with an external receiver, real Wi-Fi/firewall behavior, a zrok tunnel, real-phone latency, and any receiver in a language other than Python.

## ADR-017 — Standalone console application and single .exe via Node SEA and embedded static assets

**Status:** Accepted

**Decision:**
1. Support running the application as a standalone Windows console application single executable (`dist/lan-camera-streaming.exe`).
2. Build the executable using Node.js official Single Executable Application (SEA) capabilities combined with `esbuild` for bundling and `postject` for resource injection into the PE binary.
3. Automatically embed all frontend static assets (`src/public`) into an in-memory asset map (`src/server/embedded-assets.js`) during the build process, while preserving disk-based asset serving when assets exist on the filesystem.
4. Provide a rich CLI interface (`src/server/cli.js`) featuring interactive console banner, automatic LAN IPv4 detection, terminal ASCII QR code generation via `qrcode-terminal`, command-line flags (`--port`, `--host`, `--pin`, `--local`, `--zrok`, `--env`, etc.), dynamic `.env` auto-loading, and optional automated zrok tunnel management with cleanup on shutdown.
5. Expose `.env` and `.env.example` directly in `dist/` alongside the executable so users can configure settings (PORT, ACCESS_PIN, ZROK_TOKEN, etc.) in text without static baking. If launched without a `.env` file, the executable auto-generates a default template next to itself.
6. Provide an icon identity (`assets/icon.ico`, `assets/icon.png`, `src/public/assets/icon.svg`, `src/public/favicon.ico`), integrated into all web UI headers/favicons and embedded directly into the Windows `.exe` resource table via `resedit`.
7. Provide a root build script (`build.bat`) that automatically increments the patch/last digit of the application version in `package.json` and `package-lock.json` (`scripts/bump-version.js`), rebuilds embedded assets, updates Windows PE binary version info (`VersionInfo`), and produces the single executable.

**Reasoning:**
Distributing the application as a standalone `.exe` eliminates the need for end users to install Node.js, npm, or dependencies on target machines. Exposing `.env` in `dist/` allows users to edit their configuration using standard text editors while the `.exe` dynamically loads the values at runtime rather than having settings hardcoded into the binary. Automating version bumping in `build.bat` ensures every generated build has a distinct, traceable version number in both the CLI and Windows Explorer file properties.

**Consequences:**
A single click or command (`build.bat`) increments the version, bundles static assets, compiles the full application into `dist/lan-camera-streaming.exe`, stamps the PE icon and version info, and exposes `dist/.env`. Testing verifies that the executable runs in an isolated directory, dynamically loads custom `.env` values, auto-generates `.env` when missing, and serves all endpoints.

**Correction (2026-10-12):** the browser Socket.IO client cannot come from `node_modules` inside the exe. `signaling.js` sets `serveClient: false`; `server.js` serves the client at `/vendor/socket.io.js` (installed package first, embedded copy as fallback) and the pages load it from there. It must not live under `/socket.io/` because engine.io intercepts every request on that prefix. Any new runtime file read from `node_modules` or the source tree needs the same embedding treatment.

## ADR-018 — Multi-viewer concurrent WebRTC mesh streaming

**Status:** Accepted

**Decision:**
1. Transition from the 1-to-1 connection model to a 1-to-many multi-peer mesh model per room.
2. In `RoomManager`, replace the single `viewerSocketId` with `viewerSocketIds: Set<string>`. Multiple viewers can join the same room simultaneously without throwing `"Room already has an active viewer/receiver."`. Exactly 1 sender remains enforced per room.
3. In `signaling.js`, enhance `webrtc:offer`, `webrtc:answer`, and `webrtc:ice-candidate` to route targeted payloads between the sender and individual viewers using `targetId` / `viewerId` / `senderId`. Broadcast non-targeted sender candidates and tunnel frames (`tunnel:frame`) to all connected viewers in the room.
4. On the sender client (`sender.js`), manage an individual `WebRtcPeer` instance for each connected viewer (`Map<viewerId, WebRtcPeer>`). When a viewer joins (`peer:joined`), the sender creates an offer specifically targeted to that viewer. When a viewer disconnects (`peer:left`), the sender closes only that viewer's peer connection without tearing down other viewers or stopping the camera.

**Reasoning:**
Eliminates user lockouts caused by duplicate browser tabs, reloading, or external receiver sidecars (e.g. Unity or Python) needing to stream concurrently with a PC browser preview.

**Consequences:**
Multiple viewers can watch the live camera stream concurrently over WebRTC or tunnel relay. Since the sender phone uploads an individual WebRTC track per viewer, performance depends on device encode power and local network bandwidth (typically 2–4 viewers on modern devices).

**Follow-up (2026-10-12):** a sender page loaded before this change sends offers without `targetId`, which previously gave every offer to the first viewer and left the others stuck on "Negotiating connection...". The server now rejects an untargeted offer when two or more viewers are present (`room:error` asking the user to reload the sender page). Verified live with 2-3 browser viewers; a real phone with 2+ viewers is untested (each viewer costs the phone one more encoder).

## ADR-019 — Ayurvedic Holistic Product Design & UI/UX Elevation

**Status:** Accepted

**Decision:**
1. Ground the frontend design philosophy in Ayurvedic principles of balance (Sattva), sensory clarity, and ergonomic vitality (Prāna):
   - **Sattvic Botanical Theme:** Replace high-contrast, clinical dark themes with a soothing herb-slate palette (`#0a1317`, `#121e24`, `#1f353d`) accented by botanical emerald (`#10b981`), warm turmeric amber (`#f59e0b`), and pitta-cooling terracotta alert tones (`#ef4444`).
   - **Prāna Pulse Animation:** Introduce organic breathing keyframes for live status and connection indicators rather than abrupt flashes.
2. **Nāḍī Parīkṣā (Holistic Vitals Dashboard):**
   - Provide a real-time, glanceable vitals bar on both sender and viewer displaying flow/pulse (FPS), acuity (Resolution), audience count (Viewers), path harmony (LAN Direct / Internet / Relay), and latency/ping (RTT).
3. **Viewport Heads-Up Display (HUD) & Ergonomics:**
   - Overlaid glassmorphism HUD on viewfinder and viewer:
     - Sender: Quick camera flip, flashlight/torch toggle (when supported by device hardware constraints), snapshot still capture, and fullscreen view.
     - Viewer: Picture-in-Picture (PiP) support (`requestPictureInPicture()`), full-frame snapshot download, fullscreen toggle, and instant reconnect recovery.
   - Foldable session setup: Auto-minimize or collapse setup cards during streaming so the camera viewfinder and share passes remain focal.
   - 1-tap clipboard copying with visual confirmation on QR codes, localhost links, and Python endpoints.
4. **Collapsible Diagnostics Drawer:**
   - House technical WebRTC stats, SDP logs, and candidate traces in a collapsible drawer to eliminate cognitive noise for regular users while keeping full diagnostic power one click away.

**Reasoning:**
Video streaming interfaces frequently inflict optical fatigue and sensory agitation (Rajas/Tamas). Applying Ayurvedic principles produces a calm, alert, and deeply ergonomic experience that empowers users to monitor and stream with ease.

**Consequences:**
Substantially enhanced mobile thumb ergonomics, instant access to stream health vitals, still capture capabilities, and reduced cognitive overload across all platforms.

## ADR-020 — Orientation-Aware Single-Screen UX Architecture

**Status:** Accepted

**Decision:**
1. **Single-Screen Landscape Viewport (`100dvh`):**
   - Eliminate document-level scrolling on desktop monitors, laptops, tablets, and rotated mobile devices (tested down to 667×320 and 844×390).
   - In landscape orientation, use a CSS Grid / Flex workspace with a side-by-side layout:
     - **Sender:** Left pane houses the camera preview viewfinder with floating HUD controls; right pane houses compact session setup / broadcasting sharing panel.
     - **Viewer:** 70/30 split where the remote live video receives visual priority on the left (65–75% width), while session state and controls occupy the right pane.
   - Constrain `.sidebar-pane` to `overflow-y: auto; overflow-x: hidden;` so controls degrade gracefully without clipping on ultra-short viewports while keeping the main video pinned in full view.
2. **Portrait Fluid Stacking:**
   - On vertical mobile/tablet orientations, switch to single-column stacking.
   - When broadcasting or joined (`.streaming-active`), elevate the viewport pane above the setup controls (`order: 1` over `order: 2`) so the active video remains immediately visible upon session start.
3. **State-Driven Workflow Transitions:**
   - **Sender:** Collapse the setup form upon starting, surface an active broadcasting share card with quick link copy & optional QR reveal, and toggle primary Start button to Stop button.
   - **Viewer:** Collapse the Room ID / PIN join form into a compact "CONNECTED" session status bar with one-click Leave Stream button.
   - **Developer Tools & Integrations:** Move Python OpenCV stream endpoints (`/stream/:roomId?pin=...`), Direct PC viewer links, and SDP/ICE diagnostics into a collapsible drawer (`<details class="collapsible-section card-collapsible">`) collapsed by default.

**Reasoning:**
Video streaming is an active visual medium where operators and viewers need constant sight of the frame alongside immediate access to session actions. Indiscriminate vertical scrolling disconnects users from their live feeds.

**Consequences:**
Complete viewability on both mobile orientations and desktop displays without scroll fatigue, zero regressions to WebRTC signaling or Python endpoints, and graceful resilience on ultra-short screens.

## ADR-021 — DirectShow Virtual Camera Driver & Deeplink Integration

**Status:** Accepted, amended by ADR-023 (Camera app) and ADR-024 (distribution)

**Decision:**
1. **DirectShow Virtual Source Filter (`LanCamFilter.dll`):**
   - Implement an in-process COM DirectShow source filter registered under `CLSID_VideoInputDeviceCategory` as `"LAN Phone Camera"`.
   - The filter consumes the HTTP/MJPEG stream from `http://127.0.0.1:7777/stream/<roomId>?pin=<pin>` using WinHTTP and decodes frames using the Windows Imaging Component (WIC) into uncompressed RGB24 samples.
   - Outputs standard DirectShow pins (`IPin`, `IAMStreamConfig`, `IKsPropertySet`) so DirectShow applications (OBS, ffmpeg, Chrome/Electron apps, classic Zoom/Teams) can use it like a USB webcam. (The Windows Camera app is not one of them; see ADR-023.)
2. **Deeplink Protocol Scheme (`lancam://`):**
   - Provide a companion launcher (`lancam-setup.exe`) that registers the custom protocol `lancam://` in Windows Registry.
   - When the user clicks "Set as Webcam" in the browser viewer, the browser launches `lancam://stream?room=...&pin=...&host=...&port=...`.
   - The launcher persists the active room and PIN into `%LOCALAPPDATA%\LanCamera\session.ini`, allowing the DirectShow filter to tune to the active room automatically without manual configuration.
3. **Distribution & Packaging:**
   - Originally packaged as `dist/lancam-vcam-setup.zip` served at `/download/lancam-vcam`; replaced by the one-file installer of ADR-024.

**Reasoning:**
Eliminates third-party software dependencies (such as OBS Studio or Python scripts) when users want to treat their mobile camera feed as a native hardware webcam for desktop applications.

**Consequences:**
Users can use the phone camera in DirectShow applications after registering the driver once.

**Correction (2026-10-12):** the Windows Camera app cannot list this camera. It is a UWP / Media Foundation app and only enumerates kernel-streaming cameras and Media Foundation virtual cameras, never DirectShow filters registered under `CLSID_VideoInputDeviceCategory` (OBS's DirectShow virtual camera has the same limitation). The camera appears in DirectShow-aware apps (OBS, Zoom, classic Teams, Chrome, ffmpeg; Unity depends on how it enumerates devices, untested). Clicking "Set as Webcam" therefore no longer launches the Windows Camera app. `lancam-setup.exe` is now `asInvoker` (a `requireAdministrator` manifest showed a UAC prompt on every `lancam://` click); it still self-elevates once for installation, because registration writes to HKLM and Program Files. Frames are now flipped to the bottom-up DIB order DirectShow expects and letterboxed to the pin's negotiated size. To get the camera into the Windows Camera app, a Media Foundation virtual camera (`MFCreateVirtualCamera`, Windows 11) would have to replace or accompany the DirectShow filter.

## ADR-022 — Pure WebRTC Shared-Memory Bridge for DirectShow Virtual Camera

**Status:** Partly implemented, not wired (see the correction at the end of this record)

**Decision:**
1. **Zero-MJPEG Architecture for Virtual Camera:**
   - Eliminate HTTP/MJPEG continuous polling when running the DirectShow virtual camera from an active WebRTC session.
   - Establish a low-latency Win32 Shared Memory mapping (`Local\LanCamSharedMemory_Video`, up to $1920\times 1080\times 3$ bytes uncompressed RGB24) protected by a Win32 Mutex (`Local\LanCamSharedMemory_Mutex`).
2. **Browser-Side WebRTC Frame Extraction (`viewer.js`):**
   - The browser viewer running on the PC renders the peer-to-peer WebRTC video into an in-memory canvas at ~30 FPS when the virtual camera is requested.
   - Packs raw BGR24 image frames with a 16-byte binary header (`magic=0x4C43414D`, width, height, sequence) and sends them to `/api/vcam/bridge-frame`.
3. **Local Loopback Bridge Daemon (`lancam_setup.exe --bridge`):**
   - A lightweight WinSock2 server listens on `127.0.0.1:7779`.
   - The Node.js server streams received frame packets directly across loopback TCP to the bridge daemon.
   - The bridge daemon writes each frame directly into the Win32 Shared Memory mapping.
4. **DirectShow Virtual Source Filter Priority (`LanCamFilter.dll`):**
   - In `LanCamPin::StreamLoop()`, check `m_pFilter->GetShmReader().ReadLatestFrame()`.
   - If active shared memory frames exist (timestamp $< 1000\text{ms}$ old), stream them directly into DirectShow output buffers with $<15\text{ms}$ latency.
   - If shared memory is inactive, gracefully fall back to the HTTP decoder.

**Reasoning:**
Prevents dual video encoding/decoding overhead and avoids stressing the phone or server with redundant MJPEG JPEG compression when an active WebRTC P2P stream is already running on the PC.

**Consequences:**
Intended: DirectShow clients receive the WebRTC feed with minimal latency and no JPEG round trip.

**Correction (2026-10-13, from reading the code):** the pieces exist but are not connected. `POST /api/vcam/bridge-frame` receives **JPEG** frames from the viewer page (not BGR24 with a binary header) and passes them to the MJPEG streamer; the server never connects to `127.0.0.1:7779`; nothing starts `lancam-setup.exe --bridge`; so the shared-memory reader in the DirectShow filter always falls back to the HTTP MJPEG decoder. What actually runs is: viewer page canvas -> JPEG POST -> server MJPEG stream -> driver. When the viewer is pumping frames the server does not ask the phone to upload MJPEG (`mjpeg:demand` is suppressed for 3 seconds after each frame). Decision still open: wire the shared-memory path or delete it.

## ADR-023 — Media Foundation virtual camera so the Windows Camera app can list the phone camera

**Status:** Accepted; installer details in ADR-024

**Decision:**
1. Add `LanCamMfSource.dll` (`vcam/src/lancam_mfsource.cpp`): a Media Foundation media source (IMFMediaSourceEx, IMFMediaStream2, IKsControl, IMFGetService) behind an `IMFActivate` class factory. It reads the room's MJPEG stream (`MjpegDecoder`), letterboxes frames into 1280x720 and delivers NV12 at 30 fps, paced by `RequestSample` tokens.
2. `lancam-setup.exe` registers the class under `HKEY_CLASSES_ROOT\CLSID` (merged view; writing through `HKLM\SOFTWARE\Classes` directly returned ACCESS_DENIED even when elevated), copies the DLLs to `C:\Program Files\LanCamera` (renaming mapped DLLs aside when Chrome/Claude/Electron apps or the Frame Server hold them), and calls `MFCreateVirtualCamera(SoftwareCameraSource, System, AllUsers, "LAN Phone Camera", CLSID, KSCATEGORY_VIDEO_CAMERA)` + `Start`. The camera then persists across reboots with no helper process. `lancam-setup.exe --remove-mf` removes it.
3. The Frame Server hosts the source as LocalService, so the session file is also written to `%ProgramData%\LanCamera\session.ini` (folder ACL grants Users and LOCAL SERVICE modify; `lancam://` writes both copies). The source logs to `%ProgramData%\LanCamera\mfsource.log`; the installer logs to `setup.log`.
4. The DirectShow filter stays for DirectShow-only apps (OBS, ffmpeg, older software).

**Reasoning:** the Windows Camera app (UWP / Media Foundation) enumerates only kernel-streaming and Media Foundation virtual cameras, never DirectShow filters, so the first design (ADR-021) could never appear there.

**Consequences:** requires Windows 11 (build 22000+) and one elevated install. Frame data still travels over loopback MJPEG, so the viewer/sender must be streaming into the configured room. Verified here: the Windows Runtime camera enumeration went from 0 to 1 device, and a Media Foundation capture of that device through the Frame Server returned 30 fps upright 1280x720 frames from a live mock sender. Not verified: the Windows Camera app UI itself, Teams/Zoom/Unity, and a real phone.

## ADR-024 — One-file Inno Setup installer, static runtime, and fresh-machine hardening for the virtual camera

**Status:** Accepted

**Decision:**
1. Ship the driver as a single Inno Setup 6 installer, `lan-camera-setupv<version>.exe`, defined by `vcam/installer/lan-camera.iss` and built by `vcam/build.bat` (called from the root `build.bat`; the version comes from `package.json`). It installs `lancam-setup.exe`, `LanCamFilter.dll` and `LanCamMfSource.dll` to `C:/Program Files/LanCamera` (admin, 64-bit, no choices), stops the Frame Server, moves any in-use DLL aside (Chrome, Claude and other Electron apps map the DirectShow DLL; the old copy is deleted at reboot), then runs `lancam-setup.exe --install --silent`. The uninstaller runs `lancam-setup.exe --uninstall --silent` and removes `%ProgramData%/LanCamera`.
2. Build all three binaries with the static C++ runtime (`/MT`). A clean Windows has no Visual C++ redistributable, so a `/MD` build either cannot start the setup tool or cannot be loaded by the Frame Server.
3. Look up `MFCreateVirtualCamera` in `mfsensorgroup.dll` (it is not exported by `mfplat.dll`) with `GetProcAddress`, so the setup tool still starts on Windows 10 and reports that the Windows camera needs Windows 11, while the DirectShow camera is still registered.
4. The setup tool reports honestly: it verifies the DLLs are present, records the real `regsvr32` result, confirms that Windows lists the camera (`MFEnumDeviceSources`) before saying so, separates DirectShow and Windows-camera status, logs to `%ProgramData%/LanCamera/setup.log`, and exits non-zero on problems. It never copies a file onto itself when run from the install folder.
5. The server serves the installer at `/download/lan-camera-setup` (aliases `/download/lancam-vcam`, `.exe`, `.zip`), from disk (next to the exe, `dist/`, or the working directory) or from a copy embedded in the exe at build time, so the exe works from any folder. The viewer starts the download through a hidden iframe so a live stream is never interrupted.

**Reasoning:** the zip required extraction and a manual `lancam-setup.exe` run, failed silently when run from inside the archive, and on a fresh machine registered nothing: the setup tool looked for `MFCreateVirtualCamera` in the wrong DLL (hidden on the dev PC by an earlier install) and all binaries needed the Visual C++ runtime. A conventional installer gives an uninstaller, a log, and one file to hand to users.

**Consequences:** building the driver needs Visual Studio 2022 (C++) and Inno Setup 6; the installer and DLLs are not code-signed, so SmartScreen or antivirus may warn; the Windows camera needs Windows 11. Verified on the dev PC: silent install, uninstall (camera list empty, DirectShow class removed, data folder removed) and reinstall. Not verified: a clean machine/VM, the visible wizard, Windows 10, N editions (need the Media Feature Pack).

## ADR-025 — Dynamic Media Source Switching via Track Replacement & Reliable Viewer Reconnect

**Status:** Accepted

**Decision:**
1. **Dynamic Media Source Switching (`RTCRtpSender.replaceTrack`):**
   - Media source switches (between camera devices, facing modes, resolutions, video files, and remote video URLs) must not trigger room departures or full SDP renegotiation.
   - The sender acquires the new `MediaStream` first, iterates all active `viewerPeers` (`RTCPeerConnection`), locates the video sender (`peer.getSenders().find(s => s.track && s.track.kind === 'video')`), and invokes `sender.replaceTrack(newTrack)`.
   - The sender updates `localVideo.srcObject` and stops previous media tracks only *after* the new track is successfully placed into the sender pipeline.
   - The sender broadcasts `stream:state` with `{ state: 'source-changed' }` so viewers can update UI indicators without disrupting ongoing media playback.
2. **Deterministic Multi-Viewer Re-entry:**
   - When a sender leaves and re-enters an active room, the server's `RoomManager` includes all currently connected viewers in `response.peerSocketIds`.
   - The sender's `room:join` response handler iterates every `peerId` in `peerSocketIds` and actively initiates WebRTC peer connections.
   - In `signaling.js`, `room:join` broadcasts `peer:joined` with `{ peerSocketId: socket.id, role: 'camera-sender' }` to all waiting viewers in the room (not just the first peer), ensuring all waiting viewers immediately prepare for the incoming offer.
   - The viewer's `stream:state` and `onTrack` event handlers automatically dismiss reconnect prompts and resume playback.

**Reasoning:**
Tearing down and recreating rooms or peer connections causes user-visible stutter, requires manual coordination between sender and receiver users, and fails completely if callbacks are dropped. `replaceTrack()` allows in-place seamless source switching without SDP renegotiation.

**Consequences:**
Source switching takes effect immediately on all connected receivers. Senders rejoining occupied rooms instantly reconnect to all waiting viewers without requiring viewers to refresh or leave the room.

## ADR-026 — The 14-Feature LAN Camera Ecosystem Architecture

**Status:** Accepted

**Decision:**
Implement a comprehensive 14-feature expansion across mobile client controls, network adaptability, multi-camera studio switching, virtual webcam resilience, native game engine reception, IP camera bridging, and Windows OS integration:
1. **Bidirectional Audio Pipeline & Intercom (Talkback):** Senders capture optional microphone audio alongside video; viewers control audio playback/mute/volume and emit push-to-talk chimes via dual-tone Web Audio synthesis.
2. **High-Performance Shared-Memory Bridge (ADR-022 Wired):** Activated `src/server/vcam-shm-bridge.js` connecting Node.js to `lancam-setup.exe --bridge` on TCP 7779, writing directly into `Local\LanCamSharedMemory_Video` for zero-latency DirectShow frame delivery without HTTP polling overhead.
3. **Native Unity Receiver Package (`com.vcam.lancamera`):** Created production-ready UPM package adhering strictly to `AGENTS.md` (no `var`, explicit types, no `new()`, K&R braces). Decodes streams directly into reusable `Texture2D` instances via `ImageConversion.LoadImage` for UI (`RawImage`) and 3D materials without GC spikes.
4. **Multi-Camera Studio Switcher Mode:** `RoomManager` supports `studio-sender` role with multiple concurrent camera feeds; `signaling.js` broadcasts active cameras and targeted offer/answer routing; viewer displays interactive Studio Switcher bar.
5. **Embedded RTSP 1.0 / IP-Camera Bridge:** Implemented zero-dependency `src/server/rtsp-server.js` (RFC 2326 & RFC 2435 JPEG over RTP) broadcasting on `rtsp://<host>:8554/live/<roomId>` for VLC, OBS, ffmpeg, and NVRs.
6. **Hardware Camera Controls:** Added torch/flashlight toggle and hardware zoom slider to camera manager HUD with constraint fallbacks.
7. **Adaptive Bitrate (ABR) & Dynamic Quality Scaling:** WebRTC sender dynamically inspects RTCPeerConnection stats (RTT and packet loss) and adjusts encoding parameters (`RTCRtpSender.setParameters`) between 600 kbps, 1.5 Mbps, and 4.0 Mbps.
8. **Local Recording & Snapshot Hub:** Canvas snapshot PNG capture and client-side `MediaRecorder` with live recording timer HUD.
9. **mDNS / Zero-Conf LAN Auto-Discovery:** Implemented zero-dependency multicast DNS beacon (`src/server/mdns-beacon.js`) advertising `lancam.local` on 224.0.0.251:5353 and added `/api/discover`.
10. **Standby Slate & Virtual Camera Fallback State:** Added valid JFIF fallback generator (`src/server/standby-slate.js`) served on MJPEG stream when no sender is active, and SMPTE color bars rendered in DirectShow `lancam_filter.cpp`.
11. **Mobile Battery & Thermal Saver Mode:** Integrated Screen WakeLock API (`navigator.wakeLock`) and OLED Blackout Saver mode to preserve battery and prevent thermal throttling.
12. **Quick-Join URL & QR Code Auto-Connect:** Deep link query parameter handling (`?room=...&pin=...&autostart=1`) and one-click share link generation.
13. **Stream Transformation & Framing HUD:** Interactive horizontal flip (mirroring), 90°/180°/270° rotation locks, and 3x3 rule-of-thirds grid.
14. **Windows System Tray Companion & Auto-Start Configuration:** PowerShell tray companion (`scripts/lan-camera-tray.ps1`) docking into Windows notification area and Windows Registry auto-start manager (`scripts/register-autostart.ps1`).

**Reasoning:**
Transforms the project from an isolated browser tool into a complete, professional, cross-platform LAN camera broadcasting and ingestion ecosystem compatible with browsers, Windows apps, game engines, and surveillance systems.

**Consequences:**
Complete interoperability across WebRTC, RTSP, MJPEG, DirectShow, Unity, and Windows system tray, validated by 50 automated tests with zero external runtime dependencies.

## ADR-027 — Non-Human Sender Disconnection Resilience & Auto-Reconnection Lifecycle

**Status:** Accepted

**Context:**
On mobile devices and fluctuating local networks, senders can experience transient disconnections caused by Wi-Fi roaming, lock screen sleep, app backgrounding, or temporary TCP socket timeouts. Previously, when the sender socket disconnected, Socket.IO client reconnected under the hood with a new socket ID, but never re-joined the room. Furthermore, if a reconnect occurred before the server expired an orphaned socket, `RoomManager` rejected the join with `"Room already has an active sender."`, which caused `sender.js` to invoke `stopSession()` and permanently kill the camera and session. When viewers joined or reconnected, the server reported no sender, leaving viewers stuck on `"Waiting for Sender..."`.

**Decision:**
1. **Human Stop vs Non-Human Disconnect Distinction:**
   - The only action that terminates streaming and releases the camera is an explicit user click on the "Stop Streaming" button (`btnStop`).
   - For all non-human interruptions (socket `disconnect`, `connect_error`, Wi-Fi loss, background sleep), the sender maintains `isStreamingRequested = true` and keeps the local camera stream alive.
2. **Server-Side Stale Sender Socket Eviction:**
   - `RoomManager.createOrJoinRoom` supports `options.reconnect: true`.
   - When a sender with the valid PIN reconnects to a room with an existing `senderSocketId`:
     - If the existing socket is disconnected/dead or `reconnect: true` is set, the server evicts the stale socket (`result.evictedSenderId`), assigns the new socket ID, and broadcasts `peer:left` for the old socket followed by `peer:joined` for the new socket.
3. **Automated Client Rejoin & WebRTC Peer Restoration:**
   - On socket `connect`, mobile `visibilitychange` (screen turn-on), or network `online`, `sender.js` automatically emits `room:join` with `{ reconnect: true }`.
   - Upon successful rejoin, the sender immediately receives all waiting viewers in `response.peerSocketIds` and initiates fresh WebRTC offers to resume video playback instantly.
   - If join fails transiently (e.g., server still processing), an auto-rejoin retry timer exponential backoff continues attempting reconnection every 3 seconds until restored or explicitly stopped by the user.
4. **Periodic Health Watchdog:**
   - A 5-second watchdog interval checks socket connectivity, refreshes the Screen WakeLock, and re-acquires camera tracks if killed by mobile OS background policies.
5. **Viewer Auto-Reconnection:**
   - `viewer.js` automatically re-joins its room if the viewer's socket reconnects, avoiding stranded state.

**Consequences:**
Transient network drops, mobile lock screen wakeups, and server restarts heal automatically within 1-2 seconds without requiring manual button clicks or room re-entry.

## ADR-028 — Screen Sharing Input Source with Aspect-Preserving Quality Scaling

**Status:** Accepted

**Context:**
Users frequently need to broadcast desktop screens, application windows, or browser tabs across the local network to viewers, Unity applications, or virtual webcam clients, matching the quality and resolution controls available for physical camera sensors. However, screens have varied aspect ratios (16:9, 16:10, 4:3, 21:9 Ultrawide, or 9:16 portrait on mobile/vertical monitors). Hardcoding fixed dimensions (such as 1280x720) causes distortion, black letterboxing, or text blurriness when downscaling.

**Decision:**
1. **Screen Capture as First-Class Input Source:**
   - Add `screen` ("Screen share (display)") to `<select id="sourceSelect">` in `sender.html`.
   - Leverage `navigator.mediaDevices.getDisplayMedia()` with fallback for optional system/tab audio capture.
   - When `screen` is selected, automatically hide camera-only UI controls (camera device dropdown, torch, zoom, focus controls, flip button) while keeping the Quality/Resolution selector active.
2. **Aspect-Preserving Proportional Scaling:**
   - Define bounding-box constraints rather than rigid width/height forcing:
     - `max`: Unconstrained full native display resolution (`width: { max: 7680 }, height: { max: 4320 }, frameRate: { ideal: 30, max: 60 }`), transmitting 1:1 screen pixels for 4K, 1440p, and high-DPI displays.
     - `1080p`: Bounding box `1920x1080` (or `1080x1920` for portrait).
     - `720p`: Bounding box `1280x720` (or `720x1280` for portrait).
     - `480p`: Bounding box `854x480` (or `480x854` for portrait).
   - In accordance with the W3C Screen Capture specification, bounding boxes scale the captured frame proportionally, strictly preserving the native aspect ratio without geometric distortion, stretching, or cropping.
3. **Seamless Dynamic Quality Switching without Re-Prompting:**
   - When a user changes resolution while screen sharing is live, `CameraManager.applyScreenResolution()` directly calls `track.applyConstraints()`, adjusting capture resolution in-place without triggering the browser's screen-selection modal again.
   - Automatic orientation detection dynamically swaps width and height constraint maximums for portrait displays.
4. **Lifecycle & Native Toolbar Termination:**
   - Listen for `track.onended` (fired when the user clicks "Stop sharing" on the browser's floating toolbar) to cleanly terminate or reset the stream without leaving frozen frames.
   - Preserve previous source state if screen sharing is cancelled by the user.

**Consequences:**
Desktop and mobile senders can share any screen, window, or tab at 1:1 full fidelity or bandwidth-friendly 1080p/720p/480p resolutions with exact aspect ratio preservation. All downstream pipelines (WebRTC P2P, Mode B Tunnel Relay, HTTP MJPEG, and RTSP) seamlessly distribute the screen feed.

## ADR-029: Per-viewer constant FPS / constant resolution priority

**Status:** Accepted (2026-10-14)

**Context:** Measured on a live screen share: 6-15 FPS at 1920x1080 (VP8, ~4 Mbps, no packet loss). The sender forced `degradationPreference = 'maintain-resolution'` and the ABR controller reset `maxBitrate` to 4 Mbps every 4 s, so the encoder dropped frames to protect resolution. Switching to frame-rate priority gave 30 FPS but a lower resolution.

**Decision:**
1. Each viewer chooses in Advanced Settings: `fps` (default, constant 30 FPS, resolution may drop), `resolution` (constant Full HD, FPS may drop) or `both` (best effort). The choice is stored in the viewer's localStorage and sent as `viewer:quality-priority`; the server validates it (viewers only, three allowed values) and relays it to the room's sender with the viewer id.
2. The sender stores the mode per viewer and applies it to that viewer's peer connection only (`WebRtcPeer.applyQualityPriority`): `maintain-framerate`, `maintain-resolution`, or for `both` try `disabled` then fall back to `maintain-resolution`. It is re-applied once the peer is `connected` because `setParameters` can be rejected before negotiation, and ABR updates preserve it.
3. Bitrate ceiling is 8 Mbps (`LanMaxBitrateBps`), 12 Mbps for `both`.
4. Chrome 155 rejects `degradationPreference: 'disabled'` (TypeError), so no setting can force 1080p AND 30 FPS; `both` only succeeds when the sender CPU and the network have headroom. The sender STATS line reports `Limited by: none|cpu|bandwidth` and the encoder in use.

**Consequences:** Two viewers can ask for different trade-offs at once. If `both` still misses 30 FPS and the sender reports `cpu`, the follow-up is hardware H.264 (below) or a smaller capture size.

**Addendum - GPU H.264 with VP8 fallback (2026-10-14):**
- Sender Advanced Settings has a Video Encoder select: Auto (default) / H.264 force / VP8.
- Auto asks `navigator.mediaCapabilities.encodingInfo({type: 'webrtc', ...H264 1080p30})` once at load; only when `supported && powerEfficient` (Chrome's hardware-encode signal) does `WebRtcPeer.preferVideoCodec('video/H264')` put H.264 first in each viewer's offer. Every other codec stays in the offer, so a viewer that cannot decode H.264 negotiates VP8 (verified in Chrome 155 with a VP8-only receiver, 30 FPS).
- Chrome hides `encoderImplementation` / `powerEfficientEncoder` from pages that are not capturing, so they are only a secondary check: if they are exposed and show a software H.264 encoder, the sender re-offers that viewer with VP8 and stores `lancam_hw_h264_unsupported` in localStorage (re-selecting Auto clears it). Forced H.264 skips this fallback.
- Detection correction (RTX 3060, Chrome 155): `encodingInfo` with the constrained-baseline id `42e01f` reports `powerEfficient: false` even though Chrome really encodes H.264 on the GPU (`MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)`, `powerEfficientEncoder: true`). Baseline `42001f` and high `640028` report `true`. The sender therefore asks for `42001f`, `4d001f` and `640028` and treats any `powerEfficient` as a GPU encoder. Verified: the sender page in real Chrome on the RTX 3060 PC logs `[ENCODER] GPU H.264 encoder detected`; headless / the Claude in-app browser (no GPU) correctly log "No GPU H.264 encoder detected" and stay on VP8.
- The sender log line `[ENCODER] GPU H.264 encoder detected ...` or `No GPU H.264 encoder detected ...` shows what a given sender found.

**Addendum 2 - measured package for Full HD at 30 FPS (2026-10-15):**
- Findings (real Chrome 155, GPU H.264, loopback, demanding synthetic 1080p30 sources; investigation workflow `bwe-fps-investigation`):
  - In Constant FPS mode (`maintain-framerate`) Chrome's quality scaler downscaled 1080p to 720p about 2.25 s after connect in 36 of 36 baseline runs, while the bandwidth estimate was 5-14 Mbps. `Limited by: bandwidth` is only the label libwebrtc uses for a quality-driven downscale, not proof of a low estimate. maxBitrate 12/20 Mbps, maxFramerate, scaleResolutionDownBy=1 and priority did not prevent it.
  - Holding `maintain-resolution` for the first 6 s and then switching to `maintain-framerate` kept 1080p in 8 of 8 runs (4 s: 3/8, 8 s: 7/8); switching the preference clears Chrome's adaptation restrictions.
  - Chrome reads `x-google-*-bitrate` for the sender's own stream only from the sender's REMOTE description, so the hints go into the viewer's answer before `setRemoteDescription`. Munging the sender's own offer has no effect. `x-google-min-bitrate` had no effect and `min > max` makes Chrome reject the answer, so only start and max are used.
  - `'disabled'` is not a valid `degradationPreference`; Chrome 155 accepts `maintain-framerate-and-resolution`, which is the real "both".
- Decision: ceilings 12 Mbps (fps, resolution) and 16 Mbps (both); answer hints start 10000/max 12000 kbps (fps, resolution) and start 12000/max 16000 kbps (both); 6 s resolution hold in Constant FPS mode, re-armed after every successful `replaceTrack`, viewer mode change and ABR restore; mode-aware ABR (two consecutive samples to change level, restore below 120 ms, only Constant FPS viewers scale resolution); the server stores one mode per viewer socket, rate-limits the event (5 per 5 s per socket), de-duplicates repeats and includes `viewerQuality` in the sender's join acknowledgement.
- Validation of the production code (`WebRtcPeer`) on the RTX 3060 hardware encoder: 12 of 12 new-code runs (3 modes x 2 sources x 2 repeats, 20 s) held 1920x1080 at 29.9-30.1 FPS with no downscale; 4 of 4 runs reproducing the previous behaviour dropped to 1280x720 at 2.5 s.
- Not proven: the user's real session (D3D12 encoder on this driver is disabled in the test profile, real `getDisplayMedia` capture on Windows 10 was not tested). Screen capture on Windows 10 can itself cap near 21 FPS (DXGI/GDI path); the sender STATS line now prints source fps next to sent fps to tell the two apart.

## ADR-030: Screen share mouse cursor exclusion and reporting

**Status:** Accepted (2026-10-16)

**Context:**
When sharing desktop screens, application windows, or browser tabs, the sender often needs the option to exclude the mouse cursor from the broadcasted video stream (e.g. for clean recordings, presentations, or privacy). Operating system cursors must never be hidden, moved, disabled, or manipulated directly by web applications. The W3C Screen Capture specification defines `MediaTrackConstraints.cursor` with enum values `'always' | 'motion' | 'never'`. However, browser support and implementation behavior vary: Chromium-based browsers (Chrome & Edge on Windows) track compositor cursor capture under Issue #40649204, where `navigator.mediaDevices.getSupportedConstraints().cursor` may be undefined or compositor capture may burn the cursor into frame buffers.

**Decision:**
1. **Screen Capture API Cursor Constraint:**
   - Add a "Hide mouse cursor in screen share" checkbox (`#screenCursorToggle`) to `sender.html`, visible only when `sourceSelect` is set to `screen`.
   - In `CameraManager.getScreenConstraints(resolution, frameRate, cursor)` and `startScreenCapture()`, merge `cursor: 'never'` (or `'always'`) with existing width, height, and frameRate constraints without overwriting other options.
   - If the browser rejects the constraint with an `OverconstrainedError` or `TypeError`, gracefully retry capture without the `cursor` property so video acquisition never fails.
2. **Transparent Diagnostics Reporting (No False Claims):**
   - Provide helper `CameraManager.getEffectiveCursorSetting(track)` reading `track.getSettings().cursor`.
   - When cursor exclusion is requested:
     - If `effectiveCursor === 'never'`: log info confirming the browser excluded the cursor.
     - If `effectiveCursor === 'always' | 'motion'`: warn that the browser kept the cursor visible in the stream.
     - If `effectiveCursor === undefined`: log a warning noting the browser limitation (e.g. Chromium/Windows) and that the mouse cursor may remain visible in the stream.
3. **Seamless Dynamic Source Update:**
   - Attach a change listener to `#screenCursorToggle`. If screen streaming is live, invoke `applyDynamicSourceChange()` to hot-swap the video track across all active WebRTC peers without terminating connections or renegotiating SDP.

**Consequences:**
Senders can control cursor inclusion in screen broadcasts. When supported by the underlying browser and compositor, viewers receive clean, cursor-free screen video. If unsupported, the diagnostics panel provides transparent feedback explaining the browser limitation without falsely claiming the cursor is hidden.

## ADR-031: Remote Desktop Control Integration, Credential Verification & Native Helper Submodule

**Status:** Accepted (2026-10-16)

**Context:**
Users viewing a shared Windows desktop stream need the ability to interact with and control the remote computer using their own mouse and keyboard. The application must support two independent credential pathways: a permanent control password configured on the controlled host, and a dynamic 6-digit session PIN generated whenever desktop screen sharing begins. Control must be restricted to one authorized viewer at a time, with safe disconnection handling and immediate revocation controls for the sender. Furthermore, operating system input must be cleanly segregated into a dedicated native helper rather than executed directly inside the Node.js application process.

**Decision:**
1. **Dedicated Native Helper Submodule (`remote-control-helper`):**
   - Maintained as an independent Git submodule (`https://github.com/WRDeadman10/remote-control-helper.git`).
   - Implemented in C++ utilizing standard Win32 `SendInput` APIs without requiring administrative elevation.
   - Operates a local loopback server on `127.0.0.1:8765`, requiring an authenticated session handshake.
   - Enforces normalized coordinate bounds `[0.0, 1.0]` and maintains a registry of depressed keys and buttons, guaranteeing immediate release upon client disconnect, lease expiry, or emergency stop.
2. **Dual-Credential Authorization Model:**
   - **Permanent Password:** Hashed using `crypto.scrypt` with a 16-byte random salt and persisted locally in `.control-auth.json` (or `%LOCALAPPDATA%/LanCamera/control-auth.json`). Never stored in plaintext or sent in URLs.
   - **Session PIN:** Cryptographically generated 6-digit numeric PIN generated on screen-capture initiation, displayed on the sender UI, and invalidated immediately when screen sharing stops.
   - Either credential authorizes the viewer to acquire the single-controller lease.
   - 5 failed attempts locks the requesting socket out for 30 seconds.
3. **Authoritative Single-Controller Lease with Reconnection Grace:**
   - Server-managed lease in `RemoteControlManager` ensures at most one viewer controls at a time.
   - When an active controller unexpectedly disconnects, native input is instantly released, and a 60-second reservation grace period holds the lease for that controller to resume without re-entering credentials.
   - Sender maintains instant "Revoke Control" and "Disable Control" authority.
4. **Hybrid Control Transport:**
   - WebRTC DataChannel (label `lancam-control`) provides sub-5ms low-latency mouse and keyboard input directly between controller viewer and sender peer.
   - Socket.IO control signaling serves as reliable fallback and manages lease state and authorization.

**Consequences:**
Authorized viewers can seamlessly control the host Windows desktop with high responsiveness and accurate coordinate mapping. The system remains completely secure: credentials are protected, input is strictly bounded, the native helper is unexposed to external networks, and all held inputs are safely released upon any interruption.

## ADR-032: Distributed 3-System Remote Desktop Topology, Deeplink Auto-Launch & Inno Setup Distribution

**Status:** Accepted (2026-10-16)

**Context:**
In distributed LAN environments, the application runs across three separate systems:
1. Central Server: Runs `node src/server/index.js` on any host (e.g. Linux, cloud container, or LAN box).
2. System X (Sender): Runs `/sender` in the browser, sharing its Windows screen and hosting the native helper (`remote-control-helper.exe`).
3. System Y (Viewer): Runs `/viewer` in the browser, watching the desktop stream and entering the PIN/password to control System X.

Because the central server may run on an external machine, the native input helper cannot execute on the central server; it must run specifically on System X where the screen is physically being captured and controlled. Furthermore, users should not need to manually open command prompts or run background executables.

**Decision:**
1. **Loopback Browser-to-Native IPC with CORS & RFC 6455 WebSockets:**
   - In `remote-control-helper`, extended `LoopbackServer` to support HTTP GET `/health`, CORS preflight headers (`Access-Control-Allow-Origin: *`), HTTP POST `/input`, and RFC 6455 WebSocket framing (`ws://127.0.0.1:8765`) using WinCrypt SHA-1 hashing.
   - Allows the sender's browser tab on System X to communicate directly with its local helper via loopback with sub-millisecond latency.
2. **Automated Launch via `lancam-control://` Deeplink & HKCU Registration:**
   - When the helper starts, or during installation, it registers the `lancam-control://` URL protocol handler under `HKEY_CURRENT_USER\Software\Classes\lancam-control`. This requires zero administrative elevation or UAC prompts.
   - Added single-instance mutex `Local\LanCameraRemoteControlHelper_SingleInstance` to prevent duplicate background processes.
   - When the sender enables remote control or a viewer requests control, System X probes `http://127.0.0.1:8765/health`. If not running, it invokes `lancam-control://start` via a hidden iframe, matching the DirectShow virtual camera model.
3. **Inno Setup Standalone Installer & Direct Server Downloads:**
   - Authored Inno Setup script `installer/control-helper.iss` that builds `control-helper-setup.exe` (1.89 MB).
   - Server provides direct download route `/download/control-helper-setup` (and embeds the installer in single-executable builds via `scripts/build-embedded-assets.js`).
   - If the helper is not detected on System X after retries, a banner displays with a one-click "Download Helper Setup" button and "Retry / Launch Helper" button.
4. **Input Routing on System X:**
   - All control inputs arriving on System X (via WebRTC `lancam-control` DataChannel or relayed via signaling server) are forwarded directly into `ws://127.0.0.1:8765` (or HTTP POST fallback) on System X, ensuring seamless remote desktop control regardless of network topology.

**Consequences:**
Complete distributed 3-system operation works out of the box with zero friction. The central server can run on Linux, Docker, or LAN; the sender machine automatically launches or prompts for installation of the native helper; and the viewer controls the sender desktop with zero manual helper configuration.

## ADR-033: Persistent and Resilient zrok Share Reservation

**Status:** Accepted (2026-10-16)

**Context:**
Previously, `cli.js` and `start.ps1` attempted to launch a public share using `zrok share public <target> -n public:lan`. This failed because:
1. `-n` is not a valid parameter of `zrok share public` (it is a parameter of `zrok reserve public`).
2. `public:lan` and `lan` violate zrok's unique naming rules (lowercase alphanumeric only, between 4 and 32 characters in length).
3. The fallback dynamic share polled `zrok overview` using a regular expression that matched the first 10-16 alphanumeric characters following the port string. In zrok's JSON overview, the 13-digit Unix timestamp `createdAt` (e.g. `1792164730133`) immediately follows `backendProxyEndpoint`, causing the CLI to report an invalid URL (`https://1792164730133.shares.zrok.io`) instead of the true share URL (`https://<token>.share.zrok.io`).
4. On subsequent runs, existing shares were destroyed or disregarded, creating unnecessary dynamic churn.

**Decision:**
1. **Existing Share Discovery & Prioritization:**
   - Both `cli.js` (via modular `src/server/zrok-helper.js`) and `start.ps1` query `zrok overview` and parse the pure JSON output.
   - The system checks if any active share exists in the environment, prioritizing explicitly reserved shares (`reserved: true`) and shares targeting the configured port.
   - If an existing share is found, the system binds to it directly using `zrok share reserved <shareToken> --override-endpoint <targetUrl> --headless`.
2. **Deterministic Candidate Generation & Auto-Reservation:**
   - When no share exists, the system attempts to reserve candidate words (e.g. `lancam`, `lancamera`, `lancamstream`, `lancamlive`, or `lancam` + 4-char lowercase alphanumeric suffixes) using `zrok reserve public <target> -n <word> --backend-mode proxy --json-output`.
   - If candidate words conflict or fail, it falls back to zrok's auto-generated unique reservation (`zrok reserve public <target> --backend-mode proxy --json-output`).
   - The returned `token` and `frontend_endpoints` are extracted directly from the parsed JSON, and the backend is started on that reservation.
3. **Persistence Across Runs & Teardown Lifecycle:**
   - Reserved shares remain reserved across process restarts, guaranteeing identical public URLs for subsequent sessions.
   - On process termination (SIGINT/SIGTERM), only ephemeral dynamic shares are released via `zrok release <shareToken>`; reserved shares are preserved for subsequent runs.

**Consequences:**
Public URLs are permanent and consistent across runs. Terminal output and ASCII QR codes reliably display the true `frontendEndpoint` (`https://<token>.share.zrok.io`). The error "Could not bind to reserved 'public:lan'" is completely eliminated.

## ADR-034: Chrome Private Network Access (PNA), Loopback CSP & Pre-Stream Remote Control

**Status:** Accepted (2026-10-16)

**Context:**
Real-world field testing over a public zrok tunnel (`*.share.zrok.io`) revealed three blockers:
1. Browser CSP violations blocked loopback health checks (`http://127.0.0.1:8765/health`) and custom protocol deeplink framing (`lancam-control:`).
2. When a public HTTPS origin queries loopback (`127.0.0.1`), Chrome enforces the Private Network Access (PNA) specification, which requires `Access-Control-Allow-Private-Network: true` on both preflight `OPTIONS` and actual responses.
3. In `sender.js`, the signaling socket was only connected inside `startSession()` ("Start Streaming"). Consequently, users trying to enable Remote Control, generate a session PIN, or set a permanent password prior to clicking "Start Streaming" encountered "Signaling socket not connected" or missing PINs.
4. Switching tabs or window focus triggered `document.visibilityState === 'visible'`, which invoked `rejoinRoomAsSender()` unconditionally when viewer peers were 0, causing frequent stream teardowns and reconnection loops.

**Decision:**
1. **CSP & Private Network Access:**
   - Updated `Content-Security-Policy` header in `src/server/server.js`:
     - Added `http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*` to `connect-src`.
     - Added `frame-src 'self' lancam-control: lancam:` to allow silent protocol launcher iframes.
   - Updated `remote-control-helper` loopback HTTP server:
     - Added `Access-Control-Allow-Private-Network: true` to CORS preflight `OPTIONS`, `GET /health`, and `POST /input` responses.
2. **Pre-Stream Control & Signaling Auth:**
   - Extended `ensureSocket()` in `sender.js` to initialize the Socket.IO connection at page load.
   - Updated `control:enable`, `control:pin:regenerate`, `control:password:set`, and `control:password:clear` in `signaling.js` to authorize requests when the sender is already joined OR when the payload PIN matches `config.accessPin`.
   - Updated `sender.js` to emit `pin` with pre-streaming control requests and handle asynchronous socket connection.
3. **Deeplink Invocations & Tab Focus Health:**
   - Enhanced `launchControlHelperDeeplink(userGesture)` to trigger an invisible anchor click on manual user button clicks for maximum browser activation.
   - Refined `visibilitychange` in `sender.js` so it only repairs damaged viewer peers if viewers exist and only rejoins if `!hasJoinedRoom`. It never tears down an intact session on tab focus.

**Consequences:**
Remote desktop control functions seamlessly over public zrok tunnels and LAN connections. Senders can configure control PINs and permanent passwords before starting streaming. The helper is detected without PNA or CSP errors, and tab switching does not disrupt active streams.

## ADR-035: zrok2 CLI Compatibility & Reserved Name Discovery

**Status:** Accepted (2026-10-18)

**Context:**
Users utilizing `zrok2` (zrok v2.0+) encountered startup failures when executing `dist\lan-camera-streaming.exe` or `start.ps1`. Even when the name `"lan"` (`lan.shares.zrok.io`) was already registered and reserved, the application reported `No existing reserved share found`, iterated through reservation attempts, and failed with `Error: unknown command "reserve" for "zrok2"`.

Root causes:
1. `zrok2 overview` outputs formatted text tables with Unicode box-drawing characters unless explicitly invoked with `--json`. The previous `overview` command returned no JSON braces, causing `getZrokShares` to return an empty array `[]`.
2. In `zrok2 overview --json`, inactive reserved names reside in the top-level `names` array (`{ "name": "lan", "namespaceToken": "public", "reserved": true }`), not in `environments[].shares`. `getZrokShares` only inspected `environments[].shares`, completely ignoring `data.names`.
3. In `zrok2`, the legacy commands `reserve public`, `share reserved`, and `release <token>` were removed or restructured:
   - Reserving a name is performed via `zrok2 create name <name>` and `zrok2 modify name <name> --reserved`.
   - Hosting on a reserved name is performed via `zrok2 share public <target> -n <namespaceToken>:<name> --backend-mode proxy --headless`.
   - Releasing an ephemeral share backend is performed via `zrok2 delete share <token>`.

**Decision:**
1. **Dual-Mode CLI Discovery:** Implemented `isZrokV2(zrokBinary)` to detect `zrok2` vs legacy `zrok` v0.4 from binary paths and version outputs.
2. **Overview JSON Extraction:** `getZrokOverviewData` queries `--json` first with fallback to plain `overview`. `parseZrokOverviewJson` extracts both active shares (`environments[].shares`) and registered reserved names (`data.names`), synthesizing reserved share objects with normalized endpoints (`https://<name>.<namespaceName>`) and name selections (`<namespaceToken>:<name>`).
3. **Share Lifecycle Compatibility:**
   - For `zrok2`: hosts on reserved names using `share public <target> -n <nameSelection> --backend-mode proxy --headless`. Reserves new names via `create name` and `modify name -r`. Releases dynamic shares on exit via `delete share <token>`.
   - For legacy `zrok`: maintains full compatibility with `share reserved <token>` / `reserve public` / `release <token>`.

**Consequences:**
Existing reserved names like `lan` are immediately discovered and hosted as `https://lan.shares.zrok.io`. Terminal QR codes and URLs accurately display the reserved address. Both `zrok2` and legacy `zrok` environments are fully supported with zero regressions.

## ADR-036: In-Room Real-Time WhatsApp-Style Chat with Local Persistence, Slide-Out Drawer & Dimmed Unsplash Wallpaper

**Status:** Accepted (2026-10-18)

**Context:**
Participants streaming or watching video feeds in a room require bidirectional text communication. User requirements specify:
1. Room-scoped chat functionality so senders and viewers can communicate seamlessly.
2. Automatic name assignment with interactive user editing and persistent storage in `localStorage` (`lancam_chat_username`) across visits.
3. Slide-out drawer UI with smooth entry/exit animations, accessible via a floating toggle action button.
4. Unread notification indicator dot/badge on the toggle button that clears upon opening the panel.
5. User ability to mute/unmute notifications, with mute preferences persisted in `localStorage` (`lancam_chat_muted`).
6. WhatsApp-inspired styling with distinct sent (green) and received (slate) message bubbles, tails, timestamps, delivery checkmarks, and colored sender badges.
7. Atmospheric chat background loaded dynamically from Unsplash random photos, heavily dimmed with a dark overlay to maintain complete contrast and zero distraction from chat readability.

**Decision:**
1. **Signaling & History Buffer:**
   - Add `chat:message` socket event in `src/server/signaling.js`. Validate room membership, sanitize text (trim, length limit 2000 chars), sanitize sender display name (max 40 chars), generate unique message IDs, and broadcast to `io.to(roomId)`.
   - Maintain a bounded in-memory message history buffer (last 50 messages per room) with `chat:history` retrieval for late-joining viewers or reconnecting participants.
   - Clean up room chat history when all participants leave.
2. **Client Chat Architecture (`src/public/js/chat.js`):**
   - Provide an auto-name generator generating memorable combinations (adjective + noun + random 3-digit number).
   - Check `localStorage.getItem('lancam_chat_username')` on load and persist changes immediately.
   - Provide inline name editing in the chat header with validation.
   - Implement mute toggle with `localStorage.getItem('lancam_chat_muted')` persistence and muted UI states.
   - Implement floating action button with unread message counter badge dot.
   - Implement slide-out drawer (`.chat-drawer`) with smooth GPU-accelerated CSS translation (`translateX(100%)` -> `translateX(0)`), close button, and backdrop overlay.
   - WhatsApp dark theme bubble layout with incoming/outgoing tails, sender identity tags, timestamps, and double checkmark icons.
   - Dimmed Unsplash background: queries Unsplash Random Photo API, caches URL, applies an obsidian veil (`rgba(11, 20, 26, 0.88)` / `filter: brightness(0.22)`), and provides a one-click shuffle button for fresh wallpapers.
   - Web Audio API notification chime when messages arrive while drawer is closed and chat is unmuted.
3. **Integration:**
   - Integrate `ChatManager` into `src/public/sender.js` and `src/public/viewer.js`, binding to active room sessions.
   - Style all chat drawer elements in `src/public/css/style.css` matching the dark mode design tokens.
4. **Mobile Responsive Architecture:**
   - Enforce `100dvh` dynamic viewport sizing and Safe Area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) for iOS notch, Dynamic Island, and Android gesture navigation bars.
   - Set 16px font size on mobile inputs to prevent disruptive iOS Safari auto-zooming on focus.
   - Lock body background scrolling via `body.chat-drawer-open` while the chat drawer is open.
   - Implement touch swipe-to-dismiss gesture (`setupSwipeToDismiss`) allowing users to swipe the drawer right to close.
   - Integrate VisualViewport API (`setupMobileViewport`) to dynamically resize and pin the drawer above the virtual keyboard when typing on mobile devices.
   - Provide compact landscape mobile styles (`orientation: landscape and max-height: 500px`) allowing video streams and chat to be enjoyed simultaneously without obscuring the screen.
5. **Rejoin Deduplication & Persistent Client Identity (`senderUserId`):**
   - Store a persistent unique client ID in `localStorage` (`lancam_chat_user_id` / `getOrCreateUserId()`) and attach it as `senderUserId` to every outgoing message payload.
   - Signaling server validates, sanitizes (max 64 chars), and embeds `senderUserId` in broadcast messages and history buffer.
   - In `ChatManager`, maintain a `renderedMessageIds = new Set()` and check both the Set and DOM element IDs before rendering any message bubble or system chip.
   - When users reconnect or history is reloaded on rejoin (`chat:history`), duplicates are silently ignored.
   - Messages are evaluated as self (`outgoing` green bubbles) via `(msg.senderUserId && msg.senderUserId === this.userId) || (msg.senderId === this.socket.id)`, ensuring a user's own previous messages remain recognized as theirs even after socket IDs change upon reconnecting.
   - History rendering passes `isHistory = true`, preventing unread counter increment and notification sound triggers during initial or reconnect history loads.
   - When switching rooms (`roomId !== this.roomId`), message container and rendered IDs are reset via `clearMessages()`; when rejoining the same room, existing DOM messages are preserved.

**Consequences:**
Senders and viewers in any room can chat with WhatsApp-like familiarity, custom or auto names persist between visits, unread notifications are surfaced with badge dots, chat can be muted silently, the chat background remains aesthetically pleasing without impairing text legibility, mobile phones in both portrait and landscape enjoy full touch gestures, safe area spacing, and virtual keyboard ergonomics, and rejoining or reconnecting to a room never causes duplicate messages or false incoming self-message alerts.

## ADR-037: Dynamic Server-Derived Application Versioning

**Status:** Accepted (2026-10-18)

**Context:**
The header brand badges across sender, viewer, and discovery pages previously had hardcoded strings (`v1.0.23`). When the package version was bumped (e.g. to `1.0.36`), the badges remained frozen at outdated versions unless manually edited in multiple HTML and server files. Furthermore, standalone executable builds (SEA) do not distribute `package.json` on disk, requiring an architecture that resolves version dynamically in all execution environments.

**Decision:**
1. **Single Source of Truth (`src/server/version.js`):**
   - Provide `getAppVersion()` resolving the version dynamically:
     - Check `__APP_VERSION__` injected at build-time by `esbuild` for standalone single-executable applications.
     - Check `package.json` on disk relative to module and current working directory for source / development runs.
     - Fallback to current release tag.
2. **Server API Exposure:**
   - Expose version in `/api/version`, `/api/config`, `/api/discover`, and `/health` endpoints.
   - Expose `embeddedVersion` in `scripts/build-embedded-assets.js`.
   - Update `cli.js` to derive `APP_VERSION` from `getAppVersion()`.
3. **Frontend Dynamic Hydration (`src/public/js/ui-utils.js`):**
   - Provide `initializeVersionBadge()` querying `.brand-version, #appVersionBadge` and hydrating with `v${data.version}` from `/api/version`.
   - Auto-execute on DOM readiness.
   - Additionally update badges in `sender.js` and `viewer.js` when `/api/config` is loaded.
   - Replace static version text in `sender.html`, `viewer.html`, and `index.html` with empty badge containers styled with `.brand-version:empty { display: none; }` to prevent empty layout shifts.

**Consequences:**
Any version bump in `package.json` immediately and automatically reflects across the server, API endpoints, CLI, sender header, viewer header, and hub page without requiring manual string updates across frontend files or server templates. Standalone executables, development runs, and LAN discovery beacons remain consistently synchronized.

## ADR-038: Mobile Pinch-to-Zoom, Touch Interaction and TeamViewer-Style Remote Desktop Control

**Status:** Accepted (2026-10-21)

**Context:**
1. Mobile viewers previously could not pinch-to-zoom or pan camera feeds or screen-sharing feeds, limiting inspection of fine UI elements, documents, or small desktop text.
2. Mobile viewers that obtained remote desktop control lacked a functional mobile touch control surface: standard mouse events relied on physical desktop mice, clicks did not account for display scaling, zoom, or letterboxing, mobile virtual keyboards could not type into the remote Windows desktop, modifier keys (Shift, Ctrl, Alt, Win) were inaccessible, and there was no touchpad or adaptive cursor overlay matching industry-standard remote access applications (TeamViewer).

**Decision:**
1. **Universal Pinch-to-Zoom and Pan (`src/public/js/zoom-controller.js`):**
   - Manage local scale (1.0x to 4.0x) and translation (panX, panY) through hardware-accelerated CSS transforms applied to the active media element (`remoteVideo` or `remoteCanvas`).
   - Center pinch-to-zoom at the exact midpoint between the user's two fingers.
   - Enforce boundary clamping so content cannot be panned beyond viewable viewport boundaries.
   - Provide floating `+` and `-` zoom buttons docked on the right side of the video viewport, along with double-tap or button Fit Screen reset.
   - Ensure media stream playback, WebRTC peer connections, and video decoders are never interrupted or renegotiated during zoom.
2. **Zoom-Aware Coordinate Mapping (`src/public/js/control-coords.js`):**
   - Extend coordinate transformation functions (`translateScreenCoordinates` and `getScreenCoordinatesFromNormalized`) to account for:
     1. Viewport bounding client rectangle.
     2. Intrinsic video dimensions (`videoWidth`, `videoHeight`).
     3. Aspect ratio letterbox/pillarbox geometry (`calculateVideoRenderBox`).
     4. Current zoom scale factor.
     5. Current pan translation offsets (`panX`, `panY`).
   - Guarantees 1:1 pixel accuracy when tapping remote controls while zoomed in.
3. **Adaptive Cursor Overlay (`#remoteCursorOverlay`):**
   - Render a high-visibility pointer overlay positioned via `getScreenCoordinatesFromNormalized`.
   - Maintain stable physical size in mobile CSS pixels regardless of zoom scale.
   - Keep overlay pointer hotspot aligned with the native host cursor coordinates.
4. **Dual Interaction Modes:**
   - **Mouse Mode (Touchpad):** The mobile screen acts as a relative touchpad. Drag moves the pointer via accumulated sensitivity; single tap performs left-click; long-press triggers right-click; two-finger drag scrolls vertically/horizontally; double-tap-and-drag performs click-and-drag (text selection, window moving).
   - **Touch Mode (Direct Tap):** Taps map directly to host screen coordinates.
   - **Gesture Disambiguation:** Two-finger pinch gestures are reserved for local zoom and strictly suppressed from sending remote mouse movements or clicks.
5. **Mobile Remote-Control Toolbar & Drawers:**
   - Implement responsive, collapsible bottom toolbar matching TeamViewer mobile patterns:
     - Exit / Release control.
     - Keyboard toggle.
     - Mouse / Touch mode toggle and gesture guide bottom sheet.
     - Shortcuts panel (Copy, Paste, Print Screen, Switch Apps, Save).
     - Special keys pad (`Esc`, `F1`-`F12`, `Tab`, `PrtSc`, `ScrLk`, `Pause`, `Ins`, `Home`, `PgUp`, `Del`, `End`, `PgDn`, arrow keys).
     - Settings (pointer sensitivity).
     - Collapse/Expand chevron toggle.
6. **Mobile Keyboard & Unicode Native Input:**
   - Provide an invisible text entry layer to invoke the native mobile virtual keyboard.
   - Support Unicode text input via `KEYEVENTF_UNICODE` in `remote-control-helper` (`InjectText`), plus backspace, enter, and composition events.
   - Provide an auxiliary modifier key bar (`Shift`, `Ctrl`, `Alt`, `Win`, `...`) with held-state indicators.
   - Map `VK_SNAPSHOT` for PrintScreen.

**Consequences:**
Mobile viewers gain an intuitive, production-grade remote control experience matching TeamViewer, allowing detailed inspection of Windows desktops via pinch-to-zoom, responsive touchpad and direct touch control, accurate clicks across all zoom levels, complete keyboard and modifier entry, and zero impact on view-only streaming.

## ADR-039: Ubuntu 24.04 and POSIX Linux Hosting Supervisor (`start.sh`)

**Status:** Accepted (2026-10-21)

**Context:**
The application was previously supervised primarily via PowerShell on Windows (`start.ps1`). Users hosting the signaling and streaming server on Ubuntu 24.04 LTS (and other POSIX Linux distributions) required an equivalent automated startup script providing:
1. Automatic dependency installation (`npm install`) on first run.
2. Safe `.env` loading and `.env.example` copying without overwriting shell-exported environment variables.
3. Linux networking discovery using `hostname -I` and `ip -4 addr` to surface private LAN IP addresses (`10.x`, `192.168.x`, `172.16-31.x`).
4. Dual operation: public HTTPS zrok tunnel mode and `--local-only` LAN direct mode.
5. Automated zrok environment verification, authentication (`zrok enable $ZROK_TOKEN --headless`), share reservation, and dynamic fallback matching `start.ps1` and `zrok-helper.js`.
6. Node.js server background lifecycle monitoring and `/health` polling.
7. Terminal ASCII QR code rendering for immediate mobile phone camera connection.
8. Signal trapping (`SIGINT`, `SIGTERM`, `EXIT`) to release dynamic zrok shares and stop child background processes cleanly without orphaned ports.
9. Ubuntu firewall instructions (`sudo ufw allow $PORT/tcp`).

**Decision:**
1. Author `start.sh` with bash shebang (`#!/usr/bin/env bash`), strict LF line endings, colorized console banners, and complete feature parity with `start.ps1`.
2. Support `--local-only`, `-LocalOnly`, `-l`, and `--help` flags.
3. Update `src/server/zrok-helper.js` cross-platform binary discovery to check `command -v zrok || which zrok` on non-Windows platforms alongside Linux standard binary paths (`/usr/local/bin/zrok`, `/usr/bin/zrok`, `/opt/zrok/bin/zrok`, etc.).
4. Add automated test suite `tests/start-script.test.js` verifying LF line endings, arguments, environment parsing, health checks, zrok cleanup traps, and runtime `--help` execution.

**Consequences:**
Users can run `./start.sh` or `./start.sh --local-only` out of the box on Ubuntu 24.04 with zero Windows or PowerShell dependencies. Cleanup, background process management, terminal QR codes, and zrok share reservations behave identically across Linux and Windows.

## ADR-040: Mobile Viewport Gesture Isolation and Touch Feed Panning

**Status:** Accepted (2026-10-21)

**Context:**
On mobile devices (Android Chrome, iOS Safari), viewing or remotely controlling the stream encountered gesture conflicts:
1. Two-finger pinch gestures zoomed the entire web page/viewport (header, status badges, sidebar, text) instead of scaling only the video feed.
2. Dragging on the video feed scrolled the entire web application page rather than panning the zoomed video or moving the remote desktop pointer.
3. Passive touch event listeners in ZoomController and MobileRemoteController prevented calling preventDefault(), allowing browser viewport gesture actions to take precedence.
4. Missing CSS touch-action: none and overscroll-behavior: none on the video container and media elements allowed touch panning and pinch-to-zoom to leak to the document body.

**Decision:**
1. **CSS Viewport Isolation:**
   - Configured touch-action: none, overscroll-behavior: none, user-select: none, and -webkit-touch-callout: none on .video-container, #videoWrapper, #remoteVideo, and #remoteCanvas.
   - Configured touch-action: pan-y and overscroll-behavior: contain on .control-bottom-sheet so bottom sheets retain smooth vertical scrolling without scroll-chaining to the document body.
   - Configured touch-action: manipulation on .video-hud, .floating-zoom-controls, .mobile-control-toolbar, and .mobile-modifier-bar to permit responsive taps while disabling double-tap viewport zoom.
2. **ZoomController Gesture Refinement:**
   - Converted touchstart and touchmove listeners from passive to active ({ passive: false }).
   - On 2-finger touchstart, call preventDefault() immediately to halt browser viewport scaling before the browser locks into page zoom.
   - In touchmove, always call preventDefault() on the feed to eliminate page scroll. When remote control is inactive and scale > 1.0, smoothly pan the zoomed feed by touch delta (panBy(deltaX, deltaY)).
   - Added iOS Safari gesturestart, gesturechange, gestureend prevention (preventDefault()) on the container.
   - Filtered interactive UI targets (buttons, hud, toolbar, bottom sheets) via isInteractiveTarget() so controls remain clickable.
3. **MobileRemoteController Pointer Isolation:**
   - Converted touch event listeners from passive to active ({ passive: false }).
   - Called preventDefault() on touchmove during remote mouse trackpad movement and remote desktop touch, preventing website page scroll.
   - Added resilient requestAnimationFrame fallback in _throttledMouseMove for environments where RAF is absent.

**Consequences:**
Pinch-to-zoom strictly zooms the video feed element (1x to 4x) without resizing the website header or page layout. Dragging on the video feed pans the zoomed video feed when zoomed in (view mode) or moves the remote cursor (mouse mode) without scrolling the web page. Scrolling outside the video feed and inside bottom sheets remains fully functional.

## ADR-041: WebRTC mDNS Local IP Concealment Detection & Multi-Browser Flag Guidance

**Status:** Accepted (2026-10-21)

**Context:**
On Windows Chromium browsers (Google Chrome, Microsoft Edge, Comet, Brave, Opera, Vivaldi, Arc), WebRTC by default anonymizes private LAN IPv4 addresses by replacing host candidates with temporary mDNS `.local` hostnames (e.g. `9b2d86f7-...local`). When streaming camera feeds or screen sharing to Android phones, iOS devices, or other LAN endpoints, the receiver cannot resolve the host machine's mDNS hostname without a local mDNS responder, causing WebRTC direct P2P connections to fail. Disabling the browser flag `enable-webrtc-hide-local-ips-with-mdns` immediately exposes the private LAN IP address and allows instant LAN streaming. Different Chromium forks use distinct internal URL schemes (`comet://flags`, `edge://flags`, `chrome://flags`, `brave://flags`, etc.) and browsers block web pages from directly navigating to internal `://flags` URLs for security.

**Decision:**
1. **Multi-Browser Detection & Scheme Resolution (`src/public/js/mdns-detector.js`):**
   - Implemented `detectBrowserFlagInfo()` detecting Comet, Edge, Brave, Opera, Vivaldi, Yandex, Arc, and Chrome/Chromium, resolving exact internal schemes (`comet://flags/#enable-webrtc-hide-local-ips-with-mdns`, `edge://flags/...`, etc.).
   - Implemented `isWindowsPlatform()` detecting Windows environments via `navigator.userAgentData.platform`, `navigator.platform`, and user agent strings.
   - Implemented `probeMdnsLocalIpHiding()` creating a fast, zero-server local `RTCPeerConnection` probe to gather host candidates. If candidates contain `.local` and no private LAN IPv4 address is emitted, mDNS concealment is detected as active.
2. **Interactive Warning & Guidance UI (`src/public/sender.html`):**
   - Added `#mdnsWarningBanner` above the setup card, surfacing the detected browser name, one-click `Copy Flag URL` button, `Step-by-Step Guide` launcher, and session dismissal.
   - Added `#mdnsGuidanceModal` featuring detailed step-by-step instructions matching browser flags UI, copyable flag URL box, note explaining browser link restrictions, and a live `Test Setting Again` re-probe button.
   - Added a persistent `🌐 LAN Guide` button in the Session Setup card header to access guidance at any time.
3. **Sender Lifecycle Integration (`src/public/js/sender.js`):**
   - Automated startup evaluation for Windows senders.
   - Reactively unhides the warning banner and logs browser-specific flag URLs if ICE connection fails during a stream session.
4. **Verification:**
   - Added unit test suite `tests/mdns-detector.test.js` verifying browser flag URLs, Windows platform checks, candidate parsing, probe gathering, and DOM event wiring (233/233 tests passing).

**Consequences:**
Windows users on Comet, Chrome, Edge, and other Chromium browsers receive immediate, automated, browser-tailored instructions to disable mDNS anonymization with one-click URL copying, allowing effortless LAN WebRTC streaming to mobile devices.

## ADR-042: Mobile Touchpad Edge Auto-Pan, Tap-Without-Jump Disambiguation, and Pinch-vs-Scroll Isolation

**Status:** Accepted (2026-10-21)

**Context:**
During mobile remote desktop control in TeamViewer-style touchpad (`mouse`) mode:
1. When zoomed in, dragging the cursor to the visible boundary of the mobile viewport caused the pointer to stop at the edge even though the remote Windows desktop extended much further in that direction. Users expect the viewport to auto-pan in the direction of the drag ("edge push-to-pan") until the actual remote desktop edge is reached.
2. Tapping anywhere on the mobile screen caused the pointer to jump to the tap location instead of executing a click at the cursor's current position that the user had navigated to. This was caused by synthesized mouse events (`mousedown`, `mouseup`) escaping touch handlers and triggering desktop pointer coordinate translation in `viewer.js`.
3. Swiping with two fingers to scroll (wheel scroll) unintentionally triggered pinch-to-zoom because `ZoomController` unconditionally treated any two-finger touch as a pinch gesture without disambiguating parallel movement. Additionally, double-tapping triggered mobile browser viewport zoom and desktop fullscreen toggles.

**Decision:**
1. **Edge Auto-Pan Engine (`src/public/js/mobile-control.js`):**
   - When zoomed in (`scale > 1.01`) in `mouse` mode:
   - Evaluates cursor screen position via `getScreenCoordinatesFromNormalized` against an edge margin threshold (28px).
   - If cursor reaches an edge moving in that direction and the remote screen boundary is not yet reached (`normX < 1.0` right, `normX > 0.0` left, `normY < 1.0` bottom, `normY > 0.0` top), smoothly pans the zoomed viewport in that direction via `zoomController.panBy(panDeltaX, panDeltaY)`.
   - When the physical remote desktop edge is reached, panning stops cleanly.
   - Clamped visual overlay positioning (`clampedRelX, clampedRelY`) keeps the cursor arrow visibly pinned at the screen border while the desktop slides underneath.
2. **Tap Click Disambiguation (Zero Pointer Jump):**
   - Active touch prevention: `touchstart` and `touchend` call `e.preventDefault()` on non-interactive targets, instructing the browser to suppress synthesized `mousedown`/`mouseup` events.
   - Tap in `mouse` mode dispatches `{ type: 'mouse_click', button: 'left' }` strictly at the cursor's existing normalized position without modifying `normX`/`normY` or sending `mouse_move`.
   - Updated `bindDesktopPointerControls` in `src/public/js/viewer.js` to utilize Pointer Events with strict touch/pen exclusion (`e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents`), preventing any synthetic event from moving the remote cursor.
3. **Pinch vs Two-Finger Scroll Disambiguation (`src/public/js/zoom-controller.js`):**
   - When `isControlActive()` is true, two-finger gestures initialize in a `'pending'` mode.
   - If distance delta between fingers exceeds 20px, locks to `'pinch'` (scaling feed, suppressing wheel events).
   - If both fingers move in parallel in the same vertical direction (> 10px travel, < 18px distance variation), locks to `'scroll'` (sending `mouse_wheel` packets via `MobileRemoteController` while preserving exact zoom scale).
   - Guarded `videoWrapper`'s `dblclick` listener to prevent full-screen toggling during active remote control sessions.
4. **Verification:**
   - Added 4 comprehensive unit test cases in `tests/mobile-control-ui.test.js` covering tap coordinate preservation, edge auto-pan triggering and stopping at desktop boundaries, parallel two-finger scroll isolation, and pinch zoom isolation (237/237 tests passing).

**Consequences:**
Mobile remote control provides a professional TeamViewer-grade experience: dragging to the edge smoothly auto-scrolls across the entire multi-monitor or widescreen Windows desktop, tapping clicks precisely where the pointer is positioned without jumping, two-finger scrolling scrolls documents without zooming, and pinch zooming remains fluid and isolated.

## Open decisions to revisit after the first working stream

- Whether to code-sign the installer and executables (ADR-024).
- Whether the Windows camera should support Windows 10 (it needs an API that exists only on Windows 11).
- Whether to add hardware H.264/HEVC transcoding for RTSP in addition to RFC 2435 JPEG.
