# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Room management and Socket.IO signaling completed and verified (Phase 3 / P2/P3 room components).
- RoomManager enforcing 1-to-1 capacity, PIN validation, room ID sanitization, and automatic cleanup.
- Socket.IO signaling relays (SDP offer/answer, ICE candidates, stream states) with room isolation and max buffer bounds.
- All 6 automated tests pass (startup, config, room manager, and full client signaling relays).
- Next milestone: Browser camera capture and WebRTC media connection implementation.

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows and signaling protocol.
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes.
6. `docs/project-overview.md` — goals, scope and MVP definition.

If repository-specific files exist, inspect `.editorconfig`, `package.json`, the lockfile, README, existing server code, and tests before creating or changing files. Reuse an existing implementation instead of introducing a duplicate server.

## Agreed architecture

- Host: Windows PC.
- Backend: Node.js + Express.
- Signaling: Socket.IO.
- Camera capture: browser `getUserMedia()` after an explicit Start click.
- Media transport: WebRTC between sender and viewer.
- Frontend: plain HTML, CSS, and browser JavaScript for the initial small UI, unless an existing repository framework should be reused.
- HTTPS: one optional ngrok or zrok tunnel for initial access, or trusted local HTTPS for LAN-only use.
- Media relay: TURN is deferred until actual tests show that direct connectivity fails on target networks.
- MVP: one sender, one viewer, video-only, no recording, no cloud media storage.

**Critical boundary:** Socket.IO carries room and WebRTC signaling messages only. Do not send encoded video frames through Socket.IO, HTTP uploads, or the tunnel. Confirm the chosen WebRTC media path in browser diagnostics rather than assuming it is direct.

## Immediate next task

Start with **P0 — Inspect and bootstrap** in `docs/tasks.md`.

1. Inspect the actual repository and identify its current state.
2. Summarize the intended changes before implementation, as required by `AGENTS.md`.
3. Create/reuse the minimal Express + Socket.IO server, a health route, and static asset serving.
4. Verify server startup and `/health` before adding camera capture.
5. Update `tasks.md` based on work actually completed.

Do not implement the entire roadmap in one unreviewed change. Finish one milestone, run its checks, record the results, and then proceed.

## Implementation constraints

- Keep room/session state server-side and validate membership for every signaling event.
- Require a room ID plus pairing secret/PIN; a tunnel URL is not an access-control mechanism.
- The browser must only start capture after user action and must stop tracks when the stream is stopped.
- Handle camera errors, disconnects, expired rooms and server restarts explicitly.
- Do not report Live until a remote video track is received and rendered.
- Do not add recording, cloud storage, audio, multi-viewer support, or a TURN dependency without updating scope and decisions first.
- Do not mark tasks complete until the behavior has been tested.
- Keep secrets out of source control and logs.

## Required handoff after each implementation session

Update this file with:

- actual implementation status (not planned status);
- modified/created files;
- commands and tests run, with pass/fail results;
- known issues and reproduction steps;
- the single best next task.

Also update `tasks.md` and, for material design changes, `decisions.md`. Do not claim that mobile or cross-network behavior works without testing it on the relevant devices and networks.
