/**
 * @file zoom-controller.js
 * Universal pinch-to-zoom, panning, and transform management for viewer media.
 * Supports WebRTC video, canvas relay, and image streams.
 * Strictly adheres to AGENTS.md conventions (no var, K&R braces, explicit types).
 */

export class ZoomController {
  /**
   * @param {HTMLElement} containerElement - Viewport or video container element.
   * @param {HTMLElement|HTMLElement[]} targetElements - Elements to scale/pan (video, canvas).
   * @param {Object} [options]
   * @param {number} [options.minScale=1.0]
   * @param {number} [options.maxScale=4.0]
   * @param {Function} [options.onZoomChange]
   */
  constructor(containerElement, targetElements, options = {}) {
    if (containerElement && !containerElement.nodeType && typeof containerElement.addEventListener !== 'function') {
      options = containerElement;
      targetElements = options.targetElements;
      containerElement = options.containerElement;
    }

    this.containerElement = containerElement;
    this.targetElements = Array.isArray(targetElements) ? targetElements : [targetElements];
    this.minScale = (options && options.minScale) || 1.0;
    this.maxScale = (options && options.maxScale) || 4.0;
    this.onZoomChange = (options && options.onZoomChange) || null;
    this.isControlActive = (options && typeof options.isControlActive === 'function') ? options.isControlActive : null;

    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;

    // Gesture tracking state
    this.isPinching = false;
    this.isPanning = false;
    this.twoFingerMode = null;
    this.initialPinchDistance = 0;
    this.initialScale = 1.0;
    this.pinchMidpoint = { x: 0, y: 0 };
    this.lastTouchPosition = { x: 0, y: 0 };
    this.initialTouchY1 = 0;
    this.initialTouchY2 = 0;
    this.activeTouchCount = 0;
    this.ignoreNextClick = false;

    // Additional external transform string (e.g., from StreamTransformController)
    this.externalTransform = '';

    this._bindEvents();
  }

  /**
   * Set target elements dynamically if stream or canvas changes.
   * @param {HTMLElement|HTMLElement[]} elements
   */
  setTargetElements(elements) {
    this.targetElements = Array.isArray(elements) ? elements : [elements];
    this.applyTransform();
  }

  /**
   * Set external transform to compose with zoom (e.g. rotate, mirror).
   * @param {string} transformStr
   */
  setExternalTransform(transformStr) {
    this.externalTransform = transformStr ? transformStr.trim() : '';
    this.applyTransform();
  }

  /**
   * Set callback to determine if remote control is active.
   * @param {Function} callback
   */
  setControlActive(callback) {
    this.isControlActive = typeof callback === 'function' ? callback : null;
  }

  /**
   * Current transform state.
   * @returns {{ scale: number, panX: number, panY: number }}
   */
  getState() {
    return {
      scale: this.scale,
      panX: this.panX,
      panY: this.panY
    };
  }

  /**
   * Reset zoom and pan to 1.0x (Fit Screen).
   */
  resetZoom() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
    this._notifyChange();
  }

  /**
   * Zoom in by a relative factor around a specific origin point.
   * @param {number} [factor=1.3]
   * @param {number} [originClientX]
   * @param {number} [originClientY]
   */
  zoomIn(factor = 1.3, originClientX = null, originClientY = null) {
    const targetScale = Math.min(this.maxScale, this.scale * factor);
    this.setZoom(targetScale, originClientX, originClientY);
  }

  /**
   * Zoom out by a relative factor.
   * @param {number} [factor=1.3]
   * @param {number} [originClientX]
   * @param {number} [originClientY]
   */
  zoomOut(factor = 1.3, originClientX = null, originClientY = null) {
    const targetScale = Math.max(this.minScale, this.scale / factor);
    this.setZoom(targetScale, originClientX, originClientY);
  }

  /**
   * Set absolute zoom scale centered at an origin point.
   * @param {number} newScale
   * @param {number} [originClientX]
   * @param {number} [originClientY]
   */
  setZoom(newScale, originClientX = null, originClientY = null) {
    const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
    if (Math.abs(clampedScale - this.scale) < 0.001) {
      return;
    }

    if (clampedScale <= 1.001) {
      this.resetZoom();
      return;
    }

    const rawRect = this.containerElement ? this.containerElement.getBoundingClientRect() : null;
    const rect = (rawRect && rawRect.width > 0 && rawRect.height > 0) ? rawRect : { left: 0, top: 0, width: 800, height: 600 };
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const ox = (originClientX !== null && originClientX !== undefined) ? (originClientX - rect.left - centerX) : 0;
    const oy = (originClientY !== null && originClientY !== undefined) ? (originClientY - rect.top - centerY) : 0;

    // Adjust pan so the origin point under fingers remains in the same relative position
    const scaleRatio = clampedScale / this.scale;
    this.panX = ox - (ox - this.panX) * scaleRatio;
    this.panY = oy - (oy - this.panY) * scaleRatio;
    this.scale = clampedScale;

    this._clampPan();
    this.applyTransform();
    this._notifyChange();
  }

  /**
   * Pan the view by pixel deltas.
   * @param {number} deltaX
   * @param {number} deltaY
   */
  panBy(deltaX, deltaY) {
    if (this.scale <= 1.0) {
      return;
    }
    this.panX += deltaX;
    this.panY += deltaY;
    this._clampPan();
    this.applyTransform();
    this._notifyChange();
  }

  /**
   * Constrain panning so the content cannot be lost beyond view boundaries.
   * @private
   */
  _clampPan() {
    if (this.scale <= 1.0) {
      this.panX = 0;
      this.panY = 0;
      return;
    }

    const rawRect = this.containerElement ? this.containerElement.getBoundingClientRect() : null;
    const rect = (rawRect && rawRect.width > 0 && rawRect.height > 0) ? rawRect : { width: 800, height: 600 };
    const maxPanX = (rect.width * (this.scale - 1)) / 2 + (rect.width * 0.15);
    const maxPanY = (rect.height * (this.scale - 1)) / 2 + (rect.height * 0.15);

    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
  }

  /**
   * Apply CSS transform to all registered target elements.
   */
  applyTransform() {
    const transformParts = [];
    if (this.scale !== 1.0 || this.panX !== 0 || this.panY !== 0) {
      transformParts.push(`translate(${this.panX.toFixed(2)}px, ${this.panY.toFixed(2)}px)`);
      transformParts.push(`scale(${this.scale.toFixed(4)})`);
    }
    if (this.externalTransform) {
      transformParts.push(this.externalTransform);
    }

    const cssTransform = transformParts.join(' ');
    for (let i = 0; i < this.targetElements.length; i++) {
      const el = this.targetElements[i];
      if (el && el.style) {
        el.style.transformOrigin = 'center center';
        el.style.transform = cssTransform;
      }
    }
  }

  /**
   * Attach gesture listeners for touch and pointer events.
   * @private
   */
  _bindEvents() {
    if (!this.containerElement) {
      return;
    }

    const isInteractiveTarget = (target) => {
      if (!target || typeof target.closest !== 'function') {
        return false;
      }
      return Boolean(target.closest('button, input, select, textarea, a, .video-hud, .floating-zoom-controls, .video-overlay-msg, #mobileControlToolbar, .control-bottom-sheet, #mobileModifierBar'));
    };

    // Suppress Safari proprietary viewport zoom gestures on the media viewport
    const preventSafariGesture = (e) => {
      if (!isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };
    this.containerElement.addEventListener('gesturestart', preventSafariGesture, { passive: false });
    this.containerElement.addEventListener('gesturechange', preventSafariGesture, { passive: false });
    this.containerElement.addEventListener('gestureend', preventSafariGesture, { passive: false });

    // Touch event handlers for pinch-to-zoom and pan
    this.containerElement.addEventListener('touchstart', (e) => {
      if (isInteractiveTarget(e.target)) {
        return;
      }

      this.activeTouchCount = e.touches.length;
      if (e.touches.length === 2) {
        // Two fingers: initialize gesture tracking and prevent browser viewport scaling
        e.preventDefault();
        this.ignoreNextClick = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this.initialScale = this.scale;
        this.pinchMidpoint = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };
        this.lastTouchPosition = { ...this.pinchMidpoint };
        this.initialTouchY1 = t1.clientY;
        this.initialTouchY2 = t2.clientY;

        const isControlling = (typeof this.isControlActive === 'function' && this.isControlActive());
        if (isControlling) {
          // When remote control is active, disambiguate between pinch-to-zoom and two-finger scroll
          this.twoFingerMode = 'pending';
          this.isPinching = false;
        } else {
          this.twoFingerMode = 'pinch';
          this.isPinching = true;
        }
      } else if (e.touches.length === 1) {
        this.lastTouchPosition = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY
        };
        this.isPanning = (this.scale > 1.0);
      }
    }, { passive: false });

    this.containerElement.addEventListener('touchmove', (e) => {
      if (isInteractiveTarget(e.target)) {
        return;
      }

      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentMidpoint = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };

        const isControlling = (typeof this.isControlActive === 'function' && this.isControlActive());
        if (isControlling && this.twoFingerMode === 'pending') {
          const distDelta = Math.abs(currentDistance - this.initialPinchDistance);
          const deltaY1 = t1.clientY - this.initialTouchY1;
          const deltaY2 = t2.clientY - this.initialTouchY2;
          const sameDirection = (deltaY1 * deltaY2 > 0);
          const avgDeltaY = (Math.abs(deltaY1) + Math.abs(deltaY2)) / 2;

          if (distDelta > 20) {
            this.twoFingerMode = 'pinch';
            this.isPinching = true;
          } else if (sameDirection && avgDeltaY > 10 && distDelta < 18) {
            this.twoFingerMode = 'scroll';
            this.isPinching = false;
          }
        }

        if (this.twoFingerMode === 'pinch' || (!isControlling && this.isPinching)) {
          this.isPinching = true;
          if (this.initialPinchDistance > 10) {
            const scaleDelta = currentDistance / this.initialPinchDistance;
            const targetScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialScale * scaleDelta));

            // Also account for two-finger panning translation while pinching
            const panDeltaX = currentMidpoint.x - this.lastTouchPosition.x;
            const panDeltaY = currentMidpoint.y - this.lastTouchPosition.y;

            this.setZoom(targetScale, currentMidpoint.x, currentMidpoint.y);
            if (this.scale > 1.0) {
              this.panBy(panDeltaX, panDeltaY);
            }
          }

          this.lastTouchPosition = currentMidpoint;
        }
      } else if (e.touches.length === 1) {
        // Prevent default browser page scrolling when dragging on the video feed
        e.preventDefault();

        const isControlling = (typeof this.isControlActive === 'function' && this.isControlActive());
        if (!isControlling && this.scale > 1.0 && this.lastTouchPosition) {
          const t = e.touches[0];
          const deltaX = t.clientX - this.lastTouchPosition.x;
          const deltaY = t.clientY - this.lastTouchPosition.y;
          this.lastTouchPosition = { x: t.clientX, y: t.clientY };
          this.panBy(deltaX, deltaY);
        }
      }
    }, { passive: false });

    const endTouchHandler = (e) => {
      if (isInteractiveTarget(e.target)) {
        return;
      }
      this.activeTouchCount = e.touches.length;
      if (e.touches.length < 2) {
        this.isPinching = false;
        this.twoFingerMode = null;
      }
      if (e.touches.length === 0) {
        this.isPanning = false;
        this.twoFingerMode = null;
        // Suppress phantom clicks after pinch gesture
        setTimeout(() => {
          this.ignoreNextClick = false;
        }, 300);
      }
    };

    this.containerElement.addEventListener('touchend', endTouchHandler, { passive: true });
    this.containerElement.addEventListener('touchcancel', endTouchHandler, { passive: true });
  }

  /**
   * Notify observers of zoom and pan state changes.
   * @private
   */
  _notifyChange() {
    if (typeof this.onZoomChange === 'function') {
      this.onZoomChange(this.getState());
    }
  }
}
