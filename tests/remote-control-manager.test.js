/**
 * @file remote-control-manager.test.js
 * Unit tests for RemoteControlManager: credential authentication, PIN, rate limiting, and single-controller lease lifecycle.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RemoteControlManager } from '../src/server/remote-control-manager.js';

test('RemoteControlManager — Permanent Password Management', () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-ctrl-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const manager = new RemoteControlManager({ authFilePath: tmpAuthFile });
    assert.equal(manager.hasPermanentPassword(), false);
    assert.equal(manager.verifyPermanentPassword('anypass'), false);

    // Reject too-short password (< 6 chars)
    const shortRes = manager.setPermanentPassword('12345');
    assert.equal(shortRes.success, false);
    assert.match(shortRes.error, /at least 6 characters/i);

    // Set valid password
    const validRes = manager.setPermanentPassword('SecureRemotePass123!');
    assert.equal(validRes.success, true);
    assert.equal(manager.hasPermanentPassword(), true);

    // Verify correct password
    assert.equal(manager.verifyPermanentPassword('SecureRemotePass123!'), true);
    // Verify wrong password
    assert.equal(manager.verifyPermanentPassword('WrongPassword'), false);
    assert.equal(manager.verifyPermanentPassword(''), false);

    // Persistence across new manager instance with same file
    const manager2 = new RemoteControlManager({ authFilePath: tmpAuthFile });
    assert.equal(manager2.hasPermanentPassword(), true);
    assert.equal(manager2.verifyPermanentPassword('SecureRemotePass123!'), true);
    assert.equal(manager2.verifyPermanentPassword('WrongPassword'), false);

    // Clear password
    manager2.clearPermanentPassword();
    assert.equal(manager2.hasPermanentPassword(), false);
    assert.equal(manager2.verifyPermanentPassword('SecureRemotePass123!'), false);
  } finally {
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});

test('RemoteControlManager — Session PIN Generation and Verification', () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-ctrl-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const manager = new RemoteControlManager({ authFilePath: tmpAuthFile });
    const roomId = 'test-room-1';

    // Initial PIN is null
    assert.equal(manager.getSessionPin(roomId), null);

    // Generate 6-digit PIN
    const pin = manager.generateSessionPin(roomId);
    assert.equal(typeof pin, 'string');
    assert.match(pin, /^\d{6}$/);
    assert.equal(manager.getSessionPin(roomId), pin);

    // Verification
    assert.equal(manager.verifySessionPin(roomId, pin), true);
    assert.equal(manager.verifySessionPin(roomId, '000000'), false);
    assert.equal(manager.verifySessionPin(roomId, '123'), false);
    assert.equal(manager.verifySessionPin('other-room', pin), false);

    // Clear PIN
    manager.clearSessionPin(roomId);
    assert.equal(manager.getSessionPin(roomId), null);
    assert.equal(manager.verifySessionPin(roomId, pin), false);
  } finally {
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});

test('RemoteControlManager — Rate Limiting on Authentication Attempts', () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-ctrl-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const manager = new RemoteControlManager({
      authFilePath: tmpAuthFile,
      maxFailedAttempts: 3,
      lockoutDurationMs: 1000
    });
    const roomId = 'rate-room';
    manager.setControlEnabled(roomId, true);
    const pin = manager.generateSessionPin(roomId);

    const clientSocket = 'viewer-sock-1';

    // 1st failed attempt
    const r1 = manager.requestLease(roomId, clientSocket, 'wrong1');
    assert.equal(r1.success, false);
    assert.equal(manager.checkRateLimit(clientSocket).allowed, true);

    // 2nd failed attempt
    const r2 = manager.requestLease(roomId, clientSocket, 'wrong2');
    assert.equal(r2.success, false);
    assert.equal(manager.checkRateLimit(clientSocket).allowed, true);

    // 3rd failed attempt -> triggers lockout
    const r3 = manager.requestLease(roomId, clientSocket, 'wrong3');
    assert.equal(r3.success, false);
    assert.equal(manager.checkRateLimit(clientSocket).allowed, false);

    // 4th attempt even with CORRECT PIN is blocked during lockout
    const r4 = manager.requestLease(roomId, clientSocket, pin);
    assert.equal(r4.success, false);
    assert.match(r4.error, /Too many failed attempts/i);
    assert.ok(r4.retryAfter > 0);
  } finally {
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});

test('RemoteControlManager — Single Controller Lease Lifecycle and Revocation', () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-ctrl-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const manager = new RemoteControlManager({ authFilePath: tmpAuthFile });
    const roomId = 'lease-room';

    // Cannot request when control is disabled
    manager.setControlEnabled(roomId, false);
    const resDisabled = manager.requestLease(roomId, 'v1', '123456');
    assert.equal(resDisabled.success, false);
    assert.match(resDisabled.error, /not enabled/i);

    // Enable control and generate PIN
    manager.setControlEnabled(roomId, true);
    const pin = manager.generateSessionPin(roomId);

    // Viewer 1 acquires lease
    const grantRes = manager.requestLease(roomId, 'v1', pin);
    assert.equal(grantRes.success, true);
    assert.equal(grantRes.granted, true);
    assert.ok(grantRes.controllerToken);
    assert.equal(manager.isController(roomId, 'v1'), true);
    assert.equal(manager.isController(roomId, 'v2'), false);

    // Viewer 2 attempts to acquire lease while Viewer 1 holds it
    const v2Res = manager.requestLease(roomId, 'v2', pin);
    assert.equal(v2Res.success, false);
    assert.match(v2Res.error, /Another viewer is currently controlling/i);

    // Viewer 2 attempts to release lease (not controller)
    const badRelease = manager.releaseLease(roomId, 'v2');
    assert.equal(badRelease.success, false);
    assert.equal(manager.isController(roomId, 'v1'), true);

    // Host revokes lease
    const revokeRes = manager.revokeLease(roomId);
    assert.equal(revokeRes.success, true);
    assert.equal(revokeRes.revokedControllerId, 'v1');
    assert.equal(manager.isController(roomId, 'v1'), false);
    assert.equal(manager.getActiveController(roomId), null);

    // Viewer 2 can now acquire lease
    const v2Grant = manager.requestLease(roomId, 'v2', pin);
    assert.equal(v2Grant.success, true);
    assert.equal(manager.isController(roomId, 'v2'), true);

    // Viewer 2 releases explicitly
    const releaseRes = manager.releaseLease(roomId, 'v2');
    assert.equal(releaseRes.success, true);
    assert.equal(manager.isController(roomId, 'v2'), false);
  } finally {
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});

test('RemoteControlManager — Disconnect Grace Period and Reconnection', async () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-ctrl-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const manager = new RemoteControlManager({
      authFilePath: tmpAuthFile,
      gracePeriodMs: 150 // Short grace period for fast automated testing
    });
    const roomId = 'grace-room';
    manager.setControlEnabled(roomId, true);
    const pin = manager.generateSessionPin(roomId);

    // Viewer 1 connects and acquires control
    const grant = manager.requestLease(roomId, 'v1-socket', pin);
    assert.equal(grant.success, true);
    const token = grant.controllerToken;

    // Viewer 1 disconnects (e.g. Wi-Fi glitch / tab reload)
    const dcEvents = manager.handleSocketDisconnect('v1-socket');
    assert.equal(dcEvents.length, 1);
    assert.equal(dcEvents[0].wasController, true);
    assert.equal(dcEvents[0].inGrace, true);

    // During grace period, Viewer 2 cannot steal control
    const v2Res = manager.requestLease(roomId, 'v2-socket', pin);
    assert.equal(v2Res.success, false);
    assert.match(v2Res.error, /reconnection grace period/i);

    // Viewer 1 reconnects with new socket ID but providing valid controllerToken
    const reconnRes = manager.requestLease(roomId, 'v1-reconnected-socket', pin, {
      controllerToken: token
    });
    assert.equal(reconnRes.success, true);
    assert.equal(reconnRes.reconnected, true);
    assert.equal(manager.isController(roomId, 'v1-reconnected-socket'), true);

    // Disconnect again and let grace period expire
    manager.handleSocketDisconnect('v1-reconnected-socket');
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Now Viewer 2 CAN acquire control
    const v2Grant = manager.requestLease(roomId, 'v2-socket', pin);
    assert.equal(v2Grant.success, true);
    assert.equal(manager.isController(roomId, 'v2-socket'), true);
  } finally {
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});

test('RemoteControlManager — Sender Disconnect Terminates Control Session', () => {
  const tmpAuthFile = path.join(os.tmpdir(), `test-ctrl-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  try {
    const manager = new RemoteControlManager({ authFilePath: tmpAuthFile });
    const roomId = 'sender-dc-room';
    manager.setControlEnabled(roomId, true);
    manager.setSenderSocket(roomId, 'sender-socket-1');
    const pin = manager.generateSessionPin(roomId);

    // Viewer acquires control
    const grant = manager.requestLease(roomId, 'viewer-1', pin);
    assert.equal(grant.success, true);
    assert.equal(manager.isController(roomId, 'viewer-1'), true);

    // Sender closes tab / disconnects
    const dcEvents = manager.handleSocketDisconnect('sender-socket-1');
    assert.equal(dcEvents.length, 1);
    assert.equal(dcEvents[0].wasSender, true);
    assert.equal(dcEvents[0].revokedControllerId, 'viewer-1');

    // Lease should be revoked immediately
    assert.equal(manager.isController(roomId, 'viewer-1'), false);
    assert.equal(manager.getActiveController(roomId), null);
    assert.equal(manager.getSessionPin(roomId), null);
  } finally {
    if (fs.existsSync(tmpAuthFile)) {
      fs.unlinkSync(tmpAuthFile);
    }
  }
});
