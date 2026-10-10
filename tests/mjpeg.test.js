import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';
import { MjpegStreamer } from '../src/server/mjpeg-streamer.js';

const MockJpegFrame = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0xFF, 0xD9]);

function waitForDemand(socketClient, active, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socketClient.off('mjpeg:demand', handler);
      reject(new Error(`Timed out waiting for mjpeg:demand active=${active}`));
    }, timeoutMs);
    function handler(payload) {
      if (payload.active === active) {
        clearTimeout(timer);
        socketClient.off('mjpeg:demand', handler);
        resolve();
      }
    }
    socketClient.on('mjpeg:demand', handler);
  });
}

async function startTestServer(port) {
  const config = loadConfig({ PORT: port, ACCESS_PIN: 'testpin123' });
  const logger = new Logger('error');
  const mjpegStreamer = new MjpegStreamer();
  config.mjpegStreamer = mjpegStreamer;

  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  return { httpServer, mjpegStreamer, baseUrl: `http://127.0.0.1:${address.port}` };
}

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

test('MJPEG stream broadcasts JPEG frames from sender to HTTP subscriber on demand', async () => {
  const { httpServer, baseUrl } = await startTestServer('3005');
  const socketClient = Client(baseUrl);

  try {
    await new Promise((res) => socketClient.on('connect', res));

    const joinRes = await new Promise((res) => {
      socketClient.emit('room:join', { roomId: 'mjpeg-room', role: 'sender', pin: 'testpin123' }, res);
    });
    assert.equal(joinRes.success, true);

    // Connect HTTP subscriber: the sender must be asked to start uploading frames
    const demandStarted = waitForDemand(socketClient, true);
    const controller = new AbortController();
    const streamResponse = await fetch(`${baseUrl}/stream/mjpeg-room?pin=testpin123`, {
      signal: controller.signal
    });
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get('content-type'), /multipart\/x-mixed-replace/);
    await demandStarted;

    socketClient.emit('mjpeg:frame', MockJpegFrame);

    // Read stream chunks until the JPEG payload has been delivered
    const reader = streamResponse.body.getReader();
    let received = Buffer.alloc(0);
    while (!received.includes(MockJpegFrame)) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      received = Buffer.concat([received, Buffer.from(chunk.value)]);
    }

    // Snapshot endpoint serves the fresh cached frame
    const snapshotRes = await fetch(`${baseUrl}/snapshot/mjpeg-room?pin=testpin123`);
    assert.equal(snapshotRes.status, 200);
    assert.equal(snapshotRes.headers.get('content-type'), 'image/jpeg');
    const snapshotBytes = Buffer.from(await snapshotRes.arrayBuffer());
    assert.deepEqual(snapshotBytes, MockJpegFrame);

    // Disconnecting the last subscriber tells the sender to stop uploading
    const demandStopped = waitForDemand(socketClient, false);
    controller.abort();
    await demandStopped;
  } finally {
    socketClient.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('MJPEG frames are dropped while no consumer is connected', async () => {
  const { httpServer, mjpegStreamer, baseUrl } = await startTestServer('3006');
  const socketClient = Client(baseUrl);

  try {
    await new Promise((res) => socketClient.on('connect', res));
    await new Promise((res) => {
      socketClient.emit('room:join', { roomId: 'idle-room', role: 'sender', pin: 'testpin123' }, res);
    });

    socketClient.emit('mjpeg:frame', MockJpegFrame);
    // Acked event is processed after the preceding frame event on the same socket
    await new Promise((res) => socketClient.emit('tunnel:stats', res));

    assert.equal(mjpegStreamer.latestFrames.has('idle-room'), false);
    assert.equal(mjpegStreamer.hasDemand('idle-room'), false);
  } finally {
    socketClient.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('Sender joining after a consumer connected is told to start uploading', async () => {
  const { httpServer, baseUrl } = await startTestServer('3007');
  const socketClient = Client(baseUrl);
  const controller = new AbortController();

  try {
    await new Promise((res) => socketClient.on('connect', res));

    const streamResponse = await fetch(`${baseUrl}/stream/late-room?pin=testpin123`, {
      signal: controller.signal
    });
    assert.equal(streamResponse.status, 200);

    const demandStarted = waitForDemand(socketClient, true);
    const joinRes = await new Promise((res) => {
      socketClient.emit('room:join', { roomId: 'late-room', role: 'sender', pin: 'testpin123' }, res);
    });
    assert.equal(joinRes.success, true);
    await demandStarted;
  } finally {
    controller.abort();
    socketClient.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('MjpegStreamer reports demand for pending snapshots and resolves them with the next frame', async () => {
  const streamer = new MjpegStreamer();
  const changes = [];
  streamer.onDemandChange = (roomId, active) => {
    changes.push([roomId, active]);
  };

  assert.equal(streamer.hasDemand('room-a'), false);

  const pending = streamer.getFreshFrame('room-a', 5000, 2000);
  assert.equal(streamer.hasDemand('room-a'), true);

  streamer.broadcastFrame('room-a', MockJpegFrame);
  const frame = await pending;
  assert.deepEqual(frame, MockJpegFrame);
  assert.equal(streamer.hasDemand('room-a'), false);
  assert.deepEqual(changes, [['room-a', true], ['room-a', false]]);
});

test('MjpegStreamer snapshot request times out with null and clears demand', async () => {
  const streamer = new MjpegStreamer();
  const changes = [];
  streamer.onDemandChange = (roomId, active) => {
    changes.push([roomId, active]);
  };

  const frame = await streamer.getFreshFrame('room-b', 5000, 30);
  assert.equal(frame, null);
  assert.equal(streamer.hasDemand('room-b'), false);
  assert.deepEqual(changes, [['room-b', true], ['room-b', false]]);
});
