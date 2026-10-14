import { describe, test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { CameraManager } from '../src/public/js/camera-manager.js';

describe('CameraManager Capture and Audio Handling', () => {
  let mockTracks;
  let lastGUMConstraints;
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    mockTracks = [
      {
        kind: 'video',
        readyState: 'live',
        stop: () => {},
        applyConstraints: async () => {},
        getCapabilities: () => ({ torch: true, zoom: { min: 1, max: 5 } })
      }
    ];
    lastGUMConstraints = null;

    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: true },
      configurable: true,
      writable: true
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: async (constraints) => {
            lastGUMConstraints = constraints;
            return {
              getTracks: () => mockTracks,
              getVideoTracks: () => mockTracks.filter((t) => t.kind === 'video'),
              getAudioTracks: () => mockTracks.filter((t) => t.kind === 'audio')
            };
          },
          enumerateDevices: async () => [
            { kind: 'videoinput', deviceId: 'cam-1', label: 'Front Camera' }
          ]
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

  test('startCapture succeeds without throwing "withAudio is not defined" when withAudio is omitted', async () => {
    const manager = new CameraManager();
    const stream = await manager.startCapture({
      width: 1280,
      height: 720,
      frameRate: 30
    });
    assert.ok(stream, 'Stream must be returned');
    assert.strictEqual(lastGUMConstraints.audio, false, 'Default audio constraint must be false');
    assert.strictEqual(lastGUMConstraints.video.width.ideal, 1280);
  });

  test('startCapture correctly passes audio: true when withAudio is true', async () => {
    const manager = new CameraManager();
    const stream = await manager.startCapture({
      withAudio: true
    });
    assert.ok(stream, 'Stream must be returned');
    assert.strictEqual(lastGUMConstraints.audio, true, 'Audio constraint must be true');
  });

  test('startCapture falls back to video-only if audio capture throws error', async () => {
    let callCount = 0;
    global.navigator.mediaDevices.getUserMedia = async (constraints) => {
      callCount++;
      if (constraints.audio) {
        const audioErr = new Error('Microphone not found or denied');
        audioErr.name = 'NotFoundError';
        throw audioErr;
      }
      return {
        getTracks: () => mockTracks,
        getVideoTracks: () => mockTracks.filter((t) => t.kind === 'video'),
        getAudioTracks: () => []
      };
    };

    const manager = new CameraManager();
    const stream = await manager.startCapture({
      withAudio: true
    });
    assert.ok(stream, 'Stream must be returned via video-only fallback');
    assert.strictEqual(callCount, 2, 'getUserMedia should be called twice (first with audio, then fallback without audio)');
  });

  test('stopCapture cleanly stops all tracks and nullifies currentStream', async () => {
    let stoppedCount = 0;
    mockTracks[0].stop = () => { stoppedCount++; };

    const manager = new CameraManager();
    await manager.startCapture();
    assert.ok(manager.currentStream);

    manager.stopCapture();
    assert.strictEqual(stoppedCount, 1, 'Track stop() must be called');
    assert.strictEqual(manager.currentStream, null, 'currentStream must be reset to null');
  });
});
