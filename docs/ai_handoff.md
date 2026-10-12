# LAN Camera Streaming — AI Handoff

## External receivers (2026-10-10) — documentation added, server unchanged

A first external receiver now exists: the Viitorx Unity app's Python sidecar joins a room as the WebRTC receiver and uses the phone as a webcam. Because this project is independent and meant to serve any technology, the contract was written down neutrally (ADR-016).

- **Read first for any integration:** `docs/receiver-guide.md`. The formal schemas are `docs/architecture.md` §4, corrected this session (`mediaMode`, who receives `peer:joined`, `senderId`, `tunnel:frame`, `/api/config`, per-socket membership, the join rate limit, the exclusive viewer slot, the MJPEG delimiter).
- **No server code changed.** Only `README.md` and `docs/` (`receiver-guide.md` new; `architecture.md`, `decisions.md` ADR-016, `tasks.md` P5, `roadmap.md` Phase 6, `project-overview.md`, this file).
- **Behaviors a receiver must handle** (all from the server source, and met by the Python receiver): join on every `connect`; the viewer slot is exclusive (a browser viewer blocks a receiver); the sender creates the offer and trickles candidates after it; five failed joins block a socket for 30 s.
- **Verified:** the WebRTC path against this server with a Python (`aiortc`) receiver and a Python stand-in phone on loopback (join, offer/answer, leave and return, socket drop, wrong PIN, occupied room, slow consumer, plus the full chain through a pose model); MJPEG and tunnel relay with an earlier standalone Python receiver.
- **NOT verified:** a real phone's browser sender page with an external receiver; real Wi-Fi, firewall and zrok behavior; real-phone latency; any receiver in a language other than Python. `npm test` was not re-run for this documentation change.
- **Next:** build a receiver in a second language from the guide alone and fix whatever the guide got wrong; then a real-device run (tasks.md P5).
- **Reference implementation** (other repository, the Viitorx VRM project): `python-sidecar~/tools/video/lan_camera.py`, tested by `python-sidecar~/tests/test_lan_camera.py`, which starts THIS server (`CAMERA_SERVER_DIR`).

## Standalone Console Executable (.exe) & CLI (2026-10-12) — ADR-017

A single, self-contained Windows console `.exe` is now fully supported (`dist/lan-camera-streaming.exe`). It requires zero runtime dependencies (no Node.js or `node_modules` required to run on client PCs).

- **Build pipeline:** `npm run build:exe` runs `scripts/build-exe.js`, which compiles static assets, bundles with `esbuild`, creates an official Node.js Single Executable Application (SEA) blob, copies the Node PE binary, injects the resource using `postject`, and exposes `dist/.env` and `dist/.env.example` alongside the executable.
- **Embedded asset fallback:** Frontend assets (`src/public`) are inlined into `src/server/embedded-assets.js`. Express routes check disk paths first (allowing local customizations) and fall back to in-memory embedded assets when running in an isolated environment. Verified by copying `lan-camera-streaming.exe` to an empty folder without `src/` and fetching `/health`, `/sender`, `/viewer`, and `/css/style.css` (all returned HTTP 200).
- **Interactive CLI features:** `src/server/cli.js` provides CLI options (`-p, --port`, `--host`, `--pin`, `-l, --local`, `-z, --zrok`, `--zrok-token`, `--cert`, `--key`, `-e, --env`, `--help`), automatic detection and display of private LAN IPv4 addresses, ASCII QR code generation via `qrcode-terminal`, `.env` auto-discovery and template generation, and optional automated zrok tunnel supervision with cleanup on Ctrl+C.
- **Runtime .env configuration:** The executable does not hardcode user settings; it dynamically loads `dist/.env` on launch. If launched in a new folder without `.env`, it automatically writes a default template `.env` next to the executable. Users can edit `.env` in Notepad to change `PORT`, `ACCESS_PIN`, `ZROK_TOKEN`, etc.
- **Automated test suite:** `npm test` now runs 33 tests (all 33 pass), including `tests/cli.test.js` covering argument flags, `.env` parsing, and custom env file loading.

## Current status

**Status:** Zero-zrok-quota LAN operation implemented (ADR-015) and Standalone Console Executable (.exe) implemented (ADR-017). Code and automated tests are done.

- **Quota leak fixed:** the sender used to upload ~15 FPS JPEGs (`mjpeg:frame`) through Socket.IO (and zrok) unconditionally, even in WebRTC mode. It is now demand-driven: the server emits `mjpeg:demand { active }` to the sender only while an HTTP `/stream/:roomId` consumer or a `/snapshot/:roomId` request is waiting, and drops frames otherwise. Frames are capped at 1280 px width / 900 KB with one in-flight encode. `/snapshot` now asks for a fresh frame on demand.
- **Viewer on the PC via localhost:** `/api/network-info` returns `{ protocol, port }` only (no LAN IPs, since the route is public through zrok). Sender page shows an "Open Viewer on the PC" localhost link; viewer page shows a hint banner when opened through a non-local hostname; `start.ps1` prints `http://localhost:<port>/viewer`.
- **Path indicator:** `webrtc-peer.js` classifies the nominated ICE pair (`classifyPath`) as `lan` / `internet` / `relay`; `#pathIndicator` on both pages and a `[PATH]` diagnostics line show it. `lan` means no video bytes through zrok.
- **Mode B relabelled** as "Fallback — Video through zrok (uses zrok quota)", with a warning on the sender page. ICE-failure diagnosis rewritten (AP isolation, Windows Firewall profile, VPN adapter). Tunnel frames above 600 KB are skipped client-side.
- **Local HTTPS / tunnel-free mode:** server serves HTTPS when `HTTPS_CERT_PATH` + `HTTPS_KEY_PATH` are set (both or neither, validated in `config.js`). `start.ps1 -LocalOnly` skips zrok and prints LAN sender URLs + QR over plain HTTP (or HTTPS with a user-supplied cert). The mkcert auto-setup was removed again at the user's request; phone camera on plain HTTP needs the Chrome insecure-origin flag. The recommended path is the default zrok mode. In normal (zrok) mode `start.ps1` forces plain HTTP because zrok proxies to `http://127.0.0.1`.
- **Previous work still in place:** reserved `lan.shares.zrok.io` binding, full-resolution camera option, zrok endpoint release on exit.
- **Automated tests:** 29/29 pass (`npm test`). Also verified manually: server starts over HTTPS with a throwaway cert, `/api/network-info` returns `https`, missing cert files produce an actionable error. PowerShell scripts parse cleanly (no non-ASCII characters). The browser UI changes (sender/viewer pages, path indicator) were syntax-checked only, not exercised in a browser with a camera.

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows, Mode A vs Mode B, external receiver signaling contract (now includes `mjpeg:demand`).
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions (ADR-001 through ADR-015) and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes (see P4.6).
6. `docs/project-overview.md` — goals, scope, and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express.
- Tunnel (optional): `zrok` public HTTPS share bound to `public:lan`; carries only the phone's page load and Socket.IO signaling in Mode A. WebRTC media is UDP and never goes through zrok.
- Mode A (WebRTC): host-to-host on the same Wi-Fi when the PC viewer uses `localhost`.
- Mode B (tunnel relay): last-resort fallback that sends every frame through zrok.
- Tunnel-free alternative: `start.ps1 -LocalOnly` (plain HTTP + Chrome flag on the phone, or user-supplied certificate).
- Security was explicitly de-prioritised by the user for this iteration (default PIN `123456` unchanged).

## Modified files (this iteration)

- Assets: `assets/icon.ico` (new), `assets/icon.png` (new), `src/public/assets/icon.svg` (new), `src/public/favicon.ico` (new), `src/public/favicon.png` (new).
- UI/Client: `src/public/index.html`, `src/public/sender.html`, `src/public/viewer.html`, `src/public/css/style.css`.
- Server: `src/server/server.js`, `src/server/cli.js` (new), `src/server/embedded-assets.js` (generated).
- Scripts/build: `scripts/build-embedded-assets.js` (updated for binary assets), `scripts/build-exe.js` (updated for icon embedding).
- Package & config: `package.json`, `.gitignore`.
- Tests: `tests/cli.test.js` (new).
- Docs: `README.md`, `docs/tasks.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/project-overview.md`, `docs/roadmap.md`, `docs/ai_handoff.md`.

## Immediate next task

1. Distribute or test `dist/lan-camera-streaming.exe` on a target Windows machine without Node.js installed.
2. Confirm the CLI launches with `.\dist\lan-camera-streaming.exe --local`, displays the banner, prints the local IP and terminal ASCII QR code, and serves the UI with the new icon to a phone browser.

## Commands run & results

- `npm test`: 33/33 passed.
- `npm run build:exe`: successfully generated standalone `dist/lan-camera-streaming.exe` (83.02 MB) with embedded icon, exposed `dist/.env`, and copied `dist/icon.ico`.
- Icon endpoints test: verified HTTP 200 for `/favicon.ico`, `/favicon.png`, and `/assets/icon.svg` on running executable.
- Dynamic `.env` verification test: edited `dist/.env` with custom `PORT=3888` and `ACCESS_PIN=987654`; verified executable booted on port 3888 and responded with HTTP 200.
- Isolated directory test: verified auto-creation of `.env` template when `lan-camera-streaming.exe` was run in a new directory with zero existing files.
