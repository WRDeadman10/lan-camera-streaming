import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';

test('Rate limiting enforces temporary block after consecutive invalid PIN attempts', async () => {
  const config = loadConfig({ PORT: '3003', ACCESS_PIN: 'supersecret' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const socketUrl = `http://127.0.0.1:${address.port}`;

  const client = Client(socketUrl);

  try {
    await new Promise((res) => client.on('connect', res));

    // Attempt 5 bad joins
    for (let i = 0; i < 5; i++) {
      const res = await new Promise((r) => {
        client.emit('room:join', { roomId: 'rate-room', role: 'sender', pin: 'wrong' }, r);
      });
      assert.equal(res.success, false);
      assert.equal(res.error, 'Invalid access PIN');
    }

    // 6th attempt should be rate limited
    const rateLimitedRes = await new Promise((r) => {
      client.emit('room:join', { roomId: 'rate-room', role: 'sender', pin: 'supersecret' }, r);
    });
    assert.equal(rateLimitedRes.success, false);
    assert.match(rateLimitedRes.error, /Too many failed attempts/);

  } finally {
    client.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
