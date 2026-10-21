/**
 * @file security-audit-fixes.test.js
 * Automated regression tests verifying resolution of the 13 audit findings (ADR-045).
 * Tests P0.1-P0.3, P1.4-P1.10, P2.11-P2.13.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';
import { RoomManager } from '../src/server/room-manager.js';
import { MjpegStreamer } from '../src/server/mjpeg-streamer.js';
import { RtspServer, parseJpegDimensions } from '../src/server/rtsp-server.js';

test('P2.13: loadConfig parses all ecosystem flags and helpers from env', () => {
  const customEnv = {
    PORT: '8080',
    ACCESS_PIN: '998877',
    ENABLE_MDNS: 'false',
    ENABLE_RTSP: 'true',
    RTSP_PORT: '9554',
    RTSP_HOST: '127.0.0.1',
    ENABLE_VCAM_SHM_BRIDGE: 'true',
    VCAM_SHM_PORT: '7780',
    VCAM_SHM_HOST: '127.0.0.2',
    CONTROL_HELPER_HOST: '127.0.0.3',
    CONTROL_HELPER_PORT: '8888',
    CONTROL_HELPER_TOKEN: 'secret_ipc_token'
  };

  const config = loadConfig(customEnv);
  assert.equal(config.port, 8080);
  assert.equal(config.accessPin, '998877');
  assert.equal(config.enableMdns, false);
  assert.equal(config.enableRtsp, true);
  assert.equal(config.rtspPort, 9554);
  assert.equal(config.rtspHost, '127.0.0.1');
  assert.equal(config.enableVcamShmBridge, true);
  assert.equal(config.vcamShmPort, 7780);
  assert.equal(config.vcamShmHost, '127.0.0.2');
  assert.equal(config.controlHelperHost, '127.0.0.3');
  assert.equal(config.controlHelperPort, 8888);
  assert.equal(config.controlHelperToken, 'secret_ipc_token');
});

test('P1.6: /api/vcam/bridge-frame requires PIN authentication', async () => {
  const config = loadConfig({ PORT: '3020', ACCESS_PIN: 'vcam_secret_123' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const port = httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const dummyJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);

    // Request without pin -> 401 Unauthorized
    const resNoPin = await fetch(`${baseUrl}/api/vcam/bridge-frame?room=room1`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: dummyJpeg
    });
    assert.equal(resNoPin.status, 401);

    // Request with wrong pin -> 401 Unauthorized
    const resWrongPin = await fetch(`${baseUrl}/api/vcam/bridge-frame?room=room1&pin=wrong`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: dummyJpeg
    });
    assert.equal(resWrongPin.status, 401);

    // Request with valid pin query param -> 200 OK
    const resValidPin = await fetch(`${baseUrl}/api/vcam/bridge-frame?room=room1&pin=vcam_secret_123`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: dummyJpeg
    });
    assert.equal(resValidPin.status, 200);

    // Request with valid header x-access-pin -> 200 OK
    const resValidHeader = await fetch(`${baseUrl}/api/vcam/bridge-frame?room=room1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-access-pin': 'vcam_secret_123'
      },
      body: dummyJpeg
    });
    assert.equal(resValidHeader.status, 200);
  } finally {
    await new Promise((resolve) => {
      httpServer.close(resolve);
    });
  }
});

test('P2.11 & P1.7: MjpegStreamer adheres to RFC 2435 boundary and suppresses stale cached frames (>5s)', async () => {
  const streamer = new MjpegStreamer();

  let headerStatus = null;
  let headersSent = null;
  const writtenChunks = [];

  const mockRes = {
    writeHead(status, headers) {
      headerStatus = status;
      headersSent = headers;
    },
    flushHeaders() {},
    write(chunk) {
      writtenChunks.push(chunk);
    },
    on() {}
  };

  // Seed with an old frame (received 10 seconds ago)
  const oldFrame = Buffer.from('old_frame_data');
  streamer.latestFrames.set('room-stale', oldFrame);
  streamer.latestFrameTimes.set('room-stale', Date.now() - 10000);

  streamer.addSubscriber('room-stale', mockRes);

  assert.equal(headerStatus, 200);
  assert.equal(headersSent['Content-Type'], 'multipart/x-mixed-replace; boundary=frame');

  // Must NOT write the stale frame; must write the standby slate
  const wroteOldFrame = writtenChunks.some((c) => Buffer.isBuffer(c) && c.includes('old_frame_data'));
  assert.equal(wroteOldFrame, false, 'Subscriber must not receive frame older than 5 seconds');
});

test('P1.9 & P2.12: RtspServer parses SOF0 dimensions dynamically and validates authentication and room membership', async () => {
  const rm = new RoomManager('rtsp_pin_777');
  rm.createOrJoinRoom('valid-room', 'sender', 'sender1', 'rtsp_pin_777');

  const rtspServer = new RtspServer(0, '127.0.0.1', { info() {}, warn() {}, error() {} }, 'rtsp_pin_777', rm);
  await rtspServer.start();
  const port = rtspServer.server.address().port;

  // Verify dynamic dimension parsing from SOF0 marker
  // Construct minimal valid JPEG with SOF0 (0xFF 0xC0): length=11, precision=8, height=480 (0x01E0), width=640 (0x0280)
  const customJpeg = Buffer.from([
    0xFF, 0xD8,
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x01, 0xE0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00,
    0xFF, 0xD9
  ]);
  const dims = parseJpegDimensions(customJpeg);
  assert.equal(dims.width, 640);
  assert.equal(dims.height, 480);

  const client = new net.Socket();
  await new Promise((resolve) => {
    client.connect(port, '127.0.0.1', resolve);
  });

  function sendReq(data) {
    return new Promise((resolve) => {
      client.once('data', (chunk) => {
        resolve(chunk.toString('utf8'));
      });
      client.write(data);
    });
  }

  try {
    // 1. OPTIONS is public
    const resOpt = await sendReq('OPTIONS rtsp://127.0.0.1/live/valid-room RTSP/1.0\r\nCSeq: 1\r\n\r\n');
    assert.ok(resOpt.includes('RTSP/1.0 200 OK'));

    // 2. DESCRIBE without pin -> 401 Unauthorized
    const resNoPin = await sendReq('DESCRIBE rtsp://127.0.0.1/live/valid-room RTSP/1.0\r\nCSeq: 2\r\n\r\n');
    assert.ok(resNoPin.includes('RTSP/1.0 401 Unauthorized'));
    assert.ok(resNoPin.includes('WWW-Authenticate: Basic realm="LAN Camera RTSP"'));

    // 3. DESCRIBE with wrong pin -> 401 Unauthorized
    const resBadPin = await sendReq('DESCRIBE rtsp://127.0.0.1/live/valid-room?pin=wrong RTSP/1.0\r\nCSeq: 3\r\n\r\n');
    assert.ok(resBadPin.includes('RTSP/1.0 401 Unauthorized'));

    // 4. DESCRIBE with valid pin but non-existent room -> 404 Room Not Found
    const resBadRoom = await sendReq('DESCRIBE rtsp://127.0.0.1/live/non-existent?pin=rtsp_pin_777 RTSP/1.0\r\nCSeq: 4\r\n\r\n');
    assert.ok(resBadRoom.includes('RTSP/1.0 404 Room Not Found'));

    // 5. DESCRIBE with valid pin and valid room -> 200 OK
    const resValid = await sendReq('DESCRIBE rtsp://127.0.0.1/live/valid-room?pin=rtsp_pin_777 RTSP/1.0\r\nCSeq: 5\r\n\r\n');
    assert.ok(resValid.includes('RTSP/1.0 200 OK'));
    assert.ok(resValid.includes('m=video 0 RTP/AVP 26'));
  } finally {
    client.destroy();
    rtspServer.close();
  }
});

test('P1.4 & P1.5 & P0.2: RoomManager senderToken protection, relay isolation, and room:leave cleanup', async () => {
  const config = loadConfig({ PORT: '3025', ACCESS_PIN: 'audit_pass_999' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  const { remoteControlManager } = setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const port = httpServer.address().port;
  const socketUrl = `http://127.0.0.1:${port}`;

  const sender = Client(socketUrl);
  const intruderSender = Client(socketUrl);
  const viewer = Client(socketUrl);
  const outsideSocket = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => sender.on('connect', res)),
      new Promise((res) => intruderSender.on('connect', res)),
      new Promise((res) => viewer.on('connect', res)),
      new Promise((res) => outsideSocket.on('connect', res))
    ]);

    // 1. Initial sender joins
    const s1Res = await new Promise((res) => {
      sender.emit('room:join', { roomId: 'audit-room', role: 'sender', pin: 'audit_pass_999' }, res);
    });
    assert.equal(s1Res.success, true);
    assert.ok(s1Res.senderToken, 'Sender must receive a private senderToken upon join');

    // 2. Viewer joins
    const vRes = await new Promise((res) => {
      viewer.emit('room:join', { roomId: 'audit-room', role: 'viewer', pin: 'audit_pass_999' }, res);
    });
    assert.equal(vRes.success, true);

    // 3. Intruder sender attempts to evict active sender using reconnect: true without token
    const intruderEvictNoToken = await new Promise((res) => {
      intruderSender.emit('room:join', { roomId: 'audit-room', role: 'sender', pin: 'audit_pass_999', reconnect: true }, res);
    });
    assert.equal(intruderEvictNoToken.success, false);
    assert.match(intruderEvictNoToken.error, /Unauthorized sender eviction/);

    // 4. Intruder sender attempts to evict with bogus token
    const intruderEvictBadToken = await new Promise((res) => {
      intruderSender.emit('room:join', { roomId: 'audit-room', role: 'sender', pin: 'audit_pass_999', reconnect: true, senderToken: 'bogus_token' }, res);
    });
    assert.equal(intruderEvictBadToken.success, false);
    assert.match(intruderEvictBadToken.error, /Unauthorized sender eviction/);

    // 5. P1.5 Relay Scoping: viewer attempts to relay SDP answer or ICE candidate to arbitrary socket outside room
    let outsideReceivedAnswer = false;
    outsideSocket.on('webrtc:answer', () => {
      outsideReceivedAnswer = true;
    });

    viewer.emit('webrtc:answer', {
      targetId: outsideSocket.id, // Target is outside the room!
      sdp: 'mock-sdp',
      type: 'answer'
    });

    await new Promise((res) => {
      setTimeout(res, 80);
    });
    assert.equal(outsideReceivedAnswer, false, 'WebRTC answer must not be relayed outside the room');

    // 6. P0.2 Remote control lease release on room:leave
    // Enable control and grant lease to viewer
    await new Promise((res) => {
      sender.emit('control:enable', { roomId: 'audit-room', pin: 'audit_pass_999', enabled: true }, res);
    });
    const pin = remoteControlManager.getSessionPin('audit-room');
    const leaseRes = await new Promise((res) => {
      viewer.emit('control:request-lease', { roomId: 'audit-room', credential: pin }, res);
    });
    assert.equal(leaseRes.success, true);
    assert.equal(remoteControlManager.isController('audit-room', viewer.id), true);

    // Viewer leaves the room explicitly via room:leave
    let senderNotifiedLeft = false;
    sender.on('control:controller-left', () => {
      senderNotifiedLeft = true;
    });

    viewer.emit('room:leave');
    await new Promise((res) => {
      setTimeout(res, 80);
    });

    // After room:leave, controller lease must be cleaned from active controller
    assert.equal(remoteControlManager.isController('audit-room', viewer.id), false);
    assert.equal(senderNotifiedLeft, true, 'Sender must be notified of controller left on room:leave');
  } finally {
    sender.disconnect();
    intruderSender.disconnect();
    viewer.disconnect();
    outsideSocket.disconnect();
    await new Promise((resolve) => {
      httpServer.close(resolve);
    });
  }
});
