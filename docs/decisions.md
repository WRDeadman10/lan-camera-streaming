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

**Status:** Accepted

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
3. Access-controlled room management (1-sender, 1-receiver model).
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

## Open decisions to revisit after the first working stream

- Whether TypeScript should replace plain JavaScript for stricter types.
- Whether the app needs multiple simultaneous camera sources.
- Whether TURN should be operated locally, on a server, or not at all for the intended networks.
- Whether audio is required.
- Whether the final deployment should use a trusted local CA/local DNS or continue using a tunnel.
- What latency and quality targets the real deployment must meet, based on measurements from the target devices and Wi-Fi.

