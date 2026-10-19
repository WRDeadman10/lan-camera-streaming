/**
 * @file control-bridge.test.js
 * Unit tests for ControlBridge loopback TCP communication and message formatting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ControlBridge } from '../src/server/control-bridge.js';

test('ControlBridge — Connects, authenticates, and dispatches input commands', async () => {
  const receivedMessages = [];
  let serverSocket = null;

  // Mock native helper loopback server
  const mockServer = net.createServer((sock) => {
    serverSocket = sock;
    let buffer = '';

    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx = 0;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          const parsed = JSON.parse(line);
          receivedMessages.push(parsed);

          if (parsed.type === 'auth') {
            if (parsed.token === 'test-secret-token') {
              sock.write(JSON.stringify({ status: 'ok', authenticated: true }) + '\n');
            } else {
              sock.write(JSON.stringify({ status: 'error', error: 'Invalid token' }) + '\n');
            }
          } else {
            sock.write(JSON.stringify({ status: 'ok' }) + '\n');
          }
        }
      }
    });
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;

  const bridge = new ControlBridge({
    host: '127.0.0.1',
    port,
    authToken: 'test-secret-token'
  });

  try {
    const connected = await bridge.connect();
    assert.equal(connected, true);

    // Give time for auth exchange
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), true);

    // Send mouse move
    const moveRes = bridge.sendInput({ type: 'mouse_move', x: 0.25, y: 0.75 });
    assert.equal(moveRes, true);

    // Send mouse down & up
    bridge.sendInput({ type: 'mouse_down', button: 'left' });
    bridge.sendInput({ type: 'mouse_up', button: 'left' });

    // Send mouse wheel
    bridge.sendInput({ type: 'mouse_wheel', deltaY: -120, deltaX: 0 });

    // Send keyboard key_down & key_up
    bridge.sendInput({ type: 'key_down', code: 'KeyA' });
    bridge.sendInput({ type: 'key_up', code: 'KeyA' });

    // Send release_all
    bridge.releaseAll();

    // Verify messages received by mock server
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(receivedMessages.length >= 7);

    assert.equal(receivedMessages[0].type, 'auth');
    assert.equal(receivedMessages[0].token, 'test-secret-token');

    assert.equal(receivedMessages[1].type, 'mouse_move');
    assert.equal(receivedMessages[1].x, 0.25);
    assert.equal(receivedMessages[1].y, 0.75);

    assert.equal(receivedMessages[2].type, 'mouse_down');
    assert.equal(receivedMessages[2].button, 'left');

    assert.equal(receivedMessages[3].type, 'mouse_up');
    assert.equal(receivedMessages[3].button, 'left');

    assert.equal(receivedMessages[4].type, 'mouse_wheel');
    assert.equal(receivedMessages[4].deltaY, -120);

    assert.equal(receivedMessages[5].type, 'key_down');
    assert.equal(receivedMessages[5].code, 'KeyA');

    assert.equal(receivedMessages[6].type, 'key_up');
    assert.equal(receivedMessages[6].code, 'KeyA');

    assert.equal(receivedMessages[7].type, 'release_all');
  } finally {
    bridge.disconnect();
    if (serverSocket) {
      serverSocket.destroy();
    }
    await new Promise((resolve) => mockServer.close(resolve));
  }
});
