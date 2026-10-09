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

## P4.5 — Experimental zrok-Tunneled Video Mode

- [x] Implement `TunnelRelay` service for server-side frame rate/size bounding and backpressure frame dropping.
- [x] Add media mode selector (`webrtc` vs `tunnel-relay`) across room manager, sender, and viewer.
- [x] Implement canvas downscaling and binary JPEG transmission (`tunnel:frame`) in `sender.js`.
- [x] Implement binary frame canvas rendering with drop-queue management in `viewer.js`.
- [x] Add real-time throughput diagnostics (frames sent/received, dropped frames, encoding latency, MB/hr estimates).
- [x] Add PowerShell startup scripts for Windows zrok workflow (`scripts/start-server.ps1`, `scripts/start-zrok.ps1`).
- [x] Add automated unit and integration tests covering binary frame relay and room mode isolation.

## P5 — Conditional / post-MVP

- [ ] Add TURN only if testing demonstrates a requirement for relayed connectivity.
- [ ] Evaluate whether audio is required.
- [ ] Evaluate multiple viewers or multiple camera senders.
- [ ] Add QR-based pairing if it materially improves setup.
- [ ] Evaluate a stable local DNS name and locally trusted certificate for tunnel-free LAN operation.
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
