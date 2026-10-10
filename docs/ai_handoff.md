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

## Current status

**Status:** Zero-zrok-quota LAN operation implemented (ADR-015). Code and automated tests are done; real phone + PC verification is still pending.

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

- Server: `src/server/mjpeg-streamer.js`, `src/server/signaling.js`, `src/server/server.js`, `src/server/config.js`, `src/server/index.js`.
- Client: `src/public/js/sender.js`, `src/public/js/viewer.js`, `src/public/js/webrtc-peer.js`, `src/public/js/ui-utils.js`, `src/public/sender.html`, `src/public/viewer.html`, `src/public/index.html`, `src/public/css/style.css`.
- Scripts/config: `start.ps1` is now the ONLY script. The `scripts/` folder (start-server, start-zrok, release-zrok, setup-local-https) was deleted and folded into it (also does first-run `npm install` and `.env` creation). Also `.env.example`, `.gitignore`.
- Tests: `tests/mjpeg.test.js` (rewritten for demand-driven flow), `tests/server.test.js`, `tests/path-classification.test.js` (new).
- Docs: `README.md`, `docs/tasks.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/ai_handoff.md`.

## Immediate next task

On the real devices:
1. `powershell -File start.ps1`; open the sender URL on the phone, start streaming in WebRTC mode; open `http://localhost:3000/viewer?room=<id>` on the PC.
2. Confirm the green "LAN direct" indicator and a `[STATS] Pair: host ... <-> host/prflx ...` line. If ICE fails, check Wi-Fi AP/client isolation, the Windows network profile (Private), and VPN adapters.
3. Check the zrok dashboard: transfer should be KBs (page + signaling), not MBs.
4. Optional tunnel-free run: `powershell -File start.ps1 -LocalOnly`; on the phone enable the Chrome insecure-origin flag for the printed URL.

## Commands run & results

- `npm test`: 29/29 passed.
- HTTPS smoke test with a throwaway self-signed cert: `/health` and `/api/network-info` served over HTTPS; plain HTTP rejected.
- PowerShell parser check on `start.ps1`: 0 errors.
- Neither `start.ps1` mode was executed end to end here (default mode starts a real zrok share).
