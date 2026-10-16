/**
 * @file signaling-control.test.js
 * Unit tests for remote control signaling events in signaling.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';

test('Signaling Control Events — Sender enables control, generates PIN, viewer acquires lease, and host revokes', async () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-sig-ctrl-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const config = loadConfig({
    PORT: '3045',
    ACCESS_PIN: 'testpin123',
    controlAuthFilePath: tmpAuthFile
  });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  const { remoteControlManager } = setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;
  const socketUrl = `http://127.0.0.1:${port}`;

  const senderClient = Client(socketUrl);
  const viewerClient = Client(socketUrl);

  try {
    await Promise.all([
      new Promise((res) => senderClient.on('connect', res)),
      new Promise((res) => viewerClient.on('connect', res))
    ]);

    const roomId = 'ctrl-sig-room';

    // 1. Join room
    const senderJoin = await new Promise((res) => {
      senderClient.emit('room:join', { roomId, role: 'sender', pin: 'testpin123' }, res);
    });
    assert.equal(senderJoin.success, true);
    assert.equal(senderJoin.controlState.enabled, false);

    const viewerJoin = await new Promise((res) => {
      viewerClient.emit('room:join', { roomId, role: 'viewer', pin: 'testpin123' }, res);
    });
    assert.equal(viewerJoin.success, true);

    // 2. Viewer attempts to toggle control (should be rejected)
    const badEnable = await new Promise((res) => {
      viewerClient.emit('control:enable', { roomId, enabled: true }, res);
    });
    assert.equal(badEnable.success, false);
    assert.match(badEnable.error, /Unauthorized/i);

    // 3. Sender enables control
    const senderEnable = await new Promise((res) => {
      senderClient.emit('control:enable', { roomId, enabled: true }, res);
    });
    assert.equal(senderEnable.success, true);
    assert.equal(senderEnable.enabled, true);
    assert.match(senderEnable.sessionPin, /^\d{6}$/);
    const sessionPin = senderEnable.sessionPin;

    // 4. Viewer requests lease with invalid PIN (should fail)
    const badLease = await new Promise((res) => {
      viewerClient.emit('control:request-lease', { roomId, credential: '000000' }, res);
    });
    assert.equal(badLease.success, false);
    assert.match(badLease.error, /Invalid control PIN/i);

    // 5. Viewer requests lease with valid PIN (should succeed)
    const leasePromise = new Promise((res) => {
      senderClient.once('control:controller-joined', res);
    });

    const goodLease = await new Promise((res) => {
      viewerClient.emit('control:request-lease', { roomId, credential: sessionPin }, res);
    });
    assert.equal(goodLease.success, true);
    assert.equal(goodLease.granted, true);
    assert.ok(goodLease.controllerToken);

    const joinNotification = await leasePromise;
    assert.equal(joinNotification.controllerId, viewerClient.id);

    // 6. Sender sets permanent password
    const setPass = await new Promise((res) => {
      senderClient.emit('control:password:set', { password: 'HostPassword123' }, res);
    });
    assert.equal(setPass.success, true);

    const hasPass = await new Promise((res) => {
      viewerClient.emit('control:password:has', res);
    });
    assert.equal(hasPass.hasPassword, true);

    // 7. Sender revokes control
    const revokePromise = new Promise((res) => {
      viewerClient.once('control:revoked', res);
    });

    const revokeRes = await new Promise((res) => {
      senderClient.emit('control:revoke', { roomId }, res);
    });
    assert.equal(revokeRes.success, true);
    assert.equal(revokeRes.revoked, true);

    const revokeNotice = await revokePromise;
    assert.equal(revokeNotice.reason, 'revoked_by_host');

    // 8. Viewer can now acquire lease using permanent password
    const passLease = await new Promise((res) => {
      viewerClient.emit('control:request-lease', { roomId, credential: 'HostPassword123' }, res);
    });
    assert.equal(passLease.success, true);
    assert.equal(passLease.granted, true);

    // 9. Viewer releases lease
    const releaseRes = await new Promise((res) => {
      viewerClient.emit('control:release', { roomId }, res);
    });
    assert.equal(releaseRes.success, true);
  } finally {
    senderClient.disconnect();
    viewerClient.disconnect();
    await new Promise((resolve) => httpServer.close(resolve));
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});
