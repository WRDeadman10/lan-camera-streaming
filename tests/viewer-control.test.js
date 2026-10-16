import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { calculateVideoRenderBox, translateScreenCoordinates } from '../src/public/js/control-coords.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Remote Desktop Control UI and Coordinate Mapping Verification', () => {
  const viewerHtmlPath = path.resolve(__dirname, '../src/public/viewer.html');
  const senderHtmlPath = path.resolve(__dirname, '../src/public/sender.html');
  const cssPath = path.resolve(__dirname, '../src/public/css/style.css');

  const viewerHtmlContent = fs.readFileSync(viewerHtmlPath, 'utf8');
  const senderHtmlContent = fs.readFileSync(senderHtmlPath, 'utf8');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  test('viewer.html contains all remote control HUD and modal elements', () => {
    const dom = new JSDOM(viewerHtmlContent);
    const doc = dom.window.document;

    const btnHudControl = doc.getElementById('btnHudControl');
    assert.ok(btnHudControl, 'btnHudControl must exist in viewer.html');
    assert.ok(btnHudControl.classList.contains('hud-btn'), 'btnHudControl must have hud-btn class');

    const hudControlPill = doc.getElementById('hudControlPill');
    assert.ok(hudControlPill, 'hudControlPill must exist in viewer.html');
    assert.strictEqual(hudControlPill.style.display, 'none', 'hudControlPill must be hidden initially');

    const btnReleaseControl = doc.getElementById('btnReleaseControl');
    assert.ok(btnReleaseControl, 'btnReleaseControl must exist in viewer.html');

    const controlModal = doc.getElementById('controlModal');
    assert.ok(controlModal, 'controlModal must exist in viewer.html');
    assert.strictEqual(controlModal.style.display, 'none', 'controlModal must be hidden initially');

    const controlCredentialInput = doc.getElementById('controlCredentialInput');
    assert.ok(controlCredentialInput, 'controlCredentialInput must exist in control modal');
    assert.strictEqual(controlCredentialInput.type, 'password', 'controlCredentialInput must be password type');

    const btnSubmitControl = doc.getElementById('btnSubmitControl');
    assert.ok(btnSubmitControl, 'btnSubmitControl must exist');

    const btnCancelControlModal = doc.getElementById('btnCancelControlModal');
    assert.ok(btnCancelControlModal, 'btnCancelControlModal must exist');

    const btnCloseControlModal = doc.getElementById('btnCloseControlModal');
    assert.ok(btnCloseControlModal, 'btnCloseControlModal must exist');

    const controlModalStatus = doc.getElementById('controlModalStatus');
    assert.ok(controlModalStatus, 'controlModalStatus must exist');

    const viewerControlSidebarCard = doc.getElementById('viewerControlSidebarCard');
    assert.ok(viewerControlSidebarCard, 'viewerControlSidebarCard must exist in viewer.html');

    const btnSidebarRequestControl = doc.getElementById('btnSidebarRequestControl');
    assert.ok(btnSidebarRequestControl, 'btnSidebarRequestControl must exist in viewer.html');

    const btnSidebarReleaseControl = doc.getElementById('btnSidebarReleaseControl');
    assert.ok(btnSidebarReleaseControl, 'btnSidebarReleaseControl must exist in viewer.html');

    const autoControlPinInput = doc.getElementById('autoControlPinInput');
    assert.ok(autoControlPinInput, 'autoControlPinInput must exist in joinCard');
  });

  test('sender.html contains remote control management panel and password modal', () => {
    const dom = new JSDOM(senderHtmlContent);
    const doc = dom.window.document;

    const controlSectionPanel = doc.getElementById('controlSectionPanel');
    assert.ok(controlSectionPanel, 'controlSectionPanel must exist in sender.html');

    const controlToggle = doc.getElementById('controlToggle');
    assert.ok(controlToggle, 'controlToggle toggle must exist in sender.html');
    assert.strictEqual(controlToggle.type, 'checkbox', 'controlToggle must be a checkbox');

    const controlStatusBadge = doc.getElementById('controlStatusBadge');
    assert.ok(controlStatusBadge, 'controlStatusBadge must exist');

    const controlPinDisplay = doc.getElementById('controlPinDisplay');
    assert.ok(controlPinDisplay, 'controlPinDisplay must exist');

    const btnRegenControlPin = doc.getElementById('btnRegenControlPin');
    assert.ok(btnRegenControlPin, 'btnRegenControlPin must exist');

    const btnCopyControlPin = doc.getElementById('btnCopyControlPin');
    assert.ok(btnCopyControlPin, 'btnCopyControlPin must exist');

    const btnRevokeControl = doc.getElementById('btnRevokeControl');
    assert.ok(btnRevokeControl, 'btnRevokeControl must exist');

    const btnOpenPasswordModal = doc.getElementById('btnOpenPasswordModal');
    assert.ok(btnOpenPasswordModal, 'btnOpenPasswordModal must exist');

    const passwordModal = doc.getElementById('passwordModal');
    assert.ok(passwordModal, 'passwordModal must exist');

    const permPasswordInput = doc.getElementById('permPasswordInput');
    assert.ok(permPasswordInput, 'permPasswordInput must exist');

    const permPasswordConfirm = doc.getElementById('permPasswordConfirm');
    assert.ok(permPasswordConfirm, 'permPasswordConfirm must exist');

    const btnSavePassword = doc.getElementById('btnSavePassword');
    assert.ok(btnSavePassword, 'btnSavePassword must exist');

    const btnClearPassword = doc.getElementById('btnClearPassword');
    assert.ok(btnClearPassword, 'btnClearPassword must exist');

    const controlHelperAlert = doc.getElementById('controlHelperAlert');
    assert.ok(controlHelperAlert, 'controlHelperAlert must exist in sender.html');

    const btnLaunchControlHelper = doc.getElementById('btnLaunchControlHelper');
    assert.ok(btnLaunchControlHelper, 'btnLaunchControlHelper must exist in sender.html');

    const btnDownloadControlHelper = doc.getElementById('btnDownloadControlHelper');
    assert.ok(btnDownloadControlHelper, 'btnDownloadControlHelper must exist in sender.html');
    assert.equal(btnDownloadControlHelper.getAttribute('href'), '/download/control-helper-setup', 'btnDownloadControlHelper must link to /download/control-helper-setup');

    const controlHelperRunningIndicator = doc.getElementById('controlHelperRunningIndicator');
    assert.ok(controlHelperRunningIndicator, 'controlHelperRunningIndicator must exist in sender.html');
  });

  test('style.css defines control UI styling rules', () => {
    assert.ok(cssContent.includes('.control-active-pill'), 'CSS must define .control-active-pill');
    assert.ok(cssContent.includes('.control-release-btn'), 'CSS must define .control-release-btn');
    assert.ok(cssContent.includes('.modal-overlay'), 'CSS must define .modal-overlay');
    assert.ok(cssContent.includes('.modal-card'), 'CSS must define .modal-card');
  });

  test('calculateVideoRenderBox handles standard and widescreen aspect ratios correctly', () => {
    // 16:9 container with 16:9 video -> exact fit
    const exactFit = calculateVideoRenderBox(1920, 1080, 1920, 1080);
    assert.strictEqual(exactFit.left, 0);
    assert.strictEqual(exactFit.top, 0);
    assert.strictEqual(exactFit.width, 1920);
    assert.strictEqual(exactFit.height, 1080);

    // Letterboxed: 16:9 container (1920x1080) displaying 4:3 video (1440x1080)
    const letterboxed = calculateVideoRenderBox(1920, 1080, 1440, 1080);
    assert.strictEqual(letterboxed.top, 0);
    assert.strictEqual(letterboxed.height, 1080);
    assert.strictEqual(letterboxed.width, 1440);
    assert.strictEqual(letterboxed.left, 240); // (1920 - 1440) / 2

    // Pillarboxed: square container (1000x1000) displaying 16:9 video (1920x1080)
    const pillarboxed = calculateVideoRenderBox(1000, 1000, 1920, 1080);
    assert.strictEqual(pillarboxed.left, 0);
    assert.strictEqual(pillarboxed.width, 1000);
    assert.ok(Math.abs(pillarboxed.height - (1000 / (16 / 9))) < 1);
    assert.ok(pillarboxed.top > 0);
  });

  test('translateScreenCoordinates clamps and maps clicks correctly', () => {
    const boundingRect = { left: 100, top: 50, width: 1920, height: 1080 };
    // Center of 1920x1080 video at (100+960, 50+540) = (1060, 590)
    const center = translateScreenCoordinates(1060, 590, boundingRect, 1920, 1080);
    assert.ok(center);
    assert.strictEqual(Math.round(center.x * 100) / 100, 0.5);
    assert.strictEqual(Math.round(center.y * 100) / 100, 0.5);

    // Out of bounds without clamping returns null
    const outside = translateScreenCoordinates(50, 20, boundingRect, 1920, 1080, false);
    assert.strictEqual(outside, null);

    // Out of bounds with clamping clamps to 0.0
    const clamped = translateScreenCoordinates(50, 20, boundingRect, 1920, 1080, true);
    assert.ok(clamped);
    assert.strictEqual(clamped.x, 0);
    assert.strictEqual(clamped.y, 0);
  });
});
