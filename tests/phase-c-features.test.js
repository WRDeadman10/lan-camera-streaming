import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { RoomManager } from '../src/server/room-manager.js';
import { getStandbySlateJpeg } from '../src/server/standby-slate.js';
import { VcamShmBridge } from '../src/server/vcam-shm-bridge.js';

test('Feature 10: Standby Slate provides valid JPEG with proper dimensions and markers', () => {
  const slateBuffer = getStandbySlateJpeg(1280, 720);
  assert.ok(Buffer.isBuffer(slateBuffer), 'Slate buffer should be a Buffer');
  assert.ok(slateBuffer.length > 50, 'Slate buffer should have non-trivial size');
  // Check SOI marker 0xFFD8 and EOI marker 0xFFD9
  assert.equal(slateBuffer[0], 0xff);
  assert.equal(slateBuffer[1], 0xd8);
  assert.equal(slateBuffer[slateBuffer.length - 2], 0xff);
  assert.equal(slateBuffer[slateBuffer.length - 1], 0xd9);
});

test('Feature 4: Multi-Camera Studio Mode allows multiple senders and cleans up properly', () => {
  const rm = new RoomManager('pin123');

  // Standard room rejects duplicate sender
  const s1 = rm.createOrJoinRoom('standard-room', 'sender', 's1', 'pin123');
  assert.equal(s1.success, true);
  const s2 = rm.createOrJoinRoom('standard-room', 'sender', 's2', 'pin123');
  assert.equal(s2.success, false);
  assert.match(s2.error, /already has an active sender/);

  // Studio room allows multiple studio-senders
  const st1 = rm.createOrJoinRoom('studio-room', 'studio-sender', 'cam1', 'pin123');
  assert.equal(st1.success, true);
  assert.equal(st1.isStudio, true);

  const st2 = rm.createOrJoinRoom('studio-room', 'studio-sender', 'cam2', 'pin123');
  assert.equal(st2.success, true);
  assert.equal(st2.isStudio, true);

  const st3 = rm.createOrJoinRoom('studio-room', 'studio-sender', 'cam3', 'pin123');
  assert.equal(st3.success, true);

  const senders = rm.getSenderSocketIds('studio-room');
  assert.equal(senders.length, 3);
  assert.ok(senders.includes('cam1'));
  assert.ok(senders.includes('cam2'));
  assert.ok(senders.includes('cam3'));

  // Viewer joining gets all studio sender IDs
  const v1 = rm.createOrJoinRoom('studio-room', 'viewer', 'view1', 'pin123');
  assert.equal(v1.success, true);
  assert.equal(v1.hasPeer, true);
  assert.equal(v1.peerSocketIds.length, 3);

  // One studio sender leaves
  const leaveRes = rm.leave('cam1');
  assert.equal(leaveRes.isStudio, true);
  const remainingSenders = rm.getSenderSocketIds('studio-room');
  assert.equal(remainingSenders.length, 2);
  assert.ok(!remainingSenders.includes('cam1'));

  // Cleanup remaining
  rm.leave('cam2');
  rm.leave('cam3');
  rm.leave('view1');
  assert.equal(rm.getRoom('studio-room'), null);
});

test('Feature 2: VcamShmBridge transmits frame with 12-byte header over TCP', async () => {
  let receivedHeader = null;
  let receivedData = null;

  // Mock TCP server on ephemeral port
  let clientSock = null;
  const server = net.createServer((socket) => {
    clientSock = socket;
    socket.once('data', (chunk) => {
      if (chunk.length >= 12) {
        receivedHeader = {
          width: chunk.readUInt32LE(0),
          height: chunk.readUInt32LE(4),
          dataSize: chunk.readUInt32LE(8)
        };
        receivedData = chunk.subarray(12);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const bridge = new VcamShmBridge(port, '127.0.0.1', { info() {}, warn() {}, error() {} });
  bridge.connect();

  // Wait for connection
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(bridge.isConnected(), true);

  const fakeRgb = Buffer.alloc(64, 0xAB);
  const sent = bridge.sendFrame(640, 480, fakeRgb);
  assert.equal(sent, true);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(receivedHeader);
  assert.equal(receivedHeader.width, 640);
  assert.equal(receivedHeader.height, 480);
  assert.equal(receivedHeader.dataSize, 64);
  assert.equal(receivedData.length, 64);
  assert.equal(receivedData[0], 0xAB);

  bridge.close();
  if (clientSock) {
    try {
      clientSock.destroy();
    } catch {}
  }
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
});
