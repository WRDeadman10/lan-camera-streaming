# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Full MVP implementation and Dual-Transport Python Vision Pipeline complete, documented, and verified.
- Backend server bootstrap, configuration validation, `/health`, `/api/config`, `/stream/:roomId`, and `/snapshot/:roomId`.
- In-memory RoomManager enforcing 1-to-1 rooms, PIN authentication, room ID validation, and stale room cleanup.
- Socket.IO signaling relays with payload validation, rate-limiting on repeated auth failures, room isolation, and MJPEG frame streaming.
- Responsive HTML5/CSS UI for landing page, sender, and viewer with one-click direct Python stream links.
- `python_inference` package with clean `BaseVideoTransport` abstraction and two adapters:
  1. `MjpegVideoTransport`: standard HTTP multipart streaming using OpenCV / standard library.
  2. `WebRtcVideoTransport`: ultra-low latency direct peer-to-peer WebRTC via `aiortc` and `python-socketio`.
- `InferencePipeline` enforcing strict fresh-frame policy: queue size = 1 with automatic stale-frame eviction and `max_frame_age_ms` threshold.
- `MetricsCollector` tracking real-time FPS, inference FPS, latency, frame age, CPU %, memory MB, and network bitrate.
- Unified CLI runner: `python run_inference.py --transport [mjpeg|webrtc]`.
- All Node.js automated tests passing (9/9) and Python unit tests passing (2/2).

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows and signaling protocol.
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes.
6. `docs/project-overview.md` — goals, scope and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express.
- Signaling: Socket.IO over HTTP/HTTPS.
- Camera capture: browser `getUserMedia()` after explicit user action.
- Media transport: Pure WebRTC peer-to-peer for browser viewers + Dual transport for Python inference (WebRTC `aiortc` or HTTP multipart MJPEG).
- Security: Access PIN authentication, payload size limit (100KB), brute-force rate-limiting, room isolation.
- HTTPS: Documented for localhost, ngrok/zrok public tunnel, or mkcert trusted LAN certificates.

## Immediate next task

Perform comparative benchmark on target devices (iPhone/Android -> Windows PC over LAN and zrok tunnel) measuring latency, FPS, and CPU across both transports using `python run_inference.py`.

## Commands run & results

- `npm test`: 9/9 tests passed (server config, health endpoint, room capacity, signaling relays, auth rate limiting, MJPEG streaming).
- `python tests/test_python_inference.py`: 2/2 tests passed (metrics collection, fresh-frame drop policy).
- Server start: `npm start` (listening on port 3000).
- Python inference runner: `python run_inference.py --transport mjpeg` and `python run_inference.py --transport webrtc`.
