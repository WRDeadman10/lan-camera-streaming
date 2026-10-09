# LAN Camera Streaming — Project Overview

## 1. Purpose

Build a small self-hosted web application that lets a phone, tablet, or laptop share its camera through a browser URL, then lets another browser watch the live feed. The initial target is devices on the same local area network (LAN), with an optional HTTPS tunnel for convenient access during development or when a trusted local HTTPS setup is not yet available.

No native mobile app is required. Users open a web page, grant camera permission, and explicitly start or stop streaming.

## 2. Primary user flow

1. Start the application on a Windows PC.
2. Open the host's HTTPS URL on the camera device and navigate to the sender page.
3. Enter or create a room/pairing code, grant camera permission, and click **Start streaming**.
4. Open the viewer page on the receiving device and join the same room.
5. Watch the live feed. The sender can stop sharing at any time.

For the first milestone, support one sender and one viewer. Multi-camera and multi-viewer support can follow after the basic connection is reliable.

## 3. Goals

- Run the signaling/web application on a Windows PC.
- Let modern mobile and desktop browsers capture a camera after an explicit user action.
- Transport real-time video using WebRTC rather than forwarding video frames through ordinary HTTP requests or Socket.IO messages.
- Use Socket.IO for room coordination and WebRTC signaling.
- Work well on the same Wi-Fi/LAN, preferring a direct peer-to-peer media path.
- Support a tunnel such as ngrok or zrok as an optional way to expose the HTTPS web application during development.
- Make stream state visible: waiting, connecting, live, disconnected, and stopped.
- Avoid recording, storing, or uploading video to a cloud service in the MVP.

## 4. Non-goals for the MVP

- Native iOS, Android, Windows, or macOS applications.
- Cloud video storage or recording.
- Video transcoding or an always-on media server.
- Guaranteed internet-wide connectivity without TURN configuration.
- Multiple senders in one room, group calls, or many concurrent viewers.
- User accounts, billing, or a public multi-tenant service.

## 5. Proposed technology

| Area | Choice | Responsibility |
|---|---|---|
| Runtime | Node.js | Runs the server on Windows |
| HTTP server | Express | Serves the web pages, static assets, and optional MJPEG stream |
| Signaling | Socket.IO | Room membership and WebRTC offer/answer/ICE exchange |
| Camera capture | Browser `getUserMedia()` | Requests permission and captures local camera stream |
| Browser media transport | WebRTC | Direct peer-to-peer live video between sender and receiver |
| External integration | Socket.IO WebRTC & HTTP MJPEG | Versioned contract for external clients (e.g. Python OpenCV / YOLO) |
| UI | HTML, CSS, browser JavaScript | Responsive sender and viewer interfaces |
| HTTPS / Tunnel | zrok or ngrok | Provides browser-trusted HTTPS entry point to the local web server |
| Media fallback | TURN server, if later required | Relays media when direct ICE connectivity cannot be established |

Use one tunnel provider at a time. The tunnel is for serving the site and signaling, not the normal video path.

## 6. Network and privacy model

- Preferred media path: sender browser directly to viewer browser over the LAN using WebRTC.
- If the devices are not on the same reachable network, WebRTC may establish another direct path; it is not guaranteed.
- If direct connectivity fails, a configured TURN server may relay media. TURN bandwidth is separate from web/signaling traffic and can add latency.
- A public tunnel URL can make the web application reachable beyond the LAN. Treat it as public: require a pairing secret or PIN, validate room membership on the server, and do not expose administrative operations without authorization.
- Do not forward router ports as part of the MVP.
- Camera capture must begin only after the user explicitly clicks the start control. Stop all media tracks when streaming ends or the page is closed.
- The MVP does not save video to disk or send it to an application server for storage.

## 7. HTTPS requirement

Browser camera access generally requires a secure context. `localhost` is treated specially by browsers, but another device visiting a Windows PC's private IP over plain HTTP typically is not. Use a valid HTTPS origin for the sender page. A tunnel can provide convenient HTTPS for initial testing; for LAN-only deployment, a locally trusted certificate/CA is an alternative.

## 8. Initial scope and provisional targets

- One camera sender and one viewer.
- Video only; audio is disabled unless explicitly added later.
- Target 720p at 30 FPS where the camera and browser support it. Actual resolution and frame rate must be read from the negotiated stream and measured rather than assumed.
- Test a 10-minute session on the same Wi-Fi without manual reconnection.
- Record observed connection setup time, frame rate, resolution, and end-to-end latency during testing. A sub-500 ms end-to-end latency target may be used as an initial LAN benchmark, not as a cross-network guarantee.

## 9. Definition of MVP complete

- A Windows host can be started using documented commands.
- Sender and viewer pages load over a camera-permission-compatible HTTPS origin.
- A sender can grant permission, start, and stop its camera.
- One viewer can join the same room and receive live video through WebRTC.
- The app exposes useful connection status and handles normal disconnects without silently remaining in a false `Live` state.
- The media path has been verified to be direct on the test LAN where possible; any TURN relay use is visible in diagnostics or test notes.
- A pairing code/token prevents an arbitrary visitor from joining a stream merely by discovering the public URL.
- The limitations and setup steps are documented.
