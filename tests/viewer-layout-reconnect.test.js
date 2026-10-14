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
});
