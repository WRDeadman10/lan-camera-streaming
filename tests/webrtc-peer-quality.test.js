import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebRtcPeer } from '../src/public/js/webrtc-peer.js';

const answerSdp = [
  'v=0',
  'm=video 9 UDP/TLS/RTP/SAVPF 102 103',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  ''
].join('\r\n');

function createStub({ rejected = [] } = {}) {
  const applied = [];
  const stub = {
    applied,
    remoteDescriptions: [],
    state: { encodings: [{}], degradationPreference: undefined },
    closed: false
  };
  const videoSender = {
    track: {
      kind: 'video',
      contentHint: 'motion',
      getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 })
    },
    getParameters: () => JSON.parse(JSON.stringify(stub.state)),
    setParameters: async (params) => {
      if (rejected.includes(params.degradationPreference)) {
        throw new TypeError(`'${params.degradationPreference}' is not a valid enum value`);
      }
      applied.push(JSON.parse(JSON.stringify(params)));
      stub.state = JSON.parse(JSON.stringify(params));
    }
  };
  stub.pc = {
    getSenders: () => [videoSender],
    setRemoteDescription: async (description) => {
      stub.remoteDescriptions.push(description);
    },
    close: () => {
      stub.closed = true;
    }
  };
  return stub;
}

function createPeer(stub, config = {}) {
  const peer = new WebRtcPeer(config);
  peer.peerConnection = stub.pc;
  return peer;
}

const lastApplied = (stub) => stub.applied[stub.applied.length - 1];
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('WebRtcPeer quality priority', () => {
  let originalWarn;
  let originalSessionDescription;

  beforeEach(() => {
    originalWarn = console.warn;
    console.warn = () => {};
    originalSessionDescription = globalThis.RTCSessionDescription;
    globalThis.RTCSessionDescription = class {
      constructor(init) {
        Object.assign(this, init);
      }
    };
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
    console.warn = originalWarn;
    globalThis.RTCSessionDescription = originalSessionDescription;
  });

  test("'resolution' keeps resolution with a 12 Mbps ceiling and no scaling", async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    assert.equal(await peer.applyQualityPriority('resolution'), 'maintain-resolution');
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-resolution');
    assert.equal(lastApplied(stub).encodings[0].maxBitrate, 12000000);
    assert.equal(lastApplied(stub).encodings[0].scaleResolutionDownBy, undefined);
  });

  test("'both' uses the standard no-adaptation value with a 16 Mbps ceiling when Chrome accepts it", async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    assert.equal(await peer.applyQualityPriority('both'), 'maintain-framerate-and-resolution');
    assert.equal(lastApplied(stub).encodings[0].maxBitrate, 16000000);
  });

  test("'both' falls back to maintain-resolution when the first value is rejected and never remembers the rejected one", async () => {
    const stub = createStub({ rejected: ['maintain-framerate-and-resolution'] });
    const peer = createPeer(stub);
    assert.equal(await peer.applyQualityPriority('both'), 'maintain-resolution');
    assert.equal(peer.degradationPreference, 'maintain-resolution');
    assert.ok(stub.applied.every((params) => params.degradationPreference === 'maintain-resolution'), 'rejected calls are not applied');

    await peer.applyBitrateLimit(1500000, 1.0);
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-resolution', 'ABR keeps the accepted preference');
  });

  test('returns null and keeps no preference when every candidate is rejected', async () => {
    const stub = createStub({ rejected: ['maintain-resolution'] });
    const peer = createPeer(stub);
    assert.equal(await peer.applyQualityPriority('resolution'), null);
    assert.equal(peer.degradationPreference, null);
  });

  test("'fps' holds resolution before connecting and during the grace period, then switches to maintain-framerate", async () => {
    const stub = createStub();
    const peer = createPeer(stub);

    assert.equal(await peer.applyQualityPriority('fps'), 'maintain-resolution', 'pre-offer apply holds resolution without starting the timer');
    assert.equal(peer.isInGracePeriod(), false);

    assert.equal(await peer.applyQualityPriority('fps', { armGrace: true }), 'maintain-resolution');
    assert.equal(peer.isInGracePeriod(), true);

    mock.timers.tick(5999);
    await flush();
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-resolution');

    mock.timers.tick(1);
    await flush();
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-framerate');
    assert.equal(peer.isInGracePeriod(), false);
    assert.equal(lastApplied(stub).encodings[0].maxBitrate, 12000000);
  });

  test('re-arming the grace (source switch, mode change) toggles back to maintain-resolution first', async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    await peer.applyQualityPriority('fps', { armGrace: true });
    mock.timers.tick(6000);
    await flush();
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-framerate');

    await peer.applyQualityPriority('fps', { armGrace: true });
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-resolution');
    assert.equal(peer.isInGracePeriod(), true);

    mock.timers.tick(6000);
    await flush();
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-framerate');
  });

  test('switching to a mode without grace cancels a pending grace timer', async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    await peer.applyQualityPriority('fps', { armGrace: true });
    await peer.applyQualityPriority('resolution');
    assert.equal(peer.isInGracePeriod(), false);
    const callsBefore = stub.applied.length;
    mock.timers.tick(10000);
    await flush();
    assert.equal(stub.applied.length, callsBefore, 'the cancelled timer must not change anything');
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-resolution');
  });

  test('closing the peer cancels the grace timer', async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    await peer.applyQualityPriority('fps', { armGrace: true });
    const callsBefore = stub.applied.length;
    peer.close();
    mock.timers.tick(10000);
    await flush();
    assert.equal(stub.applied.length, callsBefore);
    assert.equal(stub.closed, true);
  });

  test('ABR changes keep the preference, skip identical calls and can scale the resolution', async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    await peer.applyQualityPriority('resolution');
    const callsBefore = stub.applied.length;

    assert.equal(await peer.applyBitrateLimit(12000000, 1.0), true);
    assert.equal(stub.applied.length, callsBefore, 'identical parameters must not call setParameters again');

    await peer.applyBitrateLimit(1500000, 1.5);
    assert.equal(lastApplied(stub).encodings[0].maxBitrate, 1500000);
    assert.equal(lastApplied(stub).encodings[0].scaleResolutionDownBy, 1.5);
    assert.equal(lastApplied(stub).degradationPreference, 'maintain-resolution');

    await peer.applyBitrateLimit(12000000, 1.0);
    assert.equal(lastApplied(stub).encodings[0].scaleResolutionDownBy, undefined, 'restoring removes the scale');
  });

  test('unknown modes behave like fps', async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    await peer.applyQualityPriority('turbo', { armGrace: true });
    assert.equal(peer.qualityMode, 'fps');
    assert.equal(peer.qualityCeilingBps, 12000000);
  });

  test('getSenderDiagnostics reports what Chrome holds, including the grace state', async () => {
    const stub = createStub();
    const peer = createPeer(stub);
    await peer.applyQualityPriority('fps', { armGrace: true });
    const diagnostics = peer.getSenderDiagnostics();
    assert.equal(diagnostics.maxBitrate, 12000000);
    assert.equal(diagnostics.degradationPreference, 'maintain-resolution');
    assert.equal(diagnostics.graceActive, true);
    assert.equal(diagnostics.trackWidth, 1920);
    assert.equal(diagnostics.contentHint, 'motion');
    assert.equal(diagnostics.qualityMode, 'fps');
  });
});

describe('WebRtcPeer answer bitrate hints', () => {
  let originalSessionDescription;

  beforeEach(() => {
    originalSessionDescription = globalThis.RTCSessionDescription;
    globalThis.RTCSessionDescription = class {
      constructor(init) {
        Object.assign(this, init);
      }
    };
  });

  afterEach(() => {
    globalThis.RTCSessionDescription = originalSessionDescription;
  });

  test("the viewer's answer gets the start/max bitrate of the viewer's mode before it is applied", async () => {
    for (const [mode, start, max] of [['fps', 10000, 12000], ['resolution', 10000, 12000], ['both', 12000, 16000]]) {
      const stub = createStub();
      const peer = createPeer(stub);
      peer.qualityMode = mode;
      await peer.handleAnswer({ type: 'answer', sdp: answerSdp });
      const sdp = stub.remoteDescriptions[0].sdp;
      assert.ok(sdp.includes(`x-google-start-bitrate=${start};x-google-max-bitrate=${max}`), mode);
      assert.ok(sdp.includes('a=fmtp:103 apt=102'), 'rtx payload untouched');
      assert.ok(!sdp.includes('x-google-min-bitrate'));
      assert.equal(stub.remoteDescriptions[0].type, 'answer');
    }
  });

  test('seeding can be switched off and a broken answer is applied unchanged instead of throwing', async () => {
    const off = createStub();
    await createPeer(off, { seedBitrate: false }).handleAnswer({ type: 'answer', sdp: answerSdp });
    assert.equal(off.remoteDescriptions[0].sdp, answerSdp);

    const broken = createStub();
    const warn = console.warn;
    console.warn = () => {};
    try {
      const peer = createPeer(broken);
      await peer.handleAnswer({ type: 'answer' });
      assert.equal(broken.remoteDescriptions.length, 1);
    } finally {
      console.warn = warn;
    }
  });
});
