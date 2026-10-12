import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { embeddedAssets } from '../src/server/embedded-assets.js';

test('CLI --help outputs usage, options and flags', () => {
  const output = execSync('node src/server/cli.js --help', { encoding: 'utf8' });
  assert.ok(output.includes('LAN Camera Streaming'));
  assert.ok(output.includes('Standalone Console Application'));
  assert.ok(output.includes('--port'));
  assert.ok(output.includes('--host'));
  assert.ok(output.includes('--pin'));
  assert.ok(output.includes('--local'));
  assert.ok(output.includes('--zrok'));
  assert.ok(output.includes('--env'));
});

test('Embedded assets map includes all core frontend assets', () => {
  assert.ok(embeddedAssets['/index.html'], 'embeddedAssets should contain index.html');
  assert.ok(embeddedAssets['/sender.html'], 'embeddedAssets should contain sender.html');
  assert.ok(embeddedAssets['/viewer.html'], 'embeddedAssets should contain viewer.html');
  assert.ok(embeddedAssets['/css/style.css'], 'embeddedAssets should contain style.css');
  assert.ok(embeddedAssets['/js/sender.js'], 'embeddedAssets should contain sender.js');
  assert.ok(embeddedAssets['/js/viewer.js'], 'embeddedAssets should contain viewer.js');
  assert.ok(embeddedAssets['/js/webrtc-peer.js'], 'embeddedAssets should contain webrtc-peer.js');

  assert.equal(embeddedAssets['/index.html'].mimeType, 'text/html; charset=utf-8');
  assert.equal(embeddedAssets['/css/style.css'].mimeType, 'text/css; charset=utf-8');
  assert.equal(embeddedAssets['/js/sender.js'].mimeType, 'application/javascript; charset=utf-8');
});

test('parseEnvContent parses variables, strips quotes, and ignores comments', async () => {
  const { parseEnvContent } = await import('../src/server/config.js');
  const sample = `
  # This is a comment
  PORT=4000
  ACCESS_PIN="654321"
  HOST='127.0.0.1'
  ZROK_TOKEN=my-token
  `;
  const result = parseEnvContent(sample);
  assert.equal(result.PORT, '4000');
  assert.equal(result.ACCESS_PIN, '654321');
  assert.equal(result.HOST, '127.0.0.1');
  assert.equal(result.ZROK_TOKEN, 'my-token');
});

test('loadEnvFile loads custom env file and populates target environment', async () => {
  const { loadEnvFile } = await import('../src/server/config.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');

  const tmpFile = path.join(os.tmpdir(), `test-env-${Date.now()}.env`);
  fs.writeFileSync(tmpFile, 'PORT=5050\nACCESS_PIN=987654\n', 'utf8');

  try {
    const targetEnv = {};
    const res = loadEnvFile(tmpFile, { targetEnv });
    assert.equal(res.loaded, true);
    assert.equal(targetEnv.PORT, '5050');
    assert.equal(targetEnv.ACCESS_PIN, '987654');
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
});
