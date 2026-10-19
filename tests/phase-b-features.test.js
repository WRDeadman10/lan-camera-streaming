import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';
import { WebRtcPeer } from '../src/public/js/webrtc-peer.js';

test('Discovery endpoint /api/discover returns service info and hostname', async () => {
  const dummyConfig = {
    port: 3888,
    accessPin: '123456',
    useHttps: false,
    corsOrigin: '*',
    iceServers: [],
    enableMdns: true
  };
  const dummyLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const { app, httpServer, mdnsBeacon } = createServer(dummyConfig, dummyLogger);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/discover`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.service, 'lan-camera-streaming');
    assert.equal(typeof data.hostname, 'string');
    assert.equal(data.protocol, 'http');
    assert.equal(data.version, '1.0.36');
  } finally {
    mdnsBeacon?.stop();
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('WebRtcPeer applyBitrateLimit updates encodings without crashing', async () => {
  let appliedParams = null;
  const mockSender = {
    track: { kind: 'video' },
    getParameters() {
      return { encodings: [{}] };
    },
    async setParameters(p) {
      appliedParams = p;
    }
  };

  const peer = new WebRtcPeer();
  peer.peerConnection = {
    getSenders() {
      return [mockSender];
    }
  };

  const ok = await peer.applyBitrateLimit(1500000, 1.5);
  assert.equal(ok, true);
  assert.equal(appliedParams.encodings[0].maxBitrate, 1500000);
  assert.equal(appliedParams.encodings[0].scaleResolutionDownBy, 1.5);

  const resetOk = await peer.applyBitrateLimit(null, 1.0);
  assert.equal(resetOk, true);
  assert.equal(appliedParams.encodings[0].maxBitrate, undefined);
});
