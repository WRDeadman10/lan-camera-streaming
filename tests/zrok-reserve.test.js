import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findExistingShare,
  generateCandidateWords,
  getZrokShares,
  parseZrokOverviewJson,
  isZrokV2
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

  const reservedLanShare = {
    shareToken: 'lan',
    name: 'lan',
    frontendEndpoint: 'https://lan.shares.zrok.io',
    reserved: true,
    isNamedReservation: true
  };

  // 1. Only dynamic share targeting port
  assert.deepEqual(findExistingShare([dynamicShare], 7777), dynamicShare);

  // 2. Dynamic share vs reserved share for another port -> prefers reserved
  assert.deepEqual(findExistingShare([dynamicShare, reservedShareOtherPort], 7777), reservedShareOtherPort);

  // 3. Reserved share for another port vs reserved lan share -> prefers lan
  assert.deepEqual(
    findExistingShare([dynamicShare, reservedShareOtherPort, reservedLanShare], 7777),
    reservedLanShare
  );

  // 4. Reserved share for target port vs reserved lan share without port -> prefers target port
  assert.deepEqual(
    findExistingShare([dynamicShare, reservedLanShare, reservedShareTargetPort], 7777),
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

  const shares = getZrokShares(rawZrokOverview);
  assert.equal(shares.length, 1);
  const share = shares[0];

  assert.equal(share.shareToken, 'z5a5ii5pkys3');
  assert.equal(share.frontendEndpoint, 'https://z5a5ii5pkys3.share.zrok.io');
  assert.notEqual(share.shareToken, '1792164730133');
  assert.notEqual(share.frontendEndpoint, 'https://1792164730133.shares.zrok.io');
});

test('zrok2 overview JSON parsing extracts reserved names including lan and normalizes shares', () => {
  const zrok2OverviewData = {
    environments: [
      {
        environment: {
          address: '122.170.2.11',
          createdAt: 1791560295233,
          description: 'test-env',
          host: 'test-host',
          zId: '518g46DTS'
        },
        shares: [
          {
            backendMode: 'proxy',
            createdAt: 1792265941606,
            envZId: '518g46DTS',
            frontendEndpoints: [
              '0jddmbxufiun.shares.zrok.io'
            ],
            shareMode: 'public',
            shareToken: '0jddmbxufiun',
            target: 'http://127.0.0.1:7777',
            zId: '3CIFathuxDAijymHI6RLf6'
          }
        ]
      }
    ],
    names: [
      {
        createdAt: 1792265941,
        name: '0jddmbxufiun',
        namespaceName: 'shares.zrok.io',
        namespaceToken: 'public',
        shareToken: '0jddmbxufiun'
      },
      {
        createdAt: 1791565926,
        name: 'lan',
        namespaceName: 'shares.zrok.io',
        namespaceToken: 'public',
        reserved: true
      }
    ],
    namespaces: [
      {
        description: '*.shares.zrok.io',
        name: 'shares.zrok.io',
        namespaceToken: 'public'
      }
    ]
  };

  const shares = parseZrokOverviewJson(zrok2OverviewData);
  assert.equal(shares.length, 2);

  // First share: dynamic share
  const dynamicShare = shares.find((s) => s.shareToken === '0jddmbxufiun');
  assert.ok(dynamicShare);
  assert.equal(dynamicShare.target, 'http://127.0.0.1:7777');
  assert.equal(dynamicShare.backendProxyEndpoint, 'http://127.0.0.1:7777');
  assert.equal(dynamicShare.frontendEndpoint, 'https://0jddmbxufiun.shares.zrok.io');
  assert.equal(dynamicShare.reserved, false);

  // Second share: reserved name 'lan'
  const lanShare = shares.find((s) => s.name === 'lan');
  assert.ok(lanShare);
  assert.equal(lanShare.shareToken, 'lan');
  assert.equal(lanShare.name, 'lan');
  assert.equal(lanShare.nameSelection, 'public:lan');
  assert.equal(lanShare.frontendEndpoint, 'https://lan.shares.zrok.io');
  assert.equal(lanShare.reserved, true);
  assert.equal(lanShare.isNamedReservation, true);

  // findExistingShare on port 7777 finds reserved 'lan' when no reserved share specifies the port
  const chosen = findExistingShare(shares, 8888);
  assert.equal(chosen.name, 'lan');
  assert.equal(chosen.frontendEndpoint, 'https://lan.shares.zrok.io');
});

test('isZrokV2 detects zrok2 from command path and binary names', () => {
  assert.equal(isZrokV2('C:\\scrcpy-win64-v2.4\\zrok2.exe'), true);
  assert.equal(isZrokV2('zrok2'), true);
  assert.equal(isZrokV2('zrok2.exe'), true);
  assert.equal(isZrokV2(''), false);
  assert.equal(isZrokV2(null), false);
});
