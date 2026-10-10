# LAN Camera Streaming — Receiver Guide (any language, any engine)

This project is the **camera source and signaling server**. It does not care what consumes the video: a browser
viewer, a Python/OpenCV/YOLO script, a Unity or Unreal app, a Go or Rust service, `ffmpeg`. Anything that can speak
**HTTP + Socket.IO** (and, for the low-latency path, **WebRTC**) can be a receiver.

This guide is the technology-neutral contract and the lessons that cost time. The formal event schemas are in
[`architecture.md` §4](architecture.md#4-external-webrtc-receiver-signaling-contract-version-10); this file tells you
how to *use* them and where receivers go wrong. Nothing here needs a change to the server.

---

## 1. Pick a transport

| | **WebRTC** (recommended) | **MJPEG over HTTP** | **Tunnel relay** (Mode B) |
|---|---|---|---|
| How you get frames | A WebRTC video track, peer-to-peer | `GET /stream/<room>?pin=<pin>`, a multipart stream of JPEGs | `tunnel:frame` Socket.IO events carrying JPEG buffers |
| Latency | Lowest (hundreds of ms or less on a LAN) | Higher; JPEG per frame through the server | Highest; through the server and any tunnel |
| What you need | Socket.IO client **and** a WebRTC stack | An HTTP client; OpenCV/ffmpeg/browsers read it directly | A Socket.IO client and a JPEG decoder |
| Goes through the server/tunnel? | Only signaling. Media is UDP and never crosses a zrok share | Yes, every frame | Yes, every frame |
| Joins the room? | Yes (`webrtc-receiver`) | No | Yes (`webrtc-receiver`, `mediaMode: "tunnel-relay"`) |
| Use it when | You can run a WebRTC stack and the network allows UDP between the devices | You want the simplest possible receiver, or WebRTC is blocked | WebRTC cannot connect and you accept the tunnel quota |

**MJPEG and tunnel relay spend tunnel (zrok) quota for as long as they run.** Connecting to `localhost` instead of the
tunnel URL avoids that for MJPEG when the receiver runs on the server's PC.

---

## 2. Quick reference

| Thing | Value |
|---|---|
| Base URL | `http(s)://<host>:<port>` or the tunnel URL. Socket.IO and the API live at the **root**; there is no path prefix |
| Socket.IO | Protocol v4, default namespace `/`. Use the websocket transport; polling is a fallback |
| ICE servers | `GET /api/config` -> `{ "iceServers": [ { "urls": [...] }, { "urls": [...], "username": "...", "credential": "..." } ] }` |
| Auth | The access PIN (`ACCESS_PIN` in the server `.env`, at least 4 characters), sent in `room:join`, or as `?pin=` for MJPEG |
| Room id | `^[a-zA-Z0-9_-]{3,32}$` |
| Role for a receiver | `webrtc-receiver` (the server normalises it to `viewer`; `viewer` is accepted too) |
| Capacity | **One sender and one viewer/receiver per room.** A browser viewer in the room blocks your receiver, and the reverse |
| Viewer link a user sees | `http(s)://<host>/viewer?room=<room id>` (no PIN in it) |

Events a receiver uses: `room:join` (with ack), `peer:joined`, `webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`,
`stream:state`, `peer:left`, `room:error`, `room:leave`, and `tunnel:frame` (relay mode only).

---

## 3. The WebRTC sequence

```text
receiver                         server                          sender (the phone's browser page)
   | GET /api/config                |                                  |
   |------------------------------->|                                  |
   | Socket.IO connect              |                                  |
   |------------------------------->|                                  |
   | room:join {roomId, role:"webrtc-receiver", pin, mediaMode:"webrtc"} (ack)
   |------------------------------->|  ack {success, hasPeer, peerSocketId, mediaMode}
   |<-------------------------------|                                  |
   |                                | peer:joined  (to whoever was already there)
   |                                |--------------------------------->|   (or the sender joins later and learns
   |                                |                                  |    the viewer is there from hasPeer)
   |                                |            webrtc:offer {sdp,type}  <- THE SENDER CREATES THE OFFER
   |<--------------- webrtc:offer {sdp, type:"offer", senderId} -------|
   | setRemote, createAnswer, setLocal                                  |
   | webrtc:answer {sdp, type:"answer"} ------------------------------->|
   |<------------- webrtc:ice-candidate {candidate, sdpMid, sdpMLineIndex} (sender trickles, after its offer)
   |==================== media (UDP, peer to peer) ====================>|
   |<--------------- stream:state {state:"live"} ----------------------|
```

1. **Read `/api/config`** and build your peer connection's ICE configuration from it. If the request fails, fall back
   to a public STUN server. A TURN entry, when the server has one, comes through here.
2. **Connect** Socket.IO to the base URL.
3. **On every `connect` event, including automatic reconnects, emit `room:join`.** The server drops a socket's room
   membership when it disconnects, so a receiver that joins once and then reconnects is silently out of the room.
4. **Check the ack.** `success: false` carries an `error` string (section 5).
5. **Wait for the offer.** The sender creates it. Create a **new** peer connection for every `webrtc:offer` and close the
   previous one: the sender may leave and come back, and each time it sends a fresh offer.
6. **Apply it and answer.** Set the remote description, create the answer, set it locally, emit `webrtc:answer`
   (`{ sdp, type: "answer" }`). There is no target id: the server relays only between the room's two participants.
7. **Handle candidates.** The sender trickles `webrtc:ice-candidate` events **after** its offer, and they can arrive
   *before you have finished applying the offer*. Queue them and apply them once the remote description is set.
   `candidate` is a string like `candidate:842163049 1 udp 1677729535 ...`; an **empty string** means
   end-of-candidates and is ignored. Wrap each add in a try/catch: a candidate with an mDNS `.local` host may not
   resolve for you, and one bad candidate must not end the session.
8. **Receivers that do not trickle** (for example `aiortc`) put their candidates inside the answer SDP, so there is
   nothing to emit on `webrtc:ice-candidate`. That is fine.
9. **`peer:left`** means the sender went away. Close the peer connection and wait for the next offer.
10. **On shutdown** emit `room:leave`, close the peer connection, disconnect the socket.

The offer contains **one video m-line and no audio.**

### Start order does not matter
The receiver may join before or after the sender. If the receiver joins first, the sender gets `hasPeer: true` in its
own join ack and creates the offer; if the sender is already there, it gets `peer:joined` and does the same.

---

## 4. MJPEG and tunnel relay

### MJPEG: `GET /stream/<room>?pin=<pin>`
* `401` for a missing or wrong PIN. Nothing else is needed: **it does not join the room**, so it does not conflict with
  a browser viewer.
* The response is `multipart/x-mixed-replace`. Each part has `Content-Type: image/jpeg` and a `Content-Length`.
* **The delimiter quirk:** the header says `boundary=--frame` and the server writes `--frame` before each part, which
  is *not* what the multipart RFC would produce (`----frame`). OpenCV and ffmpeg cope. A hand-written or strict
  multipart parser should key on the `Content-Length` of each part rather than on the boundary string.
* **Frames only flow while a consumer is connected.** The server tells the sender (`mjpeg:demand`) when the first
  consumer connects, and the sender uploads JPEGs only then. Opening the stream before the sender is streaming is fine:
  frames start when it does.
* The PIN is in the query string, so it is in the URL. Do not log that URL.
* `GET /snapshot/<room>?pin=<pin>` returns one fresh JPEG.

### Tunnel relay
Join with `mediaMode: "tunnel-relay"`. **The room's mode is fixed by whoever created it**: a receiver joining with
the other mode is refused (`Media mode mismatch`). Frames arrive as binary JPEG buffers on the `tunnel:frame` event
(at most about 600 KB and 30 fps; the server drops the excess).

---

## 5. Errors and limits

| Ack `error` | Meaning | Retry? |
|---|---|---|
| `Invalid access PIN` | Wrong PIN | No. It cannot succeed |
| `Invalid Room ID. Must be 3-32 alphanumeric characters.` | Room id fails the pattern | No |
| `Invalid role. ...` | Not `webrtc-receiver`/`viewer`/`sender`/`camera-sender` | No |
| `Media mode mismatch. This room is configured for "<mode>" mode.` | Wrong `mediaMode` for this room | No |
| `Room already has an active viewer/receiver.` | Someone else is the viewer (often a **browser tab**) | **Yes**, it clears when they leave. Also happens briefly after *your own* reconnect, until the server notices your old socket is gone |
| `Too many failed attempts. Please wait N seconds before retrying.` | 5 failed joins on one socket: blocked for 30 s | Yes, after N seconds |
| `Internal server error` | Server fault | Yes |

* **Retry spacing:** five refusals in a row block that socket for 30 seconds, so retrying faster than every ~10 seconds
  only lengthens the wait.
* A receiver that exits on every refusal turns a wrong PIN into a restart loop in whatever supervises it. Treat the
  non-retryable errors as fatal and say why in one line.
* **Never print or log the PIN**, and never put it on a command line (other processes can read command lines).
  Environment variables or a secrets store are better.

---

## 6. When WebRTC will not connect

Media is peer to peer over UDP. If signaling works but no video arrives, ICE failed. Likely causes, in order:

1. **Router "client isolation" / guest network** blocks phone-to-PC traffic. The most common cause on a shared Wi-Fi.
2. **Windows Firewall** blocks inbound UDP for the receiving program, or the Wi-Fi profile is *Public*.
3. **A VPN or virtual adapter** hides the real LAN route.
4. **The phone is on another network** and the server has no TURN entry (`TURN_SERVERS` in its `.env`).

A zrok tunnel carries only the page and the signaling; it cannot carry WebRTC media. Over a tunnel, WebRTC works only
if the two devices can still reach each other directly or through TURN. Last resort: MJPEG or tunnel relay, which do
go through the tunnel.

Log the **candidate types** of the selected path (`host`, `srflx`, `relay`) if your stack exposes them, and never their
addresses: it tells you whether you are direct or relayed without leaking the network layout.

---

## 7. Receiver checklist (for a new integration)

- [ ] `/api/config` read, with a STUN fallback
- [ ] `room:join` emitted on **every** `connect`, with `mediaMode`, and the ack checked
- [ ] a **new** peer connection per `webrtc:offer`, the old one closed
- [ ] candidates **queued** until the remote description is set; empty candidate ignored; each add guarded
- [ ] `peer:left` closes the connection and waits for a new offer
- [ ] only the **newest** frame is kept for the consumer (a slow consumer must skip frames, not queue them, or latency
      grows without bound)
- [ ] a bound on closing the peer connection (some WebRTC stacks have been seen to hang in `close()` while ICE is
      still checking; unbounded, that blocks every later offer)
- [ ] a changing resolution is handled (a phone's WebRTC encoder adapts the resolution to the bandwidth)
- [ ] a portrait phone's frames may arrive **sideways**: not every stack applies the video-orientation header
- [ ] retry only the retryable errors; PIN never logged
- [ ] `room:leave` on shutdown

---

## 8. Libraries you could use (suggestions, not endorsements)

None of these were tried against this server except where stated.

| Need | Examples |
|---|---|
| Socket.IO client (v4) | `socket.io-client` (JavaScript), `python-socketio` (Python, **used and tested here**), a Socket.IO client for C#/.NET, Go, Rust |
| WebRTC | `aiortc` (Python, **used and tested here**), Pion (Go), `webrtc-rs` (Rust), the Unity WebRTC package, libwebrtc-based SDKs |
| MJPEG | OpenCV `VideoCapture`, `ffmpeg`, an `<img>` tag, any HTTP client |

A WebRTC stack that cannot reach a Socket.IO v4 server, or the reverse, is the usual blocker in a new language: check
both before starting.

---

## 9. Reference integration: the Viitorx Unity + Python sidecar

The first real receiver is the **Viitorx VRM mirror** (a Unity app with a Python pose-tracking sidecar). It treats this
server's phone as a webcam: the sidecar joins the room as the receiver, takes the newest frame, runs the pose model on
it and sends the result to Unity over UDP.

**What you do**
1. Start this server (`powershell -File start.ps1`) and open the **sender** page on the phone; press start.
2. In Unity, on `AppBootstrap` > `Video Test Source`: tick **Track From Video**, paste the **viewer** link
   (`http(s)://<host>/viewer?room=<id>`) into **Video Source**, type the server's `ACCESS_PIN` into **Lan Camera Pin**.
3. Press Play. Close any browser viewer in that room first (one viewer only).

**Rules it follows from this guide**
* The viewer link is recognised by its `/viewer?room=` shape; a link that contains `pin=` is **refused**.
* The PIN travels in the `CAMERA_PIN` environment variable of the sidecar process, never in the link or on a command line.
* `room:join` on every connect; a new peer connection per offer; candidates queued; only the newest frame kept; a
  wrong PIN is fatal (one line, exit code 2) while an occupied room is retried.
* A mid-stream resolution change is detected and the pose crop re-derived; `RTCPeerConnection.close()` is bounded (3 s).
* **Status lights** in the Unity window (top right, F8 hides) show the sidecar, its watchdog, the source, the model and
  whether a person is being tracked, so a silent sidecar is not mistaken for a working one.

**Where the code is** (in the Viitorx repository): `python-sidecar~/tools/video/lan_camera.py` is the receiver, written
to this guide and usable on its own as a Python reference; `python-sidecar~/tests/test_lan_camera.py` drives **this**
Node server with a fake phone built on `aiortc` (set `CAMERA_SERVER_DIR` to this project's folder).

**Verified:** the WebRTC path against this server with an `aiortc` phone on loopback (frames, a phone that leaves and
returns, a socket drop, a wrong PIN, an occupied room, a slow consumer), and the full chain through the real pose model.
The MJPEG and tunnel-relay paths were verified with an earlier standalone Python receiver. **Not verified:** a real phone
and its browser sender page with an external receiver, real Wi-Fi/firewall behaviour, a zrok tunnel, the latency of a real
phone, and a receiver in any language other than Python.
