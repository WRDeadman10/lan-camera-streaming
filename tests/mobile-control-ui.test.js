/**
 * @file mobile-control-ui.test.js
 * Verification suite for TeamViewer-style mobile remote control toolbar,
 * bottom sheets, gesture tracking, keyboard input, and modifier bars.
 * Strictly adheres to AGENTS.md conventions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MobileRemoteController } from '../src/public/js/mobile-control.js';
import { ZoomController } from '../src/public/js/zoom-controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Mobile Remote Control UI and Interaction Engine Verification', () => {
  const viewerHtmlPath = path.resolve(__dirname, '../src/public/viewer.html');
  const cssPath = path.resolve(__dirname, '../src/public/css/style.css');

  const viewerHtmlContent = fs.readFileSync(viewerHtmlPath, 'utf8');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  test('viewer.html contains all mobile control toolbar, cursor, zoom, and sheet elements', () => {
    const dom = new JSDOM(viewerHtmlContent);
    const doc = dom.window.document;

    // Remote cursor overlay
    const remoteCursorOverlay = doc.getElementById('remoteCursorOverlay');
    assert.ok(remoteCursorOverlay, '#remoteCursorOverlay must exist in viewer.html');
    assert.strictEqual(remoteCursorOverlay.style.display, 'none');

    // Floating zoom controls
    const floatingZoomControls = doc.getElementById('floatingZoomControls');
    assert.ok(floatingZoomControls, '#floatingZoomControls must exist');
    assert.ok(doc.getElementById('btnFloatingZoomIn'), '#btnFloatingZoomIn must exist');
    assert.ok(doc.getElementById('btnFloatingZoomOut'), '#btnFloatingZoomOut must exist');
    const btnFloatingZoomReset = doc.getElementById('btnFloatingZoomReset');
    assert.ok(btnFloatingZoomReset, '#btnFloatingZoomReset must exist');
    assert.strictEqual(btnFloatingZoomReset.style.display, 'none');
    assert.ok(doc.getElementById('zoomLevelIndicator'), '#zoomLevelIndicator must exist');

    // Mobile toolbar and buttons
    const mobileControlToolbar = doc.getElementById('mobileControlToolbar');
    assert.ok(mobileControlToolbar, '#mobileControlToolbar must exist');
    assert.strictEqual(mobileControlToolbar.style.display, 'none');

    const expectedToolbarButtons = [
      'btnToolbarExitControl',
      'btnToolbarKeyboard',
      'btnToolbarMode',
      'btnToolbarShortcuts',
      'btnToolbarSpecialKeys',
      'btnToolbarSettings',
      'btnToolbarCollapse',
      'btnToolbarExpand'
    ];
    for (let i = 0; i < expectedToolbarButtons.length; i++) {
      const btnId = expectedToolbarButtons[i];
      assert.ok(doc.getElementById(btnId), `#${btnId} must exist in viewer.html`);
    }

    // Auxiliary modifier bar
    const mobileModifierBar = doc.getElementById('mobileModifierBar');
    assert.ok(mobileModifierBar, '#mobileModifierBar must exist');
    assert.ok(doc.getElementById('btnDismissKeyboard'), '#btnDismissKeyboard must exist');
    assert.ok(doc.getElementById('mobileKeyboardInput'), '#mobileKeyboardInput must exist');
    assert.ok(doc.getElementById('btnModShift'), '#btnModShift must exist');
    assert.ok(doc.getElementById('btnModCtrl'), '#btnModCtrl must exist');
    assert.ok(doc.getElementById('btnModAlt'), '#btnModAlt must exist');
    assert.ok(doc.getElementById('btnModWin'), '#btnModWin must exist');
    assert.ok(doc.getElementById('btnToggleSpecialFromBar'), '#btnToggleSpecialFromBar must exist');

    // Bottom sheets
    const sheets = [
      'interactionMethodSheet',
      'shortcutsSheet',
      'specialKeysSheet',
      'controlSettingsSheet'
    ];
    for (let i = 0; i < sheets.length; i++) {
      const sheet = doc.getElementById(sheets[i]);
      assert.ok(sheet, `#${sheets[i]} must exist`);
      assert.ok(sheet.classList.contains('control-bottom-sheet'), `#${sheets[i]} must have control-bottom-sheet class`);
    }

    // Mode options in interactionMethodSheet
    assert.ok(doc.getElementById('btnModeMouse'), '#btnModeMouse must exist');
    assert.ok(doc.getElementById('btnModeTouch'), '#btnModeTouch must exist');

    // Sensitivity slider
    const controlSensitivitySlider = doc.getElementById('controlSensitivitySlider');
    assert.ok(controlSensitivitySlider, '#controlSensitivitySlider must exist');
    assert.strictEqual(controlSensitivitySlider.value, '1.5');

    // Special keys buttons
    const specialKeyBtns = doc.querySelectorAll('[data-special-key]');
    assert.ok(specialKeyBtns.length >= 20, 'Must have at least 20 special key buttons in specialKeysSheet');
  });

  test('style.css defines responsive styling for mobile toolbar, floating zoom, and sheets', () => {
    assert.ok(cssContent.includes('.remote-cursor-overlay'), 'style.css must style .remote-cursor-overlay');
    assert.ok(cssContent.includes('.floating-zoom-controls'), 'style.css must style .floating-zoom-controls');
    assert.ok(cssContent.includes('.mobile-control-toolbar'), 'style.css must style .mobile-control-toolbar');
    assert.ok(cssContent.includes('.mobile-modifier-bar'), 'style.css must style .mobile-modifier-bar');
    assert.ok(cssContent.includes('.control-bottom-sheet'), 'style.css must style .control-bottom-sheet');
    assert.ok(cssContent.includes('.special-keys-grid'), 'style.css must style .special-keys-grid');
  });

  test('MobileRemoteController lifecycle, mode switching, and sheet navigation', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    let controlActive = false;
    let releasedCalled = false;

    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    // Mock dimensions for JSDOM
    videoWrapper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600
    });
    Object.defineProperty(remoteVideo, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(remoteVideo, 'videoHeight', { value: 1080, configurable: true });

    const zoomController = new ZoomController({
      containerElement: videoWrapper,
      targetElements: [remoteVideo],
      minScale: 1.0,
      maxScale: 4.0
    });

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: zoomController,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => { releasedCalled = true; }
    });

    // Initial state: toolbar is hidden
    const toolbar = doc.getElementById('mobileControlToolbar');
    assert.strictEqual(toolbar.style.display, 'none');

    // Grant control
    controlActive = true;
    mobileCtrl.onControlGranted();
    assert.strictEqual(toolbar.style.display, 'flex');
    assert.strictEqual(toolbar.classList.contains('collapsed'), false);

    // Switch mode to touch
    mobileCtrl.setMode('touch');
    assert.strictEqual(mobileCtrl.mode, 'touch');
    const btnTouch = doc.getElementById('btnModeTouch');
    const btnMouse = doc.getElementById('btnModeMouse');
    assert.ok(btnTouch.classList.contains('active'));
    assert.strictEqual(btnMouse.classList.contains('active'), false);

    // Switch mode back to mouse
    mobileCtrl.setMode('mouse');
    assert.strictEqual(mobileCtrl.mode, 'mouse');
    assert.ok(btnMouse.classList.contains('active'));

    // Open bottom sheet
    const shortcutsSheet = doc.getElementById('shortcutsSheet');
    mobileCtrl.openSheet(shortcutsSheet);
    assert.ok(shortcutsSheet.classList.contains('open'));

    // Open special keys sheet -> shortcuts sheet closes
    const specialKeysSheet = doc.getElementById('specialKeysSheet');
    mobileCtrl.openSheet(specialKeysSheet);
    assert.strictEqual(shortcutsSheet.classList.contains('open'), false);
    assert.ok(specialKeysSheet.classList.contains('open'));

    // Close all sheets
    mobileCtrl.closeAllSheets();
    assert.strictEqual(specialKeysSheet.classList.contains('open'), false);

    // Collapse toolbar
    const btnCollapseToolbar = doc.getElementById('btnToolbarCollapse');
    btnCollapseToolbar.click();
    assert.ok(toolbar.classList.contains('collapsed'));
    const btnExpandToolbar = doc.getElementById('btnToolbarExpand');
    assert.strictEqual(btnExpandToolbar.style.display, 'flex');

    // Expand toolbar
    btnExpandToolbar.click();
    assert.strictEqual(toolbar.classList.contains('collapsed'), false);
    assert.strictEqual(btnExpandToolbar.style.display, 'none');

    // Exit control button triggers releaseControl callback
    const btnExit = doc.getElementById('btnToolbarExitControl');
    btnExit.click();
    assert.strictEqual(releasedCalled, true);

    // Release control
    controlActive = false;
    mobileCtrl.onControlReleased();
    assert.strictEqual(toolbar.style.display, 'none');
    assert.strictEqual(btnExpandToolbar.style.display, 'none');
  });

  test('MobileRemoteController modifier latching and shortcuts execution', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    let controlActive = true;

    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: null,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => {}
    });

    const btnModCtrl = doc.getElementById('btnModCtrl');

    // Latch Ctrl modifier
    mobileCtrl.toggleModifier('ControlLeft', btnModCtrl);
    assert.ok(mobileCtrl.heldModifiers.has('ControlLeft'));
    assert.ok(btnModCtrl.classList.contains('held'));
    assert.deepStrictEqual(dispatchedEvents[dispatchedEvents.length - 1], {
      type: 'key_down',
      code: 'ControlLeft'
    });

    // Unlatch Ctrl modifier
    mobileCtrl.toggleModifier('ControlLeft', btnModCtrl);
    assert.strictEqual(mobileCtrl.heldModifiers.has('ControlLeft'), false);
    assert.strictEqual(btnModCtrl.classList.contains('held'), false);
    assert.deepStrictEqual(dispatchedEvents[dispatchedEvents.length - 1], {
      type: 'key_up',
      code: 'ControlLeft'
    });

    // Latch Shift and Alt, then releaseHeldModifiers()
    const btnModShift = doc.getElementById('btnModShift');
    const btnModAlt = doc.getElementById('btnModAlt');
    mobileCtrl.toggleModifier('ShiftLeft', btnModShift);
    mobileCtrl.toggleModifier('AltLeft', btnModAlt);
    assert.strictEqual(mobileCtrl.heldModifiers.size, 2);

    mobileCtrl.releaseHeldModifiers();
    assert.strictEqual(mobileCtrl.heldModifiers.size, 0);
    assert.strictEqual(btnModShift.classList.contains('held'), false);
    assert.strictEqual(btnModAlt.classList.contains('held'), false);

    // Execute Shortcut: Copy (Ctrl + C)
    dispatchedEvents.length = 0;
    mobileCtrl.executeShortcut('copy');
    assert.strictEqual(dispatchedEvents.length, 3);
    assert.deepStrictEqual(dispatchedEvents[0], { type: 'key_down', code: 'ControlLeft' });
    assert.deepStrictEqual(dispatchedEvents[1], { type: 'key_tap', code: 'KeyC' });
    assert.deepStrictEqual(dispatchedEvents[2], { type: 'key_up', code: 'ControlLeft' });

    // Execute Shortcut: PrintScreen
    dispatchedEvents.length = 0;
    mobileCtrl.executeShortcut('printscreen');
    assert.strictEqual(dispatchedEvents.length, 1);
    assert.deepStrictEqual(dispatchedEvents[0], { type: 'key_tap', code: 'PrintScreen' });
  });

  test('Virtual keyboard input receiver forwards text and special control keys', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    let controlActive = true;

    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: null,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => {}
    });

    const keyboardInput = doc.getElementById('mobileKeyboardInput');
    const modifierBar = doc.getElementById('mobileModifierBar');

    // Open virtual keyboard
    mobileCtrl.openKeyboard();
    assert.strictEqual(modifierBar.style.display, 'flex');

    // Input text "Hello"
    dispatchedEvents.length = 0;
    keyboardInput.value = 'Hello';
    keyboardInput.dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(dispatchedEvents.length, 1);
    assert.deepStrictEqual(dispatchedEvents[0], { type: 'text', text: 'Hello' });
    assert.strictEqual(keyboardInput.value, '');

    // Press Backspace in keyboard input
    dispatchedEvents.length = 0;
    const backspaceEvent = new dom.window.KeyboardEvent('keydown', { key: 'Backspace' });
    keyboardInput.dispatchEvent(backspaceEvent);
    assert.strictEqual(dispatchedEvents.length, 1);
    assert.deepStrictEqual(dispatchedEvents[0], { type: 'key_tap', code: 'Backspace' });

    // Press Enter in keyboard input
    dispatchedEvents.length = 0;
    const enterEvent = new dom.window.KeyboardEvent('keydown', { key: 'Enter' });
    keyboardInput.dispatchEvent(enterEvent);
    assert.strictEqual(dispatchedEvents.length, 1);
    assert.deepStrictEqual(dispatchedEvents[0], { type: 'key_tap', code: 'Enter' });

    // Dismiss keyboard
    mobileCtrl.dismissKeyboard();
    assert.strictEqual(modifierBar.style.display, 'none');
  });

  test('Touch gestures handle single tap in mouse mode, two-finger scroll, and direct touch clicks', async () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    let controlActive = true;

    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    videoWrapper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600
    });
    Object.defineProperty(remoteVideo, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(remoteVideo, 'videoHeight', { value: 1080, configurable: true });

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: null,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => {}
    });

    // 1. Mouse mode single tap -> left click
    mobileCtrl.setMode('mouse');
    dispatchedEvents.length = 0;
    const touchStartEvent = new dom.window.Event('touchstart');
    touchStartEvent.touches = [{ clientX: 200, clientY: 200 }];
    videoWrapper.dispatchEvent(touchStartEvent);

    const touchEndEvent = new dom.window.Event('touchend');
    touchEndEvent.changedTouches = [{ clientX: 200, clientY: 200 }];
    videoWrapper.dispatchEvent(touchEndEvent);

    assert.strictEqual(dispatchedEvents.length, 1);
    assert.deepStrictEqual(dispatchedEvents[0], { type: 'mouse_click', button: 'left' });

    // 2. Touch mode tap -> maps to coordinates & clicks
    mobileCtrl.lastTapTime = 0;
    mobileCtrl.setMode('touch');
    dispatchedEvents.length = 0;
    const touchStartEvent2 = new dom.window.Event('touchstart');
    touchStartEvent2.touches = [{ clientX: 500, clientY: 300 }];
    videoWrapper.dispatchEvent(touchStartEvent2);

    const touchEndEvent2 = new dom.window.Event('touchend');
    touchEndEvent2.touches = [];
    touchEndEvent2.changedTouches = [{ clientX: 500, clientY: 300 }];
    videoWrapper.dispatchEvent(touchEndEvent2);

    assert.strictEqual(dispatchedEvents.length, 2);
    assert.strictEqual(dispatchedEvents[0].type, 'mouse_move');
    assert.strictEqual(dispatchedEvents[1].type, 'mouse_click');
    assert.strictEqual(dispatchedEvents[1].button, 'left');

    // 3. Two-finger scroll in mouse mode
    mobileCtrl.setMode('mouse');
    dispatchedEvents.length = 0;
    const twoFingerStart = new dom.window.Event('touchstart', { bubbles: true, cancelable: true });
    let twoFingerStartPrevented = false;
    twoFingerStart.preventDefault = () => { twoFingerStartPrevented = true; };
    twoFingerStart.touches = [
      { clientX: 200, clientY: 200 },
      { clientX: 250, clientY: 200 }
    ];
    videoWrapper.dispatchEvent(twoFingerStart);
    assert.strictEqual(twoFingerStartPrevented, true, 'two-finger touchstart must prevent browser zoom');

    const twoFingerMove = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    let twoFingerMovePrevented = false;
    twoFingerMove.preventDefault = () => { twoFingerMovePrevented = true; };
    twoFingerMove.touches = [
      { clientX: 200, clientY: 250 },
      { clientX: 250, clientY: 250 }
    ];
    videoWrapper.dispatchEvent(twoFingerMove);

    assert.strictEqual(twoFingerMovePrevented, true, 'two-finger touchmove must prevent browser scroll');
    assert.ok(dispatchedEvents.length >= 1);
    assert.strictEqual(dispatchedEvents[0].type, 'mouse_wheel');

    // 4. Mouse pointer touchpad movement calls preventDefault to stop page scroll
    dispatchedEvents.length = 0;
    const singleTouchStart = new dom.window.Event('touchstart', { bubbles: true, cancelable: true });
    singleTouchStart.touches = [{ clientX: 300, clientY: 300 }];
    videoWrapper.dispatchEvent(singleTouchStart);

    const singleTouchMove = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    let singleMovePrevented = false;
    singleTouchMove.preventDefault = () => { singleMovePrevented = true; };
    singleTouchMove.touches = [{ clientX: 320, clientY: 310 }];
    videoWrapper.dispatchEvent(singleTouchMove);

    assert.strictEqual(singleMovePrevented, true, 'touchmove during remote mouse drag must call preventDefault()');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(dispatchedEvents.some((e) => e.type === 'mouse_move'), 'touchpad drag must emit mouse_move');
  });

  test('Tap in mouse mode clicks at current cursor position without jumping coordinates', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    videoWrapper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600
    });
    Object.defineProperty(remoteVideo, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(remoteVideo, 'videoHeight', { value: 1080, configurable: true });

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: null,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => true,
      releaseControl: () => {}
    });

    mobileCtrl.setMode('mouse');
    // Position cursor at specific location via dragging
    mobileCtrl.normX = 0.85;
    mobileCtrl.normY = 0.25;

    dispatchedEvents.length = 0;

    // User taps at completely different screen coordinates (e.g. 150, 500)
    const tapStart = new dom.window.Event('touchstart', { bubbles: true, cancelable: true });
    tapStart.touches = [{ clientX: 150, clientY: 500 }];
    videoWrapper.dispatchEvent(tapStart);

    const tapEnd = new dom.window.Event('touchend', { bubbles: true, cancelable: true });
    tapEnd.touches = [];
    tapEnd.changedTouches = [{ clientX: 150, clientY: 500 }];
    videoWrapper.dispatchEvent(tapEnd);

    // The cursor position must NOT have jumped
    assert.strictEqual(mobileCtrl.normX, 0.85, 'normX must remain unchanged after tap in mouse mode');
    assert.strictEqual(mobileCtrl.normY, 0.25, 'normY must remain unchanged after tap in mouse mode');

    // Only mouse_click must be emitted, no mouse_move
    assert.strictEqual(dispatchedEvents.length, 1);
    assert.strictEqual(dispatchedEvents[0].type, 'mouse_click');
    assert.strictEqual(dispatchedEvents[0].button, 'left');
  });

  test('Edge auto-pan drags zoomed-in view when cursor hits edge and screen edge has not been reached', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    videoWrapper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600
    });
    Object.defineProperty(remoteVideo, 'videoWidth', { value: 1000, configurable: true });
    Object.defineProperty(remoteVideo, 'videoHeight', { value: 600, configurable: true });

    let controlActive = true;
    const zoomCtrl = new ZoomController({
      containerElement: videoWrapper,
      targetElements: [remoteVideo],
      minScale: 1.0,
      maxScale: 4.0,
      isControlActive: () => controlActive
    });

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: zoomCtrl,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => {}
    });

    mobileCtrl.setMode('mouse');
    // Zoom in 2.0x
    zoomCtrl.setZoom(2.0, 500, 300);
    assert.strictEqual(zoomCtrl.scale, 2.0);

    // Initial state: panX is 0
    assert.strictEqual(zoomCtrl.panX, 0);

    // Position cursor near right edge of the visible container (e.g. screenRelX = 980)
    // At scale 2.0 and panX = 0, center is 500. normX = 0.95 gives screenRelX = 500 + (0.95 - 0.5)*1000*2 = 1400 (clamped/offscreen)
    mobileCtrl.normX = 0.95;
    mobileCtrl.normY = 0.5;

    // Simulate drag further to the right
    mobileCtrl.lastTouchX = 300;
    mobileCtrl.lastTouchY = 300;

    const dragMove = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    dragMove.touches = [{ clientX: 320, clientY: 300 }]; // deltaX = +20 (moving right)
    videoWrapper.dispatchEvent(dragMove);

    // View must pan to the left (panX < 0) to pull right content into view
    assert.ok(zoomCtrl.panX < 0, `panX must be negative to reveal right content, got ${zoomCtrl.panX}`);

    // If normX is already 1.0 (screen edge of remote host has been reached)
    mobileCtrl.normX = 1.0;
    const prevPanX = zoomCtrl.panX;

    mobileCtrl.lastTouchX = 300;
    const dragAtEdge = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    dragAtEdge.touches = [{ clientX: 320, clientY: 300 }]; // deltaX = +20
    videoWrapper.dispatchEvent(dragAtEdge);

    // Edge panning must not pan further because normX is at maximum (1.0)
    assert.strictEqual(zoomCtrl.panX, prevPanX, 'must not pan further right when remote desktop edge is reached');
  });

  test('Two-finger parallel vertical swipe scrolls remote desktop via mouse_wheel and keeps zoom scale unchanged', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    videoWrapper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600
    });

    let controlActive = true;
    const zoomCtrl = new ZoomController({
      containerElement: videoWrapper,
      targetElements: [remoteVideo],
      minScale: 1.0,
      maxScale: 4.0,
      isControlActive: () => controlActive
    });

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: zoomCtrl,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => {}
    });

    mobileCtrl.setMode('mouse');
    assert.strictEqual(zoomCtrl.scale, 1.0);

    // Two fingers touch down with 50px distance
    const startEvent = new dom.window.Event('touchstart', { bubbles: true, cancelable: true });
    startEvent.touches = [
      { clientX: 200, clientY: 200 },
      { clientX: 250, clientY: 200 }
    ];
    videoWrapper.dispatchEvent(startEvent);

    // Two fingers swipe DOWN together by 30px (parallel movement, distance stays ~50px)
    dispatchedEvents.length = 0;
    const moveEvent = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    moveEvent.touches = [
      { clientX: 200, clientY: 230 },
      { clientX: 250, clientY: 230 }
    ];
    videoWrapper.dispatchEvent(moveEvent);

    // Must emit mouse_wheel event
    assert.ok(dispatchedEvents.some((e) => e.type === 'mouse_wheel'), 'parallel vertical swipe must emit mouse_wheel');

    // Zoom scale must remain at 1.0 (did NOT zoom in!)
    assert.strictEqual(zoomCtrl.scale, 1.0, 'parallel two-finger swipe must NOT change zoom scale');
  });

  test('Two-finger pinch with changing finger distance zooms view and does not dispatch mouse_wheel', () => {
    const dom = new JSDOM(viewerHtmlContent, { url: 'http://localhost/' });
    const doc = dom.window.document;
    global.window = dom.window;
    global.document = doc;

    const dispatchedEvents = [];
    const videoWrapper = doc.getElementById('videoWrapper');
    const remoteVideo = doc.getElementById('remoteVideo');

    videoWrapper.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600
    });

    let controlActive = true;
    const zoomCtrl = new ZoomController({
      containerElement: videoWrapper,
      targetElements: [remoteVideo],
      minScale: 1.0,
      maxScale: 4.0,
      isControlActive: () => controlActive
    });

    const mobileCtrl = new MobileRemoteController({
      containerElement: videoWrapper,
      videoElement: remoteVideo,
      zoomController: zoomCtrl,
      sendControlInput: (event) => dispatchedEvents.push(event),
      isControlActive: () => controlActive,
      releaseControl: () => {}
    });

    mobileCtrl.setMode('mouse');
    assert.strictEqual(zoomCtrl.scale, 1.0);

    // Two fingers touch down with 50px distance
    const startEvent = new dom.window.Event('touchstart', { bubbles: true, cancelable: true });
    startEvent.touches = [
      { clientX: 200, clientY: 200 },
      { clientX: 250, clientY: 200 }
    ];
    videoWrapper.dispatchEvent(startEvent);

    // Two fingers spread apart significantly (distance increases from 50 to 110px)
    dispatchedEvents.length = 0;
    const moveEvent = new dom.window.Event('touchmove', { bubbles: true, cancelable: true });
    moveEvent.touches = [
      { clientX: 170, clientY: 200 },
      { clientX: 280, clientY: 200 }
    ];
    videoWrapper.dispatchEvent(moveEvent);

    // Must pinch zoom in (scale > 1.0)
    assert.ok(zoomCtrl.scale > 1.2, `pinch gesture must increase scale, got ${zoomCtrl.scale}`);

    // Must NOT emit mouse_wheel events
    assert.strictEqual(
      dispatchedEvents.filter((e) => e.type === 'mouse_wheel').length,
      0,
      'pinch-to-zoom must not emit mouse_wheel events'
    );
  });
});
