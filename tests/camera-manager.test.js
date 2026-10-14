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

describe('CameraManager Screen Capture and Aspect-Preserving Scaling', () => {
  let mockScreenTracks;
  let lastGDMConstraints;
  let appliedTrackConstraints;
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    appliedTrackConstraints = null;
    mockScreenTracks = [
      {
        kind: 'video',
        readyState: 'live',
        stop: () => {},
        applyConstraints: async (c) => { appliedTrackConstraints = c; },
        getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }),
        getCapabilities: () => ({ width: { min: 320, max: 3840 }, height: { min: 240, max: 2160 } })
      }
    ];
    lastGDMConstraints = null;

    Object.defineProperty(globalThis, 'window', {
      value: { isSecureContext: true },
      configurable: true,
      writable: true
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [],
            getVideoTracks: () => [],
            getAudioTracks: () => []
          }),
          getDisplayMedia: async (constraints) => {
            lastGDMConstraints = constraints;
            return {
              getTracks: () => mockScreenTracks,
              getVideoTracks: () => mockScreenTracks.filter((t) => t.kind === 'video'),
              getAudioTracks: () => mockScreenTracks.filter((t) => t.kind === 'audio')
            };
          }
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

  test('startScreenCapture requests full quality with unconstrained native bounds when resolution is max', async () => {
    const manager = new CameraManager();
    const stream = await manager.startScreenCapture({ resolution: 'max' });
    assert.ok(stream);
    assert.strictEqual(lastGDMConstraints.video.width.max, 7680, 'Full quality should allow high native width');
    assert.strictEqual(lastGDMConstraints.video.height.max, 4320, 'Full quality should allow high native height');
  });

  test('startScreenCapture applies proportional bounds for 720p preserving aspect ratio', async () => {
    const manager = new CameraManager();
    const stream = await manager.startScreenCapture({ resolution: '720p' });
    assert.ok(stream);
    assert.strictEqual(lastGDMConstraints.video.width.max, 1280, '720p maximum width bounding box');
    assert.strictEqual(lastGDMConstraints.video.height.max, 720, '720p maximum height bounding box');
  });

  test('startScreenCapture applies proportional bounds for 1080p and 480p', async () => {
    const manager = new CameraManager();
    await manager.startScreenCapture({ resolution: '1080p' });
    assert.strictEqual(lastGDMConstraints.video.width.max, 1920);
    assert.strictEqual(lastGDMConstraints.video.height.max, 1080);

    await manager.startScreenCapture({ resolution: '480p' });
    assert.strictEqual(lastGDMConstraints.video.width.max, 854);
    assert.strictEqual(lastGDMConstraints.video.height.max, 480);
  });

  test('startScreenCapture passes audio constraint and falls back to video-only if audio fails', async () => {
    let callCount = 0;
    global.navigator.mediaDevices.getDisplayMedia = async (constraints) => {
      callCount++;
      if (constraints.audio) {
        const audioErr = new Error('Audio not supported for display');
        audioErr.name = 'NotSupportedError';
        throw audioErr;
      }
      return {
        getTracks: () => mockScreenTracks,
        getVideoTracks: () => mockScreenTracks,
        getAudioTracks: () => []
      };
    };

    const manager = new CameraManager();
    const stream = await manager.startScreenCapture({ withAudio: true });
    assert.ok(stream);
    assert.strictEqual(callCount, 2, 'Should fall back to video-only if audio fails');
  });

  test('applyScreenResolution dynamically updates track constraints preserving aspect ratio', async () => {
    const manager = new CameraManager();
    await manager.startScreenCapture({ resolution: 'max' });
    const success = await manager.applyScreenResolution('720p');
    assert.strictEqual(success, true);
    assert.ok(appliedTrackConstraints);
    assert.strictEqual(appliedTrackConstraints.width.max, 1280);
    assert.strictEqual(appliedTrackConstraints.height.max, 720);
  });

  test('applyScreenResolution handles portrait displays correctly', async () => {
    // Mock portrait stream (e.g. mobile screen 1080x1920)
    mockScreenTracks[0].getSettings = () => ({ width: 1080, height: 1920, frameRate: 30 });
    const manager = new CameraManager();
    await manager.startScreenCapture({ resolution: 'max' });
    const success = await manager.applyScreenResolution('720p');
    assert.strictEqual(success, true);
    assert.strictEqual(appliedTrackConstraints.width.max, 720, 'Portrait width should be short edge');
    assert.strictEqual(appliedTrackConstraints.height.max, 1280, 'Portrait height should be long edge');
  });

  test('startScreenCapture throws descriptive error when user cancels permission dialog', async () => {
    global.navigator.mediaDevices.getDisplayMedia = async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    };
    const manager = new CameraManager();
    await assert.rejects(
      async () => { await manager.startScreenCapture(); },
      /Screen sharing permission denied or cancelled by user/
    );
  });

  test('startScreenCapture keeps the live stream running when the picker is cancelled', async () => {
    const manager = new CameraManager();
    let liveStopCount = 0;
    const liveStream = {
      getTracks: () => [{ stop: () => { liveStopCount++; } }]
    };
    manager.currentStream = liveStream;

    global.navigator.mediaDevices.getDisplayMedia = async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    };

    await assert.rejects(async () => { await manager.startScreenCapture(); });
    assert.strictEqual(liveStopCount, 0, 'Cancelling the picker must not stop the active stream');
    assert.strictEqual(manager.currentStream, liveStream);
  });

  test('startScreenCapture releases the previous stream only after the new display stream is acquired', async () => {
    const manager = new CameraManager();
    let liveStopCount = 0;
    manager.currentStream = {
      getTracks: () => [{ stop: () => { liveStopCount++; } }]
    };

    const stream = await manager.startScreenCapture();
    assert.strictEqual(liveStopCount, 1, 'Previous stream tracks stop once the new stream is acquired');
    assert.strictEqual(manager.currentStream, stream);
  });

  test('startScreenCapture does not re-open the picker when the user cancels with audio requested', async () => {
    let callCount = 0;
    global.navigator.mediaDevices.getDisplayMedia = async () => {
      callCount++;
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    };

    const manager = new CameraManager();
    await assert.rejects(
      async () => { await manager.startScreenCapture({ withAudio: true }); },
      /Screen sharing permission denied or cancelled by user/
    );
    assert.strictEqual(callCount, 1, 'A denied picker must not be re-prompted without a user gesture');
  });
});
