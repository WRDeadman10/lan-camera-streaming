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

test('Sender auto-reconnection with reconnect: true evicts orphaned sender socket and immediately reconnects waiting viewers', async () => {
  const config = loadConfig({ PORT: '3006', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const viewer = Client(socketUrl);
  const sender1 = Client(socketUrl);
  const sender2 = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => viewer.on('connect', res)),
      new Promise((res) => sender1.on('connect', res)),
      new Promise((res) => sender2.on('connect', res))
    ]);

    // Viewer joins room
    const vJoin = await new Promise((res) => {
      viewer.emit('room:join', { roomId: 'autoreconnect-room', role: 'viewer', pin: 'testpass' }, res);
    });
    assert.equal(vJoin.success, true);

    // Initial sender joins room
    const s1Join = await new Promise((res) => {
      sender1.emit('room:join', { roomId: 'autoreconnect-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(s1Join.success, true);
    assert.equal(s1Join.hasPeer, true);
    const originalSender1Id = sender1.id;

    let viewerSawLeftPeer = null;
    let viewerSawJoinedPeer = null;
    viewer.on('peer:left', (evt) => {
      viewerSawLeftPeer = evt.peerId;
    });
    viewer.on('peer:joined', (evt) => {
      viewerSawJoinedPeer = evt.peerId;
    });

    // Without reconnect: true, a second sender joining the same room is refused
    const s2Refused = await new Promise((res) => {
      sender2.emit('room:join', { roomId: 'autoreconnect-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(s2Refused.success, false);
    assert.equal(s2Refused.error, 'Room already has an active sender.');

    // With reconnect: true but without senderToken, eviction is rejected
    const s2NoToken = await new Promise((res) => {
      sender2.emit('room:join', { roomId: 'autoreconnect-room', role: 'sender', pin: 'testpass', reconnect: true }, res);
    });
    assert.equal(s2NoToken.success, false);
    assert.match(s2NoToken.error, /Unauthorized sender eviction/);

    // With reconnect: true and matching senderToken (auto-reconnect), the new sender socket takes over and evicts the stale sender
    const s2Rejoined = await new Promise((res) => {
      sender2.emit('room:join', { roomId: 'autoreconnect-room', role: 'sender', pin: 'testpass', reconnect: true, senderToken: s1Join.senderToken }, res);
    });
    assert.equal(s2Rejoined.success, true);
    assert.equal(s2Rejoined.hasPeer, true);
    assert.equal(s2Rejoined.evictedSenderId, originalSender1Id);
    assert.ok(s2Rejoined.peerSocketIds.includes(viewer.id));

    // Wait briefly for signaling broadcast
    await new Promise((res) => setTimeout(res, 60));

    assert.equal(viewerSawLeftPeer, originalSender1Id);
    assert.equal(viewerSawJoinedPeer, sender2.id);
  } finally {
    viewer.disconnect();
    sender1.disconnect();
    sender2.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('Evicted sender is notified with sender:evicted so it can stop instead of looping reconnects', async () => {
  const config = loadConfig({ PORT: '3007', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const sender1 = Client(socketUrl);
  const sender2 = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => sender1.on('connect', res)),
      new Promise((res) => sender2.on('connect', res))
    ]);

    const s1Join = await new Promise((res) => {
      sender1.emit('room:join', { roomId: 'evict-notify-room', role: 'sender', pin: 'testpass' }, res);
    });
    assert.equal(s1Join.success, true);

    const evictedEvent = new Promise((res) => sender1.on('sender:evicted', res));

    const s2Join = await new Promise((res) => {
      sender2.emit('room:join', { roomId: 'evict-notify-room', role: 'sender', pin: 'testpass', reconnect: true, senderToken: s1Join.senderToken }, res);
    });
    assert.equal(s2Join.success, true);

    const evt = await Promise.race([
      evictedEvent,
      new Promise((res) => setTimeout(() => res(null), 1000))
    ]);
    assert.ok(evt, 'Evicted sender must receive sender:evicted');
    assert.equal(evt.roomId, 'evict-notify-room');
    assert.equal(evt.replacedBy, sender2.id);
  } finally {
    sender1.disconnect();
    sender2.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('viewer:quality-priority is relayed to the sender with the viewer id and rejects invalid modes', async () => {
  const config = loadConfig({ PORT: '3008', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const sender = Client(socketUrl);
  const viewer = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => sender.on('connect', res)),
      new Promise((res) => viewer.on('connect', res))
    ]);

    await new Promise((res) => sender.emit('room:join', { roomId: 'quality-room', role: 'sender', pin: 'testpass' }, res));
    await new Promise((res) => viewer.emit('room:join', { roomId: 'quality-room', role: 'viewer', pin: 'testpass' }, res));

    const received = [];
    sender.on('viewer:quality-priority', (evt) => received.push(evt));

    viewer.emit('viewer:quality-priority', { mode: 'both' });
    viewer.emit('viewer:quality-priority', { mode: 'turbo' });
    viewer.emit('viewer:quality-priority', {});
    // A sender must not be able to set a viewer's preference on itself
    sender.emit('viewer:quality-priority', { mode: 'fps' });

    await new Promise((res) => setTimeout(res, 150));

    assert.equal(received.length, 1, 'only the valid viewer request is relayed');
    assert.equal(received[0].mode, 'both');
    assert.equal(received[0].viewerId, viewer.id);
  } finally {
    sender.disconnect();
    viewer.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('a viewer mode chosen before the sender joins is delivered in the sender join acknowledgement', async () => {
  const config = loadConfig({ PORT: '3009', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const socketUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const viewerA = Client(socketUrl);
  const viewerB = Client(socketUrl);
  const sender = Client(socketUrl);

  try {
    await Promise.all([viewerA, viewerB, sender].map((client) => new Promise((res) => client.on('connect', res))));

    await new Promise((res) => viewerA.emit('room:join', { roomId: 'seed-room', role: 'viewer', pin: 'testpass' }, res));
    await new Promise((res) => viewerB.emit('room:join', { roomId: 'seed-room', role: 'viewer', pin: 'testpass' }, res));
    viewerA.emit('viewer:quality-priority', { mode: 'both' });
    viewerB.emit('viewer:quality-priority', { mode: 'resolution' });
    await new Promise((res) => setTimeout(res, 100));

    const senderJoin = await new Promise((res) => sender.emit('room:join', { roomId: 'seed-room', role: 'sender', pin: 'testpass' }, res));
    assert.equal(senderJoin.success, true);
    assert.deepEqual(senderJoin.viewerQuality, { [viewerA.id]: 'both', [viewerB.id]: 'resolution' });
  } finally {
    viewerA.disconnect();
    viewerB.disconnect();
    sender.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('viewer quality events are de-duplicated, rate limited and forgotten when the viewer leaves', async () => {
  const config = loadConfig({ PORT: '3010', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const socketUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const sender = Client(socketUrl);
  const viewer = Client(socketUrl);
  const sender2 = Client(socketUrl);

  try {
    await Promise.all([sender, viewer, sender2].map((client) => new Promise((res) => client.on('connect', res))));
    await new Promise((res) => sender.emit('room:join', { roomId: 'limit-room', role: 'sender', pin: 'testpass' }, res));
    await new Promise((res) => viewer.emit('room:join', { roomId: 'limit-room', role: 'viewer', pin: 'testpass' }, res));

    const received = [];
    sender.on('viewer:quality-priority', (evt) => received.push(evt.mode));

    // 50 identical events: only the first is relayed
    for (let i = 0; i < 50; i += 1) {
      viewer.emit('viewer:quality-priority', { mode: 'resolution' });
    }
    await new Promise((res) => setTimeout(res, 150));
    assert.deepEqual(received, ['resolution']);

    // Flooding alternating modes: the per-socket limit (5 events / 5 s) caps what reaches the sender
    for (let i = 0; i < 40; i += 1) {
      viewer.emit('viewer:quality-priority', { mode: i % 2 === 0 ? 'fps' : 'both' });
    }
    await new Promise((res) => setTimeout(res, 150));
    assert.ok(received.length <= 5, `relayed ${received.length} events, expected at most 5`);

    // After leaving, a new sender must not be told about the departed viewer
    viewer.emit('room:leave');
    await new Promise((res) => setTimeout(res, 100));
    sender.disconnect();
    await new Promise((res) => setTimeout(res, 100));
    const join = await new Promise((res) => sender2.emit('room:join', { roomId: 'limit-room', role: 'sender', pin: 'testpass' }, res));
    assert.equal(join.success, true);
    assert.equal(join.viewerQuality, undefined);
  } finally {
    sender.disconnect();
    viewer.disconnect();
    sender2.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
