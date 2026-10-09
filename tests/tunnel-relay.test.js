/**
 * @file tunnel-relay.test.js
 * Unit and integration tests for TunnelRelay binary frame processing,
 * rate limiting backpressure drop, size limits, and Socket.IO tunnel:frame relay.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as Client } from 'socket.io-client';
import { TunnelRelay } from '../src/server/tunnel-relay.js';
import { setupSignaling } from '../src/server/signaling.js';

test('TunnelRelay rejects non-JPEG and oversized frames', () => {
  const relay = new TunnelRelay({ maxFrameSizeBytes: 1000, maxFps: 30 });

  // Empty data
  const emptyRes = relay.processIncomingFrame('room1', null);
  assert.equal(emptyRes.valid, false);

  // Non-JPEG buffer
  const badBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  const badRes = relay.processIncomingFrame('room1', badBuffer);
  assert.equal(badRes.valid, false);
  assert.match(badRes.reason, /magic bytes/);

  // Oversized JPEG
  const bigJpeg = Buffer.alloc(2000);
  bigJpeg[0] = 0xff;
  bigJpeg[1] = 0xd8;
  const bigRes = relay.processIncomingFrame('room1', bigJpeg);
  assert.equal(bigRes.valid, false);
  assert.match(bigRes.reason, /exceeds max size/);
});

test('TunnelRelay accepts valid JPEG buffer and applies backpressure drop on rapid frames', async () => {
  const relay = new TunnelRelay({ maxFrameSizeBytes: 10000, maxFps: 10 }); // min 100ms interval
  const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  // First frame should be accepted
  const res1 = relay.processIncomingFrame('room-test', validJpeg);
  assert.equal(res1.valid, true);
  assert.equal(res1.dropped, false);
  assert.equal(res1.buffer.length, 6);

  // Immediate second frame should be dropped due to frame interval threshold
  const res2 = relay.processIncomingFrame('room-test', validJpeg);
  assert.equal(res2.valid, true);
  assert.equal(res2.dropped, true);

  const stats = relay.getRoomStats('room-test');
  assert.equal(stats.totalFrames, 1);
  assert.equal(stats.droppedFrames, 1);
  assert.equal(stats.totalBytes, 6);

  // After interval passes, frame should be accepted again
  await new Promise((resolve) => setTimeout(resolve, 110));
  const res3 = relay.processIncomingFrame('room-test', validJpeg);
  assert.equal(res3.valid, true);
  assert.equal(res3.dropped, false);

  const statsAfter = relay.getRoomStats('room-test');
  assert.equal(statsAfter.totalFrames, 2);
});

test('Socket.IO relays binary tunnel:frame from sender to viewer in tunnel-relay mode', async () => {
  const server = http.createServer();
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const config = {
    accessPin: '654321',
    corsOrigin: '*'
  };

  const { io, roomManager } = setupSignaling(server, config, logger);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;

  const senderSocket = Client(serverUrl);
  const viewerSocket = Client(serverUrl);

  try {
    // 1. Join sender in tunnel-relay mode
    const senderJoinPromise = new Promise((resolve) => {
      senderSocket.on('connect', () => {
        senderSocket.emit('room:join', {
          roomId: 'tunnel-room-1',
          role: 'sender',
          pin: '654321',
          mediaMode: 'tunnel-relay'
        }, resolve);
      });
    });

    const senderJoinRes = await senderJoinPromise;
    assert.equal(senderJoinRes.success, true);
    assert.equal(senderJoinRes.mediaMode, 'tunnel-relay');

    // 2. Try joining viewer with mismatched mode (should be rejected)
    const viewerBadJoin = await new Promise((resolve) => {
      viewerSocket.emit('room:join', {
        roomId: 'tunnel-room-1',
        role: 'viewer',
        pin: '654321',
        mediaMode: 'webrtc'
      }, resolve);
    });
    assert.equal(viewerBadJoin.success, false);
    assert.match(viewerBadJoin.error, /Media mode mismatch/);

    // 3. Join viewer with matching mode
    const viewerGoodJoin = await new Promise((resolve) => {
      viewerSocket.emit('room:join', {
        roomId: 'tunnel-room-1',
        role: 'viewer',
        pin: '654321',
        mediaMode: 'tunnel-relay'
      }, resolve);
    });
    assert.equal(viewerGoodJoin.success, true);

    // 4. Send binary frame from sender and verify receipt on viewer
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);
    const frameReceivedPromise = new Promise((resolve) => {
      viewerSocket.on('tunnel:frame', (data) => {
        resolve(Buffer.from(data));
      });
    });

    senderSocket.emit('tunnel:frame', validJpeg);

    const receivedBuffer = await frameReceivedPromise;
    assert.deepEqual(receivedBuffer, validJpeg);

    // 5. Query tunnel:stats
    const statsResult = await new Promise((resolve) => {
      senderSocket.emit('tunnel:stats', resolve);
    });
    assert.equal(statsResult.success, true);
    assert.equal(statsResult.stats.totalFrames, 1);
    assert.equal(statsResult.stats.totalBytes, validJpeg.length);

  } finally {
    senderSocket.disconnect();
    viewerSocket.disconnect();
    io.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
