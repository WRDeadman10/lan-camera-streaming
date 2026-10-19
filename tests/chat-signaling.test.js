import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';

test('In-room Chat Signaling System', async (t) => {
  const logger = new Logger('error');
  const config = loadConfig({
    PORT: 7890,
    ACCESS_PIN: 'chat123',
    MAX_VIEWERS: 5
  });

  const { httpServer } = createServer(config, logger);
  const { io, roomManager, roomChatHistories } = setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  await t.test('Rejects chat:message from unauthorized client not in a room', async () => {
    const client = Client(serverUrl);
    await new Promise((resolve) => client.on('connect', resolve));

    const response = await new Promise((resolve) => {
      client.emit('chat:message', { text: 'Hello outside room' }, resolve);
    });

    assert.equal(response.success, false);
    assert.match(response.error, /Unauthorized/);
    client.disconnect();
  });

  await t.test('Rejects malformed or empty chat:message payload', async () => {
    const sender = Client(serverUrl);
    await new Promise((resolve) => sender.on('connect', resolve));

    await new Promise((resolve) => {
      sender.emit('room:join', { roomId: 'room-chat-val', role: 'sender', pin: 'chat123' }, resolve);
    });

    const emptyRes = await new Promise((resolve) => {
      sender.emit('chat:message', { text: '   ' }, resolve);
    });
    assert.equal(emptyRes.success, false);
    assert.match(emptyRes.error, /cannot be empty/);

    const malformedRes = await new Promise((resolve) => {
      sender.emit('chat:message', null, resolve);
    });
    assert.equal(malformedRes.success, false);
    assert.match(malformedRes.error, /Malformed/);

    sender.disconnect();
  });

  await t.test('Broadcasts chat:message to room participants with timestamps and metadata', async () => {
    const sender = Client(serverUrl);
    const viewer = Client(serverUrl);

    await Promise.all([
      new Promise((resolve) => sender.on('connect', resolve)),
      new Promise((resolve) => viewer.on('connect', resolve))
    ]);

    await new Promise((resolve) => {
      sender.emit('room:join', { roomId: 'room-chat-live', role: 'sender', pin: 'chat123' }, resolve);
    });

    await new Promise((resolve) => {
      viewer.emit('room:join', { roomId: 'room-chat-live', role: 'viewer', pin: 'chat123' }, resolve);
    });

    const receivedByViewerPromise = new Promise((resolve) => {
      viewer.on('chat:message', (msg) => resolve(msg));
    });

    const receivedBySenderPromise = new Promise((resolve) => {
      sender.on('chat:message', (msg) => resolve(msg));
    });

    const ack = await new Promise((resolve) => {
      sender.emit('chat:message', {
        text: 'Hello viewers from Streamer!',
        senderName: 'Nova Streamer'
      }, resolve);
    });

    assert.equal(ack.success, true);
    assert.ok(ack.messageId);
    assert.ok(ack.timestamp);

    const [viewerMsg, senderMsg] = await Promise.all([receivedByViewerPromise, receivedBySenderPromise]);

    assert.equal(viewerMsg.id, ack.messageId);
    assert.equal(viewerMsg.roomId, 'room-chat-live');
    assert.equal(viewerMsg.senderRole, 'sender');
    assert.equal(viewerMsg.senderName, 'Nova Streamer');
    assert.equal(viewerMsg.text, 'Hello viewers from Streamer!');
    assert.ok(typeof viewerMsg.timestamp === 'number');

    assert.equal(senderMsg.id, ack.messageId);
    assert.equal(senderMsg.text, viewerMsg.text);

    // Now viewer sends a message back
    const senderReceivesReplyPromise = new Promise((resolve) => {
      sender.once('chat:message', (msg) => resolve(msg));
    });

    const viewerAck = await new Promise((resolve) => {
      viewer.emit('chat:message', {
        text: 'Loud and clear from Viewer!',
        senderName: 'Cosmic Falcon 900'
      }, resolve);
    });

    assert.equal(viewerAck.success, true);
    const reply = await senderReceivesReplyPromise;
    assert.equal(reply.text, 'Loud and clear from Viewer!');
    assert.equal(reply.senderName, 'Cosmic Falcon 900');
    assert.equal(reply.senderRole, 'viewer');

    sender.disconnect();
    viewer.disconnect();
  });

  await t.test('Retains bounded chat history and serves on chat:history', async () => {
    const sender = Client(serverUrl);
    await new Promise((resolve) => sender.on('connect', resolve));

    await new Promise((resolve) => {
      sender.emit('room:join', { roomId: 'room-chat-hist', role: 'sender', pin: 'chat123' }, resolve);
    });

    for (let i = 1; i <= 5; i++) {
      await new Promise((resolve) => {
        sender.emit('chat:message', { text: `Message #${i}`, senderName: 'HistoryTester' }, resolve);
      });
    }

    // A late-joining viewer joins and requests chat:history
    const lateViewer = Client(serverUrl);
    await new Promise((resolve) => lateViewer.on('connect', resolve));
    await new Promise((resolve) => {
      lateViewer.emit('room:join', { roomId: 'room-chat-hist', role: 'viewer', pin: 'chat123' }, resolve);
    });

    const historyRes = await new Promise((resolve) => {
      lateViewer.emit('chat:history', {}, resolve);
    });

    assert.equal(historyRes.success, true);
    assert.equal(historyRes.messages.length, 5);
    assert.equal(historyRes.messages[0].text, 'Message #1');
    assert.equal(historyRes.messages[4].text, 'Message #5');

    lateViewer.disconnect();
    sender.disconnect();
  });

  await t.test('Broadcasts chat:name-change as system message', async () => {
    const sender = Client(serverUrl);
    const viewer = Client(serverUrl);

    await Promise.all([
      new Promise((resolve) => sender.on('connect', resolve)),
      new Promise((resolve) => viewer.on('connect', resolve))
    ]);

    await new Promise((resolve) => {
      sender.emit('room:join', { roomId: 'room-name-test', role: 'sender', pin: 'chat123' }, resolve);
    });
    await new Promise((resolve) => {
      viewer.emit('room:join', { roomId: 'room-name-test', role: 'viewer', pin: 'chat123' }, resolve);
    });

    const sysPromise = new Promise((resolve) => {
      sender.on('chat:system', (sysMsg) => resolve(sysMsg));
    });

    viewer.emit('chat:name-change', {
      oldName: 'Guest 101',
      newName: 'Captain Cool'
    });

    const sysMsg = await sysPromise;
    assert.equal(sysMsg.isSystem, true);
    assert.match(sysMsg.text, /Guest 101.*changed their name to.*Captain Cool/);

    sender.disconnect();
    viewer.disconnect();
  });

  await t.test('Forwards and persists senderUserId in broadcast and history', async () => {
    const sender = Client(serverUrl);
    const viewer = Client(serverUrl);

    await Promise.all([
      new Promise((resolve) => sender.on('connect', resolve)),
      new Promise((resolve) => viewer.on('connect', resolve))
    ]);

    await new Promise((resolve) => {
      sender.emit('room:join', { roomId: 'room-userid-test', role: 'sender', pin: 'chat123' }, resolve);
    });
    await new Promise((resolve) => {
      viewer.emit('room:join', { roomId: 'room-userid-test', role: 'viewer', pin: 'chat123' }, resolve);
    });

    const viewerReceivePromise = new Promise((resolve) => {
      viewer.on('chat:message', (msg) => resolve(msg));
    });

    const sendAck = await new Promise((resolve) => {
      sender.emit('chat:message', {
        text: 'Message with persistent userId',
        senderName: 'Sender Pilot',
        senderUserId: 'user_persistent_123'
      }, resolve);
    });

    assert.equal(sendAck.success, true);
    const receivedMsg = await viewerReceivePromise;
    assert.equal(receivedMsg.senderUserId, 'user_persistent_123');

    // Verify history returns senderUserId
    const historyRes = await new Promise((resolve) => {
      viewer.emit('chat:history', {}, resolve);
    });
    assert.equal(historyRes.success, true);
    const found = historyRes.messages.find((m) => m.id === sendAck.messageId);
    assert.ok(found);
    assert.equal(found.senderUserId, 'user_persistent_123');

    sender.disconnect();
    viewer.disconnect();
  });
});
