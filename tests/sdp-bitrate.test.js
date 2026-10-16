import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecommendedBitrateHints,
  buildBitrateParams,
  getRecommendedBitrateHints,
  isQualityMode,
  mungeVideoBitrate,
  readVideoBitrateParams
} from '../src/public/js/sdp-bitrate.js';

const crlf = (lines) => lines.join('\r\n') + '\r\n';

const sdp = crlf([
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 102 103 104 105 96 97 98 99 100 101',
  'c=IN IP4 0.0.0.0',
  'a=rtcp-fb:102 goog-remb',
  'a=rtcp-fb:102 transport-cc',
  'a=rtcp-fb:102 nack',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  'a=rtcp-fb:104 goog-remb',
  'a=rtcp-fb:104 nack',
  'a=rtpmap:104 VP8/90000',
  'a=rtpmap:105 rtx/90000',
  'a=fmtp:105 apt=104',
  'a=rtpmap:96 VP9/90000',
  'a=fmtp:96 profile-id=0;x-google-start-bitrate=100;x-google-max-bitrate=500',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 red/90000',
  'a=rtpmap:99 rtx/90000',
  'a=fmtp:99 apt=98',
  'a=rtpmap:100 ulpfec/90000',
  'a=rtpmap:101 flexfec-03/90000',
  'a=fmtp:101 repair-window=10000000'
]);

const bitrate = { startKbps: 6000, minKbps: 2500, maxKbps: 8000 };
const wanted = 'x-google-start-bitrate=6000;x-google-min-bitrate=2500;x-google-max-bitrate=8000';

describe('SDP bitrate hints', () => {
  test('appends to an existing H264 fmtp line and keeps its parameters', () => {
    const out = mungeVideoBitrate(sdp, bitrate);
    assert.ok(out.includes(`a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f;${wanted}\r\n`));
  });

  test('inserts a new fmtp line for VP8 (none existed) after its rtcp-fb/rtpmap block', () => {
    const out = mungeVideoBitrate(sdp, bitrate).split('\r\n');
    const vp8 = out.indexOf('a=rtpmap:104 VP8/90000');
    assert.equal(out[vp8 + 1], `a=fmtp:104 ${wanted}`);
  });

  test('inserts the fmtp line after the LAST rtcp-fb line when rtcp-fb follows rtpmap', () => {
    const custom = crlf(['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', 'a=rtcp-fb:96 nack', 'a=rtcp-fb:96 nack pli', 'a=mid:0']);
    const out = mungeVideoBitrate(custom, { startKbps: 1000 }).split('\r\n');
    assert.equal(out[out.indexOf('a=rtcp-fb:96 nack pli') + 1], 'a=fmtp:96 x-google-start-bitrate=1000');
  });

  test('replaces existing x-google values instead of duplicating them', () => {
    const out = mungeVideoBitrate(sdp, bitrate);
    assert.ok(out.includes(`a=fmtp:96 profile-id=0;${wanted}\r\n`));
    assert.equal((out.match(/x-google-start-bitrate/g) || []).length, 3);
  });

  test('never touches rtx, red, ulpfec, flexfec or audio payloads', () => {
    const out = mungeVideoBitrate(sdp, bitrate);
    for (const line of ['a=fmtp:103 apt=102', 'a=fmtp:105 apt=104', 'a=fmtp:97 apt=96', 'a=fmtp:99 apt=98', 'a=fmtp:101 repair-window=10000000', 'a=fmtp:111 minptime=10;useinbandfec=1']) {
      assert.ok(out.includes(line + '\r\n'), line);
    }
    assert.ok(!/a=fmtp:(98|100) /.test(out));
    const touched = readVideoBitrateParams(out).map((entry) => entry.payload).sort();
    assert.deepEqual(touched, ['102', '104', '96']);
  });

  test('codec filter limits the change to the named codecs', () => {
    const out = mungeVideoBitrate(sdp, { ...bitrate, codecs: ['h264'] });
    const byPayload = Object.fromEntries(readVideoBitrateParams(out).map((entry) => [entry.payload, entry.params]));
    assert.equal(byPayload['102']['x-google-max-bitrate'], 8000);
    assert.deepEqual(byPayload['96'], { 'x-google-start-bitrate': 100, 'x-google-max-bitrate': 500 });
    assert.equal(byPayload['104'], undefined);
  });

  test('rejected video sections (port 0) are left alone', () => {
    const rejected = crlf(['m=video 0 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000']);
    assert.equal(mungeVideoBitrate(rejected, bitrate), rejected);
  });

  test('line endings and the trailing break are preserved', () => {
    const lf = sdp.replace(/\r\n/g, '\n');
    const out = mungeVideoBitrate(lf, bitrate);
    assert.ok(!out.includes('\r'));
    assert.ok(out.endsWith('\n'));
    assert.equal(mungeVideoBitrate(sdp.slice(0, -2), bitrate).endsWith('\r\n'), false);
  });

  test('is idempotent', () => {
    const once = mungeVideoBitrate(sdp, bitrate);
    assert.equal(mungeVideoBitrate(once, bitrate), once);
  });

  test('no values requested, empty or non-string sdp returns the input', () => {
    assert.equal(mungeVideoBitrate(sdp, {}), sdp);
    assert.equal(mungeVideoBitrate('', bitrate), '');
    assert.equal(mungeVideoBitrate(undefined, bitrate), undefined);
  });

  test('inconsistent values are normalised (min<=start<=max) and bad values throw', () => {
    assert.deepEqual(buildBitrateParams({ startKbps: 9000, minKbps: 9500, maxKbps: 8000 }), ['x-google-start-bitrate=8000', 'x-google-min-bitrate=8000', 'x-google-max-bitrate=8000']);
    assert.deepEqual(buildBitrateParams({ startKbps: 500, minKbps: 1500 }), ['x-google-start-bitrate=1500', 'x-google-min-bitrate=1500']);
    assert.throws(() => buildBitrateParams({ startKbps: -1 }), RangeError);
    assert.throws(() => buildBitrateParams({ maxKbps: 'abc' }), RangeError);
  });

  test('single values produce only that parameter', () => {
    const out = mungeVideoBitrate(sdp, { maxKbps: 12000 });
    assert.ok(out.includes('a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f;x-google-max-bitrate=12000\r\n'));
  });
});

describe('Recommended bitrate hints', () => {
  test('every mode has consistent SDP and encoding ceilings and never sets a minimum', () => {
    for (const mode of ['fps', 'resolution', 'both']) {
      const hints = getRecommendedBitrateHints(mode);
      assert.ok(hints.sdp.startKbps <= hints.sdp.maxKbps);
      assert.equal(hints.sdp.maxKbps * 1000, hints.encodingMaxBitrateBps);
      assert.equal(hints.sdp.minKbps, undefined, 'x-google-min-bitrate has no effect and can break the answer');
      const out = mungeVideoBitrate(sdp, hints.sdp);
      assert.ok(out.includes(`x-google-start-bitrate=${hints.sdp.startKbps}`));
      assert.ok(!out.includes('x-google-min-bitrate'));
    }
  });

  test('unknown modes fall back to fps and only the three modes are valid', () => {
    assert.equal(getRecommendedBitrateHints('unknown'), RecommendedBitrateHints.fps);
    assert.equal(isQualityMode('both'), true);
    assert.equal(isQualityMode('turbo'), false);
    assert.equal(isQualityMode(undefined), false);
  });

  test('only fps holds resolution for a grace period; both prefers the standard no-adaptation value first', () => {
    assert.equal(RecommendedBitrateHints.fps.degradation.graceMs, 6000);
    assert.deepEqual(RecommendedBitrateHints.fps.degradation.duringGrace, ['maintain-resolution']);
    assert.deepEqual(RecommendedBitrateHints.fps.degradation.afterGrace, ['maintain-framerate']);
    assert.equal(RecommendedBitrateHints.resolution.degradation.graceMs, 0);
    assert.equal(RecommendedBitrateHints.both.degradation.afterGrace[0], 'maintain-framerate-and-resolution');
    assert.equal(RecommendedBitrateHints.both.degradation.afterGrace[1], 'maintain-resolution');
    assert.ok(RecommendedBitrateHints.both.encodingMaxBitrateBps > RecommendedBitrateHints.resolution.encodingMaxBitrateBps);
  });
});
