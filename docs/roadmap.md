# LAN Camera Streaming — Roadmap

## Phase 0 — Repository and runtime foundation

**Objective:** Create a repeatable Windows development setup.

Tasks:
- Inspect the repository, `AGENTS.md`, `.editorconfig`, and existing scripts before making changes.
- Initialize or reuse the Node.js project structure.
- Add Express and Socket.IO with a single HTTP server.
- Serve a minimal landing page and implement `/health`.
- Add `.gitignore` and `.env.example`; do not commit secrets.
- Document local start and stop commands.

**Exit criteria:** The app starts on Windows, `/health` responds successfully, and a second device on the LAN can reach the server where network policy permits. Camera capture is not considered validated until HTTPS is configured.

## Phase 1 — HTTPS and camera-permission proof of concept

**Objective:** Confirm the selected browser devices can load the sender page and capture a camera.

Tasks:
- Configure one HTTPS path for development: ngrok or zrok, or a locally trusted certificate.
- Build the sender page with a user-initiated Start button and local video preview.
- Request video only; do not request audio in this phase.
- Handle permission denied, no camera, camera busy, and unsupported browser states.
- Implement Stop so all media tracks are stopped and the preview is cleared.

**Exit criteria:** A phone and a laptop browser can open the HTTPS sender page, explicitly grant permission, preview the selected camera, and stop capture without leaving the camera active.

## Phase 2 — WebRTC signaling and first live feed

**Objective:** Make one sender stream to one viewer. (Several viewers: Phase 8.)

Tasks:
- Implement validated room creation/join and one-sender/one-viewer capacity.
- Add Socket.IO events for peer readiness, SDP offer/answer, ICE candidates, leave, and errors.
- Implement `RTCPeerConnection` setup and cleanup on both clients.
- Render the remote stream in the viewer's video element.
- Add state transitions: Waiting, Connecting, Live, Reconnecting, Disconnected, Stopped, Error.
- Ensure the server relays signaling only and never receives video frames.

**Exit criteria:** A phone sender and laptop viewer on the same Wi-Fi establish a live feed. The viewer receives a remote track and renders video. Stopping the sender tears down capture and updates the viewer.

## Phase 3 — Pairing, authorization, and failure handling

**Objective:** Make accidental or unauthorized room joins difficult and failures understandable.

Tasks:
- Generate unpredictable room IDs and a pairing secret/PIN.
- Validate room membership for all signaling events.
- Reject extra senders/viewers beyond the MVP capacity. (Viewer capacity was later lifted: Phase 8.)
- Add expiry for abandoned rooms and cleanup for disconnected sockets.
- Rate-limit room creation/join attempts and validate/limit payloads.
- Add safe error messages and redact secrets from logs.
- Verify that a user who only knows the public tunnel URL cannot join without room authorization.

**Exit criteria:** Invalid secrets and unauthorized signaling are rejected; abandoned rooms are cleaned; the UI never displays Live without a usable remote track.

## Phase 3.5 — External Receiver Protocol Specification & Signaling Support

**Objective:** Support external WebRTC receivers (such as independent Python `aiortc` applications) connecting to the signaling server and browser camera sender.

Tasks:
- Add canonical participant role support (`camera-sender`, `webrtc-receiver`).
- Support bidirectional SDP offer/answer flows on the browser sender.
- Document the versioned external receiver signaling contract in `docs/architecture.md`.
- Preserve the optional HTTP MJPEG stream endpoint (`/stream/:roomId`) as an alternative integration.
- Verify room isolation, rate-limiting, and lifecycle cleanup via Node.js automated tests.

**Exit criteria:** Node.js automated tests pass for external receiver signaling and MJPEG streaming without Python installed on the host.

## Phase 4 — LAN quality and diagnostics

**Objective:** Measure real behavior on target devices instead of relying on assumptions.

Tasks:
- Add diagnostics for connection state, negotiated dimensions, received frames, bitrate, packet loss, and selected ICE candidate pair where available.
- Test direct media connectivity on the intended Wi-Fi network.
- Run a 10-minute stream and record resolution, frame rate, interruption count, and latency.
- Test camera/device changes, screen locking, browser backgrounding, Wi-Fi changes, and normal tab closure.
- Test on at least one Android phone and one desktop browser; add iOS Safari if it is a target platform.

**Exit criteria:** A recorded test report exists. The 720p/30 FPS and provisional latency goals are assessed on real hardware. Any network limitations are documented.

## Phase 4.5 — Experimental zrok-Tunneled Video Mode & Tunnel Workflow

**Objective:** Measure and test intentional application-level video relaying through the Windows Node.js server and zrok public share.

Tasks:
- Implement TunnelRelay service with maximum frame size limits (600KB), FPS enforcement (max 30), and backpressure frame dropping.
- Support media mode selection (`webrtc` vs `tunnel-relay`) across room manager, sender, and viewer.
- Add canvas downscaling, JPEG blob generation, and binary ArrayBuffer transport on the sender.
- Add binary frame reception and canvas rendering with freshest-frame buffer queue on the viewer.
- Add real-time throughput metrics (FPS, dropped frames, MB sent/received, estimated MB/hour).
- Provide a single Windows PowerShell entry point (`start.ps1`, which supersedes the former `scripts/` helpers).

**Exit criteria:** Automated tests pass for binary relay and room isolation; sender and viewer can run in tunnel-relay mode without Base64 encoding.

## Phase 5 — Optional cross-network access and TURN

**Objective:** Support networks where direct WebRTC connectivity does not work.

Tasks:
- Reproduce the failure on the intended external network before adding infrastructure.
- Configure TURN if required, using appropriately protected credentials.
- Expose a clear indication when a relayed media path is selected, where browser stats allow it.
- Measure the resulting latency and transfer cost.
- Review tunnel access policy and deployment security.

**Exit criteria:** Supported network scenarios are documented and tested. Do not claim universal remote connectivity merely because the web page is reachable.

## Phase 6 — Usability and deployment hardening

**Objective:** Make the tool comfortable to use repeatedly.

Tasks:
- Add a QR code for the sender/viewer URL or room pairing flow if useful.
- Improve mobile layout and full-screen viewer controls.
- Add reconnect actions and clearer diagnostics.
- Provide start-at-login or Windows service setup only if required; do not add it by default.
- Write a final setup guide, security checklist, and test matrix.

**Exit criteria:** A new user can start the host and connect the target devices using only the documentation. No unrequested recording or public port-forwarding functionality is present.

## Priority summary

1. Server foundation and HTTPS.
2. Camera capture and Stop lifecycle.
3. One-to-one WebRTC.
4. Room authorization and cleanup.
5. Real LAN testing and diagnostics.
6. TURN, multiple viewers, audio, QR code, and other optional features only when evidence or requirements justify them.

## Phase 7 — Standalone Console Executable & CLI Distribution

**Objective:** Package the entire application into a standalone Windows single `.exe` console application requiring zero runtime dependencies on client machines.

Delivered (ADR-017):
- Node.js Single Executable Application (SEA) build pipeline with `esbuild` and `postject`.
- In-memory embedded frontend static asset registry with seamless filesystem override.
- Interactive CLI application with banner, LAN IP detection, terminal ASCII QR code, and optional automated zrok tunnel supervision.
- Dynamic `.env` discovery, editable template generation in `dist/`, and custom `--env <path>` support.
- Custom project visual identity and icon embedding in PE resource table via `resedit`.
- Automated patch version bumping (`scripts/bump-version.js`) and one-click build automation (`build.bat`).
- Standalone single executable binary `dist/lan-camera-streaming.exe`.

**Exit criteria:** The standalone executable launches and serves all endpoints and static assets in an isolated environment without Node.js or `src/` files present. Running `build.bat` increments the version and creates a release-ready executable.

## Phase 8 — Multiple viewers per room (delivered, ADR-018)

**Objective:** Let several viewers (browser tabs, laptops, external receivers) watch one sender at once.

Delivered:
- `RoomManager` tracks a set of viewers; one sender stays enforced.
- Targeted signaling: the sender makes one offer per viewer with `targetId`; answers and candidates are matched by the viewer's socket id; `peer:left` carries `peerId`.
- The sender page keeps one `RTCPeerConnection` per viewer and shows "Live (N viewers)".
- The server rejects an untargeted offer when several viewers are present (a stale sender page) with a clear `room:error`.
- Tunnel frames and `stream:state` are broadcast to all viewers.

**Exit criteria (met on one PC with a mock camera):** 2 and 3 viewers live at once; a viewer can leave and rejoin; the sender can stop and restart with viewers present; tunnel relay works with 2 viewers. **Open:** real phone with 2+ viewers (encoder load), see tasks P4.7.

## Phase 9 — Single-screen responsive UX (delivered, ADR-019/020)

Delivered: orientation-aware layouts for phone portrait and landscape and desktop, a role-selection hub, state-driven sender/viewer panels, collapsed developer tools, PIN masking without password-manager prompts. Open: nothing recorded.

## Phase 10 — Windows virtual webcam (delivered, ADR-021/022/023; verified on one PC)

**Objective:** The phone camera appears as a normal Windows camera.

Delivered:
- DirectShow source filter (`LanCamFilter.dll`) and a Media Foundation virtual camera source (`LanCamMfSource.dll`), both reading the room's MJPEG stream and delivering 1280x720 at 30 FPS.
- `lancam://` deeplink ("Set as Webcam") that stores the room/PIN for both cameras; `POST /api/vcam/bridge-frame` so the PC viewer page feeds the camera with its WebRTC frames.
- Setup tool `lancam-setup.exe` (register, `--uninstall`, `--remove-mf`, `--silent`) with logs in `%ProgramData%/LanCamera`.

**Exit criteria:** Windows lists the camera (WinRT enumeration) and a capture through the Frame Server returns live upright frames: met. **Open:** Windows Camera app window, Teams/Zoom/Unity, a real phone, Windows 10 behavior. ADR-022's shared-memory path is not wired (see decisions).

## Phase 11 — One-file driver installer (delivered, ADR-024)

Delivered: Inno Setup installer `lan-camera-setupv<version>.exe` (install, upgrade, uninstall verified silently), built by `vcam/build.bat` from the root `build.bat`, served at `/download/lan-camera-setup` and embedded in the server exe.

**Open:** clean-machine/VM run, visible wizard click-through, code signing (SmartScreen), full root `build.bat` run end to end.

## Phase 13 — The 14 Advanced Ecosystem Features (delivered, ADR-026)

**Delivered across 5 phases (50/50 automated tests passing):**
1. **Bidirectional Audio & Intercom:** Mic audio stream acquisition, viewer audio volume/mute toggles, and push-to-talk dual-tone Web Audio chime synthesizer.
2. **High-Performance Shared-Memory Bridge:** Node `VcamShmBridge` client connected to `lancam-setup.exe --bridge` on TCP 7779, writing directly into `Local\LanCamSharedMemory_Video`.
3. **Native Unity Receiver Package:** UPM package `com.vcam.lancamera` in `unity-package/` (`LanCameraReceiver.cs`) strictly adhering to `AGENTS.md` (no `var`, explicit types, no `new()`, K&R braces).
4. **Multi-Camera Studio Switcher:** `RoomManager` studio-sender multi-feed support, targeted signaling routing, and interactive Studio Switcher bar in `viewer.html`.
5. **Embedded RTSP 1.0 Bridge:** Zero-dependency RFC 2326 & RFC 2435 JPEG over RTP streaming in `src/server/rtsp-server.js` on `rtsp://<host>:8554/live/<roomId>`.
6. **Hardware Camera Controls:** Torch/flashlight toggle and hardware zoom slider with sensor constraints in `camera-manager.js`.
7. **Adaptive Bitrate (ABR):** Dynamic RTCPeerConnection RTT polling and bitrate scaling (`RTCRtpSender.setParameters`).
8. **Local Recording & Snapshot Hub:** Canvas PNG snapshot capture and client-side `MediaRecorder` with live recording timer.
9. **mDNS / Zero-Conf LAN Auto-Discovery:** Multicast DNS beacon (`src/server/mdns-beacon.js`) announcing `lancam.local` on 224.0.0.251:5353 and `/api/discover`.
10. **Standby Slate & Virtual Camera Fallback:** Valid JFIF fallback buffer in `standby-slate.js` and SMPTE color bars in `lancam_filter.cpp`.
11. **Mobile Battery & Thermal Saver:** Screen WakeLock API and OLED Blackout Saver mode.
12. **Quick-Join URL & QR Code Auto-Connect:** Query parameter parsing (`?room=...&pin=...&autostart=1`) and one-click share deep links.
13. **Stream Transformation & Framing HUD:** Horizontal mirror flip, 90°/180°/270° rotation lock, and rule-of-thirds grid.
14. **Windows System Tray & Auto-Start:** `scripts/lan-camera-tray.ps1` notification tray companion and `scripts/register-autostart.ps1` registry manager.

## Phase 14 — Proposed next work

1. Verify virtual camera and RTSP bridge on hardware with external surveillance clients (OBS Media Source, VLC, Milestone).
2. Clean-machine VM verification of the Inno Setup installer.
3. Code-sign installer and executables when releasing public distribution builds.

## Phase 15 — Remote Desktop Control Integration (ADR-031)

**Objective:** Enable an authorized viewer to control a Windows desktop host with mouse and keyboard during screen sharing.

Tasks:
- Establish the native C++ `remote-control-helper` Git submodule with `SendInput` OS injection on loopback `127.0.0.1:8765`.
- Implement `RemoteControlManager` in Node.js server managing permanent password verification, 6-digit session PIN generation, rate limiting, and single-controller lease lifecycle.
- Add reconnection grace period (60s) for interrupted controllers to resume without re-authenticating.
- Integrate WebRTC DataChannel (`lancam-control`) for low-latency input transport with Socket.IO relay fallback.
- Implement normalized coordinate mapping in viewer accounting for letterboxing and aspect ratio.
- Implement sender controls: session PIN display with copy button, control enable/disable toggle, and immediate revocation.
- Add automated unit tests for credential verification, lease transitions, rate-limiting, and native input mapping.


## Phase 16 — Mobile Zoom, Touch Interaction and TeamViewer-Style Remote Control (ADR-038) [Completed]

**Objective:** Deliver a mobile-first remote control and viewing experience modeled after TeamViewer mobile app interaction patterns: universal pinch-to-zoom (1x-4x) and pan across all media sources, zoom-aware coordinate translation, touchpad-style Mouse mode and direct Touch mode, adaptive cursor overlay, mobile remote control toolbar, on-screen keyboard text input, auxiliary modifier bar, and special shortcuts.

Tasks:
- [x] Universal Pinch-to-Zoom & Pan (`src/public/js/zoom-controller.js`): two-finger pinch centered on fingers' midpoint, pan boundary constraints, Fit Screen reset, and floating `+`/`-` buttons.
- [x] Zoom-Aware Coordinate Mapping (`src/public/js/control-coords.js`): account for viewport bounding rectangle, video dimensions, letterbox/pillarbox geometry, scale, and pan offsets; provide screen-to-norm and norm-to-screen transforms.
- [x] Native Helper Protocol & Unicode Text Entry (`remote-control-helper`): implement `InjectText` with `KEYEVENTF_UNICODE`, map `VK_SNAPSHOT` for PrintScreen, and update `LoopbackServer`.
- [x] Adaptive Cursor Overlay (`#remoteCursorOverlay`): high-visibility arrow pointer scaled independently of video zoom in CSS pixels and hotspot-aligned to host coordinates.
- [x] Mouse Mode & Touch Mode: relative touchpad dragging with sensitivity accumulation, tap-to-click, long-press right click, two-finger scroll, double-tap & drag, direct screen tap mapping, and gesture disambiguation.
- [x] Mobile Remote-Control Toolbar & Drawers: compact collapsible bottom toolbar with Exit, Keyboard, Mouse/Touch mode, Shortcuts, Special Keys, Settings, and Collapse/Expand.
- [x] Mobile Virtual Keyboard & Modifier Bar: invisible text input surface for mobile virtual keyboard, auxiliary modifier row (`Shift`, `Ctrl`, `Alt`, `Win`, `...`), special keys matrix, and shortcut sequences.
- [x] Automated Test Coverage: 219 tests passing (`tests/zoom-and-coords.test.js`, `tests/mobile-control-ui.test.js`, `tests/viewer-control.test.js`).
