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

- [ ] Select one initial HTTPS approach: ngrok, zrok, or locally trusted HTTPS.
- [ ] Verify the sender page opens from a phone browser using the selected HTTPS URL.
- [ ] Create `/sender` UI with explicit Start and Stop controls.
- [ ] Request video capture only after the user clicks Start.
- [ ] Render a local camera preview.
- [ ] Add a camera/device selector where supported.
- [ ] Show useful errors for denied permission, missing device, busy device, and unsupported capture.
- [ ] Stop every acquired media track on Stop and page teardown.
- [ ] Verify camera capture is stopped after use.

## P2 — Viewer and WebRTC

- [ ] Create `/viewer` UI with room entry and remote video element.
- [ ] Implement in-memory room lifecycle and one-sender/one-viewer capacity.
- [ ] Define and validate payload schemas for each Socket.IO event.
- [ ] Implement room create/join/leave and peer-ready notifications.
- [ ] Implement WebRTC offer/answer exchange.
- [ ] Implement ICE candidate exchange and correct handling of candidates arriving before remote description setup completes.
- [ ] Add the sender video track to the peer connection.
- [ ] Render remote tracks in the viewer.
- [ ] Handle connection failure, peer departure, server disconnect, and retry.
- [ ] Confirm the Node.js server never handles raw video frames.
- [ ] Verify the viewer becomes Live only after receiving/rendering a remote track.

## P3 — Security and cleanup

- [ ] Generate unpredictable room IDs and pairing secrets.
- [ ] Require and validate the room secret/PIN on join.
- [ ] Enforce sender/viewer role and room capacity on the server.
- [ ] Verify every signaling event is authorized for the current room membership.
- [ ] Validate input types and limit signaling payload size.
- [ ] Rate-limit room creation and join attempts.
- [ ] Add inactive-room expiry and disconnected-socket cleanup.
- [ ] Redact pairing secrets and sensitive connection payloads from logs.
- [ ] Test invalid room IDs, wrong secrets, unauthorized recipients, and duplicate role joins.
- [ ] Review public tunnel exposure; do not add router port forwarding.

## P4 — Quality and diagnostics

- [ ] Display clear states: Waiting, Connecting, Live, Reconnecting, Disconnected, Stopped, Error.
- [ ] Expose connection/ICE state in a diagnostics panel or debug log.
- [ ] Read negotiated video dimensions and report received frames/bitrate where supported.
- [ ] Inspect the selected ICE candidate pair to verify direct versus relayed connectivity where supported.
- [ ] Test a 10-minute one-to-one stream on the target Wi-Fi.
- [ ] Record observed resolution, frame rate, interruption count, and end-to-end latency.
- [ ] Test phone-to-Windows, laptop-to-Windows, permission denial, Stop, tab closure, refresh, and Wi-Fi disconnect.
- [ ] Document any networks where direct WebRTC does not connect.

## P5 — Conditional / post-MVP

- [ ] Add TURN only if testing demonstrates a requirement for relayed connectivity.
- [ ] Evaluate whether audio is required.
- [ ] Evaluate multiple viewers or multiple camera senders.
- [ ] Add QR-based pairing if it materially improves setup.
- [ ] Evaluate a stable local DNS name and locally trusted certificate for tunnel-free LAN operation.
- [ ] Add a Windows service or auto-start setup only if explicitly required.

## Completion checklist

- [ ] Fresh checkout can be started using documented steps.
- [ ] HTTPS camera permissions work on the target devices.
- [ ] One sender and one viewer can stream over the intended LAN.
- [ ] Sender Stop reliably releases the camera.
- [ ] Unauthorized joins and signaling are rejected.
- [ ] Disconnect states and errors are actionable.
- [ ] Test results and any known limitations are documented.
- [ ] `decisions.md` is updated for any material architecture changes.
- [ ] `ai_handoff.md` describes the actual state of the repository and the next task.
