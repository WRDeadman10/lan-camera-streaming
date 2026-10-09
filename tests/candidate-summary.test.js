import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCandidateSummary } from '../src/public/js/ui-utils.js';

test('parseCandidateSummary handles null or empty candidates', () => {
  assert.equal(parseCandidateSummary(null), 'End-of-candidates (null)');
  assert.equal(parseCandidateSummary(''), 'End-of-candidates (empty)');
  assert.equal(parseCandidateSummary({ candidate: '' }), 'End-of-candidates (empty)');
});

test('parseCandidateSummary parses host candidate with direct IP', () => {
  const line = 'candidate:4234998374 1 udp 2122260223 192.168.1.120 54321 typ host generation 0';
  const result = parseCandidateSummary({ candidate: line });
  assert.equal(result, 'HOST via UDP (192.168.1.120:54321)');
});

test('parseCandidateSummary identifies mDNS obfuscated host candidate', () => {
  const line = 'candidate:842163045 1 udp 1677729535 0c78a9c2-563b-4dc7-84e1-638dc5b1285e.local 54321 typ host generation 0';
  const result = parseCandidateSummary(line);
  assert.equal(result, 'HOST via UDP (0c78a9c2-563b-4dc7-84e1-638dc5b1285e.local [mDNS obfuscated])');
});

test('parseCandidateSummary parses srflx candidate with public address and port', () => {
  const line = 'candidate:123456789 1 udp 1686052607 104.28.1.2 61234 typ srflx raddr 192.168.1.120 rport 54321';
  const result = parseCandidateSummary({ candidate: line });
  assert.equal(result, 'SRFLX via UDP (104.28.1.2:61234)');
});

test('parseCandidateSummary parses relay candidate', () => {
  const line = 'candidate:987654321 1 udp 41819903 34.120.50.1 58210 typ relay raddr 104.28.1.2 rport 61234';
  const result = parseCandidateSummary({ candidate: line });
  assert.equal(result, 'RELAY via UDP (34.120.50.1:58210)');
});
