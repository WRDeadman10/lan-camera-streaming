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

  // Valid Viewer 1 Join
  const viewerRes = rm.createOrJoinRoom('test-room', 'viewer', 'sock3', 'secret123');
  assert.equal(viewerRes.success, true);
  assert.equal(viewerRes.hasPeer, true);
  assert.equal(viewerRes.peerSocketId, 'sock1');

  // Second Viewer also allowed concurrently
  const viewer2Res = rm.createOrJoinRoom('test-room', 'viewer', 'sock4', 'secret123');
  assert.equal(viewer2Res.success, true);
  assert.equal(viewer2Res.hasPeer, true);
  assert.equal(viewer2Res.peerSocketId, 'sock1');
  assert.equal(rm.getViewerSocketIds('test-room').length, 2);

  // Peer resolution
  assert.equal(rm.getPeerSocketId('sock1'), 'sock3');
  assert.equal(rm.getPeerSocketId('sock3'), 'sock1');
  assert.equal(rm.getPeerSocketId('sock4'), 'sock1');

  // Leave handling: sender leaves
  const leaveRes = rm.leave('sock1');
  assert.equal(leaveRes.roomId, 'test-room');
  assert.equal(leaveRes.role, 'sender');
  assert.equal(leaveRes.peerSocketIds.length, 2);

  // Room still exists with 2 viewers
  assert.ok(rm.getRoom('test-room'));

  // First viewer leaves
  rm.leave('sock3');
  assert.ok(rm.getRoom('test-room'));

  // Second viewer leaves -> room cleaned up
  rm.leave('sock4');
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

test('Socket.IO signaling routes targeted offers to specific viewers in a multi-viewer room', async () => {
  const config = loadConfig({ PORT: '3003', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const sender = Client(socketUrl);
  const viewer1 = Client(socketUrl);
  const viewer2 = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => sender.on('connect', res)),
      new Promise((res) => viewer1.on('connect', res)),
      new Promise((res) => viewer2.on('connect', res))
    ]);

    // Sender joins
    const sAck = await new Promise((res) => {
      sender.emit('room:join', { roomId: 'multi-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(sAck.success, true);

    // Viewer 1 joins
    const v1Ack = await new Promise((res) => {
      viewer1.emit('room:join', { roomId: 'multi-room', role: 'viewer', pin: 'testpass' }, res);
    });
    assert.equal(v1Ack.success, true);

    // Viewer 2 joins
    const v2Ack = await new Promise((res) => {
      viewer2.emit('room:join', { roomId: 'multi-room', role: 'viewer', pin: 'testpass' }, res);
    });
    assert.equal(v2Ack.success, true);

    // Sender emits offer targeted strictly to viewer 2
    let viewer1GotOffer = false;
    viewer1.on('webrtc:offer', () => {
      viewer1GotOffer = true;
    });

    const v2OfferPromise = new Promise((res) => {
      viewer2.on('webrtc:offer', res);
    });

    sender.emit('webrtc:offer', {
      sdp: 'mock-offer-for-v2',
      type: 'offer',
      targetId: viewer2.id
    });

    const receivedV2Offer = await v2OfferPromise;
    assert.equal(receivedV2Offer.sdp, 'mock-offer-for-v2');
    assert.equal(viewer1GotOffer, false);
  } finally {
    sender.disconnect();
    viewer1.disconnect();
    viewer2.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('Socket.IO signaling rejects an untargeted sender offer when several viewers are in the room', async () => {
  const config = loadConfig({ PORT: '3004', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const sender = Client(socketUrl);
  const viewer1 = Client(socketUrl);
  const viewer2 = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => sender.on('connect', res)),
      new Promise((res) => viewer1.on('connect', res)),
      new Promise((res) => viewer2.on('connect', res))
    ]);

    for (const [socket, role] of [[sender, 'sender'], [viewer1, 'viewer'], [viewer2, 'viewer']]) {
      const ack = await new Promise((res) => {
        socket.emit('room:join', { roomId: 'stale-sender-room', role, pin: 'testpass' }, res);
      });
      assert.equal(ack.success, true);
    }

    let viewerGotOffer = false;
    viewer1.on('webrtc:offer', () => { viewerGotOffer = true; });
    viewer2.on('webrtc:offer', () => { viewerGotOffer = true; });

    const errorPromise = new Promise((res) => sender.on('room:error', res));
    sender.emit('webrtc:offer', { sdp: 'untargeted-offer', type: 'offer' });

    const error = await errorPromise;
    assert.match(error.message, /outdated/);
    // Acked event is processed after the preceding offer on the same socket
    await new Promise((res) => viewer1.emit('tunnel:stats', res));
    assert.equal(viewerGotOffer, false);

    // A single viewer is still served without a target (backward compatible)
    viewer2.disconnect();
    await new Promise((res) => setTimeout(res, 100));
    const soloOfferPromise = new Promise((res) => viewer1.on('webrtc:offer', res));
    sender.emit('webrtc:offer', { sdp: 'untargeted-solo', type: 'offer' });
    assert.equal((await soloOfferPromise).sdp, 'untargeted-solo');
  } finally {
    sender.disconnect();
    viewer1.disconnect();
    viewer2.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('Sender leaving and rejoining notifies waiting viewers and provides peer list to sender', async () => {
  const config = loadConfig({ PORT: '3005', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const sender = Client(socketUrl);
  const viewer1 = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => sender.on('connect', res)),
      new Promise((res) => viewer1.on('connect', res))
    ]);

    // Viewer joins first and waits in room
    const vJoin = await new Promise((res) => {
      viewer1.emit('room:join', { roomId: 'rejoin-room', role: 'viewer', pin: 'testpass' }, res);
    });
    assert.equal(vJoin.success, true);
    assert.equal(vJoin.hasPeer, false);

    // Setup listener on viewer for peer:joined
    let viewerSawPeer = null;
    viewer1.on('peer:joined', (evt) => {
      viewerSawPeer = evt;
    });

    // Sender joins room
    const sJoin = await new Promise((res) => {
      sender.emit('room:join', { roomId: 'rejoin-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(sJoin.success, true);
    assert.equal(sJoin.hasPeer, true);
    assert.ok(sJoin.peerSocketIds.includes(viewer1.id));

    // Wait briefly for event to deliver
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(viewerSawPeer);
    assert.equal(viewerSawPeer.role, 'sender');
    assert.equal(viewerSawPeer.peerId, sender.id);

    // Sender leaves room
    let viewerSawLeave = false;
    viewer1.on('peer:left', () => {
      viewerSawLeave = true;
    });
    sender.emit('room:leave');
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(viewerSawLeave, true);

    // Sender rejoins room
    viewerSawPeer = null;
    const sRejoin = await new Promise((res) => {
      sender.emit('room:join', { roomId: 'rejoin-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(sRejoin.success, true);
    assert.equal(sRejoin.hasPeer, true);
    assert.ok(sRejoin.peerSocketIds.includes(viewer1.id));

    await new Promise((res) => setTimeout(res, 50));
    assert.ok(viewerSawPeer);
    assert.equal(viewerSawPeer.role, 'sender');
  } finally {
    sender.disconnect();
    viewer1.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

