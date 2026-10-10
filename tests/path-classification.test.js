import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath, isPrivateAddress } from '../src/public/js/webrtc-peer.js';
import { isLocalHostname, describePath } from '../src/public/js/ui-utils.js';

test('isPrivateAddress recognises LAN, loopback, link-local and mDNS addresses', () => {
  assert.equal(isPrivateAddress('192.168.1.20'), true);
  assert.equal(isPrivateAddress('10.0.0.5'), true);
  assert.equal(isPrivateAddress('172.16.4.4'), true);
  assert.equal(isPrivateAddress('172.31.255.1'), true);
  assert.equal(isPrivateAddress('169.254.10.10'), true);
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('1b2c3d4e-0000-4000-8000-123456789abc.local'), true);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2001:db8::1'), false);
  assert.equal(isPrivateAddress(null), false);
});

test('classifyPath distinguishes LAN direct, internet and relay paths', () => {
  assert.equal(classifyPath('host', '192.168.1.20', 'host', '192.168.1.30'), 'lan');
  assert.equal(classifyPath('host', '192.168.1.20', 'prflx', '192.168.1.30'), 'lan');
  assert.equal(classifyPath('host', '192.168.1.20', 'host', null), 'lan');
  assert.equal(classifyPath('host', '192.168.1.20', 'srflx', '203.0.113.7'), 'internet');
  assert.equal(classifyPath('host', '192.168.1.20', 'host', '203.0.113.7'), 'internet');
  assert.equal(classifyPath('relay', '203.0.113.9', 'host', '192.168.1.30'), 'relay');
  assert.equal(classifyPath('host', '192.168.1.20', 'relay', '203.0.113.9'), 'relay');
});

test('isLocalHostname separates local origins from public tunnel origins', () => {
  assert.equal(isLocalHostname('localhost'), true);
  assert.equal(isLocalHostname('127.0.0.1'), true);
  assert.equal(isLocalHostname('192.168.1.50'), true);
  assert.equal(isLocalHostname('my-pc.local'), true);
  assert.equal(isLocalHostname('lan.shares.zrok.io'), false);
  assert.equal(isLocalHostname('203.0.113.7'), false);
  assert.equal(isLocalHostname(''), false);
});

test('describePath returns a description only for known path kinds', () => {
  assert.match(describePath('lan').text, /0 bytes through zrok/);
  assert.equal(describePath('unknown'), null);
});
