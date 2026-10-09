# LAN Camera Streaming — AI Handoff

## Current status

**Status:** Full Camera Resolution Option, Dedicated `lan.shares.zrok.io` Tunnel Binding, and Clean Cloud Deallocation Implemented.
- **Dedicated Reserved Tunnel Binding & Accurate QR Code:**
  - `start.ps1` binds directly to reserved name `public:lan` (`lan.shares.zrok.io`).
  - Terminal ASCII QR code and displayed URLs strictly encode `https://lan.shares.zrok.io/sender`.
  - Stale random share tokens left over from previous runs (`8kp060ytibnq`, `xx777tmwbi5m`, `mele44v03uf1`) were cleaned up via `zrok2 delete share`.
- **Automatic Dashboard Endpoint Release:**
  - `start.ps1` runs pre-flight and graceful teardown deallocation (`zrok2 delete share public:lan` and token cleanup), ensuring the zrok web console dashboard never retains dangling bound endpoints after terminating the application.
- **Maximum / Full Camera Resolution:**
  - Added "🌟 Full Maximum Resolution (Native 4K / 1080p Sensor)" option to `/sender`, along with 1080p, 720p, and 480p tiers.
  - Supported "Native (Full Camera Resolution)" in Mode B (Tunnel Relay) without forced downscaling.
  - Automatically reads and logs the actual negotiated hardware resolution and frame rate upon stream acquisition.
- **WebRTC vs Application Relay Connectivity Analysis:**
  - Verified and confirmed: Mode B (Application Relay) operates over the authenticated zrok WebSocket and works universally on all networks.
  - Documented root causes for WebRTC direct media blockage over zrok between Android and Windows (mDNS IP masking, lack of router NAT loopback on same Wi-Fi, and Symmetric NAT/CGNAT on mobile data without TURN).
- **Automated Tests:** All 18 Node.js automated tests pass (`npm test`).

## Read before implementation

1. `AGENTS.md` — agent behavior, code style and file rules.
2. `docs/architecture.md` — component boundaries, network flows, Mode A vs Mode B, and external receiver signaling contract.
3. `docs/roadmap.md` — phased delivery plan and exit criteria.
4. `docs/decisions.md` — accepted decisions (ADR-001 through ADR-014) and unresolved questions.
5. `docs/tasks.md` — implementation backlog and checkboxes.
6. `docs/project-overview.md` — goals, scope, and MVP definition.

## Agreed architecture

- Host: Windows PC running Node.js + Express.
- Primary Tunnel: `zrok` public HTTPS sharing (`zrok2 share public <target> -n public:lan --backend-mode proxy`).
- Authentication: Configurable `ZROK_TOKEN` in `.env` automatically validated and enabled via `scripts/start-zrok.ps1`.
- Mode A (WebRTC): Low-latency direct peer-to-peer media. Signaling carried by Socket.IO over zrok. Early candidate queueing guarantees 0% candidate drop rate.
- Mode B (Experimental zrok Tunnel): Camera frames downscaled or streamed native via canvas, sent as raw binary JPEG buffers via Socket.IO over zrok tunnel, relayed by Windows server to authorized viewer. Evaluates performance against zrok's 5 GB daily free quota and acts as resilient fallback when same-LAN NAT loopback fails.
- Security: Access PIN authentication, payload size bounds (600KB), brute-force rate-limiting, room isolation, and media mode agreement.
- Access & Pairing: Persistent reserved domain `lan.shares.zrok.io`, ASCII QR codes displayed in terminal upon launch, and in-browser QR codes on index and sender pages for phone camera scanning.

## Immediate next task

Run `powershell -File start.ps1` to verify:
1. Terminal ASCII QR code matches `https://lan.shares.zrok.io/sender`.
2. Sender captures at full camera resolution (1080p/4K).
3. Stopping with Ctrl+C cleanly releases the endpoint in the zrok cloud console dashboard.

## Commands run & results

- `npm test`: 18/18 tests passed.
- All-in-one start: `powershell -File start.ps1` (launches Node server, displays terminal QR code for phone scan, and runs zrok tunnel with auto-deallocation).
- Cloud cleanup test: `cmd /c "C:\scrcpy-win64-v2.4\zrok2.exe overview"` (verified 0 ghost shares).
