# LAN Camera Streaming — Task Backlog

Use these checkboxes as the implementation source of truth. Sections are grouped by topic and dated, not strictly ordered by number. Move completed work to checked only after testing it. Update this file in the same change as the implementation.

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
- [x] Support multiple concurrent viewers per room via WebRTC mesh (ADR-018, see P4.7).
- [x] Elevate Sender and Viewer UI/UX with Ayurvedic Holistic Product Design (ADR-019).
  - [x] Sattvic herb-slate palette with organic Prāna pulse indicator animations.
  - [x] Nāḍī Parīkṣā (Stream Health & Vitals Dashboard) reporting FPS, acuity, path, viewers, and latency.
  - [x] Viewport Heads-Up Display (HUD) overlay for Camera Flip, Torch/Flashlight, Snapshot still capture, PiP, and Fullscreen.
  - [x] Mobile thumb ergonomics, 1-tap clipboard copying with visual feedback, and foldable session setup accordion.
  - [x] Collapsible diagnostics drawer for decluttering technical WebRTC SDP logs.
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

## P5.5 — External receivers (documentation, 2026-10-10)

Decision: **ADR-016**. Docs only; no server code changed.

- [x] Write `docs/receiver-guide.md`: a technology-neutral guide to connecting any receiver (transport choice, the WebRTC sequence, MJPEG and tunnel relay, error and retry table, diagnosing a failed WebRTC connection, a receiver checklist, library suggestions).
- [x] Correct `docs/architecture.md` §4 to the server's real behavior: `mediaMode` in `room:join` and its ack, who receives `peer:joined`, `senderId` on relayed offers, `tunnel:frame`, `/api/config`, per-socket membership, the join rate limit, the exclusive viewer slot, the MJPEG delimiter and demand behavior.
- [x] README: replace the Python-only integration section with a language-neutral "Connecting a receiver" section, a documentation index, and the Viitorx Unity + Python sidecar reference integration.
- [x] Record the reference integration (a Unity app with a Python sidecar receiver, written to the guide) and what was verified against this server.
- [ ] Verify the guide by building a receiver in a **second language** (for example Node.js or Go) from the guide alone. Only Python has been exercised, so every statement that is not about Python is from the server source, not from a test.
- [ ] Real-device verification of an external receiver: a real phone's browser sender page, real Wi-Fi (client isolation, the Windows Firewall profile), and a zrok tunnel for the signaling.
- [ ] Measure real-phone latency end to end for the WebRTC receiver path; it is unmeasured.
- [ ] Decide whether the server should expose a machine-readable contract (a JSON schema or an OpenAPI-style description of the events) so receivers can be generated or validated.

## P6 — Standalone Console Executable (.exe) & CLI

Decision: **ADR-017**.

- [x] Create embedded assets compiler (`scripts/build-embedded-assets.js`) to bundle frontend assets (`src/public`) into in-memory registry (`src/server/embedded-assets.js`).
- [x] Update `src/server/server.js` to serve embedded static assets with filesystem fallback.
- [x] Implement standalone CLI entry point (`src/server/cli.js`) with argument parsing, banner, LAN IP detection, terminal ASCII QR code, and zrok tunnel automation with graceful cleanup.
- [x] Create single executable build pipeline (`scripts/build-exe.js`) using Node.js SEA (Single Executable Application), `esbuild`, and `postject`.
- [x] Add npm scripts: `build:exe`, `build:assets`, `bump:version`, `cli`.
- [x] Add automated test suite for CLI and embedded assets (`tests/cli.test.js`).
- [x] Verify standalone `.exe` execution in an isolated directory with zero external files.
- [x] Fix: the exe never served the Socket.IO browser client (`/socket.io/socket.io.js` returned an empty reply because socket.io reads it from `node_modules`), so the sender/viewer pages could not connect. The client is now embedded and served at `/vendor/socket.io.js`; verified in an isolated folder, over websocket signaling, and in a real browser. The earlier isolated-directory check only requested pages and CSS, not the Socket.IO client or a signaling round trip.
- [x] Fix: `src/server/embedded-assets.js` is git-ignored and generated, so a fresh clone could not start; `npm install` now generates it (`postinstall`).
- [x] Expose `.env` and `.env.example` alongside the executable in `dist/` with dynamic runtime loading and auto-template generation on first run.
- [x] Support `--env <path>` CLI flag to allow arbitrary custom configuration files.
- [x] Create modern project icon (`assets/icon.ico`, `assets/icon.png`, `src/public/assets/icon.svg`, `src/public/favicon.ico`, `src/public/favicon.png`) and embed into web headers and PE `.exe` binary via `resedit`.
- [x] Implement automated version incrementer (`scripts/bump-version.js`) to bump the last digit of the semantic version in `package.json` and `package-lock.json`.
- [x] Create one-click Windows root build script (`build.bat`) to run the version bumper and produce a fully packaged `.exe` with PE file version metadata.
 
## P7 — Orientation-Aware, Single-Screen Responsive UX (2026-10-12)

Decision: **ADR-020**.

- [x] Redesign CSS architecture (`src/public/css/style.css`) using `100dvh` viewport constraints and dynamic responsive grids.
- [x] Implement landscape orientation two-column layout for Sender (Left: camera preview + floating HUD; Right: compact setup / broadcasting card).
- [x] Implement landscape orientation 70/30 split for Viewer giving live remote video visual priority.
- [x] Redesign Role Selection Hub (`src/public/index.html`) into single-screen orientation-aware dashboard with prominent Sender & Viewer role cards, instant QR mobile scan card, and collapsible protocol guide.
- [x] Support ultra-short viewports (<=480px height, such as 667×320 and 844×390 mobile landscape) with localized sidebar scrolling and zero page-level scrollbars.
- [x] Implement portrait orientation fluid stacking prioritizing active stream feeds using `.streaming-active` reordering.
- [x] Provide state-driven UI transitions: idle, connecting, broadcasting (with dedicated share card & viewer count pill), connected, reconnecting, and stopped.
- [x] Wire up inline password visibility toggles (`setupPasswordToggle`) and QR preview toggles.
- [x] Collapse developer tools (Python OpenCV endpoints, direct PC links, WebRTC SDP/ICE diagnostics) by default.
- [x] Synchronize embedded assets (`node scripts/build-embedded-assets.js`) and ensure 100% test pass rate (`npm test`).

## P8 — DirectShow Virtual Camera Driver & Deeplink Integration (2026-10-12)

Decision: **ADR-021**. Code lives in the `vcam/` submodule (its own docs: `vcam/docs/`).

- [x] Add submodule `vcam` referencing the DirectShow driver repository (`WRDeadman10/DirectShow`).
- [x] Implement in-process COM DirectShow source filter (`vcam/src/lancam_filter.cpp`, `vcam/src/dll_main.cpp`) registering as `"LAN Phone Camera"` under `CLSID_VideoInputDeviceCategory`.
- [x] Implement MJPEG HTTP client using WinHTTP and Windows Imaging Component (WIC) decoding (`vcam/include/mjpeg_decoder.h`).
- [x] Implement protocol handler & setup tool (`vcam/src/lancam_setup.cpp`) handling `lancam://` URI schemes and COM registration.
- [x] Add "Set as Webcam" action to the browser viewer (`src/public/viewer.html`, `src/public/js/viewer.js`) that triggers the `lancam://` deeplink.
- [x] Fix: "Set as Webcam" showed a UAC prompt on every click (`requireAdministrator` manifest). The manifest is `asInvoker`; installation still self-elevates.
- [x] Fix: output was upside down and not scaled to the negotiated size; frames are flipped (bottom-up RGB24) and letterboxed (`BlitTopDownToBottomUp`, tested in isolation).
- [x] Server rejects an untargeted sender offer when several viewers are in the room (stale sender page), with a clear `room:error`.

## P8.5 — Media Foundation virtual camera for the Windows Camera app (2026-10-12)

Decision: **ADR-023**.

- [x] Diagnose: the Windows Camera app (UWP / Media Foundation) lists no DirectShow cameras (WinRT video-capture enumeration returned 0 devices).
- [x] Implement `LanCamMfSource.dll` (`vcam/src/lancam_mfsource.cpp`): IMFMediaSourceEx + IMFMediaStream2 + IKsControl behind an `IMFActivate` factory; NV12 1280x720 at 30 FPS, letterboxed.
- [x] Register with `MFCreateVirtualCamera` (system lifetime, all users, `KSCATEGORY_VIDEO_CAMERA`); class registered through `HKEY_CLASSES_ROOT` (a direct `HKLM/SOFTWARE/Classes` write is denied even when elevated).
- [x] Machine-wide session file `%ProgramData%/LanCamera/session.ini` (ACL for Users and LOCAL SERVICE) because the Frame Server runs as LocalService; `lancam://` writes both copies.
- [x] Logs: `%ProgramData%/LanCamera/mfsource.log` and `setup.log`.
- [x] Verified on this PC: WinRT enumeration lists "LAN Phone Camera (Windows Virtual Camera)"; a Media Foundation capture through the Frame Server returned 30.0 fps upright 1280x720 live frames from a mock sender.
- [ ] Open the Windows Camera app and confirm the live phone feed (UI not checked); try Teams, Zoom and Unity.
- [ ] Verify with a real phone sender and the PC viewer pump (`POST /api/vcam/bridge-frame`) instead of the mock sender's own MJPEG upload.

## P9 — Shared-memory bridge for the DirectShow camera (2026-10-12) — partly implemented, not wired

Decision: **ADR-022** (see its correction).

- [x] Win32 shared-memory IPC header (`vcam/include/shm_bridge.h`) and a reader in the DirectShow filter that prefers shared-memory frames over HTTP.
- [x] `lancam-setup.exe --bridge` daemon (WinSock2, `127.0.0.1:7779`) that writes frames into shared memory.
- [x] Viewer frame pump (`src/public/js/viewer.js`) and `POST /api/vcam/bridge-frame` (`src/server/server.js`).
- [x] Corrected behavior (verified by reading the code, 2026-10-13): the endpoint does **not** forward to TCP 7779. It hands each JPEG to the MJPEG streamer, and the camera reads `/stream/<room>` over HTTP. Nothing starts `--bridge` or sends frames to it, so the shared-memory path is dead code.
- [ ] Decide: wire the shared-memory path (lower latency, no JPEG) or delete it (`shm_bridge.h`, `--bridge`, the reader).

## P10 — Controls Sidebar Panel Scrolling & Viewport Constraints (2026-10-12)

- [x] Resolve CSS flexbox minimum height defect (`min-height: 0`, `max-height: 100%`) on `.sidebar-pane` so children do not overflow unscrollably past parent container.
- [x] Prevent flex children shrinking (`.sidebar-pane > * { flex-shrink: 0; }`) to maintain natural component heights and trigger clean vertical scrolling.
- [x] Enhance scrollbar visibility and ergonomics with `6px` width, contrasting thumb (`--border-medium` with hover highlight), and Firefox `scrollbar-width: thin`.
- [x] Add generous bottom padding (`padding-bottom: 16px`) so all Developer Tools, Python OpenCV endpoints, and diagnostics remain fully reachable.
- [x] Synchronize embedded assets (`node scripts/build-embedded-assets.js`) and run test suite (`npm test`, 35/35 passing).

## P11 — Access PIN Credential Classification Removal (2026-10-12)

- [x] Convert `accessPin` inputs in `sender.html` and `viewer.html` from `type="password"` to `type="text"` with `autocomplete="off"` and `data-lpignore="true"` to prevent browser password managers and data breach detectors from intercepting PIN entry.
- [x] Implement CSS text security masking (`.pin-masked { -webkit-text-security: disc; text-security: disc; }`) so PIN digits are visually masked with bullets without triggering credential managers.
- [x] Recompile embedded assets (`node scripts/build-embedded-assets.js`) and run test suite (`npm test`, 35/35 passing).

## P12 — Mobile Portrait & Samsung S21 Vertical Alignment Overhaul (2026-10-12)

- [x] Fix mobile header overcrowding: hide verbose 60-character `#pathIndicator` on mobile screens (`display: none !important`) since stream path is already shown in the vitals bar, keep brand title on a single line, and align live status badge cleanly.
- [x] Adapt camera viewfinder for portrait aspect ratios (e.g. 1080×1920 phone camera on Samsung S21) using flexible height (`height: 35vh; min-height: 220px; max-height: 42vh; aspect-ratio: auto;`) instead of forced 16:9 landscape box.
- [x] Convert vitals bar into smooth, horizontal swipeable ribbon with `white-space: nowrap` and zero multi-line metric wrapping.
- [x] Optimize share input rows with `flex: 1; min-width: 0;` on inputs and `flex-shrink: 0;` on copy buttons to prevent awkward truncation.
- [x] Recompile embedded assets (`node scripts/build-embedded-assets.js`) and run test suite (`npm test`, 35/35 passing).

## P13 — Prevent Web Viewer Room Disconnection on Driver Download (2026-10-13)

- [x] The driver link is an anchor with `id="btnDownloadDriver"`; its click handler calls `preventDefault()` and starts the download through a hidden iframe (`/download/lan-camera-setup`), so the page never navigates and `beforeunload` (which leaves the room) never fires on a live stream.
- [x] Link, attribute and log text now name the installer (`lan-camera-setup.exe`), not the former zip.
- [x] Rebuild embedded assets (`node scripts/build-embedded-assets.js`) and run the test suite.
- [ ] Verify the download on a live stream in a real browser.

## P14 — One-file driver installer and fresh-machine fixes (2026-10-13)

Decision: **ADR-024**.

- [x] Fix: the "dynamically load `MFCreateVirtualCamera`" change looked in `mfplat.dll`; the function is exported by `mfsensorgroup.dll`, so the Media Foundation camera was skipped on every machine (hidden on the dev PC by an earlier install).
- [x] Fix: link the C++ runtime statically (`/MT`) for `lancam-setup.exe`, `LanCamFilter.dll` and `LanCamMfSource.dll`; a clean Windows has no Visual C++ redistributable. Dependencies are now only Windows DLLs.
- [x] Installer tool: preflight (DLLs next to the exe), real `regsvr32` result, check that Windows lists the camera, honest per-component summary, non-zero exit on problems, `--silent`, `--uninstall`, `--remove-mf`, no self-copy when run from the install folder, in-use DLLs renamed aside.
- [x] Inno Setup 6 script `vcam/installer/lan-camera.iss`; `vcam/build.bat` builds it; output `dist/lan-camera-setupv<version>.exe` (the zip is gone; root `build.bat` no longer packages anything).
- [x] `/download/lan-camera-setup` (aliases `/download/lancam-vcam`, `.exe`, `.zip`) serves the newest installer from disk or from the copy embedded in the exe (`scripts/build-embedded-assets.js`); test added (37/37).
- [x] Verified on this PC: silent install (exit 0, camera listed), silent uninstall (camera list empty, DirectShow class gone, data folder gone), fresh reinstall, and the exe serving the byte-identical installer from an empty folder.
- [ ] Run the installer on a clean Windows 11 machine/VM and click through the visible wizard.
- [ ] Windows 10: confirm the installer reports "Windows camera needs Windows 11" and the DirectShow camera still works.
- [ ] Run the full root `build.bat` end to end (it bumps the version and ends with `pause`; its steps were run individually).
- [ ] Code-sign the installer (SmartScreen warns on unsigned files).

## P4.7 — Multiple viewers (2026-10-12)

Decision: **ADR-018**.

- [x] `RoomManager` with `viewerSocketIds`; one sender enforced; room removed when everyone left.
- [x] Targeted offers/answers/candidates (`targetId`, `senderId`), `peer:left` with `peerId`, broadcast of `stream:state` and `tunnel:frame`.
- [x] Sender page: one `RTCPeerConnection` per viewer; status "Live (N viewers)".
- [x] Tests: targeted offer routing, untargeted offer rejection with several viewers, room capacity.
- [x] Fix: leaked tunnel-stats timer on repeated `peer:joined` (kept logging after Stop).
- [x] Verified in the in-app browser with a mock camera: 2 and 3 viewers, leave/rejoin, sender restart with viewers present, tunnel relay with 2 viewers.
- [ ] Real phone with 2+ viewers (each viewer adds an encoder; the default "Full Maximum Resolution" 4K capture may overload a phone).
- [ ] Optional: per-peer bitrate/resolution caps; automatic retry for a viewer whose ICE fails.
- [ ] Evaluate multiple camera senders per room.

## P15 — Dynamic Media Source Switching & Multi-Viewer Reconnection Fixes (2026-10-13)

Decision: **ADR-025**.

- [x] Dynamic track replacement in `src/public/js/sender.js`: `obtainStreamForCurrentSource()` and `applyDynamicSourceChange()` hot-swap video tracks across all existing `viewerPeers` via `RTCRtpSender.replaceTrack()` without leaving or rejoining the room.
- [x] Wire dynamic switching to UI events: `sourceSelect`, `fileInput`, `urlInput`, `cameraSelect`, `cameraResolutionSelect`, and `btnToggleFacing`.
- [x] Fix sender room re-entry: restore full `room:join` response callback in `src/public/js/sender.js` so sender immediately connects to all waiting viewers (`response.peerSocketIds`) upon rejoining.
- [x] Fix signaling broadcast on sender re-entry: broadcast `peer:joined` to all peers in `result.peerSocketIds` in `src/server/signaling.js`.
- [x] Update viewer to handle dynamic track updates and dismiss reconnect overlays upon `stream:state` ('source-changed', 'live') and `onTrack` events in `src/public/js/viewer.js`.
- [x] Fix Node.js ESM module resolution in `src/server/server.js` using `createRequire(import.meta.url)` with fallback.
- [x] Fix boolean parsing in `src/server/config.js` (`parseBool`).
- [x] Automated tests added for sender source selection UI and sender leaving/rejoining with waiting viewers (41/41 passing).

