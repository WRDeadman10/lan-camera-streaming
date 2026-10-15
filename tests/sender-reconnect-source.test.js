// Source-level wiring guards for sender.js / viewer.js (browser modules that cannot be imported in Node).
// Behaviour of the logic they call is covered by sdp-bitrate, abr-policy, encoder-and-stats and webrtc-peer-quality tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
const senderJs = read('../src/public/js/sender.js');
const viewerJs = read('../src/public/js/viewer.js');
const viewerHtml = read('../src/public/viewer.html');
const senderHtml = read('../src/public/sender.html');
const uiUtilsJs = read('../src/public/js/ui-utils.js');

describe('Sender reconnect guards', () => {
  test('socket connect handler does not rejoin before the first room join completes', () => {
    const connectBlock = senderJs.slice(senderJs.indexOf("socket.on('connect'"), senderJs.indexOf("socket.on('disconnect'"));
    assert.match(connectBlock, /hasJoinedRoom/, 'first connect must not trigger a second room:join');
    assert.match(senderJs, /hasJoinedRoom = true;/, 'successful joins must set hasJoinedRoom');
    assert.match(senderJs, /hasJoinedRoom = false;/, 'stopSession must reset hasJoinedRoom');
  });

  test('screen share tab-return repairs viewers one by one and waits before treating "disconnected" as dead', () => {
    const visibilityBlock = senderJs.slice(senderJs.indexOf("document.addEventListener('visibilitychange'"), senderJs.indexOf("window.addEventListener('online'"));
    assert.match(visibilityBlock, /canRepairViewersInPlace\(\)/);
    assert.match(visibilityBlock, /repairUnhealthyViewerPeers\(\)/);
    assert.match(senderJs, /repairsInFlight/, 'a viewer must not be re-offered twice at once');
    assert.match(senderJs, /DisconnectedRepairDelayMs = 5000/);
  });
});

describe('Sender quality wiring', () => {
  test('uses the shared hint, ABR, encoder and stats modules instead of local constants', () => {
    for (const moduleName of ['abr-policy.js', 'sdp-bitrate.js', 'encoder-info.js', 'sender-stats.js']) {
      assert.ok(senderJs.includes(`./${moduleName}`), moduleName);
    }
    assert.doesNotMatch(senderJs, /LanMaxBitrate/);
    assert.doesNotMatch(senderJs, /applyBitrateLimit\(600000|applyBitrateLimit\(1500000/);
    assert.match(senderJs, /stepAbr\(getAbrState\(vId\), stats\.rawRttMs\)/);
    assert.match(senderJs, /getAbrLimits\(abrStep\.level, viewerMode, ceilingBps\)/);
  });

  test('the viewer mode defaults to fps and is applied with a grace period after connecting, mode changes and source switches', () => {
    assert.match(senderJs, /viewerQualityPriority\.get\(viewerId\) \|\| DefaultQualityMode/);
    assert.match(senderJs, /DefaultQualityMode = 'fps'/);
    assert.match(senderJs, /state === 'connected'\) \{\s+applyViewerQualityPriority\(viewerId, peer, \{ armGrace: true \}\)/);
    assert.match(senderJs, /replaceTrack\(newVideoTrack\);[\s\S]{0,200}applyViewerQualityPriority\(viewerId, peer, \{ armGrace: true \}\)/);
    assert.match(senderJs, /socket\.on\('viewer:quality-priority'[\s\S]{0,700}armGrace: true/);
  });

  test('modes chosen before the sender joined are seeded from the join acknowledgement', () => {
    assert.match(senderJs, /function seedViewerQuality\(response\)/);
    assert.equal((senderJs.match(/seedViewerQuality\(response\);/g) || []).length, 2, 'initial join and rejoin');
  });

  test('stale per-viewer state is cleared when a viewer leaves and when the session stops', () => {
    const leftBlock = senderJs.slice(senderJs.indexOf("socket.on('peer:left'"), senderJs.indexOf("socket.on('peer:left'") + 1200);
    assert.match(leftBlock, /viewerQualityPriority\.delete\(leftId\)/);
    assert.match(leftBlock, /viewerAbrState\.delete\(leftId\)/);
    const stopBlock = senderJs.slice(senderJs.indexOf('function stopSession()'));
    assert.match(stopBlock.slice(0, 3500), /viewerQualityPriority\.clear\(\)/);
  });

  test('the content hint follows the source and is switchable for A/B tests', () => {
    assert.match(senderJs, /function getContentHintForCurrentSource\(\)/);
    assert.equal((senderJs.match(/contentHint = getContentHintForCurrentSource\(\)/g) || []).length, 3, 'peer creation, hot swap, restart swap');
    assert.doesNotMatch(senderJs, /contentHint = 'motion'/);
    assert.match(senderHtml, /<select id="screenContentHint">[\s\S]*value="motion" selected[\s\S]*value="detail"/);
  });

  test('the diagnostics log is capped so frequent stats lines stay cheap', () => {
    assert.match(uiUtilsJs, /DiagnosticsLogMaxChars/);
    assert.match(uiUtilsJs, /\.slice\(0, DiagnosticsLogMaxChars\)/);
  });
});

describe('Hardware H.264 preference with VP8 fallback', () => {
  test('WebRtcPeer puts the preferred codec first but keeps every other codec in the offer', () => {
    const peerJs = read('../src/public/js/webrtc-peer.js');
    assert.match(peerJs, /setCodecPreferences\(\[\.\.\.preferred, \.\.\.others\]\)/);
  });

  test('Auto mode only prefers H.264 when the browser reports a GPU encoder, probing several profiles', () => {
    assert.match(senderJs, /info\.supported && info\.powerEfficient/);
    assert.match(senderJs, /HardwareH264ProbeProfiles = \['42001f', '4d001f', '640028'\]/, 'constrained-baseline alone under-reports GPU encoders');
    assert.match(senderJs, /results\.some\(Boolean\)/);
    assert.match(senderJs, /choice === 'vp8' \|\| hardwareH264Unsupported \|\| !hardwareH264Available/);
    assert.match(senderJs, /await hardwareH264Detection;/, 'detection must finish before the first offer');
  });

  test('only a recognised software encoder triggers the one-time VP8 fallback, and the latch expires', () => {
    assert.match(senderJs, /classifyEncoder\(stats\)/);
    assert.match(senderJs, /encoderClass === 'unknown'/);
    assert.match(senderJs, /setHardwareH264Unsupported\(true\)/);
    assert.match(senderJs, /HardwareH264LatchTtlMs = 24 \* 60 \* 60 \* 1000/);
    assert.match(senderJs, /evaluateVideoEncoder\(vId, stats\);/, 'stats polling must run the check');
  });

  test('sender offers Auto, forced H.264 and VP8 encoder choices with Auto as default', () => {
    assert.match(senderHtml, /<select id="encoderPreference">[\s\S]*value="auto" selected[\s\S]*value="h264"[\s\S]*value="vp8"/);
  });
});

describe('Viewer quality setting', () => {
  test('viewer exposes the setting, defaults to constant FPS and sends it on join and change', () => {
    assert.match(viewerHtml, /<select id="qualityPriority">[\s\S]*value="fps" selected[\s\S]*value="resolution"[\s\S]*value="both"/);
    assert.match(viewerJs, /socket\.emit\('viewer:quality-priority'/);
    assert.match(viewerJs, /sendQualityPriority\(\);/);
  });
});
