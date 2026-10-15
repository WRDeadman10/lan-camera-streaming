import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEncoder } from '../src/public/js/encoder-info.js';
import { formatSenderStats } from '../src/public/js/sender-stats.js';

describe('Encoder classification', () => {
  test('recognises the encoders Chrome reports on Windows GPUs', () => {
    assert.equal(classifyEncoder({ encoderImplementation: 'D3D12VideoEncodeAccelerator', powerEfficientEncoder: null }), 'hardware');
    assert.equal(classifyEncoder({ encoderImplementation: 'MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)', powerEfficientEncoder: true }), 'hardware');
    assert.equal(classifyEncoder({ encoderImplementation: 'ExternalEncoder' }), 'hardware');
  });

  test('recognises software encoders even when powerEfficientEncoder is missing', () => {
    assert.equal(classifyEncoder({ encoderImplementation: 'OpenH264', powerEfficientEncoder: null }), 'software');
    assert.equal(classifyEncoder({ encoderImplementation: 'libvpx', powerEfficientEncoder: false }), 'software');
  });

  test('powerEfficientEncoder true wins; an unrecognised name with no hint is unknown, never software', () => {
    assert.equal(classifyEncoder({ encoderImplementation: 'SomeNewEncoder', powerEfficientEncoder: true }), 'hardware');
    assert.equal(classifyEncoder({ encoderImplementation: 'SomeNewEncoder', powerEfficientEncoder: null }), 'unknown');
    assert.equal(classifyEncoder({}), 'unknown');
    assert.equal(classifyEncoder(null), 'unknown');
  });

  test('an unrecognised name with powerEfficientEncoder false is software', () => {
    assert.equal(classifyEncoder({ encoderImplementation: 'SomeNewEncoder', powerEfficientEncoder: false }), 'software');
  });
});

describe('Sender stats line', () => {
  const stats = {
    rtt: '1 ms',
    frameWidth: 1920,
    frameHeight: 1080,
    framesPerSecond: 29.8,
    sourceFramesPerSecond: 30,
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetBitrate: 7900000,
    availableOutgoingBitrate: 12400000,
    qualityLimitationReason: 'none',
    qualityLimitationResolutionChanges: 0,
    qualityLimitationDurations: { none: 41.2, bandwidth: 0, cpu: 0, other: 0 },
    codec: 'H264',
    encoderImplementation: 'D3D12VideoEncodeAccelerator',
    contentType: 'realtime'
  };
  const diagnostics = {
    maxBitrate: 12000000,
    scaleResolutionDownBy: 1,
    degradationPreference: 'maintain-framerate',
    contentHint: 'motion',
    trackWidth: 1920,
    trackHeight: 1080,
    trackFrameRate: 30,
    graceActive: false
  };

  test('shows what is needed to separate capture, estimate and quality-scaler causes', () => {
    const line = formatSenderStats({ stats, diagnostics, mode: 'fps', abrLevel: 'ok', pairInfo: 'host (a) <-> prflx (b)' });
    for (const expected of [
      'mode=fps pref=maintain-framerate',
      'sent 1920x1080 @ 30 fps (src 30 fps 1920x1080)',
      'target 7.90 Mbps',
      'availOut 12.40 Mbps',
      'maxBitrate 12.00 Mbps',
      'scaleDownBy 1.0',
      'LimitReason=none',
      'resChanges 0',
      'limitDur none:41.2,bandwidth:0.0,cpu:0.0,other:0.0',
      'enc H264 D3D12VideoEncodeAccelerator',
      'hint=motion track 1920x1080@30',
      'abr=ok'
    ]) {
      assert.ok(line.includes(expected), expected);
    }
  });

  test('marks the resolution hold and prints "?" for missing fields instead of throwing', () => {
    const held = formatSenderStats({ stats: { rtt: '2 ms' }, diagnostics: { degradationPreference: 'maintain-resolution', graceActive: true }, mode: 'fps', abrLevel: 'ok', pairInfo: 'x' });
    assert.ok(held.includes('pref=maintain-resolution (resolution hold)'));
    assert.ok(held.includes('sent ? @ ? fps (src ? fps ?)'));
    assert.ok(held.includes('target ?'));
    const bare = formatSenderStats({ stats: {}, diagnostics: null, mode: 'both', abrLevel: 'moderate', pairInfo: 'x' });
    assert.ok(bare.includes('mode=both pref=?'));
    assert.ok(bare.includes('abr=moderate'));
  });
});
