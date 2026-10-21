/**
 * @file mobile-control.js
 * Mobile-first remote desktop control engine inspired by TeamViewer mobile application.
 * Manages adaptive cursor overlay, touchpad Mouse mode, direct Touch mode,
 * bottom control toolbar, sheets (modes, shortcuts, special keys, settings),
 * virtual keyboard input, and modifier keys.
 * Strictly adheres to AGENTS.md conventions (explicit types, no var, K&R braces).
 */

import { translateScreenCoordinates, getScreenCoordinatesFromNormalized } from './control-coords.js';

export class MobileRemoteController {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.containerElement - The video container (#videoWrapper).
   * @param {HTMLVideoElement} options.videoElement - The remote video element.
   * @param {Object} options.zoomController - The ZoomController instance.
   * @param {Function} options.sendControlInput - Function to dispatch control event packets.
   * @param {Function} options.isControlActive - Function returning whether lease is currently held.
   * @param {Function} options.releaseControl - Function to release controller lease.
   */
  constructor(options) {
    this.containerElement = options.containerElement;
    this.videoElement = options.videoElement;
    this.getVideoElement = options.getVideoElement;
    this.zoomController = options.zoomController;
    this.sendControlInput = options.sendControlInput;
    this.isControlActive = options.isControlActive;
    this.releaseControl = options.releaseControl;

    // Interaction modes: 'mouse' (touchpad trackpad) or 'touch' (direct tap)
    this.mode = 'mouse';
    this.sensitivity = 1.5;

    // Normalized host cursor position [0.0, 1.0]
    this.normX = 0.5;
    this.normY = 0.5;

    // Active held modifier keys
    this.heldModifiers = new Set();

    // Touch gesture tracking state
    this.touchStartTime = 0;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.lastTouchX = 0;
    this.lastTouchY = 0;
    this.lastTapTime = 0;
    this.isDoubleTapDragging = false;
    this.longPressTimer = null;
    this.isLongPressed = false;
    this.isTwoFingerScrolling = false;
    this.lastTwoFingerY = 0;
    this.moveThrottleTimer = null;
    this.pendingMoveCoords = null;

    this._cacheDomElements();
    this._bindEvents();
  }

  /**
   * Cache references to UI elements in viewer.html.
   * @private
   */
  _cacheDomElements() {
    this.cursorOverlay = document.getElementById('remoteCursorOverlay');
    this.toolbar = document.getElementById('mobileControlToolbar');
    this.btnExpandToolbar = document.getElementById('btnToolbarExpand');
    this.btnExitControl = document.getElementById('btnToolbarExitControl');
    this.btnKeyboard = document.getElementById('btnToolbarKeyboard');
    this.btnMode = document.getElementById('btnToolbarMode');
    this.btnShortcuts = document.getElementById('btnToolbarShortcuts');
    this.btnSpecialKeys = document.getElementById('btnToolbarSpecialKeys');
    this.btnSettings = document.getElementById('btnToolbarSettings');
    this.btnCollapseToolbar = document.getElementById('btnToolbarCollapse');

    // Auxiliary modifier bar & hidden input
    this.modifierBar = document.getElementById('mobileModifierBar');
    this.btnDismissKeyboard = document.getElementById('btnDismissKeyboard');
    this.keyboardInput = document.getElementById('mobileKeyboardInput');
    this.btnModShift = document.getElementById('btnModShift');
    this.btnModCtrl = document.getElementById('btnModCtrl');
    this.btnModAlt = document.getElementById('btnModAlt');
    this.btnModWin = document.getElementById('btnModWin');
    this.btnToggleSpecialFromBar = document.getElementById('btnToggleSpecialFromBar');

    // Bottom sheets
    this.interactionMethodSheet = document.getElementById('interactionMethodSheet');
    this.shortcutsSheet = document.getElementById('shortcutsSheet');
    this.specialKeysSheet = document.getElementById('specialKeysSheet');
    this.controlSettingsSheet = document.getElementById('controlSettingsSheet');

    // Mode selector buttons
    this.btnModeMouse = document.getElementById('btnModeMouse');
    this.btnModeTouch = document.getElementById('btnModeTouch');
    this.interactionSubtitle = document.getElementById('interactionMethodSubtitle');

    // Floating zoom controls
    this.btnZoomIn = document.getElementById('btnFloatingZoomIn');
    this.btnZoomOut = document.getElementById('btnFloatingZoomOut');
    this.btnZoomReset = document.getElementById('btnFloatingZoomReset');
    this.zoomLevelIndicator = document.getElementById('zoomLevelIndicator');

    // Sensitivity slider
    this.sensitivitySlider = document.getElementById('controlSensitivitySlider');
    this.sensitivityValue = document.getElementById('controlSensitivityValue');
  }

  /**
   * Called when control lease is acquired by this viewer.
   */
  onControlGranted() {
    if (this.toolbar) {
      this.toolbar.style.display = 'flex';
      this.toolbar.classList.remove('collapsed');
    }
    if (this.btnExpandToolbar) {
      this.btnExpandToolbar.style.display = 'none';
    }
    this.updateCursorOverlay(this.normX, this.normY);
  }

  /**
   * Called when control lease is released, revoked, or lost.
   */
  onControlReleased() {
    this.releaseHeldModifiers();
    if (this.toolbar) {
      this.toolbar.style.display = 'none';
    }
    if (this.btnExpandToolbar) {
      this.btnExpandToolbar.style.display = 'none';
    }
    if (this.cursorOverlay) {
      this.cursorOverlay.style.display = 'none';
    }
    this.closeAllSheets();
    this.dismissKeyboard();
  }

  /**
   * Determine effective media dimensions from video or canvas element.
   * @private
   * @param {DOMRect} rect
   * @returns {{ vw: number, vh: number }}
   */
  _getMediaDimensions(rect) {
    const el = typeof this.getVideoElement === 'function' ? this.getVideoElement() : this.videoElement;
    const vw = (el && (el.videoWidth || el.width)) ? (el.videoWidth || el.width) : (rect ? rect.width : 1920);
    const vh = (el && (el.videoHeight || el.height)) ? (el.videoHeight || el.height) : (rect ? rect.height : 1080);
    return { vw, vh };
  }

  /**
   * Update the visual position of the adaptive cursor overlay.
   * @param {number} normX
   * @param {number} normY
   */
  updateCursorOverlay(normX, normY) {
    if (!this.cursorOverlay || !this.isControlActive()) {
      return;
    }

    this.normX = Math.max(0, Math.min(1, normX));
    this.normY = Math.max(0, Math.min(1, normY));

    const rect = this.containerElement ? this.containerElement.getBoundingClientRect() : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const { vw, vh } = this._getMediaDimensions(rect);

    const zoomState = this.zoomController ? this.zoomController.getState() : { scale: 1.0, panX: 0, panY: 0 };
    const screenPos = getScreenCoordinatesFromNormalized(
      this.normX,
      this.normY,
      rect,
      vw,
      vh,
      zoomState.scale,
      zoomState.panX,
      zoomState.panY
    );

    if (screenPos) {
      this.cursorOverlay.style.display = 'block';
      this.cursorOverlay.style.transform = `translate(${screenPos.screenRelX.toFixed(2)}px, ${screenPos.screenRelY.toFixed(2)}px)`;
    }
  }

  /**
   * Set interaction mode ('mouse' or 'touch').
   * @param {'mouse'|'touch'} newMode
   */
  setMode(newMode) {
    if (newMode !== 'mouse' && newMode !== 'touch') {
      return;
    }
    this.mode = newMode;
    if (this.btnModeMouse && this.btnModeTouch) {
      if (this.mode === 'mouse') {
        this.btnModeMouse.classList.add('active');
        this.btnModeTouch.classList.remove('active');
        if (this.interactionSubtitle) {
          this.interactionSubtitle.textContent = 'Use your device as a touchpad to control the mouse.';
        }
      } else {
        this.btnModeTouch.classList.add('active');
        this.btnModeMouse.classList.remove('active');
        if (this.interactionSubtitle) {
          this.interactionSubtitle.textContent = 'Tap directly on the screen to click on that location.';
        }
      }
    }
  }

  /**
   * Open native mobile keyboard by focusing hidden input.
   */
  openKeyboard() {
    if (this.keyboardInput) {
      this.keyboardInput.focus();
    }
    if (this.modifierBar) {
      this.modifierBar.style.display = 'flex';
    }
  }

  /**
   * Dismiss mobile keyboard and auxiliary bar.
   */
  dismissKeyboard() {
    if (this.keyboardInput) {
      this.keyboardInput.blur();
    }
    if (this.modifierBar) {
      this.modifierBar.style.display = 'none';
    }
  }

  /**
   * Toggle state of an auxiliary modifier key.
   * @param {string} domCode - e.g. 'ShiftLeft', 'ControlLeft', 'AltLeft', 'MetaLeft'.
   * @param {HTMLElement} btnElement
   */
  toggleModifier(domCode, btnElement) {
    if (this.heldModifiers.has(domCode)) {
      this.heldModifiers.delete(domCode);
      if (btnElement) {
        btnElement.classList.remove('held');
      }
      this.sendControlInput({ type: 'key_up', code: domCode });
    } else {
      this.heldModifiers.add(domCode);
      if (btnElement) {
        btnElement.classList.add('held');
      }
      this.sendControlInput({ type: 'key_down', code: domCode });
    }
  }

  /**
   * Release all held modifier keys.
   */
  releaseHeldModifiers() {
    for (const code of this.heldModifiers) {
      this.sendControlInput({ type: 'key_up', code });
    }
    this.heldModifiers.clear();

    const modButtons = [this.btnModShift, this.btnModCtrl, this.btnModAlt, this.btnModWin];
    for (let i = 0; i < modButtons.length; i++) {
      if (modButtons[i]) {
        modButtons[i].classList.remove('held');
      }
    }
  }

  /**
   * Execute common remote shortcuts.
   * @param {string} shortcutId
   */
  executeShortcut(shortcutId) {
    if (!this.isControlActive()) {
      return;
    }
    switch (shortcutId) {
      case 'copy':
        this.sendControlInput({ type: 'key_down', code: 'ControlLeft' });
        this.sendControlInput({ type: 'key_tap', code: 'KeyC' });
        this.sendControlInput({ type: 'key_up', code: 'ControlLeft' });
        break;
      case 'paste':
        this.sendControlInput({ type: 'key_down', code: 'ControlLeft' });
        this.sendControlInput({ type: 'key_tap', code: 'KeyV' });
        this.sendControlInput({ type: 'key_up', code: 'ControlLeft' });
        break;
      case 'save':
        this.sendControlInput({ type: 'key_down', code: 'ControlLeft' });
        this.sendControlInput({ type: 'key_tap', code: 'KeyS' });
        this.sendControlInput({ type: 'key_up', code: 'ControlLeft' });
        break;
      case 'printscreen':
        this.sendControlInput({ type: 'key_tap', code: 'PrintScreen' });
        break;
      case 'switchapps':
        this.sendControlInput({ type: 'key_down', code: 'AltLeft' });
        this.sendControlInput({ type: 'key_tap', code: 'Tab' });
        this.sendControlInput({ type: 'key_up', code: 'AltLeft' });
        break;
      default:
        break;
    }
  }

  /**
   * Close all active bottom sheets.
   */
  closeAllSheets() {
    const sheets = [this.interactionMethodSheet, this.shortcutsSheet, this.specialKeysSheet, this.controlSettingsSheet];
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i]) {
        sheets[i].classList.remove('open');
      }
    }
  }

  /**
   * Open a specific bottom sheet.
   * @param {HTMLElement} sheetEl
   */
  openSheet(sheetEl) {
    this.closeAllSheets();
    if (sheetEl) {
      sheetEl.classList.add('open');
    }
  }

  /**
   * Bind event listeners for gestures, toolbar buttons, and keyboard inputs.
   * @private
   */
  _bindEvents() {
    this._bindZoomControls();
    this._bindToolbarButtons();
    this._bindKeyboardEvents();
    this._bindTouchGestures();

    window.addEventListener('resize', () => {
      if (this.isControlActive()) {
        this.updateCursorOverlay(this.normX, this.normY);
      }
    });

    if (this.videoElement) {
      this.videoElement.addEventListener('loadedmetadata', () => {
        if (this.isControlActive()) {
          this.updateCursorOverlay(this.normX, this.normY);
        }
      });
    }
  }

  /**
   * Bind floating zoom controls.
   * @private
   */
  _bindZoomControls() {
    if (this.btnZoomIn) {
      this.btnZoomIn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.zoomController) {
          this.zoomController.zoomIn(1.3);
          this._updateZoomIndicator();
        }
      });
    }

    if (this.btnZoomOut) {
      this.btnZoomOut.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.zoomController) {
          this.zoomController.zoomOut(1.3);
          this._updateZoomIndicator();
        }
      });
    }

    if (this.btnZoomReset) {
      this.btnZoomReset.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.zoomController) {
          this.zoomController.resetZoom();
          this._updateZoomIndicator();
        }
      });
    }

    if (this.zoomController) {
      this.zoomController.onZoomChange = (state) => {
        this._updateZoomIndicator();
        if (this.isControlActive()) {
          this.updateCursorOverlay(this.normX, this.normY);
        }
      };
    }
  }

  /**
   * Update floating zoom level indicator.
   * @private
   */
  _updateZoomIndicator() {
    if (!this.zoomController) {
      return;
    }
    const state = this.zoomController.getState();
    if (this.zoomLevelIndicator) {
      this.zoomLevelIndicator.textContent = `${state.scale.toFixed(1)}x`;
    }
    if (this.btnZoomReset) {
      this.btnZoomReset.style.display = state.scale > 1.05 ? 'flex' : 'none';
    }
  }

  /**
   * Bind mobile toolbar buttons and modals.
   * @private
   */
  _bindToolbarButtons() {
    if (this.btnExitControl) {
      this.btnExitControl.addEventListener('click', () => {
        if (typeof this.releaseControl === 'function') {
          this.releaseControl();
        }
      });
    }

    if (this.btnKeyboard) {
      this.btnKeyboard.addEventListener('click', () => {
        this.openKeyboard();
      });
    }

    if (this.btnDismissKeyboard) {
      this.btnDismissKeyboard.addEventListener('click', () => {
        this.dismissKeyboard();
      });
    }

    if (this.btnMode) {
      this.btnMode.addEventListener('click', () => {
        this.openSheet(this.interactionMethodSheet);
      });
    }

    if (this.btnShortcuts) {
      this.btnShortcuts.addEventListener('click', () => {
        this.openSheet(this.shortcutsSheet);
      });
    }

    if (this.btnSpecialKeys) {
      this.btnSpecialKeys.addEventListener('click', () => {
        this.openSheet(this.specialKeysSheet);
      });
    }

    if (this.btnSettings) {
      this.btnSettings.addEventListener('click', () => {
        this.openSheet(this.controlSettingsSheet);
      });
    }

    if (this.btnCollapseToolbar) {
      this.btnCollapseToolbar.addEventListener('click', () => {
        if (this.toolbar) {
          this.toolbar.classList.add('collapsed');
        }
        if (this.btnExpandToolbar) {
          this.btnExpandToolbar.style.display = 'flex';
        }
        this.closeAllSheets();
      });
    }

    if (this.btnExpandToolbar) {
      this.btnExpandToolbar.addEventListener('click', () => {
        if (this.toolbar) {
          this.toolbar.classList.remove('collapsed');
        }
        if (this.btnExpandToolbar) {
          this.btnExpandToolbar.style.display = 'none';
        }
      });
    }

    // Mode buttons in sheet
    if (this.btnModeMouse) {
      this.btnModeMouse.addEventListener('click', () => this.setMode('mouse'));
    }
    if (this.btnModeTouch) {
      this.btnModeTouch.addEventListener('click', () => this.setMode('touch'));
    }

    // Modifier buttons in auxiliary bar
    if (this.btnModShift) {
      this.btnModShift.addEventListener('click', () => this.toggleModifier('ShiftLeft', this.btnModShift));
    }
    if (this.btnModCtrl) {
      this.btnModCtrl.addEventListener('click', () => this.toggleModifier('ControlLeft', this.btnModCtrl));
    }
    if (this.btnModAlt) {
      this.btnModAlt.addEventListener('click', () => this.toggleModifier('AltLeft', this.btnModAlt));
    }
    if (this.btnModWin) {
      this.btnModWin.addEventListener('click', () => this.toggleModifier('MetaLeft', this.btnModWin));
    }
    if (this.btnToggleSpecialFromBar) {
      this.btnToggleSpecialFromBar.addEventListener('click', () => {
        this.openSheet(this.specialKeysSheet);
      });
    }

    // Shortcuts sheet items
    const shortcutActions = [
      { id: 'btnShortcutCopy', action: 'copy' },
      { id: 'btnShortcutPaste', action: 'paste' },
      { id: 'btnShortcutPrintScreen', action: 'printscreen' },
      { id: 'btnShortcutSwitchApps', action: 'switchapps' },
      { id: 'btnShortcutSave', action: 'save' }
    ];
    for (let i = 0; i < shortcutActions.length; i++) {
      const el = document.getElementById(shortcutActions[i].id);
      if (el) {
        el.addEventListener('click', () => {
          this.executeShortcut(shortcutActions[i].action);
          this.closeAllSheets();
        });
      }
    }
    const btnShortcutMore = document.getElementById('btnShortcutMore');
    if (btnShortcutMore) {
      btnShortcutMore.addEventListener('click', () => {
        this.openSheet(this.specialKeysSheet);
      });
    }

    // Special keys buttons
    const specialKeyButtons = document.querySelectorAll('[data-special-key]');
    for (let i = 0; i < specialKeyButtons.length; i++) {
      const btn = specialKeyButtons[i];
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-special-key');
        if (code && this.isControlActive()) {
          this.sendControlInput({ type: 'key_tap', code });
        }
      });
    }

    // Close buttons for sheets
    const closeButtons = document.querySelectorAll('.sheet-close-btn');
    for (let i = 0; i < closeButtons.length; i++) {
      closeButtons[i].addEventListener('click', () => this.closeAllSheets());
    }

    // Sensitivity slider
    if (this.sensitivitySlider) {
      this.sensitivitySlider.addEventListener('input', (e) => {
        this.sensitivity = parseFloat(e.target.value);
        if (this.sensitivityValue) {
          this.sensitivityValue.textContent = `${this.sensitivity.toFixed(1)}x`;
        }
      });
    }
  }

  /**
   * Bind virtual keyboard input receiver events.
   * @private
   */
  _bindKeyboardEvents() {
    if (!this.keyboardInput) {
      return;
    }

    let beforeInputHandled = false;

    this.keyboardInput.addEventListener('beforeinput', (e) => {
      if (!this.isControlActive()) {
        return;
      }
      if (e.data) {
        beforeInputHandled = true;
        this.sendControlInput({ type: 'text', text: e.data });
      }
    });

    this.keyboardInput.addEventListener('keydown', (e) => {
      if (!this.isControlActive()) {
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        this.sendControlInput({ type: 'key_tap', code: 'Backspace' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.sendControlInput({ type: 'key_tap', code: 'Enter' });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.sendControlInput({ type: 'key_tap', code: 'Tab' });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.sendControlInput({ type: 'key_tap', code: 'Escape' });
      }
    });

    this.keyboardInput.addEventListener('input', (e) => {
      if (!this.isControlActive()) {
        this.keyboardInput.value = '';
        return;
      }
      if (!beforeInputHandled && (e.data || this.keyboardInput.value)) {
        const text = e.data || this.keyboardInput.value;
        this.sendControlInput({ type: 'text', text });
      }
      beforeInputHandled = false;
      // Clear buffer so input stays ready for next character
      this.keyboardInput.value = '';
    });
  }

  /**
   * Bind mobile touch gesture engine.
   * @private
   */
  _bindTouchGestures() {
    if (!this.containerElement) {
      return;
    }

    const isInteractiveUI = (target) => {
      if (!target || typeof target.closest !== 'function') {
        return false;
      }
      return Boolean(target.closest('#mobileControlToolbar, .control-bottom-sheet, #mobileModifierBar, .floating-zoom-controls, .video-hud, button, a, input, select, textarea'));
    };

    this.containerElement.addEventListener('touchstart', (e) => {
      if (!this.isControlActive()) {
        return;
      }

      // Ignore touches if interacting with toolbar or bottom sheets
      if (isInteractiveUI(e.target)) {
        return;
      }

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        this.touchStartTime = Date.now();
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.lastTouchX = touch.clientX;
        this.lastTouchY = touch.clientY;
        this.isLongPressed = false;

        // Check for double-tap-and-drag
        const now = Date.now();
        if (now - this.lastTapTime < 320) {
          this.isDoubleTapDragging = true;
          this.sendControlInput({ type: 'mouse_down', button: 'left' });
        }

        // Setup long-press timer (500ms -> Right Click)
        if (!this.isDoubleTapDragging) {
          this.longPressTimer = setTimeout(() => {
            this.isLongPressed = true;
            if (this.mode === 'touch') {
              this._handleTouchModeClick(touch.clientX, touch.clientY, 'right');
            } else {
              this.sendControlInput({ type: 'mouse_click', button: 'right' });
            }
            if (typeof navigator.vibrate === 'function') {
              navigator.vibrate(50);
            }
          }, 500);
        }
      } else if (e.touches.length >= 2) {
        // Cancel single-finger gesture timers and prevent page zoom
        if (this.longPressTimer) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
        this.isTwoFingerScrolling = true;
        this.lastTwoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        e.preventDefault();
      }
    }, { passive: false });

    this.containerElement.addEventListener('touchmove', (e) => {
      if (!this.isControlActive()) {
        return;
      }

      if (isInteractiveUI(e.target)) {
        return;
      }

      // Prevent mobile page scroll while actively interacting with the remote desktop
      e.preventDefault();

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const distMoved = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);

        if (distMoved > 8 && this.longPressTimer) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }

        if (this.zoomController && this.zoomController.isPinching) {
          return;
        }

        const deltaX = touch.clientX - this.lastTouchX;
        const deltaY = touch.clientY - this.lastTouchY;
        this.lastTouchX = touch.clientX;
        this.lastTouchY = touch.clientY;

        if (this.mode === 'mouse') {
          // Touchpad relative pointer movement
          const rect = this.containerElement.getBoundingClientRect();
          const scale = this.zoomController ? this.zoomController.scale : 1.0;
          const adjustedSens = (this.sensitivity / (rect.width * scale));

          this.normX = Math.max(0, Math.min(1, this.normX + deltaX * adjustedSens));
          this.normY = Math.max(0, Math.min(1, this.normY + deltaY * adjustedSens));

          this.updateCursorOverlay(this.normX, this.normY);
          this._throttledMouseMove(this.normX, this.normY);
        }
      } else if (e.touches.length === 2 && this.isTwoFingerScrolling) {
        // If zooming is happening, let ZoomController handle it
        if (this.zoomController && this.zoomController.isPinching) {
          return;
        }

        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const deltaScrollY = midY - this.lastTwoFingerY;
        this.lastTwoFingerY = midY;

        if (Math.abs(deltaScrollY) > 2) {
          this.sendControlInput({
            type: 'mouse_wheel',
            deltaY: -deltaScrollY * 4,
            deltaX: 0
          });
        }
      }
    }, { passive: false });

    this.containerElement.addEventListener('touchend', (e) => {
      if (!this.isControlActive()) {
        return;
      }

      if (isInteractiveUI(e.target)) {
        return;
      }

      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }

      if (this.zoomController && this.zoomController.ignoreNextClick) {
        this.isDoubleTapDragging = false;
        return;
      }

      if (this.isDoubleTapDragging) {
        this.isDoubleTapDragging = false;
        this.sendControlInput({ type: 'mouse_up', button: 'left' });
        return;
      }

      if (e.changedTouches.length === 1 && !this.isLongPressed && !this.isTwoFingerScrolling) {
        const touch = e.changedTouches[0];
        const elapsed = Date.now() - this.touchStartTime;
        const dist = Math.hypot(touch.clientX - this.touchStartX, touch.clientY - this.touchStartY);

        if (elapsed < 300 && dist < 12) {
          this.lastTapTime = Date.now();
          if (this.mode === 'mouse') {
            // Touchpad tap -> Left Click
            this.sendControlInput({ type: 'mouse_click', button: 'left' });
          } else {
            // Touch mode tap -> Map to host screen and Click
            this._handleTouchModeClick(touch.clientX, touch.clientY, 'left');
          }
        }
      }

      if (!e.touches || e.touches.length === 0) {
        this.isTwoFingerScrolling = false;
        this.isLongPressed = false;
      }
    }, { passive: false });
  }

  /**
   * Handle direct touch mode click with zoom and letterbox mapping.
   * @private
   */
  _handleTouchModeClick(clientX, clientY, button = 'left') {
    const rect = this.containerElement.getBoundingClientRect();
    const { vw, vh } = this._getMediaDimensions(rect);
    const zoomState = this.zoomController ? this.zoomController.getState() : { scale: 1.0, panX: 0, panY: 0 };

    const coords = translateScreenCoordinates(
      clientX,
      clientY,
      rect,
      vw,
      vh,
      true,
      zoomState.scale,
      zoomState.panX,
      zoomState.panY
    );

    if (coords) {
      this.normX = coords.x;
      this.normY = coords.y;
      this.updateCursorOverlay(this.normX, this.normY);
      this.sendControlInput({ type: 'mouse_move', x: coords.x, y: coords.y });
      this.sendControlInput({ type: 'mouse_click', button });
    }
  }

  /**
   * Throttle mouse movement messages to avoid overloading network/socket.
   * @private
   */
  _throttledMouseMove(x, y) {
    this.pendingMoveCoords = { x, y };
    if (!this.moveThrottleTimer) {
      const raf = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
        ? window.requestAnimationFrame
        : (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16));

      this.moveThrottleTimer = raf(() => {
        if (this.pendingMoveCoords) {
          this.sendControlInput({
            type: 'mouse_move',
            x: this.pendingMoveCoords.x,
            y: this.pendingMoveCoords.y
          });
          this.pendingMoveCoords = null;
        }
        this.moveThrottleTimer = null;
      });
    }
  }
}
