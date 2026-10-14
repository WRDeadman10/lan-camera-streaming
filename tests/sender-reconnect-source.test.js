// Source-level guards for the sender reconnect logic (sender.js is a browser module and cannot be imported in Node)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const senderJs = fs.readFileSync(path.resolve(__dirname, '../src/public/js/sender.js'), 'utf8');

describe('Sender reconnect guards', () => {
  test('socket connect handler does not rejoin before the first room join completes', () => {
    const connectBlock = senderJs.slice(senderJs.indexOf("socket.on('connect'"), senderJs.indexOf("socket.on('disconnect'"));
    assert.match(connectBlock, /hasJoinedRoom/, 'first connect must not trigger a second room:join');
    assert.match(senderJs, /hasJoinedRoom = true;/, 'successful joins must set hasJoinedRoom');
    assert.match(senderJs, /hasJoinedRoom = false;/, 'stopSession must reset hasJoinedRoom');
  });

  test('screen share tab-return re-offers only to dead viewers instead of rejoining everyone', () => {
    const visibilityBlock = senderJs.slice(senderJs.indexOf("document.addEventListener('visibilitychange'"), senderJs.indexOf("window.addEventListener('online'"));
    assert.match(visibilityBlock, /canRepairViewersInPlace\(\)/);
    assert.match(visibilityBlock, /repairUnhealthyViewerPeers\(\)/);
    assert.match(senderJs, /state === 'failed' \|\| state === 'disconnected' \|\| state === 'closed'/);
  });
});
