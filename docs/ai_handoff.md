# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Node.js Pure Architecture Corrected and Verified.
- Backend server bootstrap, configuration validation, `/health`, `/api/config`, `/stream/:roomId`, and `/snapshot/:roomId`.
- In-memory RoomManager enforcing 1-to-1 rooms, PIN authentication, room ID validation, and stale room cleanup. Supports canonical participant roles `camera-sender` and `webrtc-receiver`.
- Socket.IO signaling relays with payload validation, rate-limiting on repeated auth failures, and room isolation.
- Bidirectional SDP offer/answer support on browser camera sender for external receiver compatibility.
- Fully documented, versioned External WebRTC Receiver Signaling Contract in `docs/architecture.md`.
- Removed all embedded Python receiver/inference files to preserve strict Node.js project purity.
- Preserved optional HTTP MJPEG streaming endpoint for external tools (`/stream/:roomId?pin=...`).
- All 10 automated Node.js tests passing (`npm test`). Host has zero Python dependencies.

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows, and external receiver signaling contract.
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes.
6. `docs/project-overview.md` — goals, scope, and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express.
- Signaling: Socket.IO over HTTP/HTTPS.
- Camera capture: Browser `getUserMedia()` after explicit user action.
- Browser media transport: Pure WebRTC peer-to-peer between sender and receiver (Server never touches WebRTC video frames).
- External Receiver Integration: Documented Socket.IO signaling contract for independent external clients (e.g., Python `aiortc` in a separate repo) + optional HTTP MJPEG endpoint.
- Security: Access PIN authentication, payload size limit (100KB), brute-force rate-limiting, room isolation.
- HTTPS / Tunnel: zrok or ngrok for secure public ingress; direct WebRTC media path with optional TURN fallback.

## Immediate next task

Validate the browser camera sender and signaling server using a live zrok tunnel endpoint and perform integration testing with an external WebRTC receiver.

## Commands run & results

- `npm test`: 10/10 tests passed (server config, health endpoint, room capacity, canonical roles, signaling relays, auth rate limiting, MJPEG streaming).
- Server start: `npm start` (listening on port 3000).
