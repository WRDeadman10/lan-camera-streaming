# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Two-Mode Architecture Implemented and Verified (WebRTC Mode & Experimental zrok Tunnel Relay Mode).
- **Backend:** Express HTTP server, health endpoint `/health`, `/api/config`, `/stream/:roomId`, and `/snapshot/:roomId`.
- **In-Memory RoomManager:** Enforces 1-to-1 rooms, PIN authentication, room ID validation, stale room cleanup, and mediaMode matching (`webrtc` vs `tunnel-relay`).
- **Socket.IO Signaling & TunnelRelay:**
  - Standard WebRTC signaling relay (offer, answer, ICE candidates, stream lifecycle).
  - Experimental binary video frame relay (`tunnel:frame`) with rate limit enforcement (max 30 FPS), size bounds (600 KB max), and backpressure frame drops.
  - Tunnel metrics collection (`tunnel:stats`).
- **Frontend Clients:**
  - Sender (`sender.html` / `sender.js`): Media mode selector, canvas downscaling (640x360 @ 10 FPS default, configurable), non-Base64 binary ArrayBuffer encoding via `canvas.toBlob()`, and diagnostics reporting.
  - Viewer (`viewer.html` / `viewer.js`): Media mode selector, `<video>` for WebRTC, `<canvas>` for tunnel relay with freshest-frame buffer queue, and real-time throughput calculations (FPS, dropped frames, MB/hr estimate).
  - Home (`index.html`): Overview of both media modes and quick instructions.
- **Windows zrok Automation:** `scripts/start-server.ps1` and `scripts/start-zrok.ps1` helper scripts using discovered `zrok2.exe` v2.0.8.
- **Automated Tests:** All 13 Node.js automated tests pass (`npm test`).

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows, Mode A vs Mode B, and external receiver signaling contract.
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions (ADR-001 through ADR-012) and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes.
6. `docs/project-overview.md` — goals, scope, and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express.
- Primary Tunnel: `zrok` public HTTPS sharing (`zrok2 share public <target> --backend-mode proxy`).
- Authentication: Configurable `ZROK_TOKEN` in `.env` automatically validated and enabled via `scripts/start-zrok.ps1`.
- Mode A (WebRTC): Low-latency direct peer-to-peer media. Signaling carried by Socket.IO over zrok.
- Mode B (Experimental zrok Tunnel): Camera frames downscaled to canvas, sent as raw binary JPEG buffers via Socket.IO over zrok tunnel, relayed by Windows server to authorized viewer. Evaluates performance against zrok's 5 GB daily free quota.
- Security: Access PIN authentication, payload size bounds (600KB), brute-force rate-limiting, room isolation, and media mode agreement.
- Access & Pairing: Persistent reserved domain `lan.shares.zrok.io`, ASCII QR codes displayed in terminal upon launch, and in-browser QR codes on index and sender pages for phone camera scanning.

## Immediate next task

Perform live cross-network verification using `powershell -File start.ps1` with real mobile and laptop devices, comparing Mode A (WebRTC) and Mode B (zrok Tunnel Relay) for throughput and latency.

## Commands run & results

- `npm test`: 13/13 tests passed (TunnelRelay validation, backpressure dropping, Socket.IO binary relay, room capacity, canonical roles, signaling relays, auth rate limiting, MJPEG streaming).
- All-in-one start: `powershell -File start.ps1` (launches Node server, displays terminal QR code for phone scan, and runs zrok tunnel).
- Separate start options: `npm start` (server) and `powershell -File scripts/start-zrok.ps1` (zrok tunnel).
