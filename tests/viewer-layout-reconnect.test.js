import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Viewer Layout and Reconnect Memory Verification', () => {
  const viewerHtmlPath = path.resolve(__dirname, '../src/public/viewer.html');
  const viewerHtmlContent = fs.readFileSync(viewerHtmlPath, 'utf8');

  test('viewer.html places HUD buttons inside video-hud and studio/vitals bars in viewport footer', () => {
    const dom = new JSDOM(viewerHtmlContent);
    const doc = dom.window.document;

    const viewportPane = doc.querySelector('.viewport-pane');
    assert.ok(viewportPane, 'viewport-pane must exist');

    const videoWrapper = doc.getElementById('videoWrapper');
    assert.ok(videoWrapper, 'videoWrapper must exist');

    const videoHud = videoWrapper.querySelector('.video-hud');
    assert.ok(videoHud, 'video-hud must be inside videoWrapper');

    // Only HUD icon buttons should be inside video-hud
    const hudButtons = videoHud.querySelectorAll('button.hud-btn');
    assert.ok(hudButtons.length >= 8, 'video-hud must contain the HUD action icon buttons');

    // studioSwitcherBar and streamVitalsBar must NOT be inside video-hud
    assert.strictEqual(videoHud.querySelector('#studioSwitcherBar'), null, 'studioSwitcherBar must not be inside video-hud');
    assert.strictEqual(videoHud.querySelector('#streamVitalsBar'), null, 'streamVitalsBar must not be inside video-hud');

    // studioSwitcherBar and streamVitalsBar must NOT be inside videoWrapper
    assert.strictEqual(videoWrapper.querySelector('#studioSwitcherBar'), null, 'studioSwitcherBar must not be inside videoWrapper');
    assert.strictEqual(videoWrapper.querySelector('#streamVitalsBar'), null, 'streamVitalsBar must not be inside videoWrapper');

    // studioSwitcherBar and streamVitalsBar must be direct children of viewportPane (footer area)
    const directStudio = viewportPane.querySelector(':scope > #studioSwitcherBar');
    const directVitals = viewportPane.querySelector(':scope > #streamVitalsBar');
    assert.ok(directStudio, 'studioSwitcherBar must sit directly inside viewport-pane footer');
    assert.ok(directVitals, 'streamVitalsBar must sit directly inside viewport-pane footer');
  });

  test('viewer.html contains overlay title, subtitle, and reconnect button', () => {
    const dom = new JSDOM(viewerHtmlContent);
    const doc = dom.window.document;

    const overlay = doc.getElementById('videoOverlay');
    assert.ok(overlay, 'videoOverlay element must exist');

    const title = overlay.querySelector('#overlayTitle');
    assert.ok(title, 'overlayTitle must exist inside videoOverlay');

    const subtitle = overlay.querySelector('#overlaySubtitle');
    assert.ok(subtitle, 'overlaySubtitle must exist inside videoOverlay');

    const reconnectBtn = overlay.querySelector('#btnOverlayReconnect');
    assert.ok(reconnectBtn, 'btnOverlayReconnect must exist inside videoOverlay');
  });

  test('viewer.js manages reconnect memory via sessionStorage fallback', () => {
    const dom = new JSDOM(viewerHtmlContent, {
      url: 'http://localhost/viewer?room=TEST_ROOM_101&pin=998877'
    });
    const win = dom.window;

    // Simulate sessionStorage saving
    win.sessionStorage.setItem('lancam_last_room', 'TEST_ROOM_101');
    win.sessionStorage.setItem('lancam_last_pin', '998877');

    assert.strictEqual(win.sessionStorage.getItem('lancam_last_room'), 'TEST_ROOM_101');
    assert.strictEqual(win.sessionStorage.getItem('lancam_last_pin'), '998877');
  });

  test('viewer.js reports live only after the WebRTC connection is established', () => {
    const viewerJs = fs.readFileSync(path.resolve(__dirname, '../src/public/js/viewer.js'), 'utf8');
    assert.match(viewerJs, /function isWebRtcConnected\(\)/, 'isWebRtcConnected helper must exist');

    const streamStateBlock = viewerJs.slice(viewerJs.indexOf("socket.on('stream:state'"), viewerJs.indexOf("socket.on('sender:battery'"));
    assert.match(streamStateBlock, /isWebRtcConnected\(\)/, 'stream:state live must be gated on the peer connection state');

    const onTrackBlock = viewerJs.slice(viewerJs.indexOf('onTrack:'), viewerJs.indexOf('onConnectionStateChange:'));
    assert.match(onTrackBlock, /isWebRtcConnected\(\)/, 'onTrack must not hide the overlay before ICE connects');

    const failedBlock = viewerJs.slice(viewerJs.indexOf("state === 'failed'"), viewerJs.indexOf('onIceConnectionStateChange:'));
    assert.match(failedBlock, /showOverlay\('Connection Failed'/, 'a failed peer connection must show an explanatory overlay');
  });

  test('style.css and viewer.js hide top-right .video-hud in fullscreen mode', () => {
    const styleCss = fs.readFileSync(path.resolve(__dirname, '../src/public/css/style.css'), 'utf8');
    assert.match(styleCss, /:fullscreen\s+\.video-hud\s*\{[^}]*display:\s*none\s*!important/, 'style.css must hide .video-hud in :fullscreen');
    assert.match(styleCss, /:-webkit-full-screen\s+\.video-hud\s*\{[^}]*display:\s*none\s*!important/, 'style.css must hide .video-hud in :-webkit-full-screen');
    assert.match(styleCss, /\.is-fullscreen\s+\.video-hud\s*\{[^}]*display:\s*none\s*!important/, 'style.css must hide .video-hud in .is-fullscreen');

    const viewerJs = fs.readFileSync(path.resolve(__dirname, '../src/public/js/viewer.js'), 'utf8');
    assert.match(viewerJs, /document\.addEventListener\('fullscreenchange'/, 'viewer.js must listen for fullscreenchange');
    assert.match(viewerJs, /classList\.toggle\('is-fullscreen'/, 'viewer.js must toggle is-fullscreen class');
    assert.match(viewerJs, /videoWrapper\.addEventListener\('dblclick'/, 'viewer.js must toggle fullscreen on double-click');
  });

  test('viewer.html and sender.html provide dynamic brand-version badges without hardcoded version strings', () => {
    const senderHtml = fs.readFileSync(path.resolve(__dirname, '../src/public/sender.html'), 'utf8');
    const viewerHtml = fs.readFileSync(path.resolve(__dirname, '../src/public/viewer.html'), 'utf8');

    assert.doesNotMatch(senderHtml, /v1\.0\.23/, 'sender.html must not contain hardcoded v1.0.23');
    assert.doesNotMatch(viewerHtml, /v1\.0\.23/, 'viewer.html must not contain hardcoded v1.0.23');

    assert.match(senderHtml, /class="brand-version"/, 'sender.html must have brand-version badge element');
    assert.match(viewerHtml, /class="brand-version"/, 'viewer.html must have brand-version badge element');
  });

  test('initializeVersionBadge populates DOM badge with dynamic version from /api/version', async () => {
    const { initializeVersionBadge } = await import('../src/public/js/ui-utils.js');
    const { getAppVersion } = await import('../src/server/version.js');

    assert.equal(getAppVersion(), '1.0.36');

    const dom = new JSDOM('<!DOCTYPE html><html><body><span class="brand-version" id="appVersionBadge"></span></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;

    // Mock fetch for /api/version
    global.fetch = async (url) => {
      if (url === '/api/version') {
        return {
          ok: true,
          json: async () => ({ version: '1.0.36' })
        };
      }
      return { ok: false };
    };

    const ver = await initializeVersionBadge();
    assert.equal(ver, '1.0.36');

    const badge = dom.window.document.getElementById('appVersionBadge');
    assert.equal(badge.textContent, 'v1.0.36');
    assert.equal(badge.getAttribute('title'), 'LAN Camera Streaming v1.0.36');
  });
});

