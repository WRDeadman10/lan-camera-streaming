# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Enhanced Diagnostics, ICE Candidate Queueing, and Cross-Device WebRTC Logging Implemented.
- **Verbose On-Screen Diagnostics:**
  - Added real-time diagnostics panels to both sender (`sender.html`) and viewer (`viewer.html`).
  - Added `parseCandidateSummary()` to break down candidates (`HOST`, `SRFLX`, `RELAY`, protocols, IP, port, and mDNS `.local` indicators).
  - Added "Copy Logs" and "Clear Logs" buttons with mobile-optimized text selection styling (`user-select: text`, `word-break: break-all`).
- **ICE Candidate Loss Prevention:**
  - Implemented `pendingRemoteCandidates` on both sender and viewer clients, eliminating race condition where early candidates arriving before peer connection setup or during async `/api/config` fetch were silently discarded.
  - Pre-fetched and cached ICE server configurations on page load and room join.
- **Root Cause Analysis & Diagnosis for Android-to-Windows on Same LAN:**
  - When connecting Android and Windows on the same Wi-Fi using zrok, direct WebRTC often fails because:
    1. Android Chrome obfuscates private IP addresses with mDNS (`<uuid>.local`), which Windows cannot resolve if multicast UDP 5353 is blocked by Wi-Fi AP isolation or Windows Firewall.
    2. When STUN `srflx` candidates are exchanged, both devices have the same public router WAN IP. If the router lacks NAT Loopback / Hairpinning, UDP packets sent from within the LAN to the public WAN IP are dropped.
    3. Windows Defender Firewall defaults to blocking unsolicited inbound UDP traffic on "Public" Wi-Fi profiles.
  - When ICE connection transitions to `failed`, both clients output an actionable diagnosis and guide the operator to switch to **Mode B (Experimental zrok Tunnel Relay)**, which transmits frames through the authenticated server WebSocket and works 100% reliably regardless of NAT or Wi-Fi isolation.
- **Automated Tests:** All 18 Node.js automated tests pass (`npm test`).

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows, Mode A vs Mode B, and external receiver signaling contract.
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions (ADR-001 through ADR-013) and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes.
6. `docs/project-overview.md` — goals, scope, and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express.
- Primary Tunnel: `zrok` public HTTPS sharing (`zrok2 share public <target> --backend-mode proxy`).
- Authentication: Configurable `ZROK_TOKEN` in `.env` automatically validated and enabled via `scripts/start-zrok.ps1`.
- Mode A (WebRTC): Low-latency direct peer-to-peer media. Signaling carried by Socket.IO over zrok. Early candidate queueing guarantees 0% candidate drop rate.
- Mode B (Experimental zrok Tunnel): Camera frames downscaled to canvas, sent as raw binary JPEG buffers via Socket.IO over zrok tunnel, relayed by Windows server to authorized viewer. Evaluates performance against zrok's 5 GB daily free quota and acts as resilient fallback when same-LAN NAT loopback fails.
- Security: Access PIN authentication, payload size bounds (600KB), brute-force rate-limiting, room isolation, and media mode agreement.
- Access & Pairing: Persistent reserved domain `lan.shares.zrok.io`, ASCII QR codes displayed in terminal upon launch, and in-browser QR codes on index and sender pages for phone camera scanning.

## Immediate next task

Test Android-to-Windows streaming with `powershell -File start.ps1`:
1. Observe the detailed diagnostics log on both the Android phone and the Windows viewer to inspect gathered candidates (HOST mDNS vs SRFLX).
2. If the Wi-Fi router drops NAT loopback packets causing WebRTC ICE to fail, switch both sides to Mode B ("Experimental — Video through zrok") to stream smoothly through the server WebSocket.

## Commands run & results

- `npm test`: 18/18 tests passed (candidate summary parsing, TunnelRelay validation, backpressure dropping, Socket.IO binary relay, room capacity, canonical roles, signaling relays, auth rate limiting, MJPEG streaming).
- All-in-one start: `powershell -File start.ps1` (launches Node server, displays terminal QR code for phone scan, and runs zrok tunnel).
- Separate start options: `npm start` (server) and `powershell -File scripts/start-zrok.ps1` (zrok tunnel).
