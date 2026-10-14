import { describe, test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { CameraManager } from '../src/public/js/camera-manager.js';
import { BatteryMonitor } from '../src/public/js/battery-monitor.js';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';
import { io as Client } from 'socket.io-client';

describe('Camera Focus and Battery Controls', () => {
  let mockTrack;
  let lastAppliedConstraints;
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    lastAppliedConstraints = null;
    mockTrack = {
      kind: 'video',
      readyState: 'live',
      applyConstraints: async (constraints) => {
        lastAppliedConstraints = constraints;
      },
      getCapabilities: () => ({
        focusMode: ['continuous', 'manual', 'single-shot'],
        focusDistance: { min: 0.1, max: 10.0, step: 0.05 }
      }),
      stop: () => {}
    };

    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: true },
      configurable: true,
      writable: true
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [mockTrack],
            getVideoTracks: () => [mockTrack],
            getAudioTracks: () => []
          }),
          enumerateDevices: async () => []
        }
      },
      configurable: true,
      writable: true
    });
  });

  after(() => {
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    } else {
      delete globalThis.navigator;
    }
    if (originalWindowDesc) {
      Object.defineProperty(globalThis, 'window', originalWindowDesc);
    } else {
      delete globalThis.window;
    }
  });

  test('CameraManager applyFocusMode applies focusMode advanced constraint', async () => {
    const manager = new CameraManager();
    await manager.startCapture();

    const okManual = await manager.applyFocusMode('manual');
    assert.strictEqual(okManual, true);
    assert.deepStrictEqual(lastAppliedConstraints, { advanced: [{ focusMode: 'manual' }] });

    const okContinuous = await manager.applyFocusMode('continuous');
    assert.strictEqual(okContinuous, true);
    assert.deepStrictEqual(lastAppliedConstraints, { advanced: [{ focusMode: 'continuous' }] });

    const okSingleShot = await manager.applyFocusMode('single-shot');
    assert.strictEqual(okSingleShot, true);
    assert.deepStrictEqual(lastAppliedConstraints, { advanced: [{ focusMode: 'single-shot' }] });
  });

  test('CameraManager applyFocusDistance applies manual focusDistance constraint', async () => {
    const manager = new CameraManager();
    await manager.startCapture();

    const ok = await manager.applyFocusDistance(0.75);
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(lastAppliedConstraints, {
      advanced: [{ focusMode: 'manual', focusDistance: 0.75 }]
    });
  });

  test('CameraManager getFocusCapabilities extracts focus modes and distance bounds', async () => {
    const manager = new CameraManager();
    assert.strictEqual(manager.getFocusCapabilities(), null);

    await manager.startCapture();
    const caps = manager.getFocusCapabilities();
    assert.ok(caps);
    assert.deepStrictEqual(caps.focusMode, ['continuous', 'manual', 'single-shot']);
    assert.strictEqual(caps.focusDistance.min, 0.1);
    assert.strictEqual(caps.focusDistance.max, 10.0);
  });

  test('BatteryMonitor queries navigator.getBattery and emits battery events', async () => {
    const listeners = {};
    const mockBattery = {
      level: 0.85,
      charging: true,
      chargingTime: 1200,
      dischargingTime: Infinity,
      addEventListener: (type, cb) => {
        listeners[type] = cb;
      },
      removeEventListener: (type) => {
        delete listeners[type];
      }
    };

    Object.defineProperty(globalThis.navigator, 'getBattery', {
      value: async () => mockBattery,
      configurable: true,
      writable: true
    });

    let lastReport = null;
    const monitor = new BatteryMonitor((data) => {
      lastReport = data;
    });

    // Wait for async _init
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(lastReport);
    assert.strictEqual(lastReport.level, 85);
    assert.strictEqual(lastReport.charging, true);

    // Simulate battery level drop
    mockBattery.level = 0.42;
    mockBattery.charging = false;
    if (listeners.levelchange) listeners.levelchange();

    assert.strictEqual(lastReport.level, 42);
    assert.strictEqual(lastReport.charging, false);

    monitor.destroy();
    assert.strictEqual(Object.keys(listeners).length, 0);
  });

  test('Socket.IO signaling forwards sender:battery event to room viewers', async () => {
    const config = loadConfig({ PORT: '3049', ACCESS_PIN: 'testpass' });
    const logger = new Logger('error');
    const { httpServer } = createServer(config, logger);
    setupSignaling(httpServer, config, logger);

    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    const socketUrl = `http://127.0.0.1:${address.port}`;

    const senderClient = Client(socketUrl);
    const viewerClient = Client(socketUrl);

    try {
      await Promise.all([
        new Promise((resolve) => senderClient.on('connect', resolve)),
        new Promise((resolve) => viewerClient.on('connect', resolve))
      ]);

      // Join room
      await new Promise((resolve) => {
        senderClient.emit('room:join', { roomId: 'batt-room', role: 'sender', pin: 'testpass' }, resolve);
      });
      await new Promise((resolve) => {
        viewerClient.emit('room:join', { roomId: 'batt-room', role: 'viewer', pin: 'testpass' }, resolve);
      });

      // Sender broadcasts battery status
      const receivedBatteryPromise = new Promise((resolve) => {
        viewerClient.on('sender:battery', (data) => resolve(data));
      });

      senderClient.emit('sender:battery', { level: 78, charging: false });

      const received = await receivedBatteryPromise;
      assert.ok(received);
      assert.strictEqual(received.level, 78);
      assert.strictEqual(received.charging, false);
    } finally {
      senderClient.disconnect();
      viewerClient.disconnect();
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });
});
