# LAN Camera Streaming — AI Handoff

Last updated: 2026-10-13. Another agent may continue from this file tomorrow: read it, then the docs listed under "Read before implementation". The Windows virtual camera driver is a separate repository mounted as the `vcam/` submodule; its handoff is `vcam/docs/ai_handoff.md`.

## Current status

The project is feature-complete for its current scope and has been verified on one Windows 11 PC with a mock (canvas) camera and a real browser. It has **not** been verified on a clean machine, with a real phone for the newest features, or on Windows 10.

| Area | State |
|---|---|
| Browser sender/viewer, WebRTC (Mode A), tunnel relay (Mode B) | Working; LAN-direct path verified on the user's network |
| One sender + several viewers per room (ADR-018) | Working in tests and with 2-3 browser viewers; real phone with 2+ viewers not tested |
| Quota-safe operation (on-demand MJPEG, localhost viewer, path indicator) | Implemented (ADR-015) |
| External receivers (Python/Unity), MJPEG endpoint | Documented and exercised with a Python receiver (ADR-016, `docs/receiver-guide.md`) |
| Standalone `lan-camera-streaming.exe`, CLI, build automation | Working (ADR-017); the exe serves its own pages, Socket.IO client and driver installer from any folder |
| UI/UX (single-screen responsive, orientation aware) | Delivered (ADR-019/020); mobile portrait verified only in emulation |
| Windows virtual webcam "LAN Phone Camera" (DirectShow + Media Foundation) | Implemented and verified on one PC: Windows lists it, Frame Server capture returns live upright 1280x720 at 30 fps (ADR-021/023) |
| One-file installer `lan-camera-setupv<version>.exe` (Inno Setup) | Install, uninstall, reinstall verified silently on this PC (ADR-024) |
| Shared-memory bridge for the DirectShow camera (ADR-022) | **Not wired** (dead code); the real path is viewer page -> JPEG POST -> MJPEG stream |
| Automated tests | 37/37 pass (`npm test`) |

Version: `package.json` is 1.0.20. The files currently in `dist/` were built as 1.0.19, so rebuild (`build.bat`, which bumps to 1.0.21) before distributing.

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and documentation rules (section 16).
2. `docs/architecture.md` — components, routes (§3), receiver signaling contract (§4), multi-viewer (§11), virtual webcam (§12), build and distribution (§13).
3. `docs/roadmap.md` and `docs/tasks.md` — plan and backlog (open items are the unchecked boxes).
4. `docs/decisions.md` — ADR-001 to ADR-024 and the open decisions at the end.
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
- ADR-022 describes a shared-memory path that nothing uses (see its correction).

## Verified and not verified

- **Verified (2026-10-12/13):** all 37 tests; exe pages, Socket.IO client and signaling round trip from an empty folder; 2-3 browser viewers, leave/rejoin, sender restart, tunnel relay with 2 viewers; driver download from the exe in `dist/` and in an empty folder (byte-identical installer); Windows camera enumeration (0 -> 1 device after install, empty after uninstall); Frame Server capture 30 fps upright live frames; DirectShow capture through ffmpeg; silent install/uninstall/reinstall via Inno Setup; `lancam://` deeplink writes both session files without UAC.
- **Not verified:** a real phone for the virtual webcam and for 2+ viewers; the Windows Camera app window itself, Teams, Zoom, Unity; a clean machine/VM and the visible installer wizard; Windows 10; zrok mode of the exe; the full root `build.bat` (it bumps the version and ends with `pause`; its steps were run individually); a receiver in a language other than Python; real-phone latency.

## Modified files (last iteration, 2026-10-13)

- Main repo docs: `README.md`, `docs/architecture.md`, `docs/project-overview.md`, `docs/roadmap.md`, `docs/tasks.md`, `docs/decisions.md`, `docs/receiver-guide.md`, `docs/ai_handoff.md` (rewritten and structured).
- Main repo code: `src/public/viewer.html`, `src/public/js/viewer.js` (driver link and log text now name the installer), `src/server/embedded-assets.js` (regenerated).
- `vcam/docs/*` (new: project-overview, architecture, roadmap, tasks, decisions, ai_handoff). Earlier in the same period: `vcam/src/lancam_setup.cpp`, `vcam/src/lancam_mfsource.cpp` (new), `vcam/installer/lan-camera.iss` (new), `vcam/build.bat`, `vcam/include/config_manager.h`; root `build.bat`, `scripts/build-embedded-assets.js`, `src/server/server.js`, `src/server/signaling.js`, `src/server/mjpeg-streamer.js`, `src/public/js/sender.js`, `tests/*`.

## Next recommended task

1. Run the installer on a **clean Windows 11 machine or VM** (click through the wizard), open the Windows Camera app, and confirm the live phone feed; try Teams/Zoom/Unity.
2. Test a **real phone** with the PC viewer pumping frames (`bridge-frame` path) and with 2+ viewers; add per-peer bitrate/resolution caps if the phone struggles.
3. Decide whether to wire or delete the unused shared-memory bridge (ADR-022).
4. Rotate the exposed git token (see Known issues), then commit the pending work: the `vcam/` submodule changes must be committed and pushed **inside the submodule first**, then the parent repo's submodule pointer.

## Commands run and results (latest)

- `npm test`: 37/37 passed.
- `vcam/build.bat`: builds `lancam-setup.exe`, `LanCamFilter.dll`, `LanCamMfSource.dll` (static runtime) and `dist/lan-camera-setupv1.0.19.exe`.
- `npm run build:exe`: exe v1.0.19 with the installer embedded.
- Silent install/uninstall/reinstall of the installer: exit code 0 each time; `setup.log` shows `directshow=1 mf=0x0 listed=1`.

## Change log (newest first)

Details live in `docs/decisions.md` (ADRs) and `docs/tasks.md`; this is the short history.

- **2026-10-13 — Installer (ADR-024).** One Inno Setup file replaces the zip. Fresh-machine fixes: `MFCreateVirtualCamera` is looked up in `mfsensorgroup.dll` (the old lookup in `mfplat.dll` skipped the Windows camera on every machine); static C++ runtime; honest installer report. "Download Driver" no longer navigates away from a live stream (hidden iframe) and downloads the installer.
- **2026-10-12 — Media Foundation camera (ADR-023).** Windows Camera app can list the phone camera (WinRT enumeration 0 -> 1). Second-viewer failure traced to an old sender page; the server now rejects untargeted offers with several viewers. Virtual camera output fixed (upright, letterboxed); `lancam-setup.exe` no longer asks for UAC on every "Set as Webcam".
- **2026-10-12 — Multi-viewer check.** Verified 2-3 viewers; fixed a leaked tunnel-stats timer.
- **2026-10-12 — Exe fix.** The exe never served the Socket.IO client (read from `node_modules`); now `/vendor/socket.io.js`, embedded. `postinstall` regenerates `embedded-assets.js`.
- **2026-10-12 — UI/UX (ADR-019/020).** Single-screen orientation-aware layouts, vitals bar, HUD controls, sidebar scrolling fix, mobile portrait overhaul, PIN input no longer treated as a password by browsers.
- **2026-10-12 — Virtual camera first versions (ADR-021/022), multi-viewer (ADR-018), standalone exe (ADR-017).**
- **2026-10-10 — External receivers documented (ADR-016).** `docs/receiver-guide.md`; the Viitorx Unity + Python sidecar is the reference integration (other repository: `python-sidecar~/tools/video/lan_camera.py`, tests start THIS server via `CAMERA_SERVER_DIR`).
- **Earlier —** quota-safe LAN operation (ADR-015: on-demand MJPEG, localhost viewer, LAN-direct indicator, optional local HTTPS, single `start.ps1`), tunnel relay and diagnostics (ADR-012/013/014), WebRTC MVP (ADR-001 to ADR-011).
