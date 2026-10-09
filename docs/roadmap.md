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

**Objective:** Make one sender stream to one viewer.

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
- Reject extra senders/viewers beyond the MVP capacity.
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
- Provide Windows PowerShell helper scripts (`scripts/start-server.ps1`, `scripts/start-zrok.ps1`).

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
