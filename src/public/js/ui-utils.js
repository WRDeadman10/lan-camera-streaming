/**
 * @file ui-utils.js
 * Common UI helper utilities for sender and viewer interfaces.
 */

export function showError(message) {
  const alert = document.getElementById('errorAlert');
  if (alert) {
    alert.textContent = message;
    alert.classList.add('visible');
  }
}

export function clearError() {
  const alert = document.getElementById('errorAlert');
  if (alert) {
    alert.textContent = '';
    alert.classList.remove('visible');
  }
}

export function showInfo(message) {
  const alert = document.getElementById('infoAlert');
  if (alert) {
    alert.textContent = message;
    alert.classList.add('visible');
  }
}

export function clearInfo() {
  const alert = document.getElementById('infoAlert');
  if (alert) {
    alert.textContent = '';
    alert.classList.remove('visible');
  }
}

export function updateStatus(state, text) {
  const badge = document.getElementById('statusBadge');
  const textEl = document.getElementById('statusText');
  if (badge && textEl) {
    badge.className = `status-badge status-${state.toLowerCase()}`;
    textEl.textContent = text || state;
  }
}

const DiagnosticsLogMaxChars = 120000;

export function logDiagnostic(message, level = 'INFO') {
  const logEl = document.getElementById('diagnosticsLog');
  const now = new Date();
  const timestamp = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const prefix = `[${timestamp}] [${level}]`;
  const entry = `${prefix} ${message}\n`;
  if (logEl) {
    // Newest first; trimming the oldest text keeps every call cheap (the whole log is rewritten on each call).
    logEl.textContent = (entry + logEl.textContent).slice(0, DiagnosticsLogMaxChars);
  }
  if (level === 'ERROR') {
    console.error(`${prefix} ${message}`);
  } else if (level === 'WARN') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function parseCandidateSummary(cand) {
  if (cand === null || cand === undefined) {
    return 'End-of-candidates (null)';
  }
  const str = typeof cand === 'string' ? cand : (cand.candidate || '');
  if (!str || str.trim().length === 0) {
    return 'End-of-candidates (empty)';
  }
  // Candidate format: candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ <type> [raddr <raddr> rport <rport>] ...
  const parts = str.trim().split(/\s+/);
  const proto = parts[2] ? parts[2].toUpperCase() : 'UDP';
  const ip = parts[4] || '?';
  const port = parts[5] || '?';
  let type = 'UNKNOWN';
  const typIdx = parts.indexOf('typ');
  if (typIdx !== -1 && parts[typIdx + 1]) {
    type = parts[typIdx + 1].toUpperCase();
  }
  const isMdns = ip.endsWith('.local');
  const addressInfo = isMdns ? `${ip} [mDNS obfuscated]` : `${ip}:${port}`;
  return `${type} via ${proto} (${addressInfo})`;
}

const PATH_DESCRIPTIONS = {
  lan: { text: 'LAN direct - video stays on your network, 0 bytes through zrok', className: 'path-lan' },
  internet: { text: 'Direct over the internet (STUN) - video does not use zrok', className: 'path-internet' },
  relay: { text: 'TURN relay - video goes through the TURN server, not zrok', className: 'path-relay' }
};

export function describePath(pathKind) {
  return PATH_DESCRIPTIONS[pathKind] || null;
}

export function setPathIndicator(pathKind) {
  const el = document.getElementById('pathIndicator');
  const description = describePath(pathKind);
  if (!el) {
    return;
  }
  if (!description) {
    el.textContent = '';
    el.className = 'path-indicator';
    return;
  }
  el.textContent = description.text;
  el.className = `path-indicator visible ${description.className}`;
}

export function isLocalHostname(hostname) {
  if (!hostname) {
    return false;
  }
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.localhost')) {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!match) {
    return false;
  }
  const first = parseInt(match[1], 10);
  const second = parseInt(match[2], 10);
  return first === 127 || first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

export async function fetchLocalServerOrigin() {
  try {
    const res = await fetch('/api/network-info');
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return `${data.protocol}://localhost:${data.port}`;
  } catch (err) {
    return null;
  }
}

/**
 * Copies text to the clipboard across secure contexts (navigator.clipboard)
 * and insecure LAN HTTP contexts (document.execCommand fallback).
 * @param {string} text - The text string to copy.
 * @returns {Promise<boolean>} True if the copy succeeded, false otherwise.
 */
export async function copyToClipboard(text) {
  const content = typeof text === 'string' ? text : String(text ?? '');

  // 1. Try modern Async Clipboard API if available in secure context (localhost / HTTPS)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // Fall through to execCommand fallback if writeText rejects
    }
  }

  // 2. Fallback: document.execCommand('copy') via off-screen readonly textarea
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    let textarea = null;
    const selection = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
    const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    try {
      textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.style.zIndex = '-9999';

      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const successful = typeof document.execCommand === 'function' && document.execCommand('copy');
      return Boolean(successful);
    } catch {
      return false;
    } finally {
      if (textarea && textarea.parentNode) {
        textarea.parentNode.removeChild(textarea);
      }
      if (selection && selectedRange) {
        selection.removeAllRanges();
        selection.addRange(selectedRange);
      }
    }
  }

  return false;
}

export function setupDiagnosticsControls(copyBtnId, clearBtnId, logElementId = 'diagnosticsLog') {
  const copyBtn = document.getElementById(copyBtnId);
  const clearBtn = document.getElementById(clearBtnId);
  const logEl = document.getElementById(logElementId);

  if (copyBtn && logEl) {
    copyBtn.addEventListener('click', async () => {
      try {
        const textToCopy = logEl.textContent || '';
        const success = await copyToClipboard(textToCopy);
        if (success) {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        } else {
          logDiagnostic('Failed to copy diagnostics: Clipboard copy not supported or permitted', 'WARN');
        }
      } catch (err) {
        logDiagnostic(`Failed to copy diagnostics: ${err.message}`, 'WARN');
      }
    });
  }

  if (clearBtn && logEl) {
    clearBtn.addEventListener('click', () => {
      logEl.textContent = '';
      logDiagnostic('Diagnostics log cleared.', 'INFO');
    });
  }
}

export function updateVitals({ fps, resolution, path, viewers, rtt } = {}) {
  const fpsEl = document.getElementById('vitalFps');
  const resEl = document.getElementById('vitalRes');
  const pathEl = document.getElementById('vitalPath');
  const viewersEl = document.getElementById('vitalViewers');
  const latencyEl = document.getElementById('vitalLatency');

  if (fpsEl && fps !== undefined) {
    fpsEl.textContent = fps ? `${fps} FPS` : '--';
  }
  if (resEl && resolution !== undefined) {
    resEl.textContent = resolution || '--';
  }
  if (pathEl && path !== undefined) {
    if (path === 'lan') {
      pathEl.textContent = 'LAN Direct (0 B zrok)';
      pathEl.className = 'vital-value vital-badge-lan';
    } else if (path === 'internet') {
      pathEl.textContent = 'STUN Direct (0 B zrok)';
      pathEl.className = 'vital-value vital-badge-internet';
    } else if (path === 'relay' || path === 'tunnel-relay') {
      pathEl.textContent = 'zrok Relay (Uses Quota)';
      pathEl.className = 'vital-value vital-badge-relay';
    } else {
      pathEl.textContent = path || '--';
      pathEl.className = 'vital-value';
    }
  }
  if (viewersEl && viewers !== undefined) {
    if (typeof viewers === 'number') {
      viewersEl.textContent = `${viewers} ${viewers === 1 ? 'Viewer' : 'Viewers'}`;
    } else {
      viewersEl.textContent = viewers || '--';
    }
  }
  if (latencyEl && rtt !== undefined) {
    latencyEl.textContent = rtt || '--';
  }

  const vitalsBar = document.getElementById('streamVitalsBar');
  if (vitalsBar) {
    const hasLiveMetrics = Boolean(fps || resolution || path || (typeof viewers === 'number' && viewers > 0));
    vitalsBar.style.display = hasLiveMetrics ? 'flex' : 'none';
  }
}

export function captureFrameSnapshot(mediaElement, baseFilename = 'stream-snapshot') {
  if (!mediaElement) {
    return false;
  }
  const isVideo = mediaElement.tagName.toLowerCase() === 'video';
  const width = isVideo ? (mediaElement.videoWidth || 1280) : mediaElement.width;
  const height = isVideo ? (mediaElement.videoHeight || 720) : mediaElement.height;

  if (width === 0 || height === 0) {
    return false;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return false;
  }

  ctx.drawImage(mediaElement, 0, 0, width, height);
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const filename = `${baseFilename}_${timestamp}.png`;

  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }, 'image/png');

  return true;
}

export async function copyTextToClipboard(text, buttonElement, feedbackLabel = '✓ Copied!') {
  if (!text || !buttonElement) {
    return false;
  }
  try {
    const success = await copyToClipboard(text);
    if (success) {
      const original = buttonElement.innerHTML;
      buttonElement.innerHTML = feedbackLabel;
      setTimeout(() => {
        buttonElement.innerHTML = original;
      }, 2000);
      return true;
    } else {
      logDiagnostic('Copy failed: Clipboard copy not supported or permitted', 'WARN');
      return false;
    }
  } catch (err) {
    logDiagnostic(`Copy failed: ${err.message}`, 'WARN');
    return false;
  }
}

export function setupCollapsibleDrawer(toggleBtnId, contentId, expandText = 'Expand', collapseText = 'Collapse') {
  const btn = document.getElementById(toggleBtnId);
  const content = document.getElementById(contentId);
  if (!btn || !content) {
    return;
  }
  btn.addEventListener('click', () => {
    const isHidden = content.style.display === 'none' || !content.style.display;
    content.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? collapseText : expandText;
  });
}

export function setupPasswordToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (!btn || !input) {
    return;
  }
  btn.addEventListener('click', () => {
    if (input.classList.contains('pin-masked')) {
      input.classList.remove('pin-masked');
      btn.textContent = 'Hide';
    } else {
      input.classList.add('pin-masked');
      btn.textContent = 'Show';
    }
  });
}

/**
 * Screen WakeLock manager to prevent mobile devices from sleeping during live streams.
 */
export class WakeLockController {
  constructor() {
    this.sentinel = null;
    this.isActive = false;

    // Reacquire lock when tab regains visibility
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && this.isActive && !this.sentinel) {
        await this.request();
      }
    });
  }

  async request() {
    if (!('wakeLock' in navigator)) {
      return false;
    }
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.isActive = true;
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch (err) {
      console.warn('WakeLock request failed:', err);
      return false;
    }
  }

  async release() {
    this.isActive = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch (err) {
        // ignore
      }
      this.sentinel = null;
    }
  }
}

/**
 * Client-side media recording using MediaRecorder API.
 */
export class StreamRecorder {
  constructor(mediaElement, { onStart, onStop, onTimeUpdate } = {}) {
    this.mediaElement = mediaElement;
    this.recorder = null;
    this.recordedChunks = [];
    this.startTime = 0;
    this.timerInterval = null;
    this.onStart = onStart;
    this.onStop = onStop;
    this.onTimeUpdate = onTimeUpdate;
  }

  get isRecording() {
    return Boolean(this.recorder && this.recorder.state === 'recording');
  }

  start() {
    if (this.isRecording) {
      return false;
    }

    let stream = null;
    if (this.mediaElement instanceof HTMLVideoElement && this.mediaElement.srcObject) {
      stream = this.mediaElement.srcObject;
    } else if (this.mediaElement instanceof HTMLVideoElement && this.mediaElement.captureStream) {
      stream = this.mediaElement.captureStream();
    } else if (this.mediaElement instanceof MediaStream) {
      stream = this.mediaElement;
    }

    if (!stream || stream.getVideoTracks().length === 0) {
      console.warn('Cannot record: no active stream found on media element.');
      return false;
    }

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }
      }
    }

    try {
      this.recordedChunks = [];
      const options = mimeType ? { mimeType } : {};
      this.recorder = new MediaRecorder(stream, options);

      this.recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.recorder.onstop = () => {
        this.finishRecording();
      };

      this.recorder.start(1000); // 1s timeslices
      this.startTime = Date.now();

      this.timerInterval = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
        const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const ss = String(elapsedSec % 60).padStart(2, '0');
        if (typeof this.onTimeUpdate === 'function') {
          this.onTimeUpdate(`${mm}:${ss}`);
        }
      }, 500);

      if (typeof this.onStart === 'function') {
        this.onStart();
      }
      return true;
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      return false;
    }
  }

  stop() {
    if (!this.isRecording) {
      return;
    }
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this.recorder.stop();
  }

  finishRecording() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;

    if (this.recordedChunks.length > 0) {
      const blob = new Blob(this.recordedChunks, { type: this.recorder.mimeType || 'video/webm' });
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      const filename = `lancam-recording-${timestamp}.webm`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 2000);
    }

    this.recordedChunks = [];
    this.recorder = null;

    if (typeof this.onStop === 'function') {
      this.onStop();
    }
  }
}

/**
 * Stream transformation manager (flip horizontal, rotate 0/90/180/270, rule-of-thirds grid).
 */
export class StreamTransformController {
  constructor(videoElement, gridOverlayElement) {
    this.videoElement = videoElement;
    this.gridOverlayElement = gridOverlayElement;
    this.isMirrored = false;
    this.rotationDegrees = 0; // 0, 90, 180, 270
    this.isGridVisible = false;
  }

  toggleMirror() {
    this.isMirrored = !this.isMirrored;
    this.applyTransform();
    return this.isMirrored;
  }

  rotate() {
    this.rotationDegrees = (this.rotationDegrees + 90) % 360;
    this.applyTransform();
    return this.rotationDegrees;
  }

  toggleGrid() {
    this.isGridVisible = !this.isGridVisible;
    if (this.gridOverlayElement) {
      if (this.isGridVisible) {
        this.gridOverlayElement.classList.add('active');
      } else {
        this.gridOverlayElement.classList.remove('active');
      }
    }
    return this.isGridVisible;
  }

  applyTransform() {
    if (!this.videoElement) {
      return;
    }
    const parts = [];
    if (this.rotationDegrees !== 0) {
      parts.push(`rotate(${this.rotationDegrees}deg)`);
    }
    if (this.isMirrored) {
      parts.push('scaleX(-1)');
    }
    this.videoElement.style.transform = parts.join(' ');
  }
}

/**
 * Parse URL query parameters for auto-join and configuration.
 */
export function parseUrlStreamParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || urlParams.get('roomId') || '';
  const pin = urlParams.get('pin') || '';
  const mode = urlParams.get('mode') || '';
  const controlPin = urlParams.get('controlPin') || urlParams.get('control') || '';
  const autostart = urlParams.get('autostart') === '1' || urlParams.get('autostart') === 'true';
  return { roomId, pin, mode, controlPin, autostart };
}

/**
 * Construct deep link for sharing room access.
 */
export function buildShareUrl(targetPath, { roomId, pin, autostart = true }) {
  const url = new URL(targetPath, window.location.origin);
  if (roomId) {
    url.searchParams.set('room', roomId);
  }
  if (pin) {
    url.searchParams.set('pin', pin);
  }
  if (autostart) {
    url.searchParams.set('autostart', '1');
  }
  return url.toString();
}

/**
 * Dynamically loads and sets the application version from the server into all version badges.
 * @returns {Promise<string|null>}
 */
export async function initializeVersionBadge() {
  if (typeof document === 'undefined') {
    return null;
  }
  const badges = document.querySelectorAll('.brand-version, #appVersionBadge');
  if (!badges || badges.length === 0) {
    return null;
  }

  try {
    const res = await fetch('/api/version');
    if (res.ok) {
      const data = await res.json();
      if (data && data.version) {
        const versionText = `v${data.version}`;
        badges.forEach((badge) => {
          badge.textContent = versionText;
          badge.setAttribute('title', `LAN Camera Streaming ${versionText}`);
        });
        return data.version;
      }
    }
  } catch (err) {
    // Graceful fallback if network is unreachable
  }
  return null;
}

// Auto-run badge initialization on document readiness
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeVersionBadge();
    });
  } else {
    initializeVersionBadge();
  }
}

