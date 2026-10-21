/**
 * @file ux-improvements.test.js
 * Verification test suite for high-priority UX audit improvements.
 * Strictly adheres to AGENTS.md conventions (no var, explicit types, K&R bracing).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from '../src/server/server.js';
import { loadConfig } from '../src/server/config.js';
import { Logger } from '../src/server/logger.js';
import { ChatManager } from '../src/public/js/chat.js';
import { initWallpaper } from '../src/public/js/wallpaper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('UX Audit Improvements & Progressive Disclosure Verification', () => {
  const indexHtmlPath = path.resolve(__dirname, '../src/public/index.html');
  const senderHtmlPath = path.resolve(__dirname, '../src/public/sender.html');
  const viewerHtmlPath = path.resolve(__dirname, '../src/public/viewer.html');
  const styleCssPath = path.resolve(__dirname, '../src/public/css/style.css');

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const senderHtml = fs.readFileSync(senderHtmlPath, 'utf8');
  const viewerHtml = fs.readFileSync(viewerHtmlPath, 'utf8');
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');

  test('P0: server exposes /api/lan-info with reachable LAN IP and pairing URL', async () => {
    const config = loadConfig({ PORT: '3044' });
    const logger = new Logger('error');
    const { httpServer } = createServer(config, logger);

    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/lan-info`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.protocol, 'http');
      assert.strictEqual(data.port, 3044);
      assert.ok(Array.isArray(data.lanIps), 'lanIps must be an array');
      if (data.lanIps.length > 0) {
        assert.ok(data.primaryLanIp, 'primaryLanIp must exist if lanIps is non-empty');
        assert.strictEqual(data.lanUrl, `http://${data.primaryLanIp}:3044`);
      }
    } finally {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  });

  test('P0: index.html contains mobile pairing fallback elements for unreachable localhost', () => {
    const dom = new JSDOM(indexHtml, { url: 'http://localhost/' });
    const doc = dom.window.document;

    const hubQrBadge = doc.getElementById('hubQrBadge');
    assert.ok(hubQrBadge, 'hubQrBadge must exist in index.html');

    const hubQrWrapper = doc.getElementById('hubQrWrapper');
    assert.ok(hubQrWrapper, 'hubQrWrapper must exist in index.html');

    const hubQrUnavailable = doc.getElementById('hubQrUnavailable');
    assert.ok(hubQrUnavailable, 'hubQrUnavailable must exist to explain when localhost cannot be paired');
    assert.strictEqual(hubQrUnavailable.style.display, 'none');

    const hubQrInputRow = doc.getElementById('hubQrInputRow');
    assert.ok(hubQrInputRow, 'hubQrInputRow must exist');
  });

  test('P1: sender.html contains credentials row and 1-click access PIN option in share card', () => {
    const dom = new JSDOM(senderHtml, { url: 'http://localhost/' });
    const doc = dom.window.document;

    const shareCredentialsRow = doc.getElementById('shareCredentialsRow');
    assert.ok(shareCredentialsRow, 'shareCredentialsRow must exist in sender.html');

    const shareRoomCode = doc.getElementById('shareRoomCode');
    assert.ok(shareRoomCode, 'shareRoomCode element must exist');

    const sharePinCode = doc.getElementById('sharePinCode');
    assert.ok(sharePinCode, 'sharePinCode element must exist');

    const chkIncludePinInLink = doc.getElementById('chkIncludePinInLink');
    assert.ok(chkIncludePinInLink, 'chkIncludePinInLink must exist for 1-click access');
    assert.strictEqual(chkIncludePinInLink.checked, true, 'Include PIN should default to true');

    const shareLinkModeLabel = doc.getElementById('shareLinkModeLabel');
    assert.ok(shareLinkModeLabel, 'shareLinkModeLabel must exist');
  });

  test('P1: viewer.html embeds centered inactive join form inside #videoOverlay', () => {
    const dom = new JSDOM(viewerHtml, { url: 'http://localhost/' });
    const doc = dom.window.document;

    const videoOverlay = doc.getElementById('videoOverlay');
    assert.ok(videoOverlay, 'videoOverlay must exist');

    const overlayJoinForm = doc.getElementById('overlayJoinForm');
    assert.ok(overlayJoinForm, 'overlayJoinForm must exist inside videoOverlay');
    assert.ok(videoOverlay.contains(overlayJoinForm), 'overlayJoinForm must be child of videoOverlay');

    const overlayRoomId = doc.getElementById('overlayRoomId');
    assert.ok(overlayRoomId, 'overlayRoomId must exist');

    const overlayAccessPin = doc.getElementById('overlayAccessPin');
    assert.ok(overlayAccessPin, 'overlayAccessPin must exist');

    const btnOverlayJoin = doc.getElementById('btnOverlayJoin');
    assert.ok(btnOverlayJoin, 'btnOverlayJoin must exist');
  });

  test('Sender Setup progressive disclosure isolates secondary settings and remote control', () => {
    const dom = new JSDOM(senderHtml, { url: 'http://localhost/' });
    const doc = dom.window.document;

    const setupFormBody = doc.getElementById('setupFormBody');
    assert.ok(setupFormBody, 'setupFormBody must exist');

    // Core setup elements directly visible
    assert.ok(doc.getElementById('cameraSelectGroup'));
    assert.ok(doc.getElementById('sourceSelect'));
    assert.ok(doc.getElementById('roomId'));
    assert.ok(doc.getElementById('accessPin'));
    assert.ok(doc.getElementById('btnStart'));
    assert.ok(doc.getElementById('btnToggleFacing'));

    // Advanced settings in collapsible details
    const advancedSection = doc.getElementById('advancedSettingsSection');
    assert.ok(advancedSection, 'advancedSettingsSection must exist');

    // Secondary settings inside advancedSection
    assert.ok(advancedSection.contains(doc.getElementById('resolutionGroup')));
    assert.ok(advancedSection.contains(doc.getElementById('focusModeGroup')));
    assert.ok(advancedSection.contains(doc.getElementById('audioToggle')));
    assert.ok(advancedSection.contains(doc.getElementById('mediaMode')));
    assert.ok(advancedSection.contains(doc.getElementById('controlSectionPanel')), 'controlSectionPanel must be inside advanced settings');
  });

  test('Vitals metrics are renamed to FPS, Resolution, Connection and hidden by default', () => {
    const senderDom = new JSDOM(senderHtml, { url: 'http://localhost/' });
    const viewerDom = new JSDOM(viewerHtml, { url: 'http://localhost/' });

    for (const doc of [senderDom.window.document, viewerDom.window.document]) {
      const vitalsBar = doc.getElementById('streamVitalsBar');
      assert.ok(vitalsBar, 'streamVitalsBar must exist');
      assert.strictEqual(vitalsBar.style.display, 'none', 'streamVitalsBar must start hidden before streaming');

      const labels = Array.from(vitalsBar.querySelectorAll('.vital-label')).map(el => el.textContent.trim());
      assert.ok(labels.includes('FPS'), 'Labels must include FPS');
      assert.ok(labels.includes('Resolution'), 'Labels must include Resolution');
      assert.ok(labels.includes('Connection'), 'Labels must include Connection');
      assert.ok(!labels.includes('Flow'), 'Unclear label Flow must be removed');
      assert.ok(!labels.includes('Acuity'), 'Unclear label Acuity must be removed');
      assert.ok(!labels.includes('Path'), 'Unclear label Path must be replaced with Connection');
    }
  });

  test('Developer diagnostics are gated by default and togglable via Developer Mode button', () => {
    const senderDom = new JSDOM(senderHtml, { url: 'http://localhost/' });
    const viewerDom = new JSDOM(viewerHtml, { url: 'http://localhost/' });

    for (const doc of [senderDom.window.document, viewerDom.window.document]) {
      const devSection = doc.getElementById('devToolsSection');
      assert.ok(devSection, 'devToolsSection must exist');
      assert.strictEqual(devSection.style.display, 'none', 'devToolsSection must be hidden by default');

      const btnToggleDevMode = doc.getElementById('btnToggleDevMode');
      assert.ok(btnToggleDevMode, 'btnToggleDevMode button must exist');
    }
  });

  test('Chat floating button is hidden by default and only shows when room is joined', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="appShell"></div></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const chat = new ChatManager();
    chat.init();

    const floatBtn = document.getElementById('chatFloatingBtn');
    assert.ok(floatBtn, 'Floating button must exist');
    assert.strictEqual(floatBtn.style.display, 'none', 'Floating button must start hidden before room connection');

    // Simulate connecting to room
    chat.setRoom('room-test-123', 'viewer');
    assert.strictEqual(floatBtn.style.display, 'flex', 'Floating button must display when room is connected');

    // Simulate leaving room
    chat.setRoom(null);
    assert.strictEqual(floatBtn.style.display, 'none', 'Floating button must hide when disconnected from room');
  });

  test('Wallpaper system uses local static background by default without network calls', async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div class="app-shell" id="appShell"></div></body></html>', { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      throw new Error('Should not be called');
    };

    await initWallpaper({ pageKey: 'test_default' });

    assert.strictEqual(fetchCalled, false, 'Default initWallpaper must not make external network requests');
    const container = document.getElementById('wallpaperContainer');
    assert.ok(container, 'Wallpaper container must exist');
    const imageLayer = container.querySelector('.wallpaper-layer-image');
    assert.ok(imageLayer.style.backgroundImage, 'Static background image must be set');
  });

  test('Mobile responsive rules prioritize title over version and provide scroll affordance', () => {
    assert.ok(styleCss.includes('.app-header .brand-version'), 'CSS must include rule hiding version badge on mobile');
    assert.ok(styleCss.includes('scrollbar-color: rgba(255, 255, 255, 0.25) transparent'), 'CSS must include scrollbar affordance for vitals bar');
    assert.ok(styleCss.includes('.overlay-join-form'), 'CSS must include overlay join form styling');
  });
});
