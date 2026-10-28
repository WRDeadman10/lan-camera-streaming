import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';

// Resolves with the next room:participants payload that matches the predicate.
function nextRoster(client, predicate = () => true) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      if (predicate(payload)) {
        client.off('room:participants', handler);
        resolve(payload);
      }
    };
    client.on('room:participants', handler);
  });
}

function join(client, payload) {
  return new Promise((resolve) => {
    client.emit('room:join', payload, resolve);
  });
}

test('room:participants lists the sender and every viewer with the name each one joined with', async () => {
  const config = loadConfig({ PORT: '3010', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const socketUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const sender = Client(socketUrl);
  const viewerA = Client(socketUrl);
  const viewerB = Client(socketUrl);
  const clients = [sender, viewerA, viewerB];

  try {
    await Promise.all(clients.map((c) => new Promise((res) => c.on('connect', res))));

    const senderJoin = await join(sender, { roomId: 'roster-room', role: 'sender', pin: 'testpass', displayName: 'Streamer Lens 421' });
    assert.equal(senderJoin.success, true);

    const afterFirstViewer = nextRoster(sender, (p) => p.viewers.length === 1);
    const viewerAJoin = await join(viewerA, { roomId: 'roster-room', role: 'viewer', pin: 'testpass', displayName: 'Brave Falcon 101' });
    assert.equal(viewerAJoin.success, true);
    const rosterForSender = await afterFirstViewer;
    assert.equal(rosterForSender.senders.length, 1);
    assert.equal(rosterForSender.senders[0].id, sender.id);
    assert.equal(rosterForSender.senders[0].name, 'Streamer Lens 421');
    assert.equal(rosterForSender.viewers[0].id, viewerA.id);
    assert.equal(rosterForSender.viewers[0].name, 'Brave Falcon 101');

    // A second viewer joins; the viewer-side roster must include the first viewer and the sender
    const viewerBRoster = nextRoster(viewerB, (p) => p.viewers.length === 2);
    const viewerBJoin = await join(viewerB, { roomId: 'roster-room', role: 'viewer', pin: 'testpass', displayName: 'Calm Otter 555' });
    assert.equal(viewerBJoin.success, true);
    const rosterForViewerB = await viewerBRoster;
    assert.equal(rosterForViewerB.senders[0].name, 'Streamer Lens 421');
    assert.equal(rosterForViewerB.viewers.length, 2);
    const names = rosterForViewerB.viewers.map((v) => v.name).sort();
    assert.deepEqual(names, ['Brave Falcon 101', 'Calm Otter 555']);

    // Name change is reflected in the roster
    const renamed = nextRoster(sender, (p) => p.viewers.some((v) => v.name === 'Swift Heron 202'));
    viewerA.emit('chat:name-change', { oldName: 'Brave Falcon 101', newName: 'Swift Heron 202' });
    const afterRename = await renamed;
    assert.ok(afterRename.viewers.some((v) => v.id === viewerA.id && v.name === 'Swift Heron 202'));

    // Viewer leaves; sender roster shrinks
    const afterLeave = nextRoster(sender, (p) => p.viewers.length === 1);
    viewerB.emit('room:leave');
    const afterLeavePayload = await afterLeave;
    assert.equal(afterLeavePayload.viewers[0].id, viewerA.id);
  } finally {
    for (const c of clients) {
      c.disconnect();
    }
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('room:participants falls back to role defaults when no display name is sent', async () => {
  const config = loadConfig({ PORT: '3011', ACCESS_PIN: 'testpass' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const socketUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const sender = Client(socketUrl);
  const viewer = Client(socketUrl);

  try {
    await Promise.all([sender, viewer].map((c) => new Promise((res) => c.on('connect', res))));
    await join(sender, { roomId: 'default-name-room', role: 'sender', pin: 'testpass' });
    const roster = nextRoster(sender, (p) => p.viewers.length === 1);
    await join(viewer, { roomId: 'default-name-room', role: 'viewer', pin: 'testpass' });
    const payload = await roster;
    assert.equal(payload.senders[0].name, 'Streamer');
    assert.equal(payload.viewers[0].name, 'Viewer');
  } finally {
    sender.disconnect();
    viewer.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
