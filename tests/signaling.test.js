import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';
import { RoomManager } from '../src/server/room-manager.js';

test('RoomManager validates PIN, capacity, and role constraints', () => {
  const rm = new RoomManager('secret123');

  // Invalid PIN
  const badPinRes = rm.createOrJoinRoom('test-room', 'sender', 'sock1', 'wrong');
  assert.equal(badPinRes.success, false);
  assert.equal(badPinRes.error, 'Invalid access PIN');

  // Valid Sender Join
  const senderRes = rm.createOrJoinRoom('test-room', 'sender', 'sock1', 'secret123');
  assert.equal(senderRes.success, true);
  assert.equal(senderRes.hasPeer, false);

  // Duplicate Sender rejected
  const dupSenderRes = rm.createOrJoinRoom('test-room', 'sender', 'sock2', 'secret123');
  assert.equal(dupSenderRes.success, false);
  assert.match(dupSenderRes.error, /already has an active sender/);

  // Valid Viewer Join
  const viewerRes = rm.createOrJoinRoom('test-room', 'viewer', 'sock3', 'secret123');
  assert.equal(viewerRes.success, true);
  assert.equal(viewerRes.hasPeer, true);
  assert.equal(viewerRes.peerSocketId, 'sock1');

  // Duplicate Viewer rejected
  const dupViewerRes = rm.createOrJoinRoom('test-room', 'viewer', 'sock4', 'secret123');
  assert.equal(dupViewerRes.success, false);
  assert.match(dupViewerRes.error, /already has an active viewer/);

  // Peer resolution
  assert.equal(rm.getPeerSocketId('sock1'), 'sock3');
  assert.equal(rm.getPeerSocketId('sock3'), 'sock1');

  // Leave handling
  const leaveRes = rm.leave('sock1');
  assert.equal(leaveRes.roomId, 'test-room');
  assert.equal(leaveRes.role, 'sender');
  assert.equal(leaveRes.peerSocketId, 'sock3');

  // Room still exists with viewer
  assert.ok(rm.getRoom('test-room'));

  // Viewer leaves
  rm.leave('sock3');
  assert.equal(rm.getRoom('test-room'), null);
});

test('Socket.IO signaling relays offer, answer, and ICE candidates between peers', async () => {
  const config = loadConfig({ PORT: '3002', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const senderClient = Client(socketUrl);
  const viewerClient = Client(socketUrl);

  try {
    // Wait for both to connect
    await Promise.all([
      new Promise((res) => senderClient.on('connect', res)),
      new Promise((res) => viewerClient.on('connect', res))
    ]);

    // Sender joins room
    const senderJoinAck = await new Promise((res) => {
      senderClient.emit('room:join', { roomId: 'webrtc-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(senderJoinAck.success, true);

    // Prepare listener for peer:joined on sender
    const peerJoinedPromise = new Promise((res) => {
      senderClient.on('peer:joined', res);
    });

    // Viewer joins room
    const viewerJoinAck = await new Promise((res) => {
      viewerClient.emit('room:join', { roomId: 'webrtc-room', role: 'viewer', pin: 'testpass' }, res);
    });
    assert.equal(viewerJoinAck.success, true);
    assert.equal(viewerJoinAck.hasPeer, true);

    const peerJoinedEvent = await peerJoinedPromise;
    assert.equal(peerJoinedEvent.role, 'viewer');

    // Test SDP Offer relay from sender to viewer
    const offerPromise = new Promise((res) => {
      viewerClient.on('webrtc:offer', res);
    });
    senderClient.emit('webrtc:offer', { sdp: 'v=0\r\no=mock-offer...', type: 'offer' });
    const receivedOffer = await offerPromise;
    assert.equal(receivedOffer.type, 'offer');
    assert.equal(receivedOffer.sdp, 'v=0\r\no=mock-offer...');

    // Test SDP Answer relay from viewer to sender
    const answerPromise = new Promise((res) => {
      senderClient.on('webrtc:answer', res);
    });
    viewerClient.emit('webrtc:answer', { sdp: 'v=0\r\no=mock-answer...', type: 'answer' });
    const receivedAnswer = await answerPromise;
    assert.equal(receivedAnswer.type, 'answer');
    assert.equal(receivedAnswer.sdp, 'v=0\r\no=mock-answer...');

    // Test ICE Candidate relay
    const icePromise = new Promise((res) => {
      senderClient.on('webrtc:ice-candidate', res);
    });
    viewerClient.emit('webrtc:ice-candidate', { candidate: 'candidate:1 1 UDP 2130706431...', sdpMid: '0', sdpMLineIndex: 0 });
    const receivedIce = await icePromise;
    assert.match(receivedIce.candidate, /candidate:1/);

  } finally {
    senderClient.disconnect();
    viewerClient.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('RoomManager and Signaling support external receiver with canonical roles camera-sender and webrtc-receiver', async () => {
  const rm = new RoomManager('pass123');
  const senderJoin = rm.createOrJoinRoom('canonical-room', 'camera-sender', 'sockA', 'pass123');
  assert.equal(senderJoin.success, true);
  assert.equal(senderJoin.role, 'sender');

  const receiverJoin = rm.createOrJoinRoom('canonical-room', 'webrtc-receiver', 'sockB', 'pass123');
  assert.equal(receiverJoin.success, true);
  assert.equal(receiverJoin.role, 'viewer');
  assert.equal(receiverJoin.hasPeer, true);
  assert.equal(receiverJoin.peerSocketId, 'sockA');
  assert.equal(rm.getPeerSocketId('sockA'), 'sockB');
});
