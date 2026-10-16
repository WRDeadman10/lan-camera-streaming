import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { RtspServer } from '../src/server/rtsp-server.js';

test('Feature 5: RtspServer handles RTSP 1.0 handshake and session lifecycle', async () => {
  const rtspServer = new RtspServer(0, '127.0.0.1', { info() {}, warn() {}, error() {} });
  await rtspServer.start();

  const port = rtspServer.server.address().port;
  const client = new net.Socket();

  await new Promise((resolve) => client.connect(port, '127.0.0.1', resolve));

  // 1. Send OPTIONS
  let responseData = '';
  const waitForResponse = () => new Promise((resolve) => {
    const onData = (chunk) => {
      responseData += chunk.toString('utf8');
      if (responseData.includes('\r\n\r\n')) {
        client.removeListener('data', onData);
        resolve(responseData);
      }
    };
    client.on('data', onData);
  });

  client.write('OPTIONS rtsp://127.0.0.1/live/test-room RTSP/1.0\r\nCSeq: 1\r\n\r\n');
  let res = await waitForResponse();
  assert.ok(res.includes('RTSP/1.0 200 OK'));
  assert.ok(res.includes('Public: OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE'));

  // 2. Send DESCRIBE
  responseData = '';
  client.write('DESCRIBE rtsp://127.0.0.1/live/test-room RTSP/1.0\r\nCSeq: 2\r\n\r\n');
  res = await waitForResponse();
  assert.ok(res.includes('RTSP/1.0 200 OK'));
  assert.ok(res.includes('m=video 0 RTP/AVP 26'));

  // 3. Send SETUP
  responseData = '';
  client.write('SETUP rtsp://127.0.0.1/live/test-room/trackID=0 RTSP/1.0\r\nCSeq: 3\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n\r\n');
  res = await waitForResponse();
  assert.ok(res.includes('RTSP/1.0 200 OK'));
  assert.ok(res.includes('Session: '));

  // Extract Session ID
  const sessionMatch = res.match(/Session:\s*([0-9]+)/);
  assert.ok(sessionMatch);
  const sessionId = sessionMatch[1];

  // 4. Send PLAY
  responseData = '';
  client.write(`PLAY rtsp://127.0.0.1/live/test-room RTSP/1.0\r\nCSeq: 4\r\nSession: ${sessionId}\r\n\r\n`);
  res = await waitForResponse();
  assert.ok(res.includes('RTSP/1.0 200 OK'));
  assert.equal(rtspServer.hasClients('test-room'), true);

  // 5. Test broadcastFrame transmits interleaved RTP packet ('$', channel 0)
  let receivedRtpPacket = false;
  client.once('data', (chunk) => {
    if (chunk[0] === 0x24 && chunk[1] === 0x00) {
      receivedRtpPacket = true;
    }
  });

  const dummyJpeg = Buffer.from('ffd8ffe000104a46494600010101004800480000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f007f00ffd9', 'hex');
  rtspServer.broadcastFrame('test-room', dummyJpeg);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(receivedRtpPacket, true, 'Client should receive interleaved RTP packet starting with $ and channel 0');

  // 6. TEARDOWN
  responseData = '';
  client.write(`TEARDOWN rtsp://127.0.0.1/live/test-room RTSP/1.0\r\nCSeq: 5\r\nSession: ${sessionId}\r\n\r\n`);
  res = await waitForResponse();
  assert.ok(res.includes('RTSP/1.0 200 OK'));

  client.destroy();
  rtspServer.close();
});
