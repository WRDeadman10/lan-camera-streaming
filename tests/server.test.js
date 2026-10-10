import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';

test('loadConfig validates default configuration', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.accessPin, '123456');
  assert.equal(config.trustProxy, false);
  assert.equal(config.zrokToken, '');
  assert.ok(Array.isArray(config.iceServers));
  assert.ok(config.iceServers.length > 0);

  const customConfig = loadConfig({ ZROK_TOKEN: 'test-token-123' });
  assert.equal(customConfig.zrokToken, 'test-token-123');
});

test('loadConfig throws on invalid ACCESS_PIN', () => {
  assert.throws(() => {
    loadConfig({ ACCESS_PIN: '12' });
  }, /ACCESS_PIN must be at least 4 characters long/);
});

test('loadConfig throws on invalid PORT', () => {
  assert.throws(() => {
    loadConfig({ PORT: '99999' });
  }, /Invalid configuration: expected integer between 1 and 65535/);
});

test('loadConfig requires HTTPS certificate and key together', () => {
  assert.throws(() => {
    loadConfig({ HTTPS_CERT_PATH: 'certs/lan.pem' });
  }, /HTTPS_CERT_PATH and HTTPS_KEY_PATH must be set together/);

  const httpConfig = loadConfig({});
  assert.equal(httpConfig.useHttps, false);

  const httpsConfig = loadConfig({ HTTPS_CERT_PATH: 'certs/lan.pem', HTTPS_KEY_PATH: 'certs/lan-key.pem' });
  assert.equal(httpsConfig.useHttps, true);
});

test('createServer fails with an actionable error when HTTPS files are missing', () => {
  const config = loadConfig({
    HTTPS_CERT_PATH: 'certs/does-not-exist.pem',
    HTTPS_KEY_PATH: 'certs/does-not-exist-key.pem'
  });
  const logger = new Logger('error');
  assert.throws(() => {
    createServer(config, logger);
  }, /Failed to read HTTPS certificate or key/);
});

test('createServer exposes only scheme and port on /api/network-info', async () => {
  const config = loadConfig({ PORT: '3002' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/network-info`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { protocol: 'http', port: 3002 });
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('createServer responds to /health and /api/config', async () => {
  const config = loadConfig({ PORT: '3001' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Check health endpoint
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.ok(typeof healthJson.uptime === 'number');

    // Check config endpoint
    const configRes = await fetch(`${baseUrl}/api/config`);
    assert.equal(configRes.status, 200);
    const configJson = await configRes.json();
    assert.ok(Array.isArray(configJson.iceServers));
    // Verify ACCESS_PIN is not leaked
    assert.equal(configJson.accessPin, undefined);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});
