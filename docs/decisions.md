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

## ADR-010 — Provide direct HTTP MJPEG and snapshot endpoints for Python inference

**Status:** Accepted

**Decision:** Implement `/stream/:roomId?pin=...` (multipart/x-mixed-replace MJPEG) and `/snapshot/:roomId?pin=...` (single frame JPEG) on the server, paired with canvas frame capture on the sender.

**Reasoning:** Python machine learning and computer vision frameworks (such as OpenCV `cv2.VideoCapture`, PyTorch, YOLO, and requests) natively consume HTTP MJPEG URLs out of the box without requiring complex C WebRTC bindings or SDP signaling exchanges in Python.

**Consequences:** Sender client uploads JPEG frames via Socket.IO/binary buffers when active; the server distributes them to authorized HTTP consumers. WebRTC remains the primary low-latency browser-to-browser transport.

## ADR-011 — Separate External Receiver Implementation from Node.js Core

**Status:** Accepted

**Decision:** The Node.js repository will not contain Python source code or embedded inference implementations. Instead, this repository owns:
1. Browser camera capture interface.
2. Socket.IO signaling server.
3. Access-controlled room management (1-sender, 1-receiver model).
4. WebRTC session negotiation and ICE routing.
5. Optional HTTP MJPEG stream endpoint.
6. Formal specification of the external receiver signaling contract.

The Python `aiortc` receiver and computer vision/YOLO pipeline are maintained in an external, independent repository.

**Reasoning:** Maintains clean architectural boundaries, zero Python dependency on the Node.js host, and allows the external receiver to evolve independently.

## ADR-012 — Support Two Selectable Media Transport Modes (WebRTC vs Experimental zrok Tunnel Relay)

**Status:** Accepted

**Decision:** The application provides two explicit, selectable media transport modes:
1. **Mode A (WebRTC — Direct/ICE media)**: Default peer-to-peer media stream for low-latency browser streaming.
2. **Mode B (Experimental — Video through zrok)**: Deliberate application-level relay. Sender encodes downscaled JPEG frames (default 640x360 @ 10 FPS, Q=0.6) into binary buffers sent over Socket.IO (`tunnel:frame`). The Windows Node.js server validates magic bytes, enforces backpressure frame drops, and forwards raw binary buffers to the authorized viewer.

**Reasoning:** The user selected zrok as the primary tunnel provider to experiment with video streaming through zrok's free daily quota (5 GB daily transfer), comparing direct WebRTC vs tunneled application relay under real network conditions.

**Consequences:** Both sender and viewer must agree on the room's media mode. Mismatched joins are rejected. Server memory is protected with strict frame size bounds (<=600KB) and rate-limiting backpressure drop logic. No Base64 encoding is used.

## ADR-013 — WebRTC LAN Connectivity Diagnosis, Candidate Queueing, and Mode B Fallback

**Status:** Accepted

**Decision:**
1. Implement early remote ICE candidate queuing (`pendingRemoteCandidates`) and pre-fetched ICE configuration on both the sender and viewer clients to prevent silent candidate loss during SDP negotiation.
2. Provide verbose real-time diagnostic logging on both client interfaces, parsing all candidate types (HOST, SRFLX, RELAY, mDNS), protocols, addresses, gathering states, signaling states, candidate errors, and active candidate-pair RTT statistics.
3. When ICE connection fails on a LAN with zrok, the client displays a targeted diagnosis and prompts the user to switch to **Mode B (Experimental zrok Tunnel Relay)**.

**Reasoning:**
When connecting Windows and Android on the same Wi-Fi network through a public zrok tunnel:
- Windows-to-Windows across different networks succeeds because distinct public IPs allow direct STUN server-reflexive (`srflx`) hole punching.
- Windows-to-Android on the same Wi-Fi often fails direct WebRTC because:
  - Android Chrome obfuscates private IPs with mDNS (`<uuid>.local`), which Windows cannot resolve if the router blocks multicast (AP isolation / IGMP filtering) or if Windows Firewall blocks incoming mDNS.
  - When falling back to STUN `srflx`, both devices share the exact same router public WAN IP. If the router does not support NAT loopback (hairpinning), UDP packets addressed from inside the LAN to the router's own WAN IP are dropped.
  - Early candidates were previously dropped if they arrived over Socket.IO while the client was performing an asynchronous HTTP fetch of `/api/config`.
  - Windows Defender Firewall classifies Wi-Fi as "Public" by default and drops incoming UDP hole-punch packets.

**Consequences:**
Eliminating candidate drops ensures all candidate pairs are evaluated. Detailed diagnostic logging enables the operator to immediately verify whether HOST or SRFLX candidates are gathered and which pairs fail. Mode B provides an immediate 100% reliable fallback on networks where router NAT hairpinning or firewall policies prevent direct WebRTC UDP peer connections.

## ADR-014 — Native Full Sensor Camera Resolution and Clean zrok Cloud Endpoint Deallocation

**Status:** Accepted

**Decision:**
1. Allow the sender client to request the full native maximum resolution supported by the device camera sensor (using unconstrained ideal constraints `width: { ideal: 4096 }, height: { ideal: 2160 }`), while providing user-selectable capture tiers (Max Full Sensor, 1080p, 720p, 480p).
2. Allow Mode B (Tunnel Relay) to stream at full native camera resolution without downscaling when requested.
3. Bind the public zrok tunnel explicitly to the reserved name `public:lan` (`zrok2 share public <target> -n public:lan`), ensuring the public URL is always predictable (`https://lan.shares.zrok.io`) and matches the generated terminal QR code.
4. Execute pre-flight and post-flight cloud deallocation (`zrok2 delete share public:lan` and token cleanup) in `start.ps1` to prevent ghost share bindings from persisting on the zrok web console dashboard.

**Reasoning:**
- Mobile phones feature high-resolution 1080p and 4K camera sensors. Previously hardcoding `1280x720` artificially degraded image quality for both WebRTC and computer vision inference.
- Previously, randomly generated ephemeral shares without explicit namespace name attachment left dangling bindings in the zrok controller when terminated via SIGINT/Ctrl+C, causing the zrok web dashboard to show stale targets and generating QR codes with outdated URLs from older runs.

**Consequences:**
High-resolution camera sensors operate at their full optical fidelity. The terminal QR code reliably opens `https://lan.shares.zrok.io/sender`. Terminating `start.ps1` immediately releases the endpoint from the zrok cloud controller.

## Open decisions to revisit after the first working stream

- Whether TypeScript should replace plain JavaScript for stricter types.
- Whether the app needs multiple simultaneous viewers or camera sources.
- Whether TURN should be operated locally, on a server, or not at all for the intended networks.
- Whether audio is required.
- Whether the final deployment should use a trusted local CA/local DNS or continue using a tunnel.
- What latency and quality targets the real deployment must meet, based on measurements from the target devices and Wi-Fi.
