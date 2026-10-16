/**
 * @file camera-manager.js
 * MediaDevices camera capture manager handling getUserMedia, enumeration,
 * device selection, and clean track release.
 */

export class CameraManager {
  constructor() {
    this.currentStream = null;
    this.selectedDeviceId = null;
    this.facingMode = 'environment'; // Default to back camera for phone streaming
  }

  static isSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  static isSecureContext() {
    return window.isSecureContext;
  }

  async enumerateCameras() {
    if (!CameraManager.isSupported()) {
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput');
    } catch (err) {
      console.warn('Failed to enumerate cameras:', err);
      return [];
    }
  }

  async startCapture({
    deviceId,
    facingMode,
    width = 'max',
    height = 'max',
    frameRate = 30,
    withAudio = false
  } = {}) {
    if (!CameraManager.isSecureContext()) {
      throw new Error('Camera access requires a secure context (HTTPS or localhost).');
    }

    if (!CameraManager.isSupported()) {
      throw new Error('Camera capture API (navigator.mediaDevices.getUserMedia) is not supported in this browser.');
    }

    // Stop existing capture if any
    this.stopCapture();

    if (deviceId) {
      this.selectedDeviceId = deviceId;
    }
    if (facingMode) {
      this.facingMode = facingMode;
    }

    let videoConstraints;
    if (width === 'max' || width === 'full' || height === 'max' || height === 'full') {
      videoConstraints = {
        width: { ideal: 4096 },
        height: { ideal: 2160 },
        frameRate: { ideal: frameRate }
      };
    } else {
      videoConstraints = {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: frameRate }
      };
    }

    if (this.selectedDeviceId) {
      videoConstraints.deviceId = { exact: this.selectedDeviceId };
    } else if (this.facingMode) {
      videoConstraints.facingMode = { ideal: this.facingMode };
    }

    const audioConstraint = typeof withAudio === 'object' && withAudio !== null
      ? withAudio
      : Boolean(withAudio);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraint
      });

      this.currentStream = stream;
      return stream;
    } catch (err) {
      if (audioConstraint) {
        // If capture failed with audio requested, attempt video-only fallback
        try {
          const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false
          });
          console.warn('Audio capture failed; falling back to video-only capture stream.', err);
          this.currentStream = videoOnlyStream;
          return videoOnlyStream;
        } catch (_videoErr) {
          // Both failed, proceed to standard error categorization
        }
      }

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Camera permission denied by user or system policy.');
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('No camera device found on this system.');
      }
      if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw new Error('Camera hardware is currently busy or in use by another application.');
      }
      if (err.name === 'OverconstrainedError') {
        // Fallback to minimal constraints if resolution is overconstrained
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: audioConstraint
        });
        this.currentStream = fallbackStream;
        return fallbackStream;
      }
      throw new Error(`Failed to access camera: ${err.message || err.name}`);
    }
  }

  getCapabilities() {
    if (!this.currentStream) {
      return null;
    }
    const track = this.currentStream.getVideoTracks()[0];
    if (track && typeof track.getCapabilities === 'function') {
      try {
        return track.getCapabilities();
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async applyTorch(state) {
    if (!this.currentStream) {
      return false;
    }
    const track = this.currentStream.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({ advanced: [{ torch: Boolean(state) }] });
        return true;
      } catch (err) {
        console.warn('Failed to toggle torch:', err);
        return false;
      }
    }
    return false;
  }

  async applyZoom(zoomValue) {
    if (!this.currentStream) {
      return false;
    }
    const track = this.currentStream.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({ advanced: [{ zoom: Number(zoomValue) }] });
        return true;
      } catch (err) {
        console.warn('Failed to apply zoom:', err);
        return false;
      }
    }
    return false;
  }

  async applyFocusMode(mode) {
    if (!this.currentStream) {
      return false;
    }
    const track = this.currentStream.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: mode }] });
        return true;
      } catch (err) {
        console.warn(`Failed to apply focusMode '${mode}':`, err);
        return false;
      }
    }
    return false;
  }

  async applyFocusDistance(distance) {
    if (!this.currentStream) {
      return false;
    }
    const track = this.currentStream.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({
          advanced: [{
            focusMode: 'manual',
            focusDistance: Number(distance)
          }]
        });
        return true;
      } catch (err) {
        console.warn(`Failed to apply focusDistance '${distance}':`, err);
        return false;
      }
    }
    return false;
  }

  getFocusCapabilities() {
    const caps = this.getCapabilities();
    if (!caps) {
      return null;
    }
    return {
      focusMode: Array.isArray(caps.focusMode) ? caps.focusMode : null,
      focusDistance: caps.focusDistance && typeof caps.focusDistance === 'object' ? caps.focusDistance : null
    };
  }

  static isScreenCaptureSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  static isCursorConstraintSupported() {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getSupportedConstraints === 'function') {
      const supported = navigator.mediaDevices.getSupportedConstraints();
      return Boolean(supported && supported.cursor);
    }
    return false;
  }

  static getEffectiveCursorSetting(track) {
    if (track && typeof track.getSettings === 'function') {
      const settings = track.getSettings();
      if (settings && typeof settings.cursor === 'string') {
        return settings.cursor;
      }
    }
    return undefined;
  }

  getScreenConstraints(resolution = 'max', frameRate = 30, cursor = undefined) {
    let constraints;
    if (resolution === 'max' || resolution === 'full') {
      constraints = {
        width: { max: 7680 },
        height: { max: 4320 },
        frameRate: { ideal: frameRate, max: 60 }
      };
    } else {
      let maxLong = 1920;
      let maxShort = 1080;
      if (resolution === '1080p') {
        maxLong = 1920;
        maxShort = 1080;
      } else if (resolution === '720p') {
        maxLong = 1280;
        maxShort = 720;
      } else if (resolution === '480p') {
        maxLong = 854;
        maxShort = 480;
      }

      constraints = {
        width: { max: maxLong },
        height: { max: maxShort },
        frameRate: { ideal: frameRate, max: 60 }
      };
    }

    if (cursor !== undefined && cursor !== null && cursor !== '') {
      constraints.cursor = cursor;
    }
    return constraints;
  }

  async startScreenCapture({
    resolution = 'max',
    frameRate = 30,
    withAudio = false,
    cursor = undefined
  } = {}) {
    if (!CameraManager.isSecureContext()) {
      throw new Error('Screen capture requires a secure context (HTTPS or localhost).');
    }

    if (!CameraManager.isScreenCaptureSupported()) {
      throw new Error('Screen capture API (navigator.mediaDevices.getDisplayMedia) is not supported in this browser.');
    }

    // Keep the live stream running while the browser picker is open: cancelling the picker must not kill the active stream.
    const previousStream = this.currentStream;
    const releasePreviousStream = (nextStream) => {
      if (previousStream && previousStream !== nextStream) {
        previousStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (e) {
            // ignore
          }
        });
      }
    };

    const videoConstraints = this.getScreenConstraints(resolution, frameRate, cursor);
    const audioConstraint = typeof withAudio === 'object' && withAudio !== null
      ? withAudio
      : Boolean(withAudio);

    try {
      const displayMediaOptions = {
        video: videoConstraints
      };
      if (audioConstraint) {
        displayMediaOptions.audio = audioConstraint;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      } catch (displayErr) {
        if (cursor && (displayErr.name === 'OverconstrainedError' || displayErr.name === 'TypeError')) {
          console.warn(`Screen capture rejected with cursor constraint '${cursor}'; retrying without cursor constraint.`, displayErr);
          const fallbackOptions = {
            video: this.getScreenConstraints(resolution, frameRate)
          };
          if (audioConstraint) {
            fallbackOptions.audio = audioConstraint;
          }
          stream = await navigator.mediaDevices.getDisplayMedia(fallbackOptions);
        } else {
          throw displayErr;
        }
      }

      releasePreviousStream(stream);
      this.currentStream = stream;
      return stream;
    } catch (err) {
      const isUserDenial = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'AbortError';
      if (audioConstraint && !isUserDenial) {
        try {
          const videoOnlyConstraints = this.getScreenConstraints(resolution, frameRate, cursor);
          let videoOnlyStream;
          try {
            videoOnlyStream = await navigator.mediaDevices.getDisplayMedia({
              video: videoOnlyConstraints
            });
          } catch (audioFallbackErr) {
            if (cursor && (audioFallbackErr.name === 'OverconstrainedError' || audioFallbackErr.name === 'TypeError')) {
              videoOnlyStream = await navigator.mediaDevices.getDisplayMedia({
                video: this.getScreenConstraints(resolution, frameRate)
              });
            } else {
              throw audioFallbackErr;
            }
          }
          console.warn('Screen audio capture failed; falling back to video-only screen capture stream.', err);
          releasePreviousStream(videoOnlyStream);
          this.currentStream = videoOnlyStream;
          return videoOnlyStream;
        } catch (_videoErr) {
          // Fall through to error handler
        }
      }

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Screen sharing permission denied or cancelled by user.');
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No screen or display source available to share.');
      }
      if (err.name === 'NotReadableError') {
        throw new Error('Display source is currently busy or could not be captured.');
      }
      throw new Error(`Failed to capture screen: ${err.message || err.name}`);
    }
  }

  async applyScreenResolution(resolution = 'max') {
    if (!this.currentStream) {
      return false;
    }
    const track = this.currentStream.getVideoTracks()[0];
    if (!track || typeof track.applyConstraints !== 'function') {
      return false;
    }

    const settings = track.getSettings ? track.getSettings() : {};
    const isPortrait = settings.height && settings.width && settings.height > settings.width;

    let constraints = this.getScreenConstraints(resolution);
    if (isPortrait && resolution !== 'max' && resolution !== 'full') {
      const maxW = constraints.width ? constraints.width.max : 1280;
      const maxH = constraints.height ? constraints.height.max : 720;
      constraints = {
        width: { max: Math.min(maxW, maxH) },
        height: { max: Math.max(maxW, maxH) },
        frameRate: constraints.frameRate
      };
    }

    try {
      await track.applyConstraints(constraints);
      return true;
    } catch (err) {
      console.warn('Failed to apply dynamic resolution constraints to screen track:', err);
      return false;
    }
  }

  toggleFacingMode() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    this.selectedDeviceId = null; // Reset explicit deviceId to let facingMode take precedence
    return this.facingMode;
  }

  stopCapture() {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          // ignore
        }
      });
      this.currentStream = null;
    }
  }
}
