# LAN Camera Streaming — Architecture Decision Records

This document records current decisions and unresolved items. A decision may be revised when implementation evidence justifies it; update the relevant entry rather than silently changing the architecture.

## ADR-001 — Use WebRTC for media transport

**Status:** Accepted

**Decision:** Browser-to-browser live video uses WebRTC. Do not send video frames through Socket.IO, ordinary HTTP polling, or the HTTPS tunnel.

**Reasoning:** WebRTC is designed for real-time media and can establish a direct peer-to-peer path. The server then remains a signaling service instead of a video relay, which reduces server load and avoids spending tunnel bandwidth on media when a direct path works.

**Consequences:** A working signaling exchange alone does not guarantee media connectivity. The app must manage ICE, connection state, remote tracks, cleanup, and optional TURN configuration.

## ADR-002 — Use Socket.IO for signaling

**Status:** Accepted

**Decision:** Use Socket.IO for room events and WebRTC offer/answer/ICE exchange.

**Reasoning:** It provides a convenient event-based channel for browser clients and a Node.js server.

**Consequences:** Event payloads, room authorization, reconnection behavior, validation, and size limits must be defined. Socket.IO carries signaling only, not video.

## ADR-003 — Use Node.js and Express on the Windows host

**Status:** Accepted

**Decision:** Host the web app and Socket.IO signaling endpoint on a Windows PC using Node.js and Express.

**Reasoning:** This matches the requested self-hosted setup and allows the service to be started and maintained locally.

**Consequences:** Provide clear start/stop commands, health checks, Windows firewall guidance, and environment configuration. Keep the HTTP server and Socket.IO server on the same listener unless there is a documented need to split them.

## ADR-004 — Use a browser-compatible HTTPS origin for camera capture

**Status:** Accepted

**Decision:** Sender and viewer pages must be served from an HTTPS origin that the browser trusts. During initial development, use one of ngrok or zrok if that is the easiest trusted HTTPS entry point. For LAN-only deployment, a locally trusted certificate is an alternative.

**Reasoning:** Camera APIs are generally restricted to secure contexts; a private LAN IP over plain HTTP is not normally treated like `localhost`.

**Consequences:** A tunnel is optional infrastructure, not a media transport. Do not require both tunnel tools. Public tunnel access needs authorization and should be treated as internet-reachable.

## ADR-005 — Prefer direct media, with TURN as a future fallback

**Status:** Accepted for MVP; TURN is deferred

**Decision:** Test direct WebRTC connectivity on the same LAN first. Add a TURN server only when target-network tests demonstrate a need.

**Reasoning:** The initial purpose is LAN streaming, and direct media avoids relaying high-volume video through the web tunnel or a media server.

**Consequences:** The MVP must document that some network topologies block direct connectivity. No claim is made that direct media will work across every Wi-Fi, NAT, VPN, or firewall setup.

## ADR-006 — Keep the first release to one sender and one viewer

**Status:** Accepted

**Decision:** Implement one camera source and one receiving browser for the first milestone; video only, with audio disabled.

**Reasoning:** This validates permissions, signaling, media connectivity, lifecycle management, and diagnostics before introducing concurrency.

**Consequences:** Enforce room capacity server-side. Group calls, multiple viewers, audio, recording, and media-server/SFU functionality are out of MVP scope.

## ADR-007 — Do not record or store media

**Status:** Accepted

**Decision:** The MVP does not persist or record video, and the Node.js server does not ingest the media stream.

**Reasoning:** The requirement is live viewing, not storage. This reduces data handling and infrastructure complexity.

**Consequences:** Do not implement recording endpoints, frame uploads, or server-side video storage without an explicit scope change.

## ADR-008 — Protect rooms even if the URL is hard to guess

**Status:** Accepted

**Decision:** Require room authorization with an unguessable room ID plus a pairing secret/PIN, and validate access on the server.

**Reasoning:** A public HTTPS tunnel can make the website reachable outside the LAN. A URL alone is not sufficient access control.

**Consequences:** Rate-limit room creation and joins, expire idle rooms, avoid logging secrets, and expose no unauthenticated admin features.

## ADR-009 — Keep the frontend framework-free for the MVP

**Status:** Accepted provisionally

**Decision:** Start with plain HTML, CSS, and browser JavaScript unless the repository already uses a framework.

**Reasoning:** Two small pages do not require a frontend framework, so a minimal client keeps the initial implementation understandable and lightweight.

**Consequences:** Separate signaling/media logic from DOM rendering. Revisit only if the UI or state complexity grows enough to justify a framework.

## Open decisions to revisit after the first working stream

- Whether TypeScript should replace plain JavaScript for stricter types.
- Whether the app needs multiple simultaneous viewers or camera sources.
- Whether TURN should be operated locally, on a server, or not at all for the intended networks.
- Whether audio is required.
- Whether the final deployment should use a trusted local CA/local DNS or continue using a tunnel.
- What latency and quality targets the real deployment must meet, based on measurements from the target devices and Wi-Fi.
