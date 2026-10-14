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
