import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';
import { MjpegStreamer } from '../src/server/mjpeg-streamer.js';

test('MJPEG endpoint rejects unauthorized request without valid pin', async () => {
  const config = loadConfig({ PORT: '3004', ACCESS_PIN: 'testpin123' });
  const logger = new Logger('error');
  const mjpegStreamer = new MjpegStreamer();
  config.mjpegStreamer = mjpegStreamer;

  const { httpServer } = createServer(config, logger);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Missing pin
    const resNoPin = await fetch(`${baseUrl}/stream/room1`);
    assert.equal(resNoPin.status, 401);

    // Wrong pin
    const resWrongPin = await fetch(`${baseUrl}/stream/room1?pin=wrong`);
    assert.equal(resWrongPin.status, 401);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('MJPEG stream broadcasts JPEG frames from sender to HTTP subscriber', async () => {
  const config = loadConfig({ PORT: '3005', ACCESS_PIN: 'testpin123' });
  const logger = new Logger('error');
  const mjpegStreamer = new MjpegStreamer();
  config.mjpegStreamer = mjpegStreamer;

  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const socketClient = Client(baseUrl);

  try {
    await new Promise((res) => socketClient.on('connect', res));

    // Sender joins room
    const joinRes = await new Promise((res) => {
      socketClient.emit('room:join', { roomId: 'mjpeg-room', role: 'sender', pin: 'testpin123' }, res);
    });
    assert.equal(joinRes.success, true);

    // Mock 1x1 JPEG frame header bytes
    const mockJpegFrame = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0xFF, 0xD9]);

    // Connect HTTP subscriber
    const controller = new AbortController();
    const streamPromise = fetch(`${baseUrl}/stream/mjpeg-room?pin=testpin123`, {
      signal: controller.signal
    });

    // Send frame via socket
    socketClient.emit('mjpeg:frame', mockJpegFrame);

    const streamResponse = await streamPromise;
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get('content-type'), /multipart\/x-mixed-replace/);

    // Read initial stream chunk
    const reader = streamResponse.body.getReader();
    const chunk = await reader.read();
    assert.ok(chunk.value.length > 0);

    // Check snapshot endpoint
    const snapshotRes = await fetch(`${baseUrl}/snapshot/mjpeg-room?pin=testpin123`);
    assert.equal(snapshotRes.status, 200);
    assert.equal(snapshotRes.headers.get('content-type'), 'image/jpeg');
    const snapshotBytes = Buffer.from(await snapshotRes.arrayBuffer());
    assert.deepEqual(snapshotBytes, mockJpegFrame);

    controller.abort();
  } finally {
    socketClient.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
