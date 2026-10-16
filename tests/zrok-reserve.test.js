import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findExistingShare,
  generateCandidateWords
} from '../src/server/zrok-helper.js';

test('generateCandidateWords returns valid zrok unique names', () => {
  const words = generateCandidateWords();
  assert.ok(Array.isArray(words));
  assert.ok(words.length >= 10);

  for (const word of words) {
    // zrok constraint: lowercase alphanumeric, between 4 and 32 characters
    assert.match(word, /^[a-z0-9]{4,32}$/, `Word '${word}' must be 4-32 lowercase alphanumeric`);
    assert.ok(word.startsWith('lancam'), `Word '${word}' should start with lancam`);
  }
});

test('findExistingShare prioritizes reserved shares and matching ports', () => {
  // Empty
  assert.equal(findExistingShare([], 7777), null);
  assert.equal(findExistingShare(null, 7777), null);

  const dynamicShare = {
    shareToken: 'z5a5ii5pkys3',
    frontendEndpoint: 'https://z5a5ii5pkys3.share.zrok.io',
    backendProxyEndpoint: 'http://127.0.0.1:7777',
    createdAt: 1792164730133
  };

  const reservedShareOtherPort = {
    shareToken: 'lancamother',
    frontendEndpoint: 'https://lancamother.share.zrok.io',
    backendProxyEndpoint: 'http://127.0.0.1:3000',
    reserved: true
  };

  const reservedShareTargetPort = {
    shareToken: 'lancamtarget',
    frontendEndpoint: 'https://lancamtarget.share.zrok.io',
    backendProxyEndpoint: 'http://127.0.0.1:7777',
    reserved: true
  };

  // 1. Only dynamic share targeting port
  assert.deepEqual(findExistingShare([dynamicShare], 7777), dynamicShare);

  // 2. Dynamic share vs reserved share for another port -> prefers reserved
  assert.deepEqual(findExistingShare([dynamicShare, reservedShareOtherPort], 7777), reservedShareOtherPort);

  // 3. Reserved share for another port vs reserved share for target port -> prefers target port
  assert.deepEqual(
    findExistingShare([dynamicShare, reservedShareOtherPort, reservedShareTargetPort], 7777),
    reservedShareTargetPort
  );
});

test('zrok overview JSON parsing extracts exact frontendEndpoint instead of createdAt timestamp', () => {
  const rawZrokOverview = `
[INFO] retrieving overview...
{
  "environments": [
    {
      "environment": {
        "address": "122.170.2.11",
        "createdAt": 1785919024130,
        "description": "test",
        "zId": "xURw7wvcI"
      },
      "shares": [
        {
          "backendMode": "proxy",
          "backendProxyEndpoint": "http://127.0.0.1:7777",
          "createdAt": 1792164730133,
          "envZId": "xURw7wvcI",
          "frontendEndpoint": "https://z5a5ii5pkys3.share.zrok.io",
          "frontendSelection": "public",
          "shareMode": "public",
          "shareToken": "z5a5ii5pkys3",
          "updatedAt": 1792164730133,
          "zId": "3xRtEfVCI5zDy1v80Zpen9"
        }
      ]
    }
  ]
}
`;

  const jsonStart = rawZrokOverview.indexOf('{');
  const jsonEnd = rawZrokOverview.lastIndexOf('}');
  assert.ok(jsonStart !== -1 && jsonEnd !== -1);

  const parsed = JSON.parse(rawZrokOverview.slice(jsonStart, jsonEnd + 1));
  const share = parsed.environments[0].shares[0];

  assert.equal(share.shareToken, 'z5a5ii5pkys3');
  assert.equal(share.frontendEndpoint, 'https://z5a5ii5pkys3.share.zrok.io');
  // Confirm it does NOT match 1792164730133
  assert.notEqual(share.shareToken, '1792164730133');
  assert.notEqual(share.frontendEndpoint, 'https://1792164730133.shares.zrok.io');
});
