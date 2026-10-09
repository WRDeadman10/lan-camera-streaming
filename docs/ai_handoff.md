# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Full MVP implementation complete, documented, and verified.
- Backend server bootstrap, configuration validation, and `/health` & `/api/config` endpoints.
- In-memory RoomManager enforcing 1-to-1 rooms, PIN authentication, room ID validation, and stale room cleanup.
- Socket.IO signaling relays with payload validation, rate-limiting on repeated auth failures, and room isolation.
- Responsive HTML5/CSS UI for landing page, sender, and viewer.
- Browser camera capture manager with explicit user gesture requirement, camera flipping, and clean track release.
- WebRTC peer connection manager with candidate queueing, remote track rendering, auto-recovery, and real-time statistics diagnostics.
- Comprehensive documentation, setup guide, and automated test suite.
- All 7 automated tests passing.

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
- Media transport: Pure WebRTC peer-to-peer between sender and viewer. (Server never touches video frames).
- Security: Access PIN authentication, payload size limit (100KB), brute-force rate-limiting, room isolation.
- HTTPS: Documented for localhost, ngrok/zrok public tunnel, or mkcert trusted LAN certificates.

## Immediate next task

Perform live field verification across physical mobile devices (iOS Safari / Android Chrome) on actual target Wi-Fi networks and record long-term latency benchmarks (P4 items).

## Commands run & results

- `npm test`: 7/7 tests passed (server config, health endpoint, room capacity, signaling relays, auth rate limiting).
- Server start: `npm start` (listening on port 3000).
