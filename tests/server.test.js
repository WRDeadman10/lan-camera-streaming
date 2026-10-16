import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedAssets } from '../src/server/embedded-assets.js';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { setupSignaling } from '../src/server/signaling.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

test('Socket.IO browser client script is served while signaling is attached', async () => {
  const config = loadConfig({ PORT: '3003' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/vendor/socket.io.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const body = await res.text();
    assert.ok(body.length > 50000);
    assert.match(body, /Socket\.IO/);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('virtual camera driver installer is downloadable when it has been built', async (t) => {
  const hasInstaller = (fs.existsSync('dist') && fs.readdirSync('dist').some((name) => /^lan-camera-setupv.+\.exe$/i.test(name))) ||
    Boolean(embeddedAssets['/download/lan-camera-setup.exe']);
  if (!hasInstaller) {
    t.skip('lan-camera-setupv<version>.exe has not been built (run build.bat)');
    return;
  }

  const config = loadConfig({ PORT: '3005' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();

  try {
    for (const route of ['/download/lan-camera-setup', '/download/lancam-vcam']) {
      const res = await fetch(`http://127.0.0.1:${address.port}${route}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /lan-camera-setupv.+\.exe/i);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.subarray(0, 2).toString('latin1'), 'MZ');
      assert.ok(bytes.length > 500000);
    }
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('createServer sends comprehensive Content-Security-Policy allowing inline styles, unsplash, and media', async () => {
  const config = loadConfig({ PORT: '3006' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy header must be present');
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"), 'CSP must allow unsafe-inline styles');
    assert.ok(csp.includes('api.unsplash.com'), 'CSP connect-src must allow api.unsplash.com');
    assert.ok(csp.includes('images.unsplash.com'), 'CSP img-src must allow images.unsplash.com');
    assert.ok(csp.includes('data:'), 'CSP img-src must allow data: URIs');
    assert.ok(csp.includes('blob:'), 'CSP img-src and media-src must allow blob: URIs');
    assert.ok(csp.includes('mediastream:'), 'CSP media-src must allow mediastream:');
    assert.ok(csp.includes('127.0.0.1'), 'CSP connect-src must allow loopback 127.0.0.1 for native helper');
    assert.ok(csp.includes('lancam-control:'), 'CSP frame-src must allow lancam-control: protocol');
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

test('remote control helper installer is downloadable when built', async (t) => {
  const installerPath = path.resolve(__dirname, '../remote-control-helper/build/installer/control-helper-setup.exe');
  const hasInstaller = fs.existsSync(installerPath) || Boolean(embeddedAssets['/download/control-helper-setup.exe']);
  if (!hasInstaller) {
    t.skip('control-helper-setup.exe has not been built');
    return;
  }

  const config = loadConfig({ PORT: '3007' });
  const logger = new Logger('error');
  const { httpServer } = createServer(config, logger);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();

  try {
    for (const route of ['/download/control-helper-setup', '/download/control-helper-setup.exe']) {
      const res = await fetch(`http://127.0.0.1:${address.port}${route}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), /control-helper-setup\.exe/i);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.subarray(0, 2).toString('latin1'), 'MZ');
      assert.ok(bytes.length > 500000);
    }
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
});

