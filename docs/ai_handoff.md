# LAN Camera Streaming — AI Handoff

Last updated: 2026-10-21. Another agent may continue from this file tomorrow: read it, then the docs listed under "Read before implementation". The Windows virtual camera driver is a separate repository mounted as the `vcam/` submodule; its handoff is `vcam/docs/ai_handoff.md`.

## Current status

The project is feature-complete across all 16 proposed ecosystem phases and verified on Windows with 219 automated tests passing without regression.

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
| Dynamic Daily Space Wallpaper System | Implemented; React `useWallpaper()` hook & `<WallpaperBackground>` + vanilla JS system; daily caching (`YYYY-MM-DD`); Unsplash optimization; 4-layer inert background |
| Content Security Policy (CSP) Fix | Resolved; full directives for `style-src 'unsafe-inline'`, `img-src`, `connect-src`, `media-src`, `font-src`; 0 console errors |
| Sender Source Selection Initial Visibility Fix | Implemented; CSS default `display: none` for `#fileInputGroup, #urlInputGroup` + `updateSourceInputsVisibility()` on startup |
| CameraManager withAudio ReferenceError Fix | Resolved; added `withAudio = false` parameter to `CameraManager.startCapture()` with audio fallback |
| Camera Focus Controls (Constant / Manual Focus) | Implemented; `applyFocusMode()`, `applyFocusDistance()`, Focus Mode selector, HUD toggle, and tap-to-focus |
| Sender Battery Percentage on Viewer | Implemented; `BatteryMonitor` + signaling relay + viewer vitals footer and HUD pill display |
| Screen Sharing Input Source (ADR-028) | Implemented; `getDisplayMedia()` with unconstrained full quality (`max`) and aspect-preserving proportional scaling (`1080p`, `720p`, `480p`) across landscape and portrait screens, dynamic `applyConstraints` without re-prompt, audio fallback, and native toolbar disconnect handling |
| Resilient Clipboard Copying | Implemented; universal `copyToClipboard()` in `src/public/js/ui-utils.js` with modern `navigator.clipboard` check + `document.execCommand('copy')` fallback for insecure HTTP / LAN IP contexts (`http://<IP>:<PORT>`); fixes `[WARN] Failed to copy diagnostics: Cannot read properties of undefined (reading 'writeText')` |
| Fullscreen HUD Auto-Hiding | Implemented; hides top-right `.video-hud` via `:fullscreen`, `:-webkit-full-screen`, and `.is-fullscreen` with `display: none !important;` in `style.css`; synchronized via `fullscreenchange` in `viewer.js` and `sender.js`; double-click on video toggles fullscreen |
| Screen Share Mouse Cursor Exclusion (ADR-030) | Implemented; `cursor: "never"` merged into `getDisplayMedia` constraints, automatic fallback if rejected, diagnostics reporting of effective setting (`track.getSettings().cursor`) with graceful explanation of Chromium/Windows compositor limitations, dynamic hot-swap without re-negotiation |
| Remote Desktop Control Integration (ADR-031) | **Fully implemented and verified** across all 5 phases: native MSVC C++17 helper (`remote-control-helper` submodule), `RemoteControlManager` with `crypto.scrypt` & 6-digit session PINs, `control-bridge.js` loopback TCP client, Socket.IO signaling events, `lancam-control` WebRTC DataChannel + fallback, normalized letterbox/pillarbox coordinate translation, sender management panel, and viewer HUD/modal controls |
| Distributed 3-System Topology & Helper Auto-Launch (ADR-032) | **Delivered**: HTTP/WebSocket loopback in native helper (`ws://127.0.0.1:8765`), single-instance mutex, automatic HKCU `lancam-control://` protocol registration, auto-launch deeplink via hidden iframe on System X, Inno Setup standalone installer (`control-helper-setup.exe`), server download route `/download/control-helper-setup`, and direct local helper input forwarding |
| Persistent and Resilient zrok Share Reservation (ADR-033) | **Delivered**: Pure JSON `zrok overview` parsing in `src/server/zrok-helper.js` and `start.ps1`; existing share detection and reuse with `zrok share reserved <shareToken> --override-endpoint <targetUrl> --headless`; candidate word generation (`lancam`, `lancamera`, `lancamstream`, `lancamlive`, `lancam<hex>`) with auto-generated fallback; eliminates `Could not bind to reserved 'public:lan'` and `createdAt` regex URL corruption (`1792164730133.shares.zrok.io`); persists reserved share across runs |
| zrok2 CLI Compatibility & Reserved Name Discovery (ADR-035) | **Delivered**: Dual-mode CLI detection (`isZrokV2`), `zrok2 overview --json` parsing, discovery of registered reserved names (`lan` -> `public:lan` / `https://lan.shares.zrok.io`), `share public <target> -n <nameSelection>` hosting, `create name` / `modify name -r` reservation, and `delete share <token>` teardown |
| In-Room Real-Time WhatsApp-Style Chat (ADR-036) | **Delivered**: Auto-generated & persistent display names (`lancam_chat_username`), editable in header; mute/unmute control (`lancam_chat_muted`); slide-out drawer with floating action button & unread notification badge dot; WhatsApp dark theme message bubbles (green/slate, tails, timestamps, checkmarks, sender color tags); dimmed atmospheric Unsplash wallpaper with dark obsidian overlay & shuffle button; Web Audio chime; full mobile responsive viewport (`100dvh`, VisualViewport keyboard pinning, swipe-to-dismiss); rejoin message deduplication & persistent client identity (`senderUserId`) |
| Dynamic Server-Derived Application Versioning (ADR-037) | **Delivered**: Dynamic single-source versioning via `getAppVersion()` reading `package.json` / `__APP_VERSION__`; exposed via `/api/version`, `/api/config`, `/api/discover`, `/health`; dynamic frontend badge hydration (`initializeVersionBadge()`) across sender, viewer, and hub |
| Mobile Zoom, Touch Interaction & TeamViewer-Style Remote Control (ADR-038) | **Delivered**: Universal pinch-to-zoom (1x-4x) and pan across all media sources, zoom-aware letterbox coordinate translation, touchpad Mouse mode, direct Touch mode, adaptive cursor overlay, collapsible mobile control toolbar, virtual keyboard IME text input, auxiliary modifier keys bar, special keys grid, and shortcuts |
| Ubuntu 24.04 & POSIX Linux Hosting Supervisor (`start.sh`, ADR-039) | **Delivered**: `start.sh` mirroring `start.ps1` with bash shebang, strict LF line endings, `--local-only` / `-LocalOnly` / `-l` flags, Ubuntu network discovery (`hostname -I`, `ip -4 addr`), safe `.env` loading, zrok tunnel management, terminal QR codes, and process cleanup traps |
| Mobile Viewport Gesture Isolation & Feed Panning (ADR-040) | **Delivered**: CSS `touch-action: none` on `.video-container`, `#videoWrapper`, `#remoteVideo`, and `#remoteCanvas`; active gesture listeners (`{ passive: false }`); `e.preventDefault()` on 2-finger pinch and drag; single-finger feed panning when `scale > 1.0`; touchpad pointer drag isolation; Safari gesture suppression |
| WebRTC mDNS Local IP Concealment Detection & Multi-Browser Guidance (ADR-041) | **Delivered**: Automatic detection of Windows mDNS local IP concealment; browser vendor & flag scheme detection (Comet, Edge, Brave, Opera, Vivaldi, Arc, Chrome); dismissible warning banner; interactive guidance modal with copyable flag URL & live retest; 233/233 tests passing |
| Viewport Controls Ribbon & Mobile Swipe Ribbon (ADR-043) | **Delivered**: Relocated `.video-hud` outside video wrapper to eliminate obstruction of Windows window controls; horizontal touch-scrollable ribbon on mobile (`overflow-x: auto; flex-shrink: 0`); eliminated duplicate charging icon (`⚡ 100%`); 237/237 tests passing |
| Mobile Touchpad Edge Auto-Pan & Gesture Disambiguation (ADR-042) | **Delivered**: Zoom-aware edge auto-pan ("push-to-pan") dragging viewport when cursor reaches screen boundary until host screen edges are reached; single-tap click in mouse mode without coordinate jumping; two-finger parallel vertical scroll isolated from pinch-to-zoom; browser double-tap viewport zoom suppression; 237/237 tests passing |
| Automated tests | 237/237 pass (`node --test`) |

Version: `package.json` is 1.0.36.

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and documentation rules (section 16).
2. `docs/architecture.md` — components, routes (§3), receiver signaling contract (§4), multi-viewer (§11), virtual webcam (§12), build and distribution (§13).
3. `docs/roadmap.md` and `docs/tasks.md` — plan and backlog (open items are the unchecked boxes).
4. `docs/decisions.md` — ADR-001 to ADR-036 and the open decisions at the end.
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

### Verified and not verified

- **Verified (2026-10-18):**
  - Verified backend chat signaling events (`chat:message`, `chat:history`, `chat:name-change`) in `src/server/signaling.js`.
  - Verified room authorization gating, payload validation, max length clamping, and bounded history buffer (50 messages).
  - Verified auto-generation of usernames with persistence to `localStorage` (`lancam_chat_username`).
  - Verified user name editing with real-time room notification.
  - Verified mute state persistence (`lancam_chat_muted`) and suppression of audio chimes.
  - Verified slide-out panel transition, unread notification badge dot behavior, and auto-scroll.
  - Verified WhatsApp bubble aesthetics (outgoing emerald green, incoming slate, tails, checkmarks, sender tags).
  - Verified dimmed Unsplash wallpaper background with dark obsidian overlay and one-click shuffle.
  - Verified mobile responsive layout: `100dvh` dynamic height, safe-area insets (`env(safe-area-inset-*)`), 16px font size preventing iOS Safari auto-zoom on focus, touch swipe-to-dismiss gesture (`setupSwipeToDismiss`), background body scroll locking (`body.chat-drawer-open`), and VisualViewport API keyboard pinning (`setupMobileViewport`).
  - Verified compact landscape mobile layout (`orientation: landscape and max-height: 500px`) keeping video and chat drawer simultaneously accessible.
  - Verified 21/21 chat test suite passing (`tests/chat-signaling.test.js` and `tests/chat-ui.test.js`).
  - Verified embedded asset generation with 23 embedded files (`npm run build:assets`).
- **Not verified:** Live manual end-to-end chat across two physical devices on separate Wi-Fi networks.

## Modified files (last iteration, 2026-10-21)

- `src/public/viewer.html`: Moved `.video-hud` outside `#videoWrapper` into `.viewport-pane` so remote desktop top-right controls (Minimize, Maximize, Close) are completely unobstructed.
- `src/public/css/style.css`: Added responsive horizontal ribbon styling for `.viewport-pane > .video-hud` with touch-scrolling (`overflow-x: auto; -webkit-overflow-scrolling: touch`), non-shrinking action buttons, and mobile padding.
- `src/public/js/viewer.js`: Fixed duplicate charging lightning bolt symbol in `socket.on('sender:battery')`.
- `tests/viewer-layout-reconnect.test.js`: Updated layout test to assert `.video-hud` is in `.viewport-pane` as a direct child and strictly absent from `#videoWrapper`.
- `docs/decisions.md`: Documented ADR-043.
- `docs/tasks.md`: Added and marked P4.17 complete.
- `docs/roadmap.md`: Added Phase 21.
- `docs/architecture.md`: Added Section 21 detailing Viewport Controls Ribbon architecture.
- `docs/project-overview.md`: Added Viewport Controls Ribbon and Mobile Swipe Action Bar overview.
- `docs/ai_handoff.md`: Updated current status and modified files log.
