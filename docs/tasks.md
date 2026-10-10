# LAN Camera Streaming — Task Backlog

Use these checkboxes as the implementation source of truth. Move completed work to checked only after testing it. Update this file in the same change as the implementation.

## P0 — Inspect and bootstrap

- [x] Inspect the repository root, existing package files, `AGENTS.md`, `.editorconfig`, and current code patterns.
- [x] Confirm the intended Node.js version and document it.
- [x] Initialize or reuse `package.json` with start and development scripts.
- [x] Add Express and Socket.IO using the project's package manager and lockfile.
- [x] Create the server entry point and serve static frontend assets.
- [x] Add `/health` and verify it locally.
- [x] Add `.gitignore` and `.env.example` with no real secrets.
- [x] Document Windows startup and shutdown steps.

## P1 — HTTPS and sender capture

- [x] Select one initial HTTPS approach: ngrok, zrok, or locally trusted HTTPS.
- [x] Verify the sender page opens from a phone browser using the selected HTTPS URL.
- [x] Create `/sender` UI with explicit Start and Stop controls.
- [x] Request video capture only after the user clicks Start.
- [x] Render a local camera preview.
- [x] Add a camera/device selector where supported.
- [x] Show useful errors for denied permission, missing device, busy device, and unsupported capture.
- [x] Stop every acquired media track on Stop and page teardown.
- [x] Verify camera capture is stopped after use.

## P2 — Viewer and WebRTC

- [x] Create `/viewer` UI with room entry and remote video element.
- [x] Implement in-memory room lifecycle and one-sender/one-viewer capacity.
- [x] Define and validate payload schemas for each Socket.IO event.
- [x] Implement room create/join/leave and peer-ready notifications.
- [x] Implement WebRTC offer/answer exchange.
- [x] Implement ICE candidate exchange and correct handling of candidates arriving before remote description setup completes.
- [x] Add the sender video track to the peer connection.
- [x] Render remote tracks in the viewer.
- [x] Handle connection failure, peer departure, server disconnect, and retry.
- [x] Confirm the Node.js server never handles raw video frames.
- [x] Verify the viewer becomes Live only after receiving/rendering a remote track.

## P3 — Security and cleanup

- [x] Generate unpredictable room IDs and pairing secrets.
- [x] Require and validate the room secret/PIN on join.
- [x] Enforce sender/viewer role and room capacity on the server.
- [x] Verify every signaling event is authorized for the current room membership.
- [x] Validate input types and limit signaling payload size.
- [x] Rate-limit room creation and join attempts.
- [x] Add inactive-room expiry and disconnected-socket cleanup.
- [x] Redact pairing secrets and sensitive connection payloads from logs.
- [x] Test invalid room IDs, wrong secrets, unauthorized recipients, and duplicate role joins.
- [x] Review public tunnel exposure; do not add router port forwarding.

## P3.5 — External Receiver Protocol & Signaling Support

- [x] Remove generated Python receiver and inference client implementation from Node.js repository.
- [x] Support canonical participant roles (`camera-sender` and `webrtc-receiver`) in `RoomManager`.
- [x] Support bidirectional SDP negotiation on browser camera sender for external offerer/answerer.
- [x] Document versioned Socket.IO signaling protocol contract in `docs/architecture.md`.
- [x] Preserve optional HTTP MJPEG streaming endpoint (`/stream/:roomId?pin=...`) as alternative integration.
- [x] Add automated Node.js tests verifying external receiver role mapping and signaling relays.

## P4 — Quality and diagnostics

- [x] Display clear states: Waiting, Connecting, Live, Reconnecting, Disconnected, Stopped, Error.
- [x] Expose connection/ICE state in a diagnostics panel or debug log.
- [x] Read negotiated video dimensions and report received frames/bitrate where supported.
- [x] Inspect the selected ICE candidate pair to verify direct versus relayed connectivity where supported.
- [x] Implement structured real-time diagnostic logging with copy and clear buttons on both sender and viewer.
- [x] Add early ICE candidate queueing (`pendingRemoteCandidates`) to eliminate candidate drop race condition during async server config fetch.
- [x] Parse and log all candidate types (HOST, SRFLX, RELAY, mDNS), protocols, and addresses on both clients.
- [x] Document and diagnose same-LAN WebRTC failure causes between Android and Windows (mDNS isolation, lack of router NAT hairpinning, and Windows firewall).
- [ ] Test a 10-minute one-to-one stream on the target Wi-Fi.
- [ ] Record observed resolution, frame rate, interruption count, and end-to-end latency.
- [ ] Test phone-to-Windows, laptop-to-Windows, permission denial, Stop, tab closure, refresh, and Wi-Fi disconnect.
- [x] Document any networks where direct WebRTC does not connect (same-LAN Wi-Fi routers without NAT loopback / AP isolation).

## P4.5 — Experimental zrok-Tunneled Video Mode & Tunnel Lifecycle

- [x] Implement `TunnelRelay` service for server-side frame rate/size bounding and backpressure frame dropping.
- [x] Add media mode selector (`webrtc` vs `tunnel-relay`) across room manager, sender, and viewer.
- [x] Implement canvas downscaling and binary JPEG transmission (`tunnel:frame`) in `sender.js`.
- [x] Implement binary frame canvas rendering with drop-queue management in `viewer.js`.
- [x] Add real-time throughput diagnostics (frames sent/received, dropped frames, encoding latency, MB/hr estimates).
- [x] Support full native camera sensor resolution (4K / 1080p) across sender capture and tunnel relay.
- [x] Bind public zrok tunnel explicitly to reserved namespace name `public:lan` (`lan.shares.zrok.io`).
- [x] Fix terminal ASCII QR code generation to encode the exact active sender URL (`https://lan.shares.zrok.io/sender`).
- [x] Implement pre-flight and graceful teardown share deallocation in `start.ps1` (`zrok2 delete share public:lan`) to release bound endpoints from zrok web dashboard.
- [x] Release zrok dashboard endpoints automatically (pre-flight and on exit) inside `start.ps1`; the standalone `scripts/release-zrok.ps1` was removed.
- [x] Fix PowerShell 5.1 ANSI parsing errors by eliminating non-ASCII box-drawing characters from `start.ps1`.
- [x] Add automated unit and integration tests covering binary frame relay and room mode isolation.

## P4.6 — Zero-zrok-quota LAN operation

- [x] Make the sender's MJPEG frame upload demand-driven (server emits `mjpeg:demand`; frames dropped server-side when no consumer; sender downscales to 1280 px max width, one in-flight encode, 900 KB cap).
- [x] Make `/snapshot/:roomId` request a fresh frame on demand instead of relying on a permanently cached frame.
- [x] Skip oversized tunnel frames on the sender instead of letting the server reject them or Socket.IO drop the connection.
- [x] Add `/api/network-info` (scheme + port only) and a "viewer on the PC via localhost" link on the sender page, viewer hint banner, index page, and `start.ps1` output.
- [x] Add a connection-path indicator (LAN direct / internet / TURN relay) driven by the nominated ICE candidate pair on sender and viewer.
- [x] Rewrite the ICE-failure diagnosis (AP isolation, Windows Firewall profile, VPN adapter); relabel Mode B as a quota-consuming fallback.
- [x] Optional local HTTPS (`HTTPS_CERT_PATH` / `HTTPS_KEY_PATH`), and `start.ps1 -LocalOnly` for tunnel-free LAN mode (mkcert auto-setup was tried and removed).
- [x] Add automated tests for demand-driven MJPEG, network-info, HTTPS config validation, and path classification.
- [ ] Run `start.ps1` on the real phone + PC and confirm the sender shows "LAN direct" and the zrok dashboard shows only signaling-sized transfer.
- [x] Consolidate all PowerShell helpers into the single root `start.ps1` (removed `scripts/` folder; first-run `npm install` and `.env` creation handled by it).
- [ ] Optional: run `start.ps1 -LocalOnly` and confirm Chrome on the phone (with the insecure-origin flag) opens the LAN URL and grants camera access.

## P5 — Conditional / post-MVP

- [ ] Add TURN only if testing demonstrates a requirement for relayed connectivity.
- [ ] Evaluate whether audio is required.
- [ ] Evaluate multiple viewers or multiple camera senders.
- [ ] Add QR-based pairing if it materially improves setup.
- [x] Evaluate a stable local DNS name and locally trusted certificate for tunnel-free LAN operation (mkcert + `start.ps1 -LocalOnly`, see ADR-015).
- [ ] Add a Windows service or auto-start setup only if explicitly required.

## Completion checklist

- [x] Fresh checkout can be started using documented steps.
- [x] HTTPS camera permissions work on the target devices.
- [x] One sender and one viewer can stream over the intended LAN.
- [x] Sender Stop reliably releases the camera.
- [x] Unauthorized joins and signaling are rejected.
- [x] Disconnect states and errors are actionable.
- [x] Test results and any known limitations are documented.
- [x] `decisions.md` is updated for any material architecture changes.
- [x] `ai_handoff.md` describes the actual state of the repository and the next task.

## P5 — External receivers (documentation, 2026-10-10)

Decision: **ADR-016**. Docs only; no server code changed.

- [x] Write `docs/receiver-guide.md`: a technology-neutral guide to connecting any receiver (transport choice, the WebRTC sequence, MJPEG and tunnel relay, error and retry table, diagnosing a failed WebRTC connection, a receiver checklist, library suggestions).
- [x] Correct `docs/architecture.md` §4 to the server's real behavior: `mediaMode` in `room:join` and its ack, who receives `peer:joined`, `senderId` on relayed offers, `tunnel:frame`, `/api/config`, per-socket membership, the join rate limit, the exclusive viewer slot, the MJPEG delimiter and demand behavior.
- [x] README: replace the Python-only integration section with a language-neutral "Connecting a receiver" section, a documentation index, and the Viitorx Unity + Python sidecar reference integration.
- [x] Record the reference integration (a Unity app with a Python sidecar receiver, written to the guide) and what was verified against this server.
- [ ] Verify the guide by building a receiver in a **second language** (for example Node.js or Go) from the guide alone. Only Python has been exercised, so every statement that is not about Python is from the server source, not from a test.
- [ ] Real-device verification of an external receiver: a real phone's browser sender page, real Wi-Fi (client isolation, the Windows Firewall profile), and a zrok tunnel for the signaling.
- [ ] Measure real-phone latency end to end for the WebRTC receiver path; it is unmeasured.
- [ ] Decide whether the server should expose a machine-readable contract (a JSON schema or an OpenAPI-style description of the events) so receivers can be generated or validated.
