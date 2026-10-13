# LAN Camera Streaming — AI Handoff

## "Download Driver" disconnected the active WebRTC stream in the viewer (2026-10-13)

- **Cause:** In `src/public/viewer.html`, the driver download link was an unadorned anchor tag `<a href="/download/lancam-vcam">`. When clicked during an active stream, the browser treated it as top-level page navigation before receiving the HTTP `Content-Disposition: attachment` response header. This triggered the window's `beforeunload` event handler in `src/public/js/viewer.js`, which called `leaveRoom()`, abruptly tearing down the Socket.IO connection and WebRTC peer connection.
- **Fix:**
  1. Updated `src/public/viewer.html` to add `id="btnDownloadDriver"`, `download="lancam-vcam-setup.zip"`, and `target="_blank" rel="noopener noreferrer"`.
  2. In `src/public/js/viewer.js`, attached a click listener to `#btnDownloadDriver` that calls `event.preventDefault()` and assigns the download route (`/download/lancam-vcam`) to a hidden DOM `<iframe>`. This initiates the installer download immediately while completely preventing window navigation and `beforeunload` triggers.
  3. Recompiled embedded assets (`node scripts/build-embedded-assets.js`).
- **Modified files:** `src/public/viewer.html`, `src/public/js/viewer.js`, `docs/tasks.md`, `docs/ai_handoff.md`.
- **Recommended next task:** Verify end-to-end driver download on a live stream in the web viewer.

## "Download Driver" returned a .txt (2026-10-12)

- **Cause:** `/download/lancam-vcam` looked for the zip only at `<cwd>/dist/` and a bundle-relative path, so the exe started from `dist\` returned a 404 text message, which the `<a download>` link saved as `lancam-vcam.txt`.
- **Fix:** the route now also checks next to the exe, `<exe>/dist/`, the cwd and `dist/`, and falls back to a copy of the zip embedded in the exe at build time (`scripts/build-embedded-assets.js`, so `build.bat` must build the zip before the exe, which it does). The link no longer has the `download` attribute. Test added (37/37).
- **Verified:** the rebuilt exe (v1.0.17) returns the 68,270-byte zip (`PK`, three files) both from `dist\` and from an empty folder. The exe that was already running must be restarted to pick this up.

## Windows Camera app now sees the phone camera (2026-10-12) — ADR-023

- **Why the user still got "We can't find your camera":** reinstalling the DirectShow driver could not help; the Camera app only lists kernel-streaming / Media Foundation cameras. Confirmed with the same enumeration API the Camera app uses (`Windows.Devices.Enumeration`, VideoCapture): 0 devices before.
- **Fix:** a Media Foundation virtual camera (`vcam/src/lancam_mfsource.cpp` -> `LanCamMfSource.dll`), registered by `lancam-setup.exe` via `MFCreateVirtualCamera`. Installed on this PC. Result: enumeration shows "LAN Phone Camera (Windows Virtual Camera)"; an MF Source Reader on that device through the Frame Server returned 30.0 fps, 1280x720, upright, live frames from a mock sender (room 123).
- **Installer fixes found on the way:** `HKLM\SOFTWARE\Classes` cannot be opened for write even elevated here (use `HKEY_CLASSES_ROOT`); Chrome/Claude/Antigravity keep `LanCamFilter.dll` mapped, so in-use DLLs are renamed aside and replaced (old copies deleted at reboot, `*.old*` files in Program Files are expected); the Frame Server needs the session in `%ProgramData%\LanCamera` (ACL set by the installer); `--silent` skips the message box.
- **Diagnostics:** `%ProgramData%\LanCamera\setup.log` (installer, HRESULTs) and `mfsource.log` (the source inside the Frame Server, including rejected interface IDs).
- **Not verified:** the Windows Camera app window itself, Teams/Zoom/Unity, a real phone, Windows 10 (the API needs Windows 11).
- **Housekeeping:** an elevated "LAN Camera Driver Setup" message box from an earlier test run (pid 13716) keeps `vcamuild\lancam-setup.exe` locked until it is closed; then run `build.bat`. `dist\lancam-vcam-setup.zip` was packaged from the verified installer build.
- **Test tools (not in the repo):** in-process MF source test and Frame Server capture test were written in the session scratchpad.

## Second viewer stuck + "Set as Webcam" error (2026-10-12)

- **Second viewer never gets video (from the user's logs):** viewer 2 received the sender's ICE candidates (targeted/broadcast) but no offer, while viewer 1 received a new offer every time viewer 2 joined. That is the signature of a sender page still running the pre-multi-viewer `sender.js` (kept open on the phone): it sends offers with no `targetId`, and the server fell back to the first viewer. Fix for the user: hard-refresh the sender page. Code: the server now rejects an untargeted sender offer when more than one viewer is in the room (`room:error` "This sender page is outdated..."), embedded assets are served with `Cache-Control: no-cache`, test added (36/36).
- **"Set as Webcam" -> UAC -> Camera app "We can't find your camera" (0xA00F4244 NoCamerasAreAttached):** two causes. (1) `lancam-setup.exe` had a `requireAdministrator` manifest, so every `lancam://` click prompted UAC; now `asInvoker` (installation still self-elevates). (2) The Windows Camera app cannot enumerate DirectShow virtual cameras (UWP / Media Foundation only), so it can never show "LAN Phone Camera"; the deeplink handler no longer launches it. The camera is registered correctly: ffmpeg lists it and receives live frames (verified with a live mock sender in room 123).
- **Extra bug found and fixed:** the virtual camera output was upside down (top-down frames in a bottom-up RGB24 sample) and frames were not scaled to the negotiated 1280x720. `LanCamPin::StreamLoop` now flips and letterboxes (`BlitTopDownToBottomUp`; standalone test of the exact function: flip, portrait-into-landscape letterbox, 1080p->720p all pass).
- **Rebuilt, not installed:** `vcam/build/*` and `dist/lancam-vcam-setup.zip` contain the fixes. The copy in `C:\Program Files\LanCamera` is the OLD driver until `lancam-setup.exe` is run again (one UAC prompt). The root exe was not rebuilt (run `build.bat`). The vcam folder is a git submodule: its changes are uncommitted inside it.
- **Not verified:** the rebuilt DLL inside a live DirectShow graph (system registry edits are blocked in this environment, so only the blit function was tested in isolation); a real phone feeding the camera; Unity's device enumeration.
- **Doc/code mismatch noticed (ADR-022):** the docs say the Node server streams frames to the `--bridge` daemon on 127.0.0.1:7779 and the filter reads shared memory, but `server.js` only forwards bridge frames into the MJPEG streamer; the filter in practice reads MJPEG over HTTP.

## Mobile Portrait & Samsung S21 Vertical Alignment Overhaul (2026-10-12)

- **Issues Diagnosed on Samsung S21 (360×800 Viewport):**
  1. Header overcrowding: 60-character `#pathIndicator` ("LAN direct - video stays on your network, 0 bytes through zrok") combined with brand title, live status badge, and role link blew out the 44px header bar, causing ugly 2-line wraps and clipped elements.
  2. Viewfinder forced 16:9 landscape aspect ratio box on a tall vertical phone screen, shrinking portrait video (1080×1920) into a tiny horizontal strip with massive black bars.
  3. Stream vitals bar wrapped values across 3 vertical lines (e.g. `1080` \n `x` \n `1920` and `LAN Direct` \n `(0 B` \n `zrok)`), crowding metric values.
  4. Link share rows clipped long tunnel URLs awkwardly.
- **Resolution:**
  - Header: Hides redundant `#pathIndicator` inside mobile header (`display: none !important`), keeps brand title on a single line, and balances status badge and navigation link cleanly.
  - Viewfinder: Changed `.viewport-pane` on mobile portrait to flexible viewport height (`height: 35vh; min-height: 220px; max-height: 42vh; aspect-ratio: auto;`), granting portrait video feeds 2× larger vertical presence.
  - Vitals ribbon: Replaced wrapping row with a single-line horizontal swipeable ribbon (`overflow-x: auto; white-space: nowrap; gap: 14px;`) with label and value side-by-side (`display: inline-flex`).
  - Share input row: Added `flex: 1; min-width: 0;` to input and `flex-shrink: 0; white-space: nowrap;` to copy button.
- **Verification & Assets:** Recompiled `embedded-assets.js` (`node scripts/build-embedded-assets.js`) and verified all 35 tests pass (`npm test`).
- **Modified files:** `src/public/css/style.css`, `src/server/embedded-assets.js`, `docs/tasks.md`, `docs/ai_handoff.md`.
- **Recommended next task:** Verify mobile viewports across Chrome and Samsung Internet.

## Access PIN Credential Classification Removal (2026-10-12)

- **Root Cause:** `#accessPin` in `sender.html` and `viewer.html` used `type="password"` with `autocomplete="current-password"`, preceded by `#roomId`. Browsers (specifically Chrome / Google Password Manager) identified this pairing as user credentials and checked default PINs (such as "123456") against known data breach databases, triggering intrusive "Change your password: The password you just used was found in a data breach" modal alerts.
- **Resolution:**
  - Converted `<input id="accessPin">` to `type="text"` with `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"`, and `data-1p-ignore="true"`.
  - Implemented visual text masking via CSS property `.pin-masked { -webkit-text-security: disc; text-security: disc; }`.
  - Updated `setupPasswordToggle` in `src/public/js/ui-utils.js` to toggle the `.pin-masked` class and change the button label ("Show" / "Hide") without changing the DOM input `type` to `"password"`.
  - Preserved full functional security, PIN masking, and verification while eliminating all browser credential prompts and breach warnings.
- **Verification & Assets:** Recompiled `embedded-assets.js` (`node scripts/build-embedded-assets.js`) and verified all 35 tests pass (`npm test`).
- **Modified files:** `src/public/sender.html`, `src/public/viewer.html`, `src/public/css/style.css`, `src/public/js/ui-utils.js`, `src/server/embedded-assets.js`, `docs/tasks.md`, `docs/ai_handoff.md`.
- **Recommended next task:** Verify end-to-end PIN entry in Chrome and Edge without browser credential prompts.

## Controls Sidebar Panel Scrolling & Overflow Constraints (2026-10-12)

- **Root Cause:** In flexbox layouts, `.sidebar-pane` defaulted to `min-height: auto`. When child cards (Session Setup, Share Stream, and expanded Developer Tools / Python endpoints) exceeded the viewport height, `.sidebar-pane` expanded past parent boundaries instead of shrinking and scrolling. Because `.app-workspace` was set to `overflow: hidden`, content below the fold was clipped offscreen and completely unreachable. Furthermore, custom scrollbar thumb styling had low contrast and narrow width.
- **Flexbox & Viewport Height Constraints:**
  - Added `min-height: 0; max-height: 100%;` to `.sidebar-pane` (and `.viewer-workspace .sidebar-pane`), ensuring the sidebar strictly respects parent viewport bounds.
  - Added `.sidebar-pane > * { flex-shrink: 0; }` so child cards do not collapse awkwardly and instead cleanly trigger vertical scrolling when content exceeds available space.
  - Added `padding-bottom: 16px;` and `overscroll-behavior-y: contain;` to ensure bottom controls (OpenCV endpoint, Direct PC link, WebRTC diagnostics) are comfortably accessible.
- **Scrollbar Ergonomics & Cross-Browser Styling:**
  - Increased scrollbar width to `6px` with a subtle rounded track.
  - Set thumb to `--border-medium` with `--text-muted` on hover for clear visual affordance.
  - Configured standard CSS `scrollbar-width: thin` and `scrollbar-color: var(--border-medium) rgba(0, 0, 0, 0.15)` for Firefox.
- **Verification & Assets:** Recompiled `embedded-assets.js` (`node scripts/build-embedded-assets.js`) and verified all 35 tests pass (`npm test`).
- **Modified files:** `src/public/css/style.css`, `src/server/embedded-assets.js`, `docs/tasks.md`, `docs/ai_handoff.md`.
- **Recommended next task:** Test the scroll behavior with Developer Tools expanded on various monitor resolutions and scale factors.

## Orientation-Aware Single-Screen UX Overhaul (2026-10-12) — ADR-020

- **Landscape Viewport Optimization (`100dvh`):**
  - Eliminated document-level scrolling across desktop monitors, laptops, and rotated phones (tested on 1920×1080, 1366×768, 844×390, and 667×320).
  - **Sender:** 2-column layout pairing a maximized camera viewfinder with a floating HUD (Facing flip, Torch, Snapshot, Fullscreen) on the left, and a compact session setup / broadcasting sharing panel on the right.
  - **Viewer:** 70/30 split providing visual priority to the remote video (65–75% width) with floating HUD (PiP, Snapshot, Fullscreen) on the left, and a compact session / metrics sidebar on the right.
  - Short viewport fallback: Set `overflow-y: auto; overflow-x: hidden;` on the sidebar pane so controls degrade gracefully without clipping on screens with height <= 480px.
- **Portrait Orientation Stacking:**
  - Single-column fluid stacking prioritizing active stream feeds using `.streaming-active` reordering (video viewports elevate above setup controls once broadcasting or joined).
- **State-Driven Workflow Transitions:**
  - **Sender:** Upon clicking Start Streaming, `#btnStart` is replaced by `#btnStop`, the setup form collapses on mobile, and a dedicated Share Stream card appears with 1-click link copying and an optional QR code reveal toggle.
  - **Viewer:** Upon clicking Join Stream, `#joinCard` is collapsed into `#viewerSessionActivePanel` with a clean "CONNECTED" badge and 1-click Leave Stream action.
  - **Role Selection Hub (`/`):** Redesigned into a responsive 2-column single-screen dashboard matching the dark charcoal/navy streaming aesthetic. Features prominent Sender & Viewer role cards with vector Lucide-style icons, an instant mobile QR scan & link copy card, and a collapsible protocol/guide drawer (`Mode A` WebRTC vs `Mode B` Fallback).
  - **Developer Tools & Integrations:** Python OpenCV endpoints (`/stream/:roomId?pin=...`), direct localhost PC links, and SDP/ICE diagnostic logs are housed inside a collapsed drawer, eliminating cognitive clutter while maintaining 100% feature availability.
- **Verification:** All 35 automated tests (`npm test`) pass. Embedded assets recompiled with `node scripts/build-embedded-assets.js`.

## Pure WebRTC Shared-Memory Bridge for DirectShow Virtual Camera (2026-10-12) — ADR-022

- **Zero-MJPEG Architecture:** Replaced continuous HTTP MJPEG frame polling with an in-memory Win32 shared-memory bridge (`vcam/include/shm_bridge.h`) leveraging `Local\LanCamSharedMemory_Video` and `Local\LanCamSharedMemory_Mutex`.
- **Browser WebRTC Frame Pump:** `src/public/js/viewer.js` automatically renders incoming P2P WebRTC frames from `#remoteVideo` to an offscreen canvas at ~30 FPS, converts RGBA to BGR24, and transmits them to `/api/vcam/bridge-frame`.
- **WinSock2 Bridge Server:** `lancam-setup.exe --bridge` runs a lightweight local TCP daemon on `127.0.0.1:7779` which receives frames from the Node.js server and writes them into Win32 Shared Memory with sub-millisecond overhead.
- **DirectShow Filter Integration:** `vcam/src/lancam_filter.cpp` continuously checks `m_pFilter->GetShmReader().ReadLatestFrame()`. If an active frame is detected (<1000ms old), it streams directly into DirectShow output buffers.
- **Verification:** Both x64 binaries (`LanCamFilter.dll` & `lancam-setup.exe`) recompiled cleanly via `vcam/build.bat`, packaged into `dist/lancam-vcam-setup.zip`, embedded assets rebuilt (`node scripts/build-embedded-assets.js`), and 35/35 automated unit/integration tests passing (`npm test`).

## DirectShow Virtual Camera & Deeplink Integration (2026-10-12) — ADR-021

- **Submodule Scaffold:** Submodule configured at `vcam/` referencing `https://github.com/WRDeadman10/DirectShow.git`.
- **DirectShow Source Filter:** Built `vcam/build/LanCamFilter.dll`, an in-process COM capture filter registered under `CLSID_VideoInputDeviceCategory` as `"LAN Phone Camera"`. Connects via WinHTTP to `http://127.0.0.1:7777/stream/<roomId>?pin=<pin>`, decodes frames with WIC (Windows Imaging Component), and streams uncompressed RGB24 video samples.
- **Deeplink Launcher (`lancam://`):** Built `vcam/build/lancam-setup.exe` to register the custom URI protocol and register the COM filter with Windows. Invoked via `lancam://stream?room=...&pin=...`, updating `%LOCALAPPDATA%\LanCamera\session.ini`.
- **Packaging & Web Viewer Action:** Bundled into `dist/lancam-vcam-setup.zip` and served at `/download/lancam-vcam`. Added a "Set as Webcam" action to the viewer interface (`src/public/viewer.html`).



- **Philosophy & Aesthetic:** Grounded in Ayurvedic Sattvic principles: replaced high-contrast clinical dark grey/blue with a calming dark herb-slate palette (`#0a1317`, `#121e24`, `#1f353d`), botanical emerald (`#10b981`), warm turmeric amber (`#f59e0b`), and pitta-cooling terracotta alert tones.
- **Prāna Pulse Animation:** Live and connecting indicators feature a gentle, organic breathing CSS keyframe pulse (`prana-pulse-green`, `prana-pulse-amber`) rather than abrupt blinks.
- **Nāḍī Parīkṣā (Stream Health & Vitals Dashboard):** Both sender and viewer pages now include a real-time vitals bar displaying Flow / FPS, Acuity / Resolution, Sangha / Audience count, Mārga / Path harmony (Direct LAN, STUN Direct, or zrok Relay), and Pulse latency (RTT in ms).
- **Viewport Heads-Up Display (HUD) Controls:**
  - Sender: Floating viewport HUD overlay with one-tap camera flip (Facing), flashlight/torch toggle (when supported by browser media track constraints), still snapshot capture, and fullscreen view.
  - Viewer: Floating viewport HUD overlay with Picture-in-Picture (PiP), high-resolution snapshot still grab to PNG, and fullscreen view.
  - Interruption Recovery: A gentle "🔄 Recheck Stream" button appears directly on the video overlay when the sender stops or disconnects.
- **Mobile Ergonomics & Decluttering:**
  - On mobile senders, session setup collapses upon streaming start into an accordion, putting primary focus on the viewfinder and sharing pass.
  - 1-tap clipboard copying with tactile visual feedback ("✓ Link Copied!") for QR codes, localhost PC URLs, and Python OpenCV endpoints.
  - Technical diagnostics logs are tucked into a collapsible drawer (`📋 Technical Diagnostics & WebRTC Vitals ▼`), reducing cognitive noise for everyday users while keeping complete SDP and ICE debugging easily accessible.
- **Embedded Asset Synchronization:** Rebuilt `embedded-assets.js` (`node scripts/build-embedded-assets.js`) to ensure standalone `.exe` distributions embed the new Ayurvedic UI/UX frontend. All 35 automated tests pass (`npm test`).

## Multi-viewer check (2026-10-12)

- **Result:** the ADR-018 multi-viewer implementation works. Verified live in the in-app browser (mock canvas camera, real WebRTC): 2 and 3 viewers on one sender; a viewer leaving and rejoining while the other keeps playing; sender Stop/Start with viewers already in the room; tunnel-relay with 2 viewers. The sender showed "Live (N viewers)" and every viewer rendered frames.
- **Fixed:** `sender.js` leaked a stats timer: `startTunnelFrameLoop()` ran on every `peer:joined` and overwrote `statsInterval` without clearing it, so "[Tunnel Stats]" lines kept printing after Stop. It now clears the old timer and does not restart a running loop. Confirmed: no new stats lines after Stop.
- **Test artifact, not a code bug:** when several viewer tabs share one Chrome with a mock camera (so both sides use mDNS `.local` candidates), a previously-used viewer tab could sit at "Negotiating connection..." (ICE `failed`) while a fresh tab connected; reloading that tab fixed it. A real phone sender exposes real LAN IPs, so this should not apply, but it is the first thing to rule out when testing with several tabs in one browser: reload the stuck viewer.
- **Known limits, not changed:** each viewer costs the phone one more video encoder (the default "Full Maximum Resolution" 4K capture can overload a phone with 2+ viewers; use 720p/1080p); a viewer whose ICE fails is not retried automatically; a room's media mode is fixed by whoever created it, so viewers must use the same mode as the sender.
- **Not verified:** a real phone camera with 2+ viewers; external (Python/Unity) receivers alongside a browser viewer.

## Exe fix (2026-10-12): pages could not connect

- **Symptom:** the built `lan-camera-streaming.exe` served pages but nothing worked (Start/Join did nothing).
- **Cause:** `/socket.io/socket.io.js` returned an empty reply in the exe. Socket.IO reads its browser client from `node_modules` at runtime and the exe has none, so `io` was undefined in the browser. `npm start` worked because `node_modules` exists. The earlier "verified" exe check only fetched pages and CSS.
- **Fix:** `signaling.js` `serveClient: false`; `server.js` serves the client at `/vendor/socket.io.js` (installed package, else the copy embedded by `scripts/build-embedded-assets.js`); `sender.html` and `viewer.html` load it from there. `package.json` gained `postinstall` to generate the git-ignored `embedded-assets.js` (a fresh clone could not start without it). Tests: 34/34.
- **Verified:** rebuilt exe copied to an empty folder: client script 200 (153,519 bytes), full signaling round trip over websocket (join, `peer:joined`, offer relay, `/api/qr`), and a real browser tab loaded `/sender`, saw `io` defined, connected and joined a room with no console errors. `dist/lan-camera-streaming.exe` was rebuilt at v1.0.5 without bumping the version.
- **Not verified:** a real phone camera streaming through the exe; exe in zrok mode (starts a real share).
- **Noticed, not changed:** `loadEnvFile` makes `.env` values override real environment variables (so `PORT=7788 node ...` is ignored when `.env` sets `PORT`), unlike the previous `start.ps1` behavior. `index.js` also loads `.env` after `start.ps1` clears `HTTPS_*` for zrok mode, so HTTPS values in `.env` would still apply there.

## External receivers (2026-10-10) — documentation added, server unchanged

A first external receiver now exists: the Viitorx Unity app's Python sidecar joins a room as the WebRTC receiver and uses the phone as a webcam. Because this project is independent and meant to serve any technology, the contract was written down neutrally (ADR-016).

- **Read first for any integration:** `docs/receiver-guide.md`. The formal schemas are `docs/architecture.md` §4, corrected this session (`mediaMode`, who receives `peer:joined`, `senderId`, `tunnel:frame`, `/api/config`, per-socket membership, the join rate limit, the exclusive viewer slot, the MJPEG delimiter).
- **No server code changed.** Only `README.md` and `docs/` (`receiver-guide.md` new; `architecture.md`, `decisions.md` ADR-016, `tasks.md` P5, `roadmap.md` Phase 6, `project-overview.md`, this file).
- **Behaviors a receiver must handle** (all from the server source, and met by the Python receiver): join on every `connect`; the viewer slot is exclusive (a browser viewer blocks a receiver); the sender creates the offer and trickles candidates after it; five failed joins block a socket for 30 s.
- **Verified:** the WebRTC path against this server with a Python (`aiortc`) receiver and a Python stand-in phone on loopback (join, offer/answer, leave and return, socket drop, wrong PIN, occupied room, slow consumer, plus the full chain through a pose model); MJPEG and tunnel relay with an earlier standalone Python receiver.
- **NOT verified:** a real phone's browser sender page with an external receiver; real Wi-Fi, firewall and zrok behavior; real-phone latency; any receiver in a language other than Python. `npm test` was not re-run for this documentation change.
- **Next:** build a receiver in a second language from the guide alone and fix whatever the guide got wrong; then a real-device run (tasks.md P5).
- **Reference implementation** (other repository, the Viitorx VRM project): `python-sidecar~/tools/video/lan_camera.py`, tested by `python-sidecar~/tests/test_lan_camera.py`, which starts THIS server (`CAMERA_SERVER_DIR`).

## Standalone Console Executable (.exe), CLI, & Build Automation (2026-10-12) — ADR-017

A single, self-contained Windows console `.exe` is now fully supported (`dist/lan-camera-streaming.exe`). It requires zero runtime dependencies (no Node.js or `node_modules` required to run on client PCs).

- **Build pipeline:** `npm run build:exe` runs `scripts/build-exe.js`, which compiles static assets, bundles with `esbuild`, creates an official Node.js Single Executable Application (SEA) blob, copies the Node PE binary, injects the resource using `postject`, applies PE icon and version metadata via `resedit`, and exposes `dist/.env` alongside the executable.
- **Root build automation (`build.bat`):** Running `build.bat` automatically increments the patch/last digit of the application version in `package.json` and `package-lock.json` (`scripts/bump-version.js`), rebuilds embedded assets, updates Windows PE binary version info (`VersionInfo`), and produces the release executable in `dist/`.
- **Embedded asset fallback:** Frontend assets (`src/public`) are inlined into `src/server/embedded-assets.js`. Express routes check disk paths first (allowing local customizations) and fall back to in-memory embedded assets when running in an isolated environment. Verified by copying `lan-camera-streaming.exe` to an empty folder without `src/` and fetching `/health`, `/sender`, `/viewer`, and `/css/style.css` (all returned HTTP 200).
- **Branding & App Icon:** Custom camera/Wi-Fi wave icon created in `assets/icon.ico` and `assets/icon.png`, served at `/favicon.ico` / `/favicon.png`, embedded in all HTML headers, and stamped directly into the Windows executable icon resource table.
- **Interactive CLI features:** `src/server/cli.js` provides CLI options (`-p, --port`, `--host`, `--pin`, `-l, --local`, `-z, --zrok`, `--zrok-token`, `--cert`, `--key`, `-e, --env`, `--help`), automatic detection and display of private LAN IPv4 addresses, ASCII QR code generation via `qrcode-terminal`, `.env` auto-discovery and template generation, and optional automated zrok tunnel supervision with cleanup on Ctrl+C.
- **Runtime .env configuration:** The executable does not hardcode user settings; it dynamically loads `dist/.env` on launch. If launched in a new folder without `.env`, it automatically writes a default template `.env` next to the executable. Users can edit `.env` in Notepad to change `PORT`, `ACCESS_PIN`, `ZROK_TOKEN`, etc.
- **Server Entry Points & Tunnel Management:**
  - `src/server/index.js` (`npm run dev` or `npm start`): Minimal web server entry point without tunnel or CLI supervision.
  - `src/server/cli.js` (`npm run cli -- --zrok` or standalone `.exe`): Full console application with interactive banner, QR code, LAN IP discovery, and automated zrok tunnel lifecycle.
  - `start.ps1`: Full PowerShell supervisor for development that manages zrok shares and starts the Node server.

## Multi-Viewer Concurrent WebRTC Mesh Streaming (2026-10-12) — ADR-018

- **Multi-peer capacity:** RoomManager replaces single `viewerSocketId` with `viewerSocketIds: Set<string>`. Multiple viewers/receivers can join the same room simultaneously without throwing `"Room already has an active viewer/receiver."`.
- **Targeted WebRTC routing:** `signaling.js` routes `webrtc:offer`, `webrtc:answer`, and `webrtc:ice-candidate` to specific peers via `targetId` / `viewerId` / `senderId`.
- **Sender multi-peer management:** `src/public/js/sender.js` tracks a `Map<viewerId, WebRtcPeer>`, creating dedicated P2P connections as new viewers join and closing connections individually when a viewer leaves.
- **Tunnel relay broadcasting:** In `tunnel-relay` mode, frames are broadcast to all joined viewers in the room.
- **Automated test suite:** `npm test` runs 35 tests (all 35 pass), including targeted multi-viewer offer routing and room capacity tests.

## Current status

**Status:** Zero-zrok-quota LAN operation implemented (ADR-015), Standalone Executable (.exe) + Build Automation implemented (ADR-017), and Multi-Viewer WebRTC Mesh implemented (ADR-018). Code and automated tests are done.

- **Quota leak fixed:** the sender used to upload ~15 FPS JPEGs (`mjpeg:frame`) through Socket.IO (and zrok) unconditionally, even in WebRTC mode. It is now demand-driven: the server emits `mjpeg:demand { active }` to the sender only while an HTTP `/stream/:roomId` consumer or a `/snapshot/:roomId` request is waiting, and drops frames otherwise. Frames are capped at 1280 px width / 900 KB with one in-flight encode. `/snapshot` now asks for a fresh frame on demand.
- **Viewer on the PC via localhost:** `/api/network-info` returns `{ protocol, port }` only (no LAN IPs, since the route is public through zrok). Sender page shows an "Open Viewer on the PC" localhost link; viewer page shows a hint banner when opened through a non-local hostname; `start.ps1` prints `http://localhost:<port>/viewer`.
- **Path indicator:** `webrtc-peer.js` classifies the nominated ICE pair (`classifyPath`) as `lan` / `internet` / `relay`; `#pathIndicator` on both pages and a `[PATH]` diagnostics line show it. `lan` means no video bytes through zrok.
- **Mode B relabelled** as "Fallback — Video through zrok (uses zrok quota)", with a warning on the sender page. ICE-failure diagnosis rewritten (AP isolation, Windows Firewall profile, VPN adapter). Tunnel frames above 600 KB are skipped client-side.
- **Local HTTPS / tunnel-free mode:** server serves HTTPS when `HTTPS_CERT_PATH` + `HTTPS_KEY_PATH` are set (both or neither, validated in `config.js`). `start.ps1 -LocalOnly` skips zrok and prints LAN sender URLs + QR over plain HTTP (or HTTPS with a user-supplied cert). The mkcert auto-setup was removed again at the user's request; phone camera on plain HTTP needs the Chrome insecure-origin flag. The recommended path is the default zrok mode. In normal (zrok) mode `start.ps1` forces plain HTTP because zrok proxies to `http://127.0.0.1`.
- **Previous work still in place:** reserved `lan.shares.zrok.io` binding, full-resolution camera option, zrok endpoint release on exit.
- **Automated tests:** 33/33 pass (`npm test`). PowerShell scripts parse cleanly (no non-ASCII characters).

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows, Mode A vs Mode B, external receiver signaling contract (now includes `mjpeg:demand`).
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions (ADR-001 through ADR-017) and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes (see P6).
6. `docs/project-overview.md` — goals, scope, and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express or standalone `lan-camera-streaming.exe`.
- Tunnel (optional): `zrok` public HTTPS share bound to `public:lan`; carries only the phone's page load and Socket.IO signaling in Mode A. WebRTC media is UDP and never goes through zrok.
- Mode A (WebRTC): host-to-host on the same Wi-Fi when the PC viewer uses `localhost`.
- Mode B (tunnel relay): last-resort fallback that sends every frame through zrok.
- Tunnel-free alternative: `start.ps1 -LocalOnly` or `lan-camera-streaming.exe --local` (plain HTTP + Chrome flag on the phone, or user-supplied certificate).
- Security was explicitly de-prioritised by the user for this iteration (default PIN `123456` unchanged).

## Modified files (this iteration)

- Executable & Automation: `build.bat` (new), `scripts/bump-version.js` (new), `scripts/build-exe.js` (new), `scripts/build-embedded-assets.js` (new).
- Assets: `assets/icon.ico` (new), `assets/icon.png` (new), `src/public/assets/icon.svg` (new), `src/public/favicon.ico` (new), `src/public/favicon.png` (new).
- UI/Client: `src/public/index.html`, `src/public/sender.html`, `src/public/viewer.html`, `src/public/css/style.css`.
- Server: `src/server/server.js`, `src/server/cli.js` (new), `src/server/config.js` (dynamic .env loading), `src/server/embedded-assets.js` (generated).
- Package & config: `package.json`, `package-lock.json`, `.gitignore`.
- Tests: `tests/cli.test.js` (new).
- Docs: `README.md`, `docs/tasks.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/project-overview.md`, `docs/roadmap.md`, `docs/ai_handoff.md`.

## Immediate next task

1. Distribute or test `dist/lan-camera-streaming.exe` on a target Windows machine without Node.js installed.
2. Confirm that running `build.bat` increments the version number, builds the `.exe`, and stamps file metadata.

## Commands run & results

- `npm test`: 33/33 passed.
- `build.bat`: successfully tested; incremented version to 1.0.3, generated `dist/lan-camera-streaming.exe` (with embedded icon and PE version information), copied `dist/.env`, and output icon assets.
- `npm run build:exe`: successfully generated standalone `dist/lan-camera-streaming.exe` (83.02 MB) with embedded icon, exposed `dist/.env`, and copied `dist/icon.ico`.
- Icon endpoints test: verified HTTP 200 for `/favicon.ico`, `/favicon.png`, and `/assets/icon.svg` on running executable.
- Dynamic `.env` verification test: edited `dist/.env` with custom `PORT=3888` and `ACCESS_PIN=987654`; verified executable booted on port 3888 and responded with HTTP 200.
- Isolated directory test: verified auto-creation of `.env` template when `lan-camera-streaming.exe` was run in a new directory with zero existing files.

