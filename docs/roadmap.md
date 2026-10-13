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

## Phase 12 — Proposed next work

1. Verify the virtual webcam with a real phone, the Windows Camera app, Teams/Zoom and Unity; run the installer on a clean Windows 11 VM.
2. Real-phone test of 2+ viewers; consider per-peer bitrate/resolution caps (`RTCRtpSender.setParameters`) so the phone is not overloaded.
3. Decide whether to wire or delete the unused shared-memory bridge (ADR-022).
4. Code-sign the installer and executables if distribution widens.
5. TURN for cross-network use if that becomes a requirement (Phase 5).
