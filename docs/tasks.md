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
- [x] Wire the shared-memory path: `src/server/vcam-shm-bridge.js` connects Node to `lancam-setup.exe --bridge` on TCP 7779 and `/api/vcam/bridge-frame?format=raw` writes frames directly into shared memory.

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
- [x] Fix: dynamically discover MSVC x64 build environment (`vcvars64.bat`) using `vswhere.exe` and standard Visual Studio 2022/2019 Community, BuildTools, Professional, and Enterprise installation paths instead of hardcoded Community edition path; prevents `'cl.exe' is not recognized` build failures.
- [x] Run the full root `build.bat` end to end (bump version -> build `vcam` driver + Inno Setup installer -> build `remote-control-helper` + Inno Setup installer -> generate embedded assets and SEA executable `lan-camera-streaming.exe`).
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

## P16 — The 14 Advanced Feature Expansion (2026-10-13)

### Phase A: Mobile Sender & Viewer Experience + Controls
- [x] Feature 12: Quick-Join URL & QR Code Auto-Connect (`?room=...&pin=...&autostart=1` query parameters, one-click share deep links).
- [x] Feature 11: Mobile Battery & Thermal Saver Mode (Screen WakeLock API, OLED Blackout mode).
- [x] Feature 6: Full Hardware Camera Controls (Torch/Flashlight toggle, hardware zoom slider, focus/exposure constraints).
- [x] Feature 13: Stream Transformation & Overlay HUD (Mirror front camera, 90/180/270 rotation lock, rule-of-thirds grid).
- [x] Feature 8: Local Recording, Snapshot & Replay Hub (Canvas PNG snapshot download, client-side MediaRecorder).

### Phase B: Audio, Network Quality & Auto-Discovery
- [x] Feature 1: Bidirectional Audio Pipeline & Intercom (Talkback) (Audio stream capture, viewer playback/mute/volume, push-to-talk).
- [x] Feature 7: Adaptive Bitrate (ABR) & Dynamic Quality Scaling (RTCPeerConnection stats polling, RTCRtpSender.setParameters).
- [x] Feature 9: mDNS / Zero-Conf LAN Auto-Discovery (Server mDNS service advertisement, `.local` hostname resolution).

### Phase C: Virtual Camera Standby Slate & Multi-Camera Switcher
- [x] Feature 10: Standby Slate & Virtual Camera Fallback State (Valid JFIF standby generator in `standby-slate.js` and SMPTE color bars in `lancam_filter.cpp`).
- [x] Feature 4: Multi-Camera Studio / Switcher Mode (Multi-sender room support in `room-manager.js`, targeted signaling in `signaling.js`, interactive Studio Switcher bar in `viewer.html`/`viewer.js`).
- [x] Feature 2: High-Performance Shared-Memory Bridge (Wired ADR-022 shared memory bridge via `src/server/vcam-shm-bridge.js` to TCP 7779 and `Local\LanCamSharedMemory_Video`).

### Phase D: Native Unity Integration
- [x] Feature 3: Native Unity Receiver Package (`unity-package/` / `com.vcam.lancamera` with C# MonoBehaviours `LanCameraReceiver`, `LanCameraConfig`, `LanCameraState` adhering to strict `AGENTS.md` rules).

### Phase E: RTSP / IP-Camera Broadcaster & Windows System Tray
- [x] Feature 5: Embedded RTSP / IP-Camera Server Bridge (Zero-dependency RFC 2326 & RFC 2435 JPEG over RTP streaming in `src/server/rtsp-server.js` on `rtsp://<host>:8554/live/<roomId>`).
- [x] Feature 14: Windows System Tray Companion & Auto-Start Configuration (System tray companion in `scripts/lan-camera-tray.ps1` and registry auto-start in `scripts/register-autostart.ps1`).
- [x] Comprehensive root `README.md` documentation for Native Unity UPM package (`com.vcam.lancamera`), RTSP server, Studio Switcher, mobile HUD controls, and Windows system tray scripts; resolved JSDOM event loop exit in tests and unsigned RTP timestamp integer overflow.
- [x] Feature: Sender Auto-Reconnection & Stale Socket Eviction (ADR-027): Distinguish human button press vs non-human disconnects; auto-rejoin on socket connect/visibilitychange/online; background watchdog; server-side stale sender eviction; version v1.0.23 badge in sender and viewer headers (51/51 tests pass).
- [x] UI & Reconnect Stream Polish: Fixed viewer HTML layout where unclosed `.video-hud` and `#videoWrapper` forced Studio Camera switcher and vitals into floating top-right HUD pill; moved `studioSwitcherBar` and `streamVitalsBar` into viewport footer matching sender layout; enhanced element padding, overlay text spacing, and input margins; fixed Reconnect button so viewer remembers last-joined room ID and PIN across disconnects/leaving without error (54/54 tests pass).
- [x] Dynamic Daily Space Wallpaper Background System: Created React `useWallpaper()` hook and `<WallpaperBackground>` component along with vanilla JS system in `src/public/js/wallpaper.js`; daily caching in `localStorage` (`YYYY-MM-DD`); Unsplash Random Photo API integration with `urls.raw` desktop optimization (`&w=2560&q=85&auto=format&fit=crop`); graceful network/rate-limit fallback; 4-layer visual background architecture with obsidian veil and subtle SVG noise texture with `pointer-events: none` and content on `z-index: 10` (60/60 tests pass).
- [x] Content Security Policy (CSP) Fix: Resolved all 25 console errors on Viewer and 20 errors on Sender caused by restrictive `default-src 'self'`. Updated `server.js` CSP to include `style-src 'self' 'unsafe-inline' https:`, `img-src 'self' data: blob: https://images.unsplash.com https://*.unsplash.com https:`, `connect-src 'self' ws: wss: https://api.unsplash.com https://*.unsplash.com https:`, `media-src 'self' blob: mediastream: data:`, `font-src 'self' data: https:`, and `worker-src 'self' blob:`. Added automated CSP test in `server.test.js` (61/61 tests pass).
- [x] Sender Source Selection Initial Visibility Fix: Added default `#fileInputGroup, #urlInputGroup { display: none; }` in `style.css` and invoked `updateSourceInputsVisibility()` upon `sender.js` initialization so file and URL input groups are properly hidden on initial page load when source defaults to webcam (62/62 tests pass).
- [x] CameraManager withAudio ReferenceError Fix: Added `withAudio = false` parameter to `CameraManager.startCapture()` in `src/public/js/camera-manager.js` with graceful fallback to video-only capture if audio fails; added unit tests in `tests/camera-manager.test.js` (66/66 tests pass).
- [x] Camera Focus Controls (Constant / Manual Focus vs Continuous Auto-Focus): Implemented `applyFocusMode()`, `applyFocusDistance()`, and `getFocusCapabilities()` in `CameraManager`. Added Focus Mode dropdown (Continuous Auto, Constant/Locked Focus, Single-Shot), manual focus distance slider, floating focus control bar, HUD focus lock button, and tap-to-focus on preview.
- [x] Sender Battery Percentage in Viewer Screen: Added `BatteryMonitor` reading `navigator.getBattery()`, broadcasting `sender:battery` over Socket.IO signaling, and displaying battery percentage and charging status (`⚡`) in viewer vitals footer and HUD pill with adaptive color coding (71/71 tests pass).
- [x] Screen Sharing Input Source with Aspect-Preserving Scaling (ADR-028):
  - [x] Added `screen` ("Screen share (display)") to `<select id="sourceSelect">` in `src/public/sender.html`.
  - [x] Implemented `startScreenCapture()`, `isScreenCaptureSupported()`, `getScreenConstraints()`, and `applyScreenResolution()` in `src/public/js/camera-manager.js`.
  - [x] Full quality mode (`max`) unconstrained up to 7680x4320 for 1:1 pixel rendering on 4K/high-DPI screens.
  - [x] Aspect-preserving proportional bounding boxes for lower quality tiers (`1080p`, `720p`, `480p`) with auto-orientation detection for portrait and landscape displays.
  - [x] Dynamic in-place resolution adjustment via `track.applyConstraints()` without re-prompting the user.
- [x] Resilient Clipboard Copying in Secure and Insecure LAN Contexts:
  - Resolved `[WARN] Failed to copy diagnostics: Cannot read properties of undefined (reading 'writeText')` when accessing the application over LAN IP HTTP (`http://<IP>:<PORT>/viewer` or `/sender`) where `navigator.clipboard` is restricted by browsers to Secure Contexts.
  - Implemented `copyToClipboard(text)` in `src/public/js/ui-utils.js` with modern Async Clipboard API check and fallback to `document.execCommand('copy')` via an off-screen readonly `<textarea>` with selection restoration.
  - Refactored `setupDiagnosticsControls()` and `copyTextToClipboard()` in `src/public/js/ui-utils.js` to use `copyToClipboard()`.
  - Updated inline clipboard copy in `src/public/index.html`.
  - Added unit test suite in `tests/clipboard-fallback.test.js` covering secure context, insecure context fallback, writeText rejection fallback, and dual-failure handling (91/91 passing tests, 1 skipped).
- [x] Fullscreen HUD Auto-Hiding:
  - Resolved floating top-right viewport HUD control panel (`.video-hud`) obscuring video stream and application overlays when entering fullscreen.
  - Added CSS rules (`:fullscreen .video-hud`, `:-webkit-full-screen .video-hud`, `.is-fullscreen .video-hud`) with `display: none !important;`.
  - Added `fullscreenchange` and `webkitfullscreenchange` listeners in `viewer.js` and `sender.js` to synchronize `.is-fullscreen` class on container and body.
  - Added double-click to toggle fullscreen on `videoWrapper` (viewer) and `videoContainer` (sender).
  - Added automated test in `tests/viewer-layout-reconnect.test.js` (92/92 passing tests, 1 skipped).
- [x] Constant Full HD / 30 FPS work (ADR-029 addendum 2):
  - [x] Viewer Advanced Settings > Quality Priority (Constant FPS / Constant Resolution / Both), relayed per viewer; server stores the mode and hands it to a sender that joins later.
  - [x] Sender seeds the bandwidth estimate through the viewer's answer SDP (`src/public/js/sdp-bitrate.js`), raises the per-viewer ceiling to 12 Mbps (16 Mbps for Both), holds resolution for 6 s after connect / source switch in Constant FPS mode, and uses `maintain-framerate-and-resolution` for Both.
  - [x] Mode-aware ABR with hysteresis (`src/public/js/abr-policy.js`); only Constant FPS viewers ever get a smaller picture.
  - [x] Sender diagnostics line: sent vs source FPS, target bitrate, available bandwidth, limit reason and durations, resolution changes, content type, content hint, ABR level, grace state; snapshots at connect +3 s / +8 s / +15 s.
  - [x] Hardware encoder detection recognises `D3D12VideoEncodeAccelerator`, unknown encoders never force VP8, the VP8 latch expires after 24 h.
  - [x] Screen Share Content Type switch (Motion / Detail) for A/B testing on real screen capture.
  - [ ] Verify on the real sender: 120 s per mode with a moving test page; read `src` fps vs `sent` fps in the `[STATS]` line to see whether Windows 10 screen capture itself caps at about 21 fps (then share a window or a tab instead of the whole screen).
  - [ ] Multi-viewer load test (2-3 viewers at 12-16 Mbps each) and real Wi-Fi start-bitrate tuning.
- [x] Screen Share Mouse Cursor Exclusion & Diagnostics Reporting (ADR-030):
  - [x] Add screen cursor toggle checkbox (`#screenCursorToggle`) in `src/public/sender.html` and default `#screenCursorGroup { display: none; }` in `src/public/css/style.css`.
  - [x] Integrate `cursor` constraint into `CameraManager.getScreenConstraints(resolution, frameRate, cursor)` and `startScreenCapture()`.
  - [x] Graceful fallback retry without `cursor` if the browser rejects the constraint with `OverconstrainedError` or `TypeError`.
  - [x] Provide static helpers `CameraManager.isCursorConstraintSupported()` and `CameraManager.getEffectiveCursorSetting(track)`.
  - [x] Transparent diagnostics reporting: log browser confirmation when `cursor === 'never'`, warning when browser keeps cursor visible (`'always'`/`'motion'`), or warning explaining browser limitation when cursor is not exposed in settings (Chromium/Windows limitation).
  - [x] Live dynamic source switching via `applyDynamicSourceChange()` when toggle changes during active screen sharing.
  - [x] Verified in automated Node.js tests (156/156 passing) and verified empirically against real Google Chrome and Microsoft Edge on Windows via CDP.

## Remote Desktop Control Integration (ADR-031)

### Phase 0: Submodule & Documentation Foundation
- [x] Register `remote-control-helper` as a genuine Git submodule pointing to `https://github.com/WRDeadman10/remote-control-helper.git`.
- [x] Document control architecture, native bridge, authentication lifecycle, and lease state machine in `docs/architecture.md`.
- [x] Record architectural decision record ADR-031 in `docs/decisions.md`.
- [x] Update `docs/project-overview.md` and `docs/roadmap.md`.

### Phase 1: Authentication & Lease Management (Node.js Server)
- [x] Implement `RemoteControlManager` in `src/server/remote-control-manager.js`:
  - [x] Permanent password hash verification with `crypto.scrypt` and 16-byte random salt stored in `.control-auth.json`.
  - [x] 6-digit cryptographically secure session PIN generation and expiry.
  - [x] Rate-limiting per socket/IP (5 failed attempts locks socket for 30 seconds).
  - [x] Single-controller lease management with 60-second reconnection grace period, release, and sender revocation.
  - [x] Automated unit tests in `tests/remote-control-manager.test.js`.

### Phase 2: Native Windows Input Helper (C++ Submodule)
- [x] Configure `CMakeLists.txt` for MSVC / C++17 build in `remote-control-helper/`.
- [x] Implement loopback Winsock2 TCP/WebSocket server on `127.0.0.1:8765` with authentication handshake token.
- [x] Implement `SendInput` mouse movement (normalized 0.0-1.0 mapped to target screen bounds).
- [x] Implement `SendInput` mouse buttons (`left`, `right`, `middle`, `down`, `up`, `click`) and wheel.
- [x] Implement `SendInput` keyboard events (`code` to Windows virtual key / scan code, modifiers).
- [x] Implement held-input registry (`std::set<WORD>`) with safety release on disconnect, lease expiry, or emergency stop.
- [x] Native tests and build verification with MSVC CMake. Commit inside submodule first.

### Phase 3: Signaling Protocol & Server Control Bridge
- [x] Extend Socket.IO signaling in `src/server/signaling.js` with control events (`control:request-lease`, `control:lease-granted`, `control:lease-rejected`, `control:revoke`, `control:release`, `control:input`).
- [x] Implement `src/server/control-bridge.js` to communicate with the native helper on `127.0.0.1:8765`.
- [x] Add unit tests for signaling events and control bridge.

### Phase 4: WebRTC DataChannel Transport & Coordinate Translation
- [x] Implement `lancam-control` DataChannel in `src/public/js/webrtc-peer.js` for sub-5ms low-latency input transport with Socket.IO relay fallback.
- [x] Implement coordinate translation in `src/public/js/control-coords.js` accounting for letterboxing, pillarboxing, and aspect ratios.
- [x] Implement viewer input event capture (mouse move, mouse down/up, wheel, keydown/keyup).

### Phase 5: Sender and Viewer UI Controls
- [x] Sender UI (`sender.html`, `sender.js`, `style.css`):
  - [x] Session PIN display with one-click copy button.
  - [x] Remote Control enable/disable toggle.
  - [x] Active controller status indicator badge and Revoke button.
  - [x] Permanent password setup/change modal.
- [x] Viewer UI (`viewer.html`, `viewer.js`, `style.css`):
  - [x] "Request Control" button and modal for entering PIN or permanent password.
  - [x] Control active HUD pill with Release button.
  - [x] Input event mapping and window blur safety release.
- [x] Run asset rebuild `node scripts/build-embedded-assets.js`.
- [x] Verify complete end-to-end integration with test suite (172/172 tests passing).

### Phase 6: Distributed 3-System Topology, Auto-Launch Deeplink & Inno Setup Distribution
- [x] Implemented HTTP health check (`GET /health`), CORS preflight, HTTP POST (`/input`), and RFC 6455 WebSocket framing (`ws://127.0.0.1:8765`) in native helper `remote-control-helper`.
- [x] Added `lancam-control://` protocol registration in HKCU (zero admin elevation required) and single-instance mutex (`Local\LanCameraRemoteControlHelper_SingleInstance`) in `src/main.cpp`.
- [x] Created Inno Setup installer script `remote-control-helper/installer/control-helper.iss` producing standalone `control-helper-setup.exe`.
- [x] Added `/download/control-helper-setup` route in `src/server/server.js` with embedded fallback in `scripts/build-embedded-assets.js`.
- [x] Implemented sender-side local helper client in `src/public/js/sender.js`:
  - [x] Health probe via `fetch('http://127.0.0.1:8765/health')`.
  - [x] Auto-launch via hidden iframe deeplink `lancam-control://start` when controller joins or control is enabled.
  - [x] Status alert badge and download button `/download/control-helper-setup` if helper is not installed.
  - [x] Local WebSocket bridge `ws://127.0.0.1:8765` for direct input forwarding on System X from both WebRTC DataChannel and signaling fallback relay.
- [x] Added automated unit tests in `tests/server.test.js` and `tests/viewer-control.test.js` (173/173 tests passing).

## P4.7 — Persistent and Resilient zrok Share Reservation (ADR-033)

- [x] Resolve `Could not bind to reserved 'public:lan'` and regex parsing errors in `src/server/cli.js` and `start.ps1`.
- [x] Implement robust zrok JSON overview parsing in `src/server/zrok-helper.js` extracting true `frontendEndpoint` and `shareToken`.
- [x] Prioritize existing reserved shares and port-matching shares before creating new shares.
- [x] Implement deterministic candidate word generation (`lancam`, `lancamera`, `lancamstream`, `lancam` + 4-char suffix) with auto-generated fallback via `zrok reserve public`.
- [x] Host on reserved shares using `zrok share reserved <shareToken> --override-endpoint <targetUrl> --headless`.
- [x] Preserve reserved shares across restarts; release only dynamic shares on SIGINT/SIGTERM.
- [x] Add automated unit tests covering word generation, share matching prioritization, and JSON extraction in `tests/zrok-reserve.test.js` (176/176 tests passing).

## P4.8 — Chrome Private Network Access, CSP & Pre-Stream Remote Control (ADR-034)

- [x] Add loopback addresses (`http://127.0.0.1:*`, `http://localhost:*`, `ws://127.0.0.1:*`, `ws://localhost:*`) and `frame-src lancam-control: lancam:` to Content Security Policy in `src/server/server.js`.
- [x] Add `Access-Control-Allow-Private-Network: true` to CORS preflight `OPTIONS`, `GET /health`, and `POST /input` responses in `remote-control-helper` loopback server.
- [x] Enable pre-streaming Remote Control configuration (PIN generation and permanent password setting) in `src/server/signaling.js` with access PIN verification.
- [x] Initialize Socket.IO connection on sender page load (`ensureSocket()`) and emit control requests with PIN prior to streaming.
- [x] Enhance helper deeplink launch with user-gesture anchor click fallback.
- [x] Eliminate spurious stream teardown/reconnect loops on tab focus (`visibilitychange`).
- [x] Add prominent Remote Desktop Control card in viewer sidebar with request/release buttons, status badges, show/hide password toggle, and optional pre-join control PIN input.
- [x] Rebuild embedded assets and verify all 176 test cases pass (176/176 passing).

## P4.9 — zrok2 Compatibility & Reserved Name Discovery (ADR-035)

- [x] Resolve `No existing reserved share found` and `unknown command "reserve" for "zrok2"` when running standalone executable or `start.ps1`.
- [x] Implement dual-mode CLI version detection `isZrokV2()` in `src/server/zrok-helper.js` and `start.ps1`.
- [x] Update overview JSON retrieval (`overview --json`) and parse both active shares (`environments[].shares`) and reserved names (`data.names`).
- [x] Recognize existing reserved names (`lan` -> `public:lan` / `https://lan.shares.zrok.io`) and prioritize them in `findExistingShare`.
- [x] Adapt share launching for zrok2: `zrok2 share public <target> -n <nameSelection> --backend-mode proxy --headless`.
- [x] Adapt reservation and cleanup for zrok2: `zrok2 create name` / `zrok2 modify name -r` and `zrok2 delete share <token>`.
- [x] Add unit tests in `tests/zrok-reserve.test.js` covering zrok2 JSON overview, name reservation extraction, and CLI version detection.
- [x] Rebuild standalone executable `dist/lan-camera-streaming.exe` and verify live hosting on reserved share `lan` (`https://lan.shares.zrok.io`).

## P4.10 — In-Room Real-Time WhatsApp-Style Chat System (ADR-036)

- [x] Implement backend chat message validation, history buffer (bounded per room), and Socket.IO broadcast (`chat:message`, `chat:history`) in `src/server/signaling.js`.
- [x] Implement client-side `src/public/js/chat.js` module:
  - [x] Auto-name generator with friendly adjective-noun-number identifiers.
  - [x] Local storage persistence (`lancam_chat_username`) and interactive display name editing.
  - [x] Mute/unmute toggle with local storage persistence (`lancam_chat_muted`).
  - [x] Floating action button with unread notification badge indicator dot.
  - [x] Slide-out/slide-in panel with smooth CSS transition and backdrop overlay.
  - [x] WhatsApp dark theme message bubbles (outgoing green, incoming slate, timestamp, double checkmarks, unique sender color tags).
  - [x] Dimmed Unsplash random wallpaper background with dark overlay and wallpaper shuffle action.
  - [x] Web Audio API subtle chime sound for unmuted incoming messages when panel is closed.
- [x] Integrate chat into `src/public/sender.html`, `src/public/viewer.html`, `src/public/js/sender.js`, and `src/public/js/viewer.js`.
- [x] Add WhatsApp chat styles to `src/public/css/style.css`.
- [x] Rebuild embedded assets via `node scripts/build-embedded-assets.js`.
- [x] Add comprehensive automated tests:
  - [x] `tests/chat-signaling.test.js` for server signaling authorization and room broadcast.
  - [x] `tests/chat-ui.test.js` for client auto-name, persistence, mute, unread badge, and message rendering.
- [x] Mobile responsive chat design: 100dvh dynamic viewport, notch/home bar safe area insets, 16px iOS auto-zoom prevention, touch swipe-to-dismiss gesture, VisualViewport virtual keyboard pinning, and landscape compact mode.
- [x] Rejoin and reconnect message deduplication & persistent client identity:
  - [x] Generate and persist unique client ID (`lancam_chat_user_id` / `getOrCreateUserId()`) in `src/public/js/chat.js`.
  - [x] Transmit `senderUserId` in `chat:message` socket payload and forward/preserve in server `src/server/signaling.js`.
  - [x] Track `renderedMessageIds` Set in `ChatManager` and deduplicate message bubbles and system chips by ID.
  - [x] Prevent duplicate history re-renders when rejoining room or auto-reconnecting on visibility/focus/wake.
  - [x] Retain `outgoing` green bubble rendering for own past messages across socket ID changes via `senderUserId`.
  - [x] Gate unread counter increment and notification sound so history loads never increment badge or trigger chimes.
  - [x] Reset message container on room switch while preserving messages when reconnecting to the same room.
- [x] Rebuild embedded assets via `node scripts/build-embedded-assets.js` and verify automated test suites (28/28 tests passing).
- [x] Update documentation (`docs/decisions.md`, `docs/tasks.md`, `docs/ai_handoff.md`).

## P4.11 — Dynamic Server-Derived Application Versioning (ADR-037)

- [x] Create `src/server/version.js` providing `getAppVersion()` reading dynamically from `package.json`, `__APP_VERSION__` (esbuild define for SEA), and fallback.
- [x] Expose application version in server endpoints: `/api/version`, `/api/config`, `/api/discover`, and `/health` in `src/server/server.js`.
- [x] Update `cli.js` to derive `APP_VERSION` from `getAppVersion()`.
- [x] Update `scripts/build-embedded-assets.js` to compile `embeddedVersion` from `package.json`.
- [x] Add dynamic version badge loader `initializeVersionBadge()` in `src/public/js/ui-utils.js` running automatically on DOM ready.
- [x] Update `src/public/js/sender.js` and `src/public/js/viewer.js` to hydrate version badges from `/api/config` responses.
- [x] Remove hardcoded `v1.0.23` strings from `sender.html`, `viewer.html`, and `server.js`; add dynamic version badge to `index.html`.
- [x] Add `.brand-version:empty { display: none; }` in `src/public/css/style.css` to prevent empty layout shifts.
- [x] Add automated unit tests in `tests/server.test.js`, `tests/phase-b-features.test.js`, and `tests/viewer-layout-reconnect.test.js`.
- [x] Rebuild embedded assets via `node scripts/build-embedded-assets.js`.


## P4.12 — Mobile Zoom, Touch Interaction and TeamViewer-Style Remote Control (ADR-038)

- [x] Implement `ZoomController` in `src/public/js/zoom-controller.js` supporting two-finger pinch-to-zoom (1x-4x) centered on pinch midpoint, pan boundary constraints, Fit Screen reset, and floating `+`/`-` buttons.
- [x] Extend coordinate mapping in `src/public/js/control-coords.js` to support zoom scale and pan translation offsets in `translateScreenCoordinates` and add `getScreenCoordinatesFromNormalized`.
- [x] Add unit tests in `tests/zoom-and-coords.test.js` validating zoom/pan coordinate transformation round-trips and aspect ratio handling.
- [x] Extend `remote-control-helper` native C++ daemon:
  - [x] Add `PrintScreen` -> `VK_SNAPSHOT` in `KeycodeMapper`.
  - [x] Add `InjectText(const std::wstring& text)` with `KEYEVENTF_UNICODE` in `InputInjector`.
  - [x] Add `text` message handling in `LoopbackServer`.
  - [x] Add native unit tests in `remote-control-helper/tests/test_main.cpp`.
  - [x] Build and verify `remote-control-helper`.
- [ ] Implement adaptive cursor overlay (`#remoteCursorOverlay`) with stable CSS pixel sizing and accurate host hotspot positioning.
- [ ] Implement Mouse Mode (touchpad relative movement, tap left click, long-press right click, two-finger scroll, double-tap & drag) and Touch Mode (direct screen tap) with gesture disambiguation.
- [ ] Implement mobile remote-control toolbar:
  - [ ] Exit / Release control button.
  - [ ] Keyboard toggle button.
  - [ ] Mouse / Touch mode toggle button and interaction method bottom sheet with gesture guide.
  - [ ] Shortcuts panel button and bottom sheet (Copy, Paste, Print Screen, Switch Apps, Save).
  - [ ] Special keys panel button and grid (`Esc`, `F1`-`F12`, `Tab`, `PrtSc`, `ScrLk`, `Pause`, `Ins`, `Home`, `PgUp`, `Del`, `End`, `PgDn`, arrow keys).
  - [ ] Settings button for pointer sensitivity.
  - [ ] Expand / Collapse toggle.
- [ ] Implement mobile keyboard integration with hidden text input layer, auxiliary modifier keys bar (`Shift`, `Ctrl`, `Alt`, `Win`, `...`), and keyboard dismissal.
- [ ] Add unit and integration tests in `tests/mobile-control-ui.test.js`.
- [ ] Rebuild embedded assets via `node scripts/build-embedded-assets.js` and verify full test suite.
- [ ] Update all documentation files (`project-overview.md`, `architecture.md`, `decisions.md`, `roadmap.md`, `tasks.md`, `ai_handoff.md`).
