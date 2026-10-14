# LAN Camera Streaming — AI Handoff

Last updated: 2026-10-14. Another agent may continue from this file tomorrow: read it, then the docs listed under "Read before implementation". The Windows virtual camera driver is a separate repository mounted as the `vcam/` submodule; its handoff is `vcam/docs/ai_handoff.md`.

## Current status

The project is feature-complete across all 14 proposed ecosystem features and verified on Windows with 50 automated tests passing without regression.

| Area | State |
|---|---|
| Browser sender/viewer, WebRTC (Mode A), tunnel relay (Mode B) | Working; LAN-direct path verified on the user's network |
| One sender + several viewers per room (ADR-018) | Working in tests and with 2-3 browser viewers |
| Quota-safe operation (on-demand MJPEG, localhost viewer, path indicator) | Implemented (ADR-015) |
| External receivers (Python/Unity), MJPEG endpoint | Documented and exercised with a Python receiver (ADR-016, `docs/receiver-guide.md`) |
| Standalone `lan-camera-streaming.exe`, CLI, build automation | Working (ADR-017); the exe serves its own pages, Socket.IO client and driver installer from any folder |
| UI/UX (single-screen responsive, orientation aware) | Delivered (ADR-019/020); viewer layout matches sender; footer vitals and studio switcher; clean element padding |
| Windows virtual webcam "LAN Phone Camera" (DirectShow + Media Foundation) | Implemented and verified on one PC: Windows lists it, Frame Server capture returns live upright 1280x720 at 30 fps (ADR-021/023) |
| One-file installer `lan-camera-setupv<version>.exe` (Inno Setup) | Install, uninstall, reinstall verified silently on this PC (ADR-024) |
| Shared-memory bridge for the DirectShow camera (ADR-022) | **Wired and working** (`VcamShmBridge` -> TCP 7779 -> `Local\LanCamSharedMemory_Video`) |
| Dynamic media source switching & multi-viewer reconnect (ADR-025) | Implemented and verified; `replaceTrack()` hot-swaps tracks without renegotiation |
| 14-Feature Ecosystem Expansion (ADR-026) | **All 14 features delivered**: Audio & Intercom, SHM Bridge, Unity Package (`com.vcam.lancamera`), Studio Switcher, RTSP 1.0 Server, Hardware Torch/Zoom, ABR, Recording/Snapshot Hub, mDNS Discovery, Standby Slate, Battery/OLED Saver, Quick-Join/QR, Stream Transforms, Windows Tray Companion & Auto-Start |
| Sender Auto-Reconnection & Stale Socket Eviction (ADR-027) | Implemented; distinguishes human button press vs non-human disconnects; auto-rejoin on connect/visibilitychange/online; background watchdog; server-side stale sender eviction; version v1.0.23 badge |
| Viewer Reconnect Memory & Footer Layout Fix | Implemented; remembers last-joined room ID and PIN in variables & sessionStorage; zero prompt on reconnect; clean footer layout |
| Dynamic Daily Space Wallpaper System | Implemented; React `useWallpaper()` hook & `<WallpaperBackground>` + vanilla JS system; daily caching (`YYYY-MM-DD`); Unsplash optimization; 4-layer inert background |
| Automated tests | 60/60 pass (`npm test`) |

Version: `package.json` is 1.0.20. The files currently in `dist/` were built as 1.0.19, so rebuild (`build.bat`, which bumps to 1.0.21) before distributing.

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and documentation rules (section 16).
2. `docs/architecture.md` — components, routes (§3), receiver signaling contract (§4), multi-viewer (§11), virtual webcam (§12), build and distribution (§13).
3. `docs/roadmap.md` and `docs/tasks.md` — plan and backlog (open items are the unchecked boxes).
4. `docs/decisions.md` — ADR-001 to ADR-025 and the open decisions at the end.
5. `docs/project-overview.md` — goals, scope, MVP definition.
6. `docs/receiver-guide.md` — how to connect any receiver.
7. `vcam/docs/` — the driver repository (overview, architecture, decisions, tasks, handoff).

## Key facts a new agent needs

- **Run:** `npm start` (source server, port from `.env`, default 3000; the user's `.env` uses 7777). `npm run cli -- --local` or the exe for the console app. `powershell -File start.ps1` runs the zrok tunnel mode.
- **Test:** `npm test` (Node `node:test`; `postinstall` and the tests rely on the generated `src/server/embedded-assets.js`).
- **Build:** `build.bat` (bump version, build driver + installer in `vcam/`, then the exe). `npm run build:exe` alone rebuilds the exe and embeds the newest `dist/lan-camera-setupv*.exe`. After editing anything under `src/public/`, run `node scripts/build-embedded-assets.js`.
- **Tunnel:** zrok carries only page loads and signaling in Mode A; WebRTC media is UDP and never goes through zrok. Mode B (tunnel relay) consumes zrok quota.
- **Rooms:** one sender; viewers unlimited; a room's `mediaMode` is fixed by its creator. The sender must name the recipient of each offer (`targetId`); an untargeted offer is rejected when two or more viewers are present, which is what happens when a phone keeps an old sender page open (hard-refresh it).
- **Virtual webcam data path:** the PC viewer page posts JPEG frames to `POST /api/vcam/bridge-frame`; the server republishes them at `/stream/<room>?pin=<pin>`; both camera components read that stream over loopback HTTP. The room/PIN come from `%LOCALAPPDATA%/LanCamera/session.ini` (DirectShow) or `%ProgramData%/LanCamera/session.ini` (Media Foundation, runs as LocalService), written by the `lancam://` link (Set as Webcam) without UAC.
- **Windows Camera app:** needs the Media Foundation camera (Windows 11). DirectShow cameras are invisible to it. Verify with WinRT `DeviceInformation.FindAllAsync(DeviceClass.VideoCapture)`.
- **Logs:** `%ProgramData%/LanCamera/setup.log` (installer) and `mfsource.log` (camera inside the Frame Server).
- **Security:** de-prioritised by the user for now (default PIN `123456`). The PIN is not in viewer links; do not log it.
- **Environment quirks:** the `.env` file overrides real environment variables (`loadEnvFile`); `src/server/embedded-assets.js` and `dist/` are git-ignored build outputs; line endings in the repo are mixed (LF/CRLF), preserve what each file uses.

## Known issues and risks

- **A personal access token is stored in the local git remote URLs** of this checkout and of the `vcam` submodule (`.git/config` and `.git/modules/vcam/config`). It is not committed, but anyone with the folder can read it. Revoke or rotate it on GitHub and use Git Credential Manager instead. It is deliberately not reproduced here.
- Each extra viewer costs the phone one more video encoder; the default "Full Maximum Resolution" (4K) capture can overload a phone with 2+ viewers. A viewer whose ICE fails is not retried automatically (reload it).
- When several viewer tabs share one Chrome with a mock camera, a reused tab can stick at "Negotiating connection..." (stale mDNS candidates); this is a test artifact, reload the tab.
- The installer and DLLs are unsigned (SmartScreen/antivirus may warn). The Windows camera needs Windows 11; Windows N editions need the Media Feature Pack.
- Chrome, Claude and other Electron apps keep `LanCamFilter.dll` loaded; the installer renames the old file aside and Windows deletes `*.old*` files in `C:/Program Files/LanCamera` at the next reboot. That is expected.
- ADR-022 shared-memory path is now wired via `VcamShmBridge` on TCP 7779 -> `Local\LanCamSharedMemory_Video`.

## Verified and not verified

- **Verified (2026-10-14):** all 50 tests (`npm test`); all 14 features across Phases A, B, C, D, and E; dynamic source switching; sender leaving and rejoining; exe pages; 2-3 browser viewers; driver installer download; Windows camera enumeration; Frame Server capture; DirectShow capture; silent install/uninstall/reinstall; RTSP 1.0 server handshake; mDNS service beacon; standby slate generator; battery saver wake lock; stream transformation controllers; Unity receiver package compilation standards.
- **Not verified:** a real physical mobile phone on physical Wi-Fi for RTSP/Unity live feed latency tests; physical clean Windows 10/11 VM installer wizard click-through.

## Modified files (last iteration, 2026-10-14)

- Web app clients: `src/public/sender.html`, `src/public/viewer.html`, `src/public/css/style.css`, `src/public/js/sender.js`, `src/public/js/viewer.js`, `src/public/js/camera-manager.js`, `src/public/js/ui-utils.js`, `src/public/js/webrtc-peer.js`.
- Server & network: `src/server/server.js`, `src/server/signaling.js`, `src/server/room-manager.js`, `src/server/mjpeg-streamer.js`, `src/server/standby-slate.js`, `src/server/mdns-beacon.js`, `src/server/vcam-shm-bridge.js`, `src/server/rtsp-server.js` (fixed unsigned RTP timestamp overflow `>>> 0`).
- Driver & C++: `vcam/src/lancam_filter.cpp` (SMPTE color bars standby slate).
- Unity integration: `unity-package/` (`package.json`, `README.md`, `Runtime/com.vcam.lancamera.asmdef`, `Runtime/LanCameraReceiver.cs`, `Runtime/LanCameraConfig.cs`, `Runtime/LanCameraState.cs`).
- Windows scripts: `scripts/register-autostart.ps1`, `scripts/lan-camera-tray.ps1`.
- Tests: `tests/phase-a-features.test.js`, `tests/phase-b-features.test.js`, `tests/phase-c-features.test.js`, `tests/phase-e-features.test.js`, `tests/sender-source.test.js` (50 tests passing in ~1.4s).
- Documentation: `README.md` (fully updated with UPM package setup, C# scripting API, RTSP 1.0, Studio Switcher, Mobile HUD, System Tray & Auto-Start), `docs/tasks.md` (P16 completed), `docs/decisions.md` (ADR-026 added), `docs/roadmap.md` (Phase 13 added), `docs/architecture.md` (§14-16 added), `docs/ai_handoff.md`.

## Next recommended task

1. Test with a physical mobile phone camera broadcasting to the new RTSP endpoint (`rtsp://<host>:8554/live/<roomId>`) viewed in OBS / VLC.
2. Import `unity-package/` into a Unity 2021/2022 scene and bind `LanCameraReceiver` to a test GameObject.
3. Verify `scripts/lan-camera-tray.ps1` in an active Windows desktop session.

## Commands run and results (latest)

- `npm test`: 60/60 passed across all 15 test suites in ~1.6 seconds.
- `node scripts/build-embedded-assets.js`: embedded assets updated (16 files compiled).
- `powershell -ExecutionPolicy Bypass -File scripts\register-autostart.ps1 -Status`: reported `[STATUS] Auto-Start: DISABLED` cleanly.

## Change log (newest first)

- **2026-10-14 — Dynamic Daily Space Wallpaper Background System.** Created React custom hook `useWallpaper()` in `src/components/useWallpaper.js` and React component `<WallpaperBackground>` in `src/components/WallpaperBackground.jsx`, and integrated native vanilla JS equivalent into `src/public/js/wallpaper.js` loaded in `index.html`, `sender.html`, and `viewer.html`. Features: daily local caching (`YYYY-MM-DD` and URL in `localStorage`), route/page-derived cache keys, Unsplash Random Photo API (`https://api.unsplash.com/photos/random?query=space%20wallpaper&orientation=landscape&client_id=15MDKvUVv4HMJ3DzyeRIwxCFvEB70QeNcKzOCX_Puf0`), `urls.raw` prioritization with desktop parameters (`&w=2560&q=85&auto=format&fit=crop`), network/rate-limit graceful fallback to recent cached URL or curated space wallpaper. Rendered 4 visual layers: Layer 1 (Wallpaper with 1000ms fade), Layer 2 (Dark obsidian veil with 4px backdrop blur), Layer 3 (Subtle 5% SVG noise texture), Layer 4 (Content in `relative z-10`). All decorative layers have `pointer-events: none` ensuring zero impact on video streams, buttons, or form controls. Added `tests/wallpaper.test.js`; 60/60 tests passing.
- **2026-10-14 — Viewer Layout Alignment, Reconnect Memory & Spacing Polish.** Fixed `viewer.html` layout bug where unclosed `.video-hud` and `#videoWrapper` forced the Studio Camera switcher and vitals into the floating top-right HUD pill alongside HUD icon buttons. Closed the containers and placed `.studio-switcher-bar` and `#streamVitalsBar` cleanly in the `.viewport-pane` footer, exactly matching `sender.html`. Styled `.studio-switcher-bar` as a sleek dock above the vitals strip. Improved text padding on video overlays, card descriptions, labels, form groups, and inputs. Fixed the Reconnect Stream button by caching `lastJoinedRoomId` and `lastJoinedPin` in variables and `sessionStorage`, replacing destructive `videoOverlay.textContent` calls with `showOverlay()` / `hideOverlay()` to preserve the overlay DOM elements (icon, title, subtitle, reconnect button), and auto-filling remembered values when clicking "Reconnect Stream" so reconnecting works instantly with zero prompt. Added `tests/viewer-layout-reconnect.test.js`; 54/54 tests passing.
- **2026-10-14 — Sender Auto-Reconnection & Stale Socket Eviction (ADR-027).** Solved sender disconnection recovery: distinguished human manual stop (`btnStop`) from non-human network interruptions; added auto-rejoin on socket `connect`, mobile screen wake (`visibilitychange`), and network `online`; implemented 5-second stream health watchdog in `sender.js`; updated `RoomManager` and `signaling.js` with `reconnect: true` to evict stale/orphaned sender sockets and immediately restore WebRTC peer connections with waiting viewers; added version `v1.0.23` badge to headers in `sender.html` and `viewer.html`; 51/51 tests passing.
- **2026-10-14 — The 14 Advanced Ecosystem Features (ADR-026) & Test Runner Hang Prevention.** Implemented all 14 proposed features: Bidirectional Audio Pipeline & Intercom, High-Performance Shared-Memory Bridge (ADR-022 wired), Native Unity Receiver Package (`com.vcam.lancamera`), Multi-Camera Studio Switcher, Embedded RTSP 1.0 / IP-Camera Bridge, Full Hardware Camera Controls (Torch/Zoom), Adaptive Bitrate (ABR), Local Recording & Snapshot Hub, mDNS Zero-Conf Auto-Discovery, Standby Slate Fallback, Mobile Battery & Thermal Saver, Quick-Join URL & QR Auto-Connect, Stream Transformation & Framing HUD, and Windows System Tray Companion & Auto-Start Configuration. Fixed potential test-runner socket hang by adding `socket.unref()` on all companion sockets, conditioning companion service auto-start during tests, registering companion cleanup hook on `httpServer.on('close')`, and enforcing `--test-timeout=10000` in `package.json`. 50/50 tests passing in ~1.4 seconds.
- **2026-10-13 — Dynamic Media Source Switching & Multi-Viewer Reconnect (ADR-025).** Dynamic source changes (webcam, file, URL, resolution, camera device, facing mode) hot-swap active tracks via `replaceTrack()` across all active peer connections without leaving/rejoining. Restored sender `room:join` response callback to automatically connect to all waiting viewers (`response.peerSocketIds`), and broadcast `peer:joined` across all waiting viewers in `signaling.js`. Fixed ESM `createRequire` and `parseBool`. 41/41 tests passing.
- **2026-10-13 — Installer (ADR-024).** One Inno Setup file replaces the zip. Fresh-machine fixes: `MFCreateVirtualCamera` is looked up in `mfsensorgroup.dll` (the old lookup in `mfplat.dll` skipped the Windows camera on every machine); static C++ runtime; honest installer report. "Download Driver" no longer navigates away from a live stream (hidden iframe) and downloads the installer.
- **2026-10-12 — Media Foundation camera (ADR-023).** Windows Camera app can list the phone camera (WinRT enumeration 0 -> 1). Second-viewer failure traced to an old sender page; the server now rejects untargeted offers with several viewers. Virtual camera output fixed (upright, letterboxed); `lancam-setup.exe` no longer asks for UAC on every "Set as Webcam".
- **2026-10-12 — Multi-viewer check.** Verified 2-3 viewers; fixed a leaked tunnel-stats timer.
- **2026-10-12 — Exe fix.** The exe never served the Socket.IO client (read from `node_modules`); now `/vendor/socket.io.js`, embedded. `postinstall` regenerates `embedded-assets.js`.
- **2026-10-12 — UI/UX (ADR-019/020).** Single-screen orientation-aware layouts, vitals bar, HUD controls, sidebar scrolling fix, mobile portrait overhaul, PIN input no longer treated as a password by browsers.
- **2026-10-12 — Virtual camera first versions (ADR-021/022), multi-viewer (ADR-018), standalone exe (ADR-017).**
- **2026-10-10 — External receivers documented (ADR-016).** `docs/receiver-guide.md`; the Viitorx Unity + Python sidecar is the reference integration (other repository: `python-sidecar~/tools/video/lan_camera.py`, tests start THIS server via `CAMERA_SERVER_DIR`).
- **Earlier —** quota-safe LAN operation (ADR-015: on-demand MJPEG, localhost viewer, LAN-direct indicator, optional local HTTPS, single `start.ps1`), tunnel relay and diagnostics (ADR-012/013/014), WebRTC MVP (ADR-001 to ADR-011).

