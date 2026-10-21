/**
 * @file sender.js
 * Sender client controller: handles camera capture, Socket.IO signaling,
 * and WebRTC peer connection to viewer.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic, parseCandidateSummary, setupDiagnosticsControls, setPathIndicator, describePath, isLocalHostname, fetchLocalServerOrigin, updateVitals, captureFrameSnapshot, copyTextToClipboard, setupCollapsibleDrawer, setupPasswordToggle, StreamRecorder, WakeLockController, StreamTransformController, parseUrlStreamParams, buildShareUrl } from './ui-utils.js';
import { CameraManager } from './camera-manager.js';
import { WebRtcPeer } from './webrtc-peer.js';
import { BatteryMonitor } from './battery-monitor.js';
import { AbrLevel, createAbrState, getAbrLimits, stepAbr } from './abr-policy.js';
import { getRecommendedBitrateHints, isQualityMode, readVideoBitrateParams } from './sdp-bitrate.js';
import { classifyEncoder } from './encoder-info.js';
import { formatSenderStats } from './sender-stats.js';
import { getChatManager } from './chat.js';
import { setupMdnsWarningAndGuidance } from './mdns-detector.js';

let mdnsController = null;

const cameraManager = new CameraManager();
let socket = null;
let currentRoomId = null;
let currentMediaMode = 'webrtc';
let statsInterval = null;
let mjpegInterval = null;
let tunnelInterval = null;
let tunnelIsEncoding = false;
let tunnelStartTime = 0;
let tunnelFramesSent = 0;
let tunnelBytesSent = 0;
let tunnelEncodeTimes = [];
let cachedIceServers = null;
let mjpegIsEncoding = false;
let lastLoggedPathKind = null;
let torchActive = false;

// Auto-reconnect state management (distinguish human stop vs network/device drop)
let isStreamingRequested = false;
let hasJoinedRoom = false;
let isRejoining = false;
let autoRejoinTimer = null;
let watchdogInterval = null;
let activeRoomId = null;
let activePin = null;
let isStudioSender = false;
let activeSenderToken = null;
let activeControllerId = null;

// Per-viewer choice of what stays constant: 'fps' (default), 'resolution' or 'both'. Bitrate ceilings live in sdp-bitrate.js.
const DefaultQualityMode = 'fps';
const viewerQualityPriority = new Map();
const viewerAbrState = new Map();

// Declared here (not with the other DOM lookups) because the encoder logic below runs at module load.
const encoderPreferenceSelect = document.getElementById('encoderPreference');
const screenContentHintSelect = document.getElementById('screenContentHint');

// Hardware H.264: offered first only when Chrome reports a GPU encoder (MediaCapabilities powerEfficient). If a software H.264
// encoder is detected later we fall back to VP8 and remember it. Viewers that cannot decode H.264 still get VP8 in the same offer.
const HardwareH264StorageKey = 'lancam_hw_h264_unsupported';
const HardwareH264LatchTtlMs = 24 * 60 * 60 * 1000;
const encoderEvaluatedViewers = new Set();
let hardwareH264Unsupported = false;
let hardwareH264Available = false;
try {
  // The flag stores the time it was set and expires, so a driver update or a misjudgement cannot disable the GPU path forever.
  const latchedAt = Number(localStorage.getItem(HardwareH264StorageKey));
  hardwareH264Unsupported = Number.isFinite(latchedAt) && latchedAt > 1 && (Date.now() - latchedAt) < HardwareH264LatchTtlMs;
  if (!hardwareH264Unsupported) {
    localStorage.removeItem(HardwareH264StorageKey);
  }
} catch (err) {
  console.warn('Hardware encoder flag storage is unavailable; the check repeats each session:', err);
}

function setHardwareH264Unsupported(value) {
  hardwareH264Unsupported = value;
  try {
    if (value) {
      localStorage.setItem(HardwareH264StorageKey, String(Date.now()));
    } else {
      localStorage.removeItem(HardwareH264StorageKey);
    }
  } catch (err) {
    console.warn('Could not store the hardware encoder flag; it applies to this session only:', err);
  }
}

// Chrome reports hardware encode per H.264 profile: on an RTX 3060 the constrained-baseline id (42e01f) says false while
// baseline (42001f), main (4d001f) and high (640028) say true, and the GPU encoder is then really used. So ask for several.
const HardwareH264ProbeProfiles = ['42001f', '4d001f', '640028'];

async function detectHardwareH264() {
  try {
    if (!navigator.mediaCapabilities || typeof navigator.mediaCapabilities.encodingInfo !== 'function') {
      hardwareH264Available = false;
    } else {
      const results = await Promise.all(HardwareH264ProbeProfiles.map(async (profileLevelId) => {
        try {
          const info = await navigator.mediaCapabilities.encodingInfo({
            type: 'webrtc',
            video: {
              contentType: `video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${profileLevelId}`,
              width: 1920,
              height: 1080,
              bitrate: getRecommendedBitrateHints(DefaultQualityMode).encodingMaxBitrateBps,
              framerate: 30
            }
          });
          return Boolean(info.supported && info.powerEfficient);
        } catch (err) {
          return false;
        }
      }));
      hardwareH264Available = results.some(Boolean);
    }
  } catch (err) {
    hardwareH264Available = false;
  }
  logDiagnostic(hardwareH264Available
    ? '[ENCODER] GPU H.264 encoder detected. Auto mode will use it (VP8 stays as fallback for viewers that cannot decode H.264).'
    : '[ENCODER] No GPU H.264 encoder detected by this browser. Auto mode keeps VP8 (software).', 'INFO');
  return hardwareH264Available;
}

const hardwareH264Detection = detectHardwareH264();

function getEncoderChoice() {
  return encoderPreferenceSelect ? encoderPreferenceSelect.value : 'auto';
}

function getPreferredVideoMime() {
  const choice = getEncoderChoice();
  if (choice === 'h264') {
    return 'video/H264';
  }
  if (choice === 'vp8' || hardwareH264Unsupported || !hardwareH264Available) {
    return null;
  }
  return 'video/H264';
}

// Runs once per viewer connection, after the first frames were encoded and Chrome reports which encoder it picked.
function evaluateVideoEncoder(viewerId, stats) {
  if (encoderEvaluatedViewers.has(viewerId) || !stats.encoderImplementation || !stats.framesEncoded) {
    return;
  }
  // Chrome only exposes the encoder name to capturing pages; when it does, use it to double-check the GPU claim.
  const forced = getEncoderChoice() === 'h264';
  encoderEvaluatedViewers.add(viewerId);

  if (stats.codec !== 'H264') {
    logDiagnostic(`[ENCODER:${viewerId}] Using ${stats.codec || 'unknown codec'} (${stats.encoderImplementation}); this viewer or browser did not take H.264.`, 'INFO');
    return;
  }
  const encoderClass = classifyEncoder(stats);
  if (encoderClass === 'hardware') {
    logDiagnostic(`[ENCODER:${viewerId}] Hardware H.264 active (${stats.encoderImplementation}). GPU is doing the encoding.`, 'INFO');
    return;
  }
  if (encoderClass === 'unknown') {
    logDiagnostic(`[ENCODER:${viewerId}] H.264 encoder "${stats.encoderImplementation}" is not recognised; keeping H.264 and not switching to VP8.`, 'WARN');
    return;
  }

  if (forced) {
    logDiagnostic(`[ENCODER:${viewerId}] H.264 is running on a software encoder (${stats.encoderImplementation}); kept because H.264 is forced.`, 'WARN');
    return;
  }
  logDiagnostic(`[ENCODER:${viewerId}] H.264 fell back to a software encoder (${stats.encoderImplementation}). Switching to VP8 and remembering this for this machine.`, 'WARN');
  setHardwareH264Unsupported(true);
  setTimeout(() => {
    if (viewerPeers.has(viewerId)) {
      initiateWebRtcConnectionForViewer(viewerId);
    }
  }, 0);
}

if (encoderPreferenceSelect) {
  encoderPreferenceSelect.addEventListener('change', () => {
    if (encoderPreferenceSelect.value === 'auto') {
      setHardwareH264Unsupported(false);
    }
    logDiagnostic(`[ENCODER] Video encoder preference set to "${encoderPreferenceSelect.value}". Applies to the next viewer connection.`, 'INFO');
  });
}

// Chrome treats a screen track marked 'motion' like camera video, which allows automatic resolution scaling; 'detail'
// keeps screen-share handling. The hint belongs to the track (shared by all viewers), so it follows the source, not a viewer.
function getContentHintForCurrentSource() {
  const wantsDetail = screenContentHintSelect && screenContentHintSelect.value === 'detail';
  return sourceSelect && sourceSelect.value === 'screen' && wantsDetail ? 'detail' : 'motion';
}

function describeQualityMode(mode) {
  if (mode === 'both') {
    return 'FPS and resolution';
  }
  return mode === 'resolution' ? 'resolution' : 'FPS';
}

async function applyViewerQualityPriority(viewerId, peer, { armGrace = false } = {}) {
  try {
    const mode = viewerQualityPriority.get(viewerId) || DefaultQualityMode;
    const applied = await peer.applyQualityPriority(mode, { armGrace });
    const ceilingMbps = getRecommendedBitrateHints(mode).encodingMaxBitrateBps / 1000000;
    if (applied) {
      const hold = peer.isInGracePeriod() ? ', holding resolution while the bandwidth estimate ramps up' : '';
      logDiagnostic(`[MEDIA:${viewerId}] Quality priority "${mode}" applied (${applied}, up to ${ceilingMbps} Mbps${hold}).`, 'INFO');
    } else {
      logDiagnostic(`[MEDIA:${viewerId}] Could not apply quality priority "${mode}" yet; will retry once connected.`, 'WARN');
    }
  } catch (err) {
    logDiagnostic(`[MEDIA:${viewerId}] Applying the quality priority failed: ${err.message}`, 'WARN');
  }
}

// Viewers that chose a mode before this sender joined are listed in the join acknowledgement.
function seedViewerQuality(response) {
  const modes = response && response.viewerQuality;
  if (!modes || typeof modes !== 'object') {
    return;
  }
  for (const [viewerId, mode] of Object.entries(modes)) {
    if (isQualityMode(mode)) {
      viewerQualityPriority.set(viewerId, mode);
    }
  }
}

function getAbrState(viewerId) {
  if (!viewerAbrState.has(viewerId)) {
    viewerAbrState.set(viewerId, createAbrState());
  }
  return viewerAbrState.get(viewerId);
}

function logSenderStats(tag, viewerId, peer, stats) {
  const pairInfo = `${stats.localCandidateType || '?'} (${stats.localAddress || '?'}) <-> ${stats.remoteCandidateType || '?'} (${stats.remoteAddress || '?'})`;
  const line = formatSenderStats({
    stats,
    diagnostics: peer.getSenderDiagnostics(),
    mode: viewerQualityPriority.get(viewerId) || DefaultQualityMode,
    abrLevel: getAbrState(viewerId).level,
    pairInfo
  });
  logDiagnostic(`[${tag}:${viewerId}] ${line}`, 'INFO');
}

// Snapshots shortly after connecting show whether the resolution drop happens during the bandwidth ramp-up.
function scheduleDiagnosticSnapshots(viewerId, peer) {
  for (const delayMs of [3000, 8000, 15000]) {
    setTimeout(async () => {
      if (viewerPeers.get(viewerId) !== peer) {
        return;
      }
      const stats = await peer.getStatsReport();
      if (!stats) {
        return;
      }
      logSenderStats(`DIAG +${delayMs / 1000}s`, viewerId, peer, stats);
      if (delayMs === 3000 && peer.peerConnection && peer.peerConnection.remoteDescription) {
        const hints = readVideoBitrateParams(peer.peerConnection.remoteDescription.sdp)
          .map((entry) => `${entry.codec}#${entry.payload} ${JSON.stringify(entry.params)}`);
        logDiagnostic(`[SDP:${viewerId}] Bitrate hints in the viewer answer: ${hints.length > 0 ? hints.join('; ') : 'none'}`, 'INFO');
      }
    }, delayMs);
  }
}

const MjpegMaxWidth = 1280;
const MjpegMaxFrameBytes = 900000;
const TunnelMaxFrameBytes = 600000;

const mjpegCanvas = document.createElement('canvas');
const mjpegContext = mjpegCanvas.getContext('2d');
const tunnelCanvas = document.createElement('canvas');
const tunnelContext = tunnelCanvas.getContext('2d');

// DOM Elements
const accessPinInput = document.getElementById('accessPin');
const roomIdInput = document.getElementById('roomId');
const btnGenRoom = document.getElementById('btnGenRoom');
const mediaModeSelect = document.getElementById('mediaMode');
const tunnelConfigPanel = document.getElementById('tunnelConfigPanel');
const tunnelResolutionSelect = document.getElementById('tunnelResolution');
const tunnelFpsSelect = document.getElementById('tunnelFps');
const tunnelQualitySelect = document.getElementById('tunnelQuality');
const cameraSelect = document.getElementById('cameraSelect');
const cameraResolutionSelect = document.getElementById('cameraResolution');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnToggleFacing = document.getElementById('btnToggleFacing');
const localVideo = document.getElementById('localVideo');
const videoOverlay = document.getElementById('videoOverlay');
const videoContainer = document.getElementById('videoContainer');
const appWorkspace = document.getElementById('appWorkspace');
const shareQrCard = document.getElementById('shareQrCard');
const viewerQrImg = document.getElementById('viewerQrImg');
const viewerQrLink = document.getElementById('viewerQrLink');
const viewerQrLinkInput = document.getElementById('viewerQrLinkInput');
const btnCopyViewerLink = document.getElementById('btnCopyViewerLink');
const btnToggleQrPreview = document.getElementById('btnToggleQrPreview');
const qrDropdownMount = document.getElementById('qrDropdownMount');
// Source selection elements
const sourceSelect = document.getElementById('sourceSelect');
const fileInput = document.getElementById('fileInput');
const urlInput = document.getElementById('urlInput');
const fileInputGroup = document.getElementById('fileInputGroup');
const urlInputGroup = document.getElementById('urlInputGroup');
const screenCursorGroup = document.getElementById('screenCursorGroup');
const screenCursorToggle = document.getElementById('screenCursorToggle');
const cameraSelectGroup = document.getElementById('cameraSelectGroup');
const focusModeGroup = document.getElementById('focusModeGroup');
const focusDistanceGroup = document.getElementById('focusDistanceGroup');
const resolutionGroup = document.getElementById('resolutionGroup');
const resolutionLabel = document.querySelector('label[for="cameraResolution"]');

// Remote Desktop Control DOM Elements
const controlToggle = document.getElementById('controlToggle');
const controlDetailsPanel = document.getElementById('controlDetailsPanel');
const controlStatusBadge = document.getElementById('controlStatusBadge');
const controlPinDisplay = document.getElementById('controlPinDisplay');
const btnCopyControlPin = document.getElementById('btnCopyControlPin');
const btnRegenControlPin = document.getElementById('btnRegenControlPin');
const btnOpenPasswordModal = document.getElementById('btnOpenPasswordModal');
const btnRevokeControl = document.getElementById('btnRevokeControl');

// Control Helper DOM Elements
const controlHelperAlert = document.getElementById('controlHelperAlert');
const btnLaunchControlHelper = document.getElementById('btnLaunchControlHelper');
const btnDownloadControlHelper = document.getElementById('btnDownloadControlHelper');
const controlHelperRunningIndicator = document.getElementById('controlHelperRunningIndicator');
const controlHelperRunningText = document.getElementById('controlHelperRunningText');

const passwordModal = document.getElementById('passwordModal');
const btnClosePasswordModal = document.getElementById('btnClosePasswordModal');
const btnCancelPasswordModal = document.getElementById('btnCancelPasswordModal');
const btnSavePassword = document.getElementById('btnSavePassword');
const btnClearPassword = document.getElementById('btnClearPassword');
const permPasswordInput = document.getElementById('permPasswordInput');
const permPasswordConfirm = document.getElementById('permPasswordConfirm');
const passwordModalStatus = document.getElementById('passwordModalStatus');

// Show/hide appropriate input based on selected source and apply dynamic switch
function updateSourceInputsVisibility() {
  const value = sourceSelect ? sourceSelect.value : 'webcam';
  if (value === 'file') {
    if (fileInputGroup) { fileInputGroup.style.display = 'block'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'none'; }
    if (screenCursorGroup) { screenCursorGroup.style.display = 'none'; }
    if (cameraSelectGroup) { cameraSelectGroup.style.display = 'none'; }
    if (focusModeGroup) { focusModeGroup.style.display = 'none'; }
    if (focusDistanceGroup) { focusDistanceGroup.style.display = 'none'; }
    if (resolutionLabel) { resolutionLabel.textContent = 'Resolution'; }
  } else if (value === 'url') {
    if (fileInputGroup) { fileInputGroup.style.display = 'none'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'block'; }
    if (screenCursorGroup) { screenCursorGroup.style.display = 'none'; }
    if (cameraSelectGroup) { cameraSelectGroup.style.display = 'none'; }
    if (focusModeGroup) { focusModeGroup.style.display = 'none'; }
    if (focusDistanceGroup) { focusDistanceGroup.style.display = 'none'; }
    if (resolutionLabel) { resolutionLabel.textContent = 'Resolution'; }
  } else if (value === 'screen') {
    if (fileInputGroup) { fileInputGroup.style.display = 'none'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'none'; }
    if (screenCursorGroup) { screenCursorGroup.style.display = 'block'; }
    if (cameraSelectGroup) { cameraSelectGroup.style.display = 'none'; }
    if (focusModeGroup) { focusModeGroup.style.display = 'none'; }
    if (focusDistanceGroup) { focusDistanceGroup.style.display = 'none'; }
    if (resolutionGroup) { resolutionGroup.style.display = 'block'; }
    if (resolutionLabel) { resolutionLabel.textContent = 'Quality / Resolution'; }
  } else {
    // webcam
    if (fileInputGroup) { fileInputGroup.style.display = 'none'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'none'; }
    if (screenCursorGroup) { screenCursorGroup.style.display = 'none'; }
    if (cameraSelectGroup) { cameraSelectGroup.style.display = 'block'; }
    if (focusModeGroup) { focusModeGroup.style.display = 'block'; }
    if (resolutionGroup) { resolutionGroup.style.display = 'block'; }
    if (resolutionLabel) { resolutionLabel.textContent = 'Quality / Resolution'; }
  }
}

// Initialize input visibility immediately on page load
updateSourceInputsVisibility();

if (sourceSelect) {
  sourceSelect.addEventListener('change', async () => {
    updateSourceInputsVisibility();
    if (isStreamingActive()) {
      await applyDynamicSourceChange();
    }
  });
}

if (screenCursorToggle) {
  screenCursorToggle.addEventListener('change', async () => {
    if (isStreamingActive() && sourceSelect && sourceSelect.value === 'screen') {
      logDiagnostic(`[SCREEN] Screen cursor setting changed to ${screenCursorToggle.checked ? 'hidden (never)' : 'visible (always)'}; updating screen capture...`, 'INFO');
      await applyDynamicSourceChange();
    }
  });
}

if (fileInput) {
  fileInput.addEventListener('change', async () => {
    if (isStreamingActive() && sourceSelect && sourceSelect.value === 'file') {
      await applyDynamicSourceChange();
    }
  });
}

if (urlInput) {
  urlInput.addEventListener('change', async () => {
    if (isStreamingActive() && sourceSelect && sourceSelect.value === 'url') {
      await applyDynamicSourceChange();
    }
  });
  urlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isStreamingActive() && sourceSelect && sourceSelect.value === 'url') {
        await applyDynamicSourceChange();
      }
    }
  });
}

if (cameraSelect) {
  cameraSelect.addEventListener('change', async () => {
    if (isStreamingActive() && (!sourceSelect || sourceSelect.value === 'webcam')) {
      await applyDynamicSourceChange();
    }
  });
}

if (cameraResolutionSelect) {
  cameraResolutionSelect.addEventListener('change', async () => {
    if (isStreamingActive()) {
      if (!sourceSelect || sourceSelect.value === 'webcam') {
        await applyDynamicSourceChange();
      } else if (sourceSelect.value === 'screen') {
        await applyScreenResolutionChange();
      }
    }
  });
}

// Native Remote Desktop Control Helper Client (runs on System X)
const HELPER_PORT = 8765;
const HELPER_HEALTH_URL = `http://127.0.0.1:${HELPER_PORT}/health`;
const HELPER_WS_URL = `ws://127.0.0.1:${HELPER_PORT}`;
const HELPER_INPUT_URL = `http://127.0.0.1:${HELPER_PORT}/input`;

let helperWs = null;
let helperDetected = false;
let helperCheckInProgress = false;

function launchControlHelperDeeplink(userGesture = false) {
  let iframe = document.getElementById('lancam-control-frame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'lancam-control-frame';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
  }
  iframe.src = 'lancam-control://start';
  if (userGesture) {
    try {
      const a = document.createElement('a');
      a.href = 'lancam-control://start';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          if (a.parentNode) {
            a.parentNode.removeChild(a);
          }
        } catch {}
      }, 500);
    } catch {}
  }
  logDiagnostic('[CONTROL-HELPER] Invoked lancam-control://start deeplink to launch local helper.', 'INFO');
}

function updateHelperUIState(isRunning) {
  helperDetected = isRunning;
  if (!controlToggle || !controlToggle.checked) {
    if (controlHelperAlert) {
      controlHelperAlert.style.display = 'none';
    }
    if (controlHelperRunningIndicator) {
      controlHelperRunningIndicator.style.display = 'none';
    }
    return;
  }

  if (isRunning) {
    if (controlHelperAlert) {
      controlHelperAlert.style.display = 'none';
    }
    if (controlHelperRunningIndicator) {
      controlHelperRunningIndicator.style.display = 'inline-flex';
    }
  } else {
    if (controlHelperAlert) {
      controlHelperAlert.style.display = 'block';
    }
    if (controlHelperRunningIndicator) {
      controlHelperRunningIndicator.style.display = 'none';
    }
  }
}

async function checkControlHelperRunning() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(HELPER_HEALTH_URL, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return Boolean(data && data.status === 'ok');
    }
    return false;
  } catch {
    return false;
  }
}

function connectHelperWebSocket() {
  if (helperWs && (helperWs.readyState === WebSocket.OPEN || helperWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    helperWs = new WebSocket(HELPER_WS_URL);
    helperWs.onopen = () => {
      logDiagnostic('[CONTROL-HELPER] Connected to local helper via WebSocket.', 'INFO');
      updateHelperUIState(true);
    };
    helperWs.onclose = () => {
      helperWs = null;
    };
    helperWs.onerror = () => {
      // Will fallback to HTTP POST if WebSocket connection drops
    };
  } catch (err) {
    logDiagnostic(`[CONTROL-HELPER] WebSocket connection error: ${err.message}`, 'WARN');
  }
}

async function probeControlHelper(autoLaunch = false) {
  if (helperCheckInProgress) {
    return;
  }
  helperCheckInProgress = true;

  const isRunning = await checkControlHelperRunning();
  if (isRunning) {
    helperCheckInProgress = false;
    updateHelperUIState(true);
    connectHelperWebSocket();
    return;
  }

  // Not running
  if (autoLaunch) {
    launchControlHelperDeeplink();
    const pollIntervals = [1000, 1500, 2000];
    let attempt = 0;
    const pollNext = async () => {
      const active = await checkControlHelperRunning();
      if (active) {
        helperCheckInProgress = false;
        updateHelperUIState(true);
        connectHelperWebSocket();
        return;
      }
      attempt += 1;
      if (attempt < pollIntervals.length) {
        setTimeout(pollNext, pollIntervals[attempt]);
      } else {
        helperCheckInProgress = false;
        updateHelperUIState(false);
      }
    };
    setTimeout(pollNext, pollIntervals[0]);
    return;
  }

  helperCheckInProgress = false;
  updateHelperUIState(false);
}

function forwardInputToLocalHelper(inputEvent) {
  if (!inputEvent || !controlToggle || !controlToggle.checked) {
    return;
  }

  // Fast path: local WebSocket
  if (helperWs && helperWs.readyState === WebSocket.OPEN) {
    try {
      helperWs.send(JSON.stringify(inputEvent));
      return;
    } catch (err) {
      logDiagnostic(`[CONTROL-HELPER] WebSocket send failed: ${err.message}`, 'WARN');
    }
  }

  // Fallback path: local HTTP POST
  fetch(HELPER_INPUT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inputEvent),
    mode: 'cors'
  }).catch(() => {
    if (!helperDetected) {
      probeControlHelper(true);
    }
  });
}

function updateControlUIState(data = {}) {
  if (!controlToggle || !controlStatusBadge) {
    return;
  }

  const isEnabled = controlToggle.checked;
  if (!isEnabled) {
    if (controlDetailsPanel) {
      controlDetailsPanel.style.display = 'none';
    }
    controlStatusBadge.textContent = 'Disabled';
    controlStatusBadge.style.background = 'rgba(255, 255, 255, 0.1)';
    controlStatusBadge.style.color = 'var(--text-muted)';
    if (btnRevokeControl) {
      btnRevokeControl.style.display = 'none';
    }
    updateHelperUIState(false);
    return;
  }

  if (controlDetailsPanel) {
    controlDetailsPanel.style.display = 'block';
  }

  if (data.sessionPin && controlPinDisplay) {
    controlPinDisplay.value = data.sessionPin;
  }

  if (data.hasController) {
    if (data.inGrace) {
      controlStatusBadge.textContent = 'Reconnecting (Grace 60s)';
      controlStatusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
      controlStatusBadge.style.color = 'var(--accent-amber)';
    } else {
      controlStatusBadge.textContent = 'Controlled';
      controlStatusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      controlStatusBadge.style.color = 'var(--accent-emerald)';
    }
    if (btnRevokeControl) {
      btnRevokeControl.style.display = 'inline-block';
    }
  } else {
    controlStatusBadge.textContent = 'Ready (No Controller)';
    controlStatusBadge.style.background = 'rgba(56, 189, 248, 0.2)';
    controlStatusBadge.style.color = 'var(--accent-cyan)';
    if (btnRevokeControl) {
      btnRevokeControl.style.display = 'none';
    }
  }

  // Check helper status when control is enabled
  probeControlHelper(false);
}

function requestControlEnable(enabled) {
  const s = ensureSocket();
  const roomId = roomIdInput ? roomIdInput.value.trim() : (activeRoomId || currentRoomId);
  const pin = accessPinInput ? accessPinInput.value.trim() : (activePin || '123456');

  if (enabled) {
    probeControlHelper(true);
  } else {
    updateHelperUIState(false);
  }

  if (!roomId) {
    updateControlUIState();
    return;
  }

  const doEmit = () => {
    s.emit('control:enable', { roomId, pin, enabled }, (res) => {
      if (res && res.success) {
        if (res.sessionPin && controlPinDisplay) {
          controlPinDisplay.value = res.sessionPin;
        }
        logDiagnostic(`[CONTROL] Remote control ${res.enabled ? 'enabled (PIN active)' : 'disabled'}.`, 'INFO');
        updateControlUIState(res);
      } else {
        showError(res && res.error ? res.error : 'Failed to update remote control state.');
        if (controlToggle) {
          controlToggle.checked = !enabled;
        }
        updateControlUIState();
      }
    });
  };

  if (s.connected) {
    doEmit();
  } else {
    s.once('connect', doEmit);
  }
}

function setupRemoteControlHandlers() {
  if (controlToggle) {
    controlToggle.addEventListener('change', () => {
      requestControlEnable(controlToggle.checked);
    });
  }

  if (btnLaunchControlHelper) {
    btnLaunchControlHelper.addEventListener('click', () => {
      launchControlHelperDeeplink(true);
      probeControlHelper(false);
      setTimeout(() => probeControlHelper(false), 1200);
      setTimeout(() => probeControlHelper(false), 2500);
    });
  }

  if (btnRegenControlPin) {
    btnRegenControlPin.addEventListener('click', () => {
      const s = ensureSocket();
      const roomId = roomIdInput ? roomIdInput.value.trim() : (activeRoomId || currentRoomId);
      const pin = accessPinInput ? accessPinInput.value.trim() : (activePin || '123456');
      if (!roomId) {
        return;
      }
      const doEmit = () => {
        s.emit('control:pin:regenerate', { roomId, pin }, (res) => {
          if (res && res.success && res.sessionPin && controlPinDisplay) {
            controlPinDisplay.value = res.sessionPin;
            showInfo('Generated new Session Control PIN');
            setTimeout(clearInfo, 2500);
          }
        });
      };
      if (s.connected) {
        doEmit();
      } else {
        s.once('connect', doEmit);
      }
    });
  }

  if (btnCopyControlPin && controlPinDisplay) {
    btnCopyControlPin.addEventListener('click', async () => {
      const pin = controlPinDisplay.value;
      if (pin && pin !== '------') {
        const ok = await copyTextToClipboard(pin);
        if (ok) {
          showInfo('Copied Session PIN to clipboard!');
          setTimeout(clearInfo, 2500);
        }
      }
    });
  }

  if (btnRevokeControl) {
    btnRevokeControl.addEventListener('click', () => {
      const s = ensureSocket();
      const roomId = roomIdInput ? roomIdInput.value.trim() : (activeRoomId || currentRoomId);
      const pin = accessPinInput ? accessPinInput.value.trim() : (activePin || '123456');
      if (!roomId) {
        return;
      }
      const doEmit = () => {
        s.emit('control:revoke', { roomId, pin }, (res) => {
          if (res && res.success) {
            showInfo('Revoked controller access.');
            setTimeout(clearInfo, 2500);
            updateControlUIState({ hasController: false });
          }
        });
      };
      if (s.connected) {
        doEmit();
      } else {
        s.once('connect', doEmit);
      }
    });
  }

  // Password Modal
  if (btnOpenPasswordModal && passwordModal) {
    btnOpenPasswordModal.addEventListener('click', () => {
      if (permPasswordInput) {
        permPasswordInput.value = '';
      }
      if (permPasswordConfirm) {
        permPasswordConfirm.value = '';
      }
      if (passwordModalStatus) {
        passwordModalStatus.textContent = '';
      }
      passwordModal.style.display = 'flex';
    });
  }

  const closePassModal = () => {
    if (passwordModal) {
      passwordModal.style.display = 'none';
    }
  };

  if (btnClosePasswordModal) {
    btnClosePasswordModal.addEventListener('click', closePassModal);
  }
  if (btnCancelPasswordModal) {
    btnCancelPasswordModal.addEventListener('click', closePassModal);
  }

  if (btnSavePassword) {
    btnSavePassword.addEventListener('click', () => {
      const p1 = permPasswordInput ? permPasswordInput.value : '';
      const p2 = permPasswordConfirm ? permPasswordConfirm.value : '';
      if (!p1 || p1.length < 6) {
        if (passwordModalStatus) {
          passwordModalStatus.textContent = 'Password must be at least 6 characters.';
          passwordModalStatus.style.color = 'var(--accent-red)';
        }
        return;
      }
      if (p1 !== p2) {
        if (passwordModalStatus) {
          passwordModalStatus.textContent = 'Passwords do not match.';
          passwordModalStatus.style.color = 'var(--accent-red)';
        }
        return;
      }

      const s = ensureSocket();
      const pin = accessPinInput ? accessPinInput.value.trim() : (activePin || '123456');
      if (passwordModalStatus) {
        passwordModalStatus.textContent = 'Saving password...';
        passwordModalStatus.style.color = 'var(--text-muted)';
      }
      const doEmit = () => {
        s.emit('control:password:set', { password: p1, pin }, (res) => {
          if (res && res.success) {
            showInfo('Permanent control password saved.');
            setTimeout(clearInfo, 2500);
            closePassModal();
          } else {
            if (passwordModalStatus) {
              passwordModalStatus.textContent = res && res.error ? res.error : 'Failed to save password.';
              passwordModalStatus.style.color = 'var(--accent-red)';
            }
          }
        });
      };
      if (s.connected) {
        doEmit();
      } else {
        s.once('connect', doEmit);
      }
    });
  }

  if (btnClearPassword) {
    btnClearPassword.addEventListener('click', () => {
      const s = ensureSocket();
      const pin = accessPinInput ? accessPinInput.value.trim() : (activePin || '123456');
      const doEmit = () => {
        s.emit('control:password:clear', { pin }, (res) => {
          if (res && res.success) {
            showInfo('Permanent control password cleared.');
            setTimeout(clearInfo, 2500);
            closePassModal();
          }
        });
      };
      if (s.connected) {
        doEmit();
      } else {
        s.once('connect', doEmit);
      }
    });
  }

  if (controlToggle && controlToggle.checked) {
    requestControlEnable(true);
  }
}

setupRemoteControlHandlers();

const pythonLinkCard = document.getElementById('pythonLinkCard');
const pythonStreamUrl = document.getElementById('pythonStreamUrl');
const btnCopyPythonUrl = document.getElementById('btnCopyPythonUrl');
const localViewerCard = document.getElementById('localViewerCard');
const localViewerLink = document.getElementById('localViewerLink');
const localViewerLinkInput = document.getElementById('localViewerLinkInput');
const btnCopyLocalLink = document.getElementById('btnCopyLocalLink');
const tunnelQuotaWarning = document.getElementById('tunnelQuotaWarning');
const btnToggleSetup = document.getElementById('btnToggleSetup');
const setupFormBody = document.getElementById('setupFormBody');
const btnHudFacing = document.getElementById('btnHudFacing');
const btnHudTorch = document.getElementById('btnHudTorch');
const btnHudSnapshot = document.getElementById('btnHudSnapshot');
const btnHudFullscreen = document.getElementById('btnHudFullscreen');

if (mediaModeSelect) {
  mediaModeSelect.addEventListener('change', () => {
    const isTunnelMode = mediaModeSelect.value === 'tunnel-relay';
    if (tunnelConfigPanel) {
      tunnelConfigPanel.style.display = isTunnelMode ? 'block' : 'none';
    }
    if (tunnelQuotaWarning) {
      tunnelQuotaWarning.style.display = isTunnelMode ? 'block' : 'none';
    }
  });
}

if (btnCopyPythonUrl) {
  btnCopyPythonUrl.addEventListener('click', () => {
    if (pythonStreamUrl && pythonStreamUrl.value) {
      copyTextToClipboard(pythonStreamUrl.value, btnCopyPythonUrl, '✓ Copied!');
    }
  });
}

if (btnCopyViewerLink) {
  btnCopyViewerLink.addEventListener('click', () => {
    const val = (viewerQrLinkInput && viewerQrLinkInput.value) || (viewerQrLink && viewerQrLink.href);
    if (val) {
      copyTextToClipboard(val, btnCopyViewerLink, '✓ Link Copied!');
    }
  });
}

if (btnCopyLocalLink) {
  btnCopyLocalLink.addEventListener('click', () => {
    const val = (localViewerLinkInput && localViewerLinkInput.value) || (localViewerLink && localViewerLink.href);
    if (val) {
      copyTextToClipboard(val, btnCopyLocalLink, '✓ PC Link Copied!');
    }
  });
}

if (btnToggleQrPreview && qrDropdownMount) {
  btnToggleQrPreview.addEventListener('click', () => {
    const isHidden = qrDropdownMount.style.display === 'none' || !qrDropdownMount.style.display;
    qrDropdownMount.style.display = isHidden ? 'block' : 'none';
    btnToggleQrPreview.textContent = isHidden ? 'Hide QR' : 'Show QR';
  });
}

setupPasswordToggle('btnTogglePin', 'accessPin');

if (btnToggleSetup && setupFormBody) {
  btnToggleSetup.addEventListener('click', () => {
    const isHidden = setupFormBody.style.display === 'none';
    setupFormBody.style.display = isHidden ? 'block' : 'none';
    btnToggleSetup.textContent = isHidden ? 'Collapse' : 'Settings';
  });
}

const wakeLockController = new WakeLockController();
const gridOverlay = document.getElementById('gridOverlay');
const transformController = new StreamTransformController(localVideo, gridOverlay);
const btnHudFlipH = document.getElementById('btnHudFlipH');
const btnHudRotate = document.getElementById('btnHudRotate');
const btnHudGrid = document.getElementById('btnHudGrid');
const btnHudBatterySaver = document.getElementById('btnHudBatterySaver');
const oledSaverOverlay = document.getElementById('oledSaverOverlay');
const btnHudRecord = document.getElementById('btnHudRecord');
const recIndicator = document.getElementById('recIndicator');
const recTimerText = document.getElementById('recTimerText');
const zoomControlBar = document.getElementById('zoomControlBar');
const zoomSlider = document.getElementById('zoomSlider');
const zoomValText = document.getElementById('zoomValText');
const btnSharePreLink = document.getElementById('btnSharePreLink');

// Focus controls
const focusModeSelect = document.getElementById('focusModeSelect');
const focusDistanceSlider = document.getElementById('focusDistanceSlider');
const focusDistanceValText = document.getElementById('focusDistanceValText');
const focusControlBar = document.getElementById('focusControlBar');
const focusSlider = document.getElementById('focusSlider');
const focusValText = document.getElementById('focusValText');
const btnHudFocus = document.getElementById('btnHudFocus');

// Battery monitoring
const vitalSenderBatteryItem = document.getElementById('vitalSenderBatteryItem');
const vitalSenderBattery = document.getElementById('vitalSenderBattery');

let latestBatteryData = null;
const batteryMonitor = new BatteryMonitor((batteryData) => {
  latestBatteryData = batteryData;
  if (vitalSenderBatteryItem && vitalSenderBattery && batteryData && batteryData.level !== null) {
    vitalSenderBatteryItem.style.display = 'flex';
    const chargingIcon = batteryData.charging ? ' ⚡' : '';
    vitalSenderBattery.textContent = `${batteryData.level}%${chargingIcon}`;
    if (batteryData.level <= 20) {
      vitalSenderBattery.style.color = '#ef4444';
    } else if (batteryData.level <= 50) {
      vitalSenderBattery.style.color = '#eab308';
    } else {
      vitalSenderBattery.style.color = '#22c55e';
    }
  }
  broadcastBatteryToViewers();
});

function broadcastBatteryToViewers() {
  if (socket && socket.connected && currentRoomId && latestBatteryData) {
    socket.emit('sender:battery', latestBatteryData);
  }
}

function updateFocusUI() {
  const currentMode = focusModeSelect ? focusModeSelect.value : 'continuous';
  const isLocked = currentMode === 'manual' || currentMode === 'single-shot';
  if (btnHudFocus) {
    btnHudFocus.style.color = isLocked ? 'var(--accent-cyan)' : 'inherit';
    btnHudFocus.title = isLocked
      ? 'Focus is Constant / Locked (Click for Auto-Focus)'
      : 'Focus is Auto (Click to Lock Constant Focus)';
  }
  const caps = cameraManager.getCapabilities();
  const hasDistance = Boolean(caps && caps.focusDistance);
  if (focusDistanceGroup) {
    focusDistanceGroup.style.display = (currentMode === 'manual' && hasDistance) ? 'block' : 'none';
  }
  if (focusControlBar) {
    if (currentMode === 'manual' && hasDistance) {
      focusControlBar.classList.add('active');
    } else {
      focusControlBar.classList.remove('active');
    }
  }
}

async function applyCurrentFocusSettings() {
  if (!cameraManager || !cameraManager.currentStream) return;
  const mode = focusModeSelect ? focusModeSelect.value : 'continuous';
  const ok = await cameraManager.applyFocusMode(mode);
  if (ok) {
    logDiagnostic(`[Camera] Focus mode applied: ${mode}`, 'INFO');
  }
  if (mode === 'manual' && focusDistanceSlider) {
    const dist = parseFloat(focusDistanceSlider.value);
    if (!isNaN(dist)) {
      await cameraManager.applyFocusDistance(dist);
    }
  }
}

if (focusModeSelect) {
  focusModeSelect.addEventListener('change', async () => {
    updateFocusUI();
    await applyCurrentFocusSettings();
  });
}

if (focusDistanceSlider) {
  focusDistanceSlider.addEventListener('input', async () => {
    const val = parseFloat(focusDistanceSlider.value);
    if (focusDistanceValText) {
      focusDistanceValText.textContent = `${val.toFixed(2)}m`;
    }
    if (focusSlider) {
      focusSlider.value = val;
    }
    if (focusValText) {
      focusValText.textContent = `${val.toFixed(2)}m`;
    }
    await cameraManager.applyFocusDistance(val);
  });
}

if (focusSlider) {
  focusSlider.addEventListener('input', async () => {
    const val = parseFloat(focusSlider.value);
    if (focusValText) {
      focusValText.textContent = `${val.toFixed(2)}m`;
    }
    if (focusDistanceSlider) {
      focusDistanceSlider.value = val;
    }
    if (focusDistanceValText) {
      focusDistanceValText.textContent = `${val.toFixed(2)}m`;
    }
    await cameraManager.applyFocusDistance(val);
  });
}

if (btnHudFocus) {
  btnHudFocus.addEventListener('click', async () => {
    const currentMode = focusModeSelect ? focusModeSelect.value : 'continuous';
    const newMode = (currentMode === 'continuous') ? 'manual' : 'continuous';
    if (focusModeSelect) {
      focusModeSelect.value = newMode;
    }
    updateFocusUI();
    const ok = await cameraManager.applyFocusMode(newMode);
    if (ok) {
      logDiagnostic(`[HUD] Focus mode toggled to ${newMode === 'manual' ? 'Constant / Locked' : 'Continuous Auto-Focus'}.`, 'INFO');
    }
  });
}

if (localVideo) {
  localVideo.addEventListener('click', async () => {
    if (!isStreamingActive()) return;
    const ok = await cameraManager.applyFocusMode('single-shot');
    if (ok) {
      if (focusModeSelect) focusModeSelect.value = 'single-shot';
      updateFocusUI();
      logDiagnostic('[Camera] Focus locked via tap on preview.', 'INFO');
    }
  });
}

if (btnHudFacing) {
  btnHudFacing.addEventListener('click', () => {
    btnToggleFacing.click();
  });
}

if (btnHudFlipH) {
  btnHudFlipH.addEventListener('click', () => {
    const isMirrored = transformController.toggleMirror();
    btnHudFlipH.style.color = isMirrored ? 'var(--accent-cyan)' : 'inherit';
  });
}

if (btnHudRotate) {
  btnHudRotate.addEventListener('click', () => {
    transformController.rotate();
  });
}

if (btnHudGrid) {
  btnHudGrid.addEventListener('click', () => {
    const isActive = transformController.toggleGrid();
    btnHudGrid.style.color = isActive ? 'var(--accent-cyan)' : 'inherit';
  });
}

if (btnHudBatterySaver && oledSaverOverlay) {
  btnHudBatterySaver.addEventListener('click', () => {
    oledSaverOverlay.classList.add('active');
  });
  oledSaverOverlay.addEventListener('click', () => {
    oledSaverOverlay.classList.remove('active');
  });
}

let streamRecorder = null;
if (btnHudRecord && localVideo) {
  streamRecorder = new StreamRecorder(localVideo, {
    onStart: () => {
      if (recIndicator) { recIndicator.classList.add('active'); }
      btnHudRecord.style.color = '#ef4444';
      logDiagnostic('[Record] Video recording started on sender.', 'INFO');
    },
    onStop: () => {
      if (recIndicator) { recIndicator.classList.remove('active'); }
      btnHudRecord.style.color = 'inherit';
      logDiagnostic('[Record] Video recording completed and file downloaded.', 'INFO');
    },
    onTimeUpdate: (timeStr) => {
      if (recTimerText) { recTimerText.textContent = `REC ${timeStr}`; }
    }
  });

  btnHudRecord.addEventListener('click', () => {
    if (streamRecorder.isRecording) {
      streamRecorder.stop();
    } else {
      if (isStreamingActive()) {
        streamRecorder.start();
      } else {
        showError('Start streaming before recording video.');
      }
    }
  });
}

if (btnHudSnapshot) {
  btnHudSnapshot.addEventListener('click', () => {
    if (localVideo && localVideo.readyState >= 2) {
      captureFrameSnapshot(localVideo, 'sender-stream-snapshot');
      logDiagnostic('[HUD] Captured stream snapshot image.', 'INFO');
    }
  });
}

if (btnHudFullscreen && videoContainer) {
  btnHudFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      videoContainer.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });
}

function handleSenderFullscreenChange() {
  const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  document.body.classList.toggle('is-fullscreen', isFs);
  if (videoContainer) {
    videoContainer.classList.toggle('is-fullscreen', isFs);
  }
}

document.addEventListener('fullscreenchange', handleSenderFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleSenderFullscreenChange);

if (videoContainer) {
  videoContainer.addEventListener('dblclick', (e) => {
    if (e.target && e.target.closest('button, a, input, select')) {
      return;
    }
    if (btnHudFullscreen) {
      btnHudFullscreen.click();
    }
  });
}

if (btnHudTorch) {
  btnHudTorch.addEventListener('click', async () => {
    torchActive = !torchActive;
    const ok = await cameraManager.applyTorch(torchActive);
    if (ok) {
      btnHudTorch.style.color = torchActive ? '#facc15' : 'inherit';
      logDiagnostic(`[HUD] Torch flashlight ${torchActive ? 'enabled' : 'disabled'}.`, 'INFO');
    } else {
      torchActive = false;
    }
  });
}

if (zoomSlider) {
  zoomSlider.addEventListener('input', async () => {
    const val = parseFloat(zoomSlider.value);
    if (zoomValText) {
      zoomValText.textContent = `${val.toFixed(1)}x`;
    }
    await cameraManager.applyZoom(val);
  });
}

function updateHardwareCapabilitiesUI() {
  const sourceChoice = sourceSelect ? sourceSelect.value : 'webcam';
  if (sourceChoice !== 'webcam') {
    if (btnHudTorch) btnHudTorch.style.display = 'none';
    if (btnHudFacing) btnHudFacing.style.display = 'none';
    if (btnHudFocus) btnHudFocus.style.display = 'none';
    if (zoomControlBar) zoomControlBar.classList.remove('active');
    if (focusControlBar) focusControlBar.classList.remove('active');
    if (focusDistanceGroup) focusDistanceGroup.style.display = 'none';
    return;
  }
  if (btnHudFacing) btnHudFacing.style.display = 'inline-flex';
  if (btnHudFocus) btnHudFocus.style.display = 'inline-flex';

  const caps = cameraManager.getCapabilities();
  if (!caps) {
    if (btnHudTorch) btnHudTorch.style.display = 'none';
    if (zoomControlBar) zoomControlBar.classList.remove('active');
    if (focusControlBar) focusControlBar.classList.remove('active');
    if (focusDistanceGroup) focusDistanceGroup.style.display = 'none';
    return;
  }
  if (btnHudTorch) {
    btnHudTorch.style.display = caps.torch ? 'inline-flex' : 'none';
  }
  if (caps.zoom && zoomControlBar && zoomSlider) {
    zoomControlBar.classList.add('active');
    zoomSlider.min = caps.zoom.min || 1;
    zoomSlider.max = caps.zoom.max || 5;
    zoomSlider.step = caps.zoom.step || 0.1;
    zoomSlider.value = 1;
    if (zoomValText) zoomValText.textContent = '1.0x';
  } else if (zoomControlBar) {
    zoomControlBar.classList.remove('active');
  }

  if (caps.focusDistance) {
    const min = caps.focusDistance.min !== undefined ? caps.focusDistance.min : 0;
    const max = caps.focusDistance.max !== undefined ? caps.focusDistance.max : 1;
    const step = caps.focusDistance.step !== undefined ? caps.focusDistance.step : 0.05;
    if (focusDistanceSlider) {
      focusDistanceSlider.min = min;
      focusDistanceSlider.max = max;
      focusDistanceSlider.step = step;
    }
    if (focusSlider) {
      focusSlider.min = min;
      focusSlider.max = max;
      focusSlider.step = step;
    }
  }
  updateFocusUI();
}

if (btnSharePreLink) {
  btnSharePreLink.addEventListener('click', () => {
    const url = buildShareUrl('/viewer', {
      roomId: roomIdInput?.value || '',
      pin: accessPinInput?.value || '',
      autostart: true
    });
    copyTextToClipboard(url, btnSharePreLink, '✓ Link Copied!');
  });
}

function generateRandomRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = '123';
  // for (let i = 0; i < 6; i++) {
  //   result += chars.charAt(Math.floor(Math.random() * chars.length));
  // }
  return result;
}

if (btnGenRoom) {
  btnGenRoom.addEventListener('click', () => {
    if (roomIdInput) {
      roomIdInput.value = generateRandomRoomId();
    }
  });
}

async function populateCameraDevices() {
  try {
    const devices = await cameraManager.enumerateCameras();
    if (devices.length > 0) {
      cameraSelect.innerHTML = '<option value="">Default (Auto / Facing)</option>';
      devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Camera ${index + 1}`;
        cameraSelect.appendChild(option);
      });
    }
  } catch (err) {
    logDiagnostic(`Could not enumerate devices: ${err.message}`);
  }
}

async function fetchIceServers() {
  if (cachedIceServers) {
    return cachedIceServers;
  }
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      if (data && data.version) {
        const badges = document.querySelectorAll('.brand-version, #appVersionBadge');
        badges.forEach((b) => {
          b.textContent = `v${data.version}`;
          b.setAttribute('title', `LAN Camera Streaming v${data.version}`);
        });
      }
      cachedIceServers = data.iceServers;
      if (Array.isArray(cachedIceServers) && cachedIceServers.length > 0) {
        const summary = cachedIceServers.map((s) => {
          const urls = Array.isArray(s.urls) ? s.urls.join(', ') : s.urls;
          return s.username ? `TURN(${urls})` : `STUN(${urls})`;
        }).join('; ');
        logDiagnostic(`[ICE] Loaded servers: ${summary}`, 'INFO');
      }
      return cachedIceServers;
    }
  } catch (err) {
    logDiagnostic(`Failed to load ICE servers config: ${err.message}`, 'WARN');
  }
  return undefined;
}

let isSwitchingSource = false;
let currentSourceVideoElement = null;

function isStreamingActive() {
  return Boolean(cameraManager.currentStream && btnStop && btnStop.style.display !== 'none');
}

function cleanupSourceVideoElement() {
  if (currentSourceVideoElement) {
    try {
      currentSourceVideoElement.pause();
      if (currentSourceVideoElement.src && currentSourceVideoElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(currentSourceVideoElement.src);
      }
      currentSourceVideoElement.src = '';
      currentSourceVideoElement.load();
    } catch {
      // Ignore cleanup error
    }
    currentSourceVideoElement = null;
  }
}

// Helper to obtain stream from a local video file
async function getLocalFileStream(file) {
  cleanupSourceVideoElement();
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.onloadedmetadata = () => {
      video.width = video.videoWidth;
      video.height = video.videoHeight;
      video.play().then(() => {
        currentSourceVideoElement = video;
        const captureFn = video.captureStream || video.mozCaptureStream;
        if (!captureFn) {
          reject(new Error('captureStream() is not supported in this browser.'));
          return;
        }
        const stream = captureFn.call(video);
        resolve(stream);
      }).catch(reject);
    };
    video.onerror = () => reject(new Error('Failed to load local video file.'));
  });
}

// Helper to obtain stream from a remote video URL
async function getRemoteUrlStream(url) {
  cleanupSourceVideoElement();
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.onloadedmetadata = () => {
      video.play().then(() => {
        currentSourceVideoElement = video;
        const captureFn = video.captureStream || video.mozCaptureStream;
        if (!captureFn) {
          reject(new Error('captureStream() is not supported in this browser.'));
          return;
        }
        const stream = captureFn.call(video);
        resolve(stream);
      }).catch(reject);
    };
    video.onerror = () => reject(new Error('Failed to load remote video URL.'));
  });
}

let lastSuccessfulSource = 'webcam';

async function applyScreenResolutionChange() {
  const resChoice = cameraResolutionSelect ? cameraResolutionSelect.value : 'max';
  logDiagnostic(`[SCREEN] Adjusting screen share resolution to "${resChoice}" (aspect preserved)...`, 'INFO');
  const ok = await cameraManager.applyScreenResolution(resChoice);
  if (ok) {
    const track = cameraManager.currentStream && cameraManager.currentStream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    const actualWidth = settings.width || localVideo.videoWidth || 0;
    const actualHeight = settings.height || localVideo.videoHeight || 0;
    const actualFps = Math.round(settings.frameRate || 30);
    logDiagnostic(`[SCREEN] Dynamic resolution applied: ${actualWidth}x${actualHeight} @ ${actualFps} FPS (${resChoice}).`, 'INFO');
    updateVitals({
      fps: actualFps,
      resolution: (actualWidth && actualHeight) ? `${actualWidth} × ${actualHeight}` : null
    });
    if (socket) {
      socket.emit('stream:state', { state: 'source-changed' });
    }
    showInfo(`Screen resolution adjusted to ${resChoice} (aspect preserved).`);
    setTimeout(clearInfo, 2500);
  } else {
    await applyDynamicSourceChange();
  }
}

async function obtainStreamForCurrentSource() {
  const sourceChoice = sourceSelect ? sourceSelect.value : 'webcam';
  if (sourceChoice === 'webcam') {
    const selectedDeviceId = (cameraSelect && cameraSelect.value) || null;
    const resChoice = cameraResolutionSelect ? cameraResolutionSelect.value : 'max';
    let targetWidth = 'max';
    let targetHeight = 'max';
    if (resChoice === '1080p') {
      targetWidth = 1920;
      targetHeight = 1080;
    } else if (resChoice === '720p') {
      targetWidth = 1280;
      targetHeight = 720;
    } else if (resChoice === '480p') {
      targetWidth = 854;
      targetHeight = 480;
    }
    const audioToggle = document.getElementById('audioToggle');
    const withAudio = Boolean(audioToggle && audioToggle.checked);
    logDiagnostic(`Requesting camera capture (mode: ${resChoice}, audio: ${withAudio})...`, 'INFO');
    return await cameraManager.startCapture({
      deviceId: selectedDeviceId,
      width: targetWidth,
      height: targetHeight,
      frameRate: 30,
      withAudio
    });
  } else if (sourceChoice === 'screen') {
    const resChoice = cameraResolutionSelect ? cameraResolutionSelect.value : 'max';
    const audioToggle = document.getElementById('audioToggle');
    const withAudio = Boolean(audioToggle && audioToggle.checked);
    const hideCursor = Boolean(screenCursorToggle && screenCursorToggle.checked);
    const cursorConstraint = hideCursor ? 'never' : 'always';
    logDiagnostic(`Requesting screen capture (quality: ${resChoice}, audio: ${withAudio}, cursor: ${cursorConstraint})...`, 'INFO');
    const stream = await cameraManager.startScreenCapture({
      resolution: resChoice,
      frameRate: 30,
      withAudio,
      cursor: cursorConstraint
    });
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const effectiveCursor = CameraManager.getEffectiveCursorSetting(videoTrack);
      if (hideCursor) {
        if (effectiveCursor === 'never') {
          logDiagnostic('[SCREEN] Cursor hiding requested (\'never\'); browser confirmed effective cursor setting is \'never\' (cursor excluded from capture).', 'INFO');
        } else if (effectiveCursor === 'always' || effectiveCursor === 'motion') {
          logDiagnostic(`[SCREEN] Cursor hiding requested ('never'), but browser reports effective cursor setting as '${effectiveCursor}' (cursor remains visible in captured stream).`, 'WARN');
        } else {
          logDiagnostic('[SCREEN] Cursor constraint \'never\' requested; browser does not expose cursor in track settings (Chromium/Windows limitation; mouse cursor may remain visible in captured stream).', 'WARN');
        }
      } else {
        if (effectiveCursor) {
          logDiagnostic(`[SCREEN] Screen capture active with effective cursor setting '${effectiveCursor}'.`, 'INFO');
        } else {
          logDiagnostic('[SCREEN] Screen capture active (browser does not report cursor setting).', 'INFO');
        }
      }

      videoTrack.addEventListener('ended', () => {
        logDiagnostic('[SCREEN] Screen sharing stopped via browser UI.', 'WARN');
        if (isStreamingActive()) {
          stopSession();
          showInfo('Screen sharing was ended.');
          setTimeout(clearInfo, 3000);
        }
      });
    }
    return stream;
  } else if (sourceChoice === 'file') {
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      throw new Error('No video file selected. Please select a file.');
    }
    return await getLocalFileStream(file);
  } else if (sourceChoice === 'url') {
    const url = urlInput ? urlInput.value.trim() : '';
    if (!url) {
      throw new Error('No video URL provided. Please enter a URL.');
    }
    return await getRemoteUrlStream(url);
  }
  throw new Error(`Unknown source choice: ${sourceChoice}`);
}

async function applyDynamicSourceChange() {
  if (!isStreamingActive() || isSwitchingSource) {
    return;
  }

  const sourceChoice = sourceSelect ? sourceSelect.value : 'webcam';
  if (sourceChoice === 'file' && (!fileInput || !fileInput.files || !fileInput.files[0])) {
    return;
  }
  if (sourceChoice === 'url' && (!urlInput || !urlInput.value.trim())) {
    return;
  }

  isSwitchingSource = true;
  clearError();
  logDiagnostic(`Applying media source change to "${sourceChoice}"...`, 'INFO');

  const prevStream = cameraManager.currentStream;
  try {
    const newStream = await obtainStreamForCurrentSource();

    if (sourceChoice === 'webcam') {
      cleanupSourceVideoElement();
    }
    lastSuccessfulSource = sourceChoice;

    localVideo.srcObject = newStream;
    videoOverlay.style.display = 'none';
    await localVideo.play().catch(() => {});

    cameraManager.currentStream = newStream;

    const newVideoTrack = newStream.getVideoTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];
    if (newVideoTrack) {
      newVideoTrack.contentHint = getContentHintForCurrentSource();
    }

    // Replace tracks on all active viewer peer connections
    if (viewerPeers.size > 0 && newVideoTrack) {
      for (const [viewerId, peer] of viewerPeers.entries()) {
        if (peer && peer.peerConnection) {
          const senders = peer.peerConnection.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video') ||
                              senders.find((s) => s.track === null);
          if (videoSender) {
            try {
              await videoSender.replaceTrack(newVideoTrack);
              logDiagnostic(`[MEDIA:${viewerId}] Successfully replaced video track with new source.`, 'INFO');
              await applyViewerQualityPriority(viewerId, peer, { armGrace: true });
            } catch (err) {
              logDiagnostic(`[MEDIA:${viewerId}] Failed to replace video track: ${err.message}`, 'WARN');
            }
          } else {
            peer.addTrack(newVideoTrack, newStream);
          }

          if (newAudioTrack) {
            const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
            if (audioSender) {
              audioSender.replaceTrack(newAudioTrack).catch(() => {});
            }
          }
        }
      }
    }

    // Safely stop old tracks after replacement
    if (prevStream && prevStream !== newStream) {
      prevStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
    }

    let actualWidth = 0;
    let actualHeight = 0;
    let actualFps = 30;
    if (newVideoTrack) {
      const settings = newVideoTrack.getSettings ? newVideoTrack.getSettings() : {};
      actualWidth = settings.width || localVideo.videoWidth || 0;
      actualHeight = settings.height || localVideo.videoHeight || 0;
      actualFps = Math.round(settings.frameRate || 30);
      logDiagnostic(`Media source active: ${actualWidth}x${actualHeight} @ ${actualFps} FPS.`, 'INFO');

      const capabilities = newVideoTrack.getCapabilities ? newVideoTrack.getCapabilities() : {};
      if (capabilities.torch && btnHudTorch) {
        btnHudTorch.style.display = 'inline-flex';
      } else if (btnHudTorch) {
        btnHudTorch.style.display = 'none';
      }
    }

    await applyCurrentFocusSettings();
    updateHardwareCapabilitiesUI();

    updateVitals({
      fps: actualFps,
      resolution: (actualWidth && actualHeight) ? `${actualWidth} × ${actualHeight}` : null
    });

    if (socket) {
      socket.emit('stream:state', { state: 'source-changed' });
    }

    showInfo(`Stream source changed to ${sourceChoice}.`);
  } catch (err) {
    if (sourceSelect) {
      sourceSelect.value = lastSuccessfulSource;
      updateSourceInputsVisibility();
    }
    showError(`Failed to switch source: ${err.message}`);
    logDiagnostic(`Source switch failed: ${err.message}`, 'ERROR');
  } finally {
    isSwitchingSource = false;
  }
}

// Modified startSession to use selected source
async function startSession() {
  clearError();
  clearInfo();

  const pin = accessPinInput.value.trim();
  const roomId = roomIdInput.value.trim();

  if (!pin) {
    showError('Please enter an Access PIN.');
    return;
  }
  if (!roomId) {
    showError('Please enter or generate a Room ID.');
    return;
  }

  isStreamingRequested = true;
  activeRoomId = roomId;
  activePin = pin;
  isStudioSender = Boolean(streamParams.role === 'studio-sender' || streamParams.studio === '1');

  btnStart.disabled = true;
  updateStatus('connecting', 'Starting capture...');
  logDiagnostic('Requesting camera permissions...');

  let stream = null;
  try {
    const sourceChoice = sourceSelect ? sourceSelect.value : 'webcam';
    stream = await obtainStreamForCurrentSource();

    if (sourceChoice === 'webcam') {
      cleanupSourceVideoElement();
    }
    lastSuccessfulSource = sourceChoice;

    localVideo.srcObject = stream;
    videoOverlay.style.display = 'none';
    await localVideo.play().catch(() => {});

    // Store stream in cameraManager for compatibility with downstream code
    cameraManager.currentStream = stream;
    


if (viewerPeers.size > 0) {
  for (const [viewerId, peer] of viewerPeers.entries()) {
    if (peer.peerConnection) {
      const senders = peer.peerConnection.getSenders();
      // Replace video track if present
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoTrack.contentHint = getContentHintForCurrentSource();
          videoSender.replaceTrack(videoTrack).then(() => {
            return applyViewerQualityPriority(viewerId, peer, { armGrace: true });
          }).catch(err => {
            logDiagnostic(`[MEDIA:${viewerId}] Failed to replace video track: ${err.message}`, 'WARN');
          });
        } else {
          peer.addTrack(videoTrack, stream);
        }
      }
      // Replace audio track if present
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender) {
          audioSender.replaceTrack(audioTrack).catch(err => {
            logDiagnostic(`[MEDIA:${viewerId}] Failed to replace audio track: ${err.message}`, 'WARN');
          });
        } else {
          peer.addTrack(audioTrack, stream);
        }
      }
    }
  }
}
    const videoTrack = stream.getVideoTracks()[0];
    let actualWidth = 0;
    let actualHeight = 0;
    let actualFps = 30;
    if (videoTrack) {
      const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
      actualWidth = settings.width || localVideo.videoWidth || 0;
      actualHeight = settings.height || localVideo.videoHeight || 0;
      actualFps = Math.round(settings.frameRate || 30);
      logDiagnostic(`Camera capture active: ${actualWidth}x${actualHeight} @ ${actualFps} FPS (${videoTrack.label || 'Default Camera'}).`, 'INFO');
    } else {
      logDiagnostic('Camera capture started.', 'INFO');
    }

    await applyCurrentFocusSettings();
    updateHardwareCapabilitiesUI();
    wakeLockController.request().catch(() => {});

    updateVitals({
      fps: actualFps,
      resolution: (actualWidth && actualHeight) ? `${actualWidth} × ${actualHeight}` : null,
      viewers: 0,
      path: currentMediaMode === 'tunnel-relay' ? 'tunnel-relay' : '--'
    });

    if (appWorkspace) {
      appWorkspace.classList.add('streaming-active');
    }
    const senderVideoHud = document.getElementById('senderVideoHud');
    if (senderVideoHud) {
      senderVideoHud.style.display = 'flex';
    }
    if (btnToggleFacing) {
      btnToggleFacing.style.display = 'none';
    }
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
    btnStop.disabled = false;

    if (btnToggleSetup) {
      btnToggleSetup.style.display = 'inline-flex';
      if (window.innerWidth <= 768 && setupFormBody) {
        setupFormBody.style.display = 'none';
        btnToggleSetup.textContent = 'Settings';
      }
    }

    // Once permission is granted, populate detailed device labels if available
    await populateCameraDevices();
  } catch (err) {
    updateStatus('error', 'Camera Error');
    showError(err.message);
    logDiagnostic(`Camera capture failed: ${err.message}`, 'ERROR');
    const senderVideoHudCatch = document.getElementById('senderVideoHud');
    if (senderVideoHudCatch) {
      senderVideoHudCatch.style.display = 'none';
    }
    if (btnToggleFacing) {
      btnToggleFacing.style.display = 'inline-flex';
    }
    btnStart.disabled = false;
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
    return;
  }

  currentRoomId = roomId;
  currentMediaMode = mediaModeSelect ? mediaModeSelect.value : 'webrtc';

  // Initialize Socket.IO connection
  ensureSocket();

  startWatchdog();

  const role = isStudioSender ? 'studio-sender' : 'sender';
  logDiagnostic(`Joining room "${roomId}" as ${role} [mode: ${currentMediaMode}]...`);
  updateStatus('connecting', 'Joining Room...');

  const isAutoRejoining = Boolean(isRejoining);
  socket.emit('room:join', { roomId, role, pin, mediaMode: currentMediaMode, reconnect: isAutoRejoining, senderToken: activeSenderToken }, async (response) => {
    if (!response || !response.success) {
      const errMsg = response ? response.error : 'Connection to room failed';
      showError(errMsg);
      logDiagnostic(`Join failed: ${errMsg}. Will automatically retry in 3 seconds...`, 'WARN');
      updateStatus('connecting', `Join failed (${errMsg}) - Retrying...`);
      scheduleAutoRejoin(3000);
      return;
    }

    hasJoinedRoom = true;
    if (response.senderToken) {
      activeSenderToken = response.senderToken;
    }
    seedViewerQuality(response);
    logDiagnostic(`Joined room "${roomId}" as ${role} [mode: ${response.mediaMode}].`);
    getChatManager().setSocket(socket);
    getChatManager().setRoom(roomId, role);
    broadcastBatteryToViewers();

    // Display Share Card with credentials and 1-click access link for Viewer
    updateViewerShareCard(roomId, pin);

    showLocalViewerLink(roomId);

    if (controlToggle && controlToggle.checked) {
      probeControlHelper(true);
      requestControlEnable(true);
    }

    // Display Direct Python Stream Link
    const streamUrl = `${window.location.origin}/stream/${roomId}?pin=${encodeURIComponent(pin)}`;
    if (pythonStreamUrl) {
      pythonStreamUrl.value = streamUrl;
    }
    if (pythonLinkCard) {
      pythonLinkCard.style.display = 'block';
    }
    logDiagnostic(`Python stream available at: ${streamUrl} (frames are uploaded only while a client is connected to it)`);

    if (currentMediaMode === 'tunnel-relay') {
      logDiagnostic('Operating in Mode B: Experimental zrok-tunneled binary video.');
      if (response.hasPeer) {
        updateStatus('live', 'Live (zrok Tunnel Relay)');
        startTunnelFrameLoop();
      } else {
        updateStatus('waiting', 'Waiting for Viewer (Tunnel Mode)...');
        logDiagnostic('Waiting for viewer to connect in tunnel mode.');
      }
    } else {
      if (response.hasPeer) {
        updateStatus('connecting', 'Viewers present. Connecting WebRTC...');
        const peerList = response.peerSocketIds || (response.peerSocketId ? [response.peerSocketId] : []);
        for (const pId of peerList) {
          await initiateWebRtcConnectionForViewer(pId);
        }
      } else {
        updateStatus('waiting', 'Waiting for Viewer / Python...');
        logDiagnostic('Waiting for viewer or Python consumer to connect.');
      }
    }
  });
}

async function rejoinRoomAsSender() {
  if (!isStreamingRequested || !activeRoomId || !activePin) {
    return;
  }
  if (isRejoining) {
    return;
  }

  if (autoRejoinTimer) {
    clearTimeout(autoRejoinTimer);
    autoRejoinTimer = null;
  }

  isRejoining = true;

  // 1. Ensure socket exists and is connected
  if (!socket) {
    socket = io();
    setupSocketListeners();
  }

  if (!socket.connected) {
    logDiagnostic('[AutoReconnect] Socket not connected yet. Waiting for socket connect event...', 'INFO');
    socket.connect();
    isRejoining = false;
    return;
  }

  // 2. Ensure camera stream is still active
  const hasLiveVideoTrack = cameraManager.currentStream &&
    cameraManager.currentStream.getVideoTracks().some((t) => t.readyState === 'live');
  if (!hasLiveVideoTrack && (!sourceSelect || sourceSelect.value === 'webcam')) {
    logDiagnostic('[AutoReconnect] Camera capture ended or interrupted while backgrounded; re-acquiring capture...', 'WARN');
    try {
      await applyDynamicSourceChange();
    } catch (err) {
      logDiagnostic(`[AutoReconnect] Failed to re-acquire camera: ${err.message}`, 'WARN');
    }
  }

  // 3. Clear stale viewer peer connections
  for (const peer of viewerPeers.values()) {
    try {
      peer.close();
    } catch {
      // Ignore
    }
  }
  viewerPeers.clear();
  pendingCandidatesByViewer.clear();

  updateStatus('connecting', 'Rejoining room...');
  logDiagnostic(`[AutoReconnect] Automatically re-joining room "${activeRoomId}"...`, 'INFO');

  const role = isStudioSender ? 'studio-sender' : 'sender';
  const joinPayload = {
    roomId: activeRoomId,
    role,
    pin: activePin,
    mediaMode: currentMediaMode,
    reconnect: true,
    senderToken: activeSenderToken
  };

  socket.emit('room:join', joinPayload, async (response) => {
    isRejoining = false;

    if (!isStreamingRequested) {
      return;
    }

    if (!response || !response.success) {
      const errMsg = response ? response.error : 'Connection to room failed';
      logDiagnostic(`[AutoReconnect] Rejoin room failed: ${errMsg}. Retrying in 3 seconds...`, 'WARN');
      updateStatus('connecting', `Reconnecting (${errMsg})...`);
      scheduleAutoRejoin(3000);
      return;
    }

    hasJoinedRoom = true;
    if (response.senderToken) {
      activeSenderToken = response.senderToken;
    }
    seedViewerQuality(response);
    logDiagnostic(`[AutoReconnect] Successfully rejoined room "${activeRoomId}" as ${role} [mode: ${response.mediaMode}].`, 'INFO');
    getChatManager().setSocket(socket);
    getChatManager().setRoom(activeRoomId, role);
    showInfo('✓ Stream reconnected to room');
    setTimeout(clearInfo, 2500);

    socket.emit('stream:state', { state: 'live' });

    if (currentMediaMode === 'tunnel-relay') {
      if (response.hasPeer) {
        updateStatus('live', 'Live (zrok Tunnel Relay)');
        startTunnelFrameLoop();
      } else {
        updateStatus('waiting', 'Waiting for Viewer (Tunnel Mode)...');
        logDiagnostic('Waiting for viewer to connect in tunnel mode.');
      }
    } else {
      if (response.hasPeer) {
        updateStatus('connecting', 'Viewers present. Connecting WebRTC...');
        const peerList = response.peerSocketIds || (response.peerSocketId ? [response.peerSocketId] : []);
        for (const pId of peerList) {
          await initiateWebRtcConnectionForViewer(pId);
        }
      } else {
        updateStatus('waiting', 'Waiting for Viewer / Python...');
        logDiagnostic('Waiting for viewer or Python consumer to connect.');
      }
    }
  });
}

function scheduleAutoRejoin(delayMs = 3000) {
  if (!isStreamingRequested) {
    return;
  }
  if (autoRejoinTimer) {
    clearTimeout(autoRejoinTimer);
  }
  autoRejoinTimer = setTimeout(() => {
    rejoinRoomAsSender();
  }, delayMs);
}

function startWatchdog() {
  stopWatchdog();
  watchdogInterval = setInterval(async () => {
    if (!isStreamingRequested) {
      stopWatchdog();
      return;
    }

    // Check socket connection
    if (!socket || !socket.connected) {
      logDiagnostic('[Watchdog] Socket disconnected while streaming active. Reconnecting...', 'INFO');
      if (socket) {
        socket.connect();
      } else {
        rejoinRoomAsSender();
      }
      return;
    }

    // Refresh Screen WakeLock
    wakeLockController.request().catch(() => {});

    // Check camera track health
    const stream = cameraManager.currentStream;
    if (stream && (!sourceSelect || sourceSelect.value === 'webcam')) {
      const liveTracks = stream.getVideoTracks().filter((t) => t.readyState === 'live');
      if (liveTracks.length === 0 && !isSwitchingSource) {
        logDiagnostic('[Watchdog] Video track ended. Re-acquiring camera...', 'WARN');
        try {
          await applyDynamicSourceChange();
        } catch (err) {
          logDiagnostic(`[Watchdog] Camera recovery failed: ${err.message}`, 'WARN');
        }
      }
    }
  }, 5000);
}

function stopWatchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}




async function showLocalViewerLink(roomId) {
  if (!localViewerCard || !localViewerLink) {
    return;
  }
  const localOrigin = await fetchLocalServerOrigin();
  if (!localOrigin || roomId !== currentRoomId) {
    return;
  }
  const localViewerUrl = `${localOrigin}/viewer?room=${encodeURIComponent(roomId)}`;
  localViewerLink.href = localViewerUrl;
  localViewerLink.textContent = localViewerUrl;
  if (localViewerLinkInput) {
    localViewerLinkInput.value = localViewerUrl;
  }
  localViewerCard.style.display = 'block';
  if (!isLocalHostname(window.location.hostname)) {
    logDiagnostic('[HINT] Open the viewer on the PC via the localhost link above so only the phone page and signaling use zrok.', 'INFO');
  }
}

const viewerPeers = new Map(); // viewerId -> WebRtcPeer
const pendingCandidatesByViewer = new Map(); // viewerId -> Array of candidates

function getConnectedViewerCount() {
  let count = 0;
  for (const peer of viewerPeers.values()) {
    if (peer.peerConnection && (peer.peerConnection.connectionState === 'connected' || peer.peerConnection.iceConnectionState === 'connected' || peer.peerConnection.iceConnectionState === 'completed')) {
      count++;
    }
  }
  return count;
}

function updateStreamingStatus() {
  const count = getConnectedViewerCount();
  const total = viewerPeers.size;
  if (count > 0) {
    updateStatus('live', `Live (${count} viewer${count > 1 ? 's' : ''})`);
    socket.emit('stream:state', { state: 'live' });
  } else if (total > 0) {
    updateStatus('connecting', `Connecting (${total} viewer${total > 1 ? 's' : ''})...`);
  } else {
    updateStatus('waiting', 'Waiting for Viewers...');
    setPathIndicator(null);
    lastLoggedPathKind = null;
  }
  updateVitals({ viewers: count });
}

// Viewers whose peer connection gathered a Chrome mDNS-obfuscated host candidate on this sender (used to explain ICE failures).
const viewerPeerHidesLanAddress = new Set();

function createSenderPeerForViewer(viewerId, iceServers) {
  if (viewerPeers.has(viewerId)) {
    const existing = viewerPeers.get(viewerId);
    existing.close();
    viewerPeers.delete(viewerId);
  }

  logDiagnostic(`[P2P] Initializing RTCPeerConnection for viewer ${viewerId}...`, 'INFO');

  const peer = new WebRtcPeer({
    iceServers,
    onIceCandidate: (candidate) => {
      if (candidate) {
        if (candidate.type === 'host' && /\.local/.test(candidate.candidate)) {
          viewerPeerHidesLanAddress.add(viewerId);
        }
        logDiagnostic(`[ICE:${viewerId}] Local candidate gathered: ${parseCandidateSummary(candidate)}`, 'INFO');
        socket.emit('webrtc:ice-candidate', {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          targetId: viewerId
        });
      } else {
        logDiagnostic(`[ICE:${viewerId}] Local candidate gathering finished (null end-of-candidates).`, 'INFO');
      }
    },
    onIceCandidateError: (event) => {
      logDiagnostic(`[ICE:${viewerId}] Candidate error (${event.errorCode}): ${event.errorText || 'STUN/TURN query error'} at ${event.url || 'host'}`, 'WARN');
    },
    onIceGatheringStateChange: (state) => {
      logDiagnostic(`[ICE:${viewerId}] Gathering state changed to: ${state}`, 'INFO');
    },
    onSignalingStateChange: (state) => {
      logDiagnostic(`[SDP:${viewerId}] Signaling state changed to: ${state}`, 'INFO');
    },
    onConnectionStateChange: (state) => {
      logDiagnostic(`[P2P:${viewerId}] Peer connection state: ${state}`, 'INFO');
      updateStreamingStatus();
      if (state === 'connected') {
        applyViewerQualityPriority(viewerId, peer, { armGrace: true });
        scheduleDiagnosticSnapshots(viewerId, peer);
        startStatsPolling();
      } else if (state === 'failed') {
        logDiagnostic(`[P2P:${viewerId}] Connection failed.`, 'ERROR');
        if (viewerPeerHidesLanAddress.has(viewerId)) {
          const flagUrl = mdnsController ? mdnsController.browserInfo.flagUrl : 'chrome://flags/#enable-webrtc-hide-local-ips-with-mdns';
          logDiagnostic(`[DIAGNOSIS:${viewerId}] Browser conceals its LAN IP behind an mDNS name (*.local). Viewers on mobile phones cannot reach this stream. Fix: Open ${flagUrl}, set "Anonymize local IPs exposed by WebRTC" to Disabled, and relaunch your browser.`, 'WARN');
          const banner = document.getElementById('mdnsWarningBanner');
          if (banner) {
            banner.style.display = 'block';
          }
        }
      }
    },
    onIceConnectionStateChange: (state) => {
      logDiagnostic(`[ICE:${viewerId}] ICE Connection State: ${state}`, 'INFO');
      if (state === 'connected' || state === 'completed') {
        logDiagnostic(`[ICE:${viewerId}] ✓ WebRTC media connection established successfully!`, 'INFO');
        updateStreamingStatus();
      } else if (state === 'failed') {
        logDiagnostic(`[ICE:${viewerId}] ❌ ICE connection failed! Direct P2P media could not connect.`, 'ERROR');
        logDiagnostic('[DIAGNOSIS] Most likely causes on the same Wi-Fi:', 'WARN');
        logDiagnostic('1. Router "AP / client isolation" (or a guest network) blocks phone-to-PC traffic.', 'WARN');
        logDiagnostic('2. Windows Firewall blocks inbound UDP for the viewer browser (Wi-Fi profile set to Public).', 'WARN');
        logDiagnostic('3. A VPN or virtual adapter on the PC hides the real LAN route.', 'WARN');
        logDiagnostic('LAST RESORT: switch Media Transport Mode to "Fallback - Video through zrok" (Mode B). It works anywhere but consumes zrok quota.', 'INFO');
      }
    },
    onControlInput: (inputEvent) => {
      if (!controlToggle || !controlToggle.checked) {
        return;
      }
      if (!activeControllerId || activeControllerId !== viewerId) {
        logDiagnostic(`[CONTROL:${viewerId}] Blocked control input: viewer is not active controller lease holder (active=${activeControllerId}).`, 'WARN');
        return;
      }
      forwardInputToLocalHelper(inputEvent);
    },
    onControlChannelStateChange: (state) => {
      logDiagnostic(`[CONTROL:${viewerId}] DataChannel state: ${state}`, 'INFO');
    }
  });

  peer.createPeerConnection();
  peer.createControlDataChannel();

  // Add captured tracks
    // Add captured tracks and enforce full‑resolution encoding
    if (cameraManager.currentStream) {
      cameraManager.currentStream.getTracks().forEach((track) => {
        logDiagnostic(`[MEDIA:${viewerId}] Added local ${track.kind} track to peer (${track.label || 'camera'}).`, 'INFO');
        const sender = peer.addTrack(track, cameraManager.currentStream);
        if (track.kind === 'video') {
          track.contentHint = getContentHintForCurrentSource();
        }
        if (track.kind === 'video' && sender) {
          encoderEvaluatedViewers.delete(viewerId);
          const preferredMime = getPreferredVideoMime();
          if (preferredMime && peer.preferVideoCodec(preferredMime)) {
            logDiagnostic(`[ENCODER:${viewerId}] Offering ${preferredMime.replace('video/', '')} first (GPU encode when available), other codecs kept as fallback.`, 'INFO');
          }
          applyViewerQualityPriority(viewerId, peer);
        }
      });
    }

  // Flush any remote candidates that arrived before peer was ready for this viewer
  const queuedCandidates = pendingCandidatesByViewer.get(viewerId);
  if (queuedCandidates && queuedCandidates.length > 0) {
    logDiagnostic(`[ICE:${viewerId}] Flushing ${queuedCandidates.length} queued remote candidate(s)...`, 'INFO');
    while (queuedCandidates.length > 0) {
      const cand = queuedCandidates.shift();
      peer.addIceCandidate(cand);
    }
  }

  viewerPeers.set(viewerId, peer);
  return peer;
}

async function initiateWebRtcConnectionForViewer(viewerId) {
  logDiagnostic(`[SDP] Creating WebRTC offer for viewer ${viewerId}...`, 'INFO');
  const iceServers = await fetchIceServers();
  await hardwareH264Detection;
  const peer = createSenderPeerForViewer(viewerId, iceServers);

  try {
    const offer = await peer.createOffer();
    logDiagnostic(`[SDP] Local SDP offer created for ${viewerId}. Emitting via Socket.IO...`, 'INFO');
    socket.emit('webrtc:offer', {
      sdp: offer.sdp,
      type: offer.type,
      targetId: viewerId
    });
    logDiagnostic(`[SDP] Sent SDP offer to viewer ${viewerId}.`, 'INFO');
  } catch (err) {
    logDiagnostic(`[SDP:${viewerId}] Error creating offer: ${err.message}`, 'ERROR');
  }
}

function ensureSocket() {
  if (typeof io !== 'function') {
    return null;
  }
  if (!socket) {
    socket = io();
    setupSocketListeners();
  } else if (!socket.connected) {
    socket.connect();
  }
  if (socket) {
    getChatManager().setSocket(socket);
  }
  return socket;
}

function setupSocketListeners() {
  socket.on('connect', () => {
    logDiagnostic(`[SOCKET] Connected to signaling server (ID: ${socket.id})`, 'INFO');
    // The very first connect is already covered by startSession()'s room:join; rejoining here would send every viewer two offers.
    if (isStreamingRequested && activeRoomId && hasJoinedRoom) {
      logDiagnostic(`[AutoReconnect] Socket connected while streaming active. Automatically rejoining room "${activeRoomId}"...`, 'INFO');
      rejoinRoomAsSender();
    }
  });

  socket.on('disconnect', (reason) => {
    logDiagnostic(`[SOCKET] Disconnected from signaling server (${reason})`, 'WARN');
    stopStatsPolling();
    if (isStreamingRequested) {
      logDiagnostic(`[AutoReconnect] Unexpected disconnection (${reason}). Auto-reconnecting in background...`, 'WARN');
      updateStatus('connecting', 'Connection Lost - Reconnecting...');
      for (const peer of viewerPeers.values()) {
        try { peer.close(); } catch {}
      }
      viewerPeers.clear();
      pendingCandidatesByViewer.clear();
      scheduleAutoRejoin(2000);
    } else {
      updateStatus('disconnected', 'Server Disconnected');
    }
  });

  socket.on('sender:evicted', () => {
    logDiagnostic('[ROOM] Another sender took over this room. Stopping this sender to avoid a reconnect loop.', 'WARN');
    const evictedSocket = socket;
    stopSession();
    if (evictedSocket) {
      evictedSocket.off();
      evictedSocket.disconnect();
    }
    socket = null;
    showError('Another sender joined this room and replaced this one. Close the other sender page, or use a different Room ID, then press Start again.');
  });

  socket.on('connect_error', (err) => {
    logDiagnostic(`[SOCKET] Connection error: ${err.message}`, 'ERROR');
    if (isStreamingRequested) {
      updateStatus('connecting', 'Reconnecting to Server...');
      scheduleAutoRejoin(3000);
    }
  });

  socket.on('mjpeg:demand', (data) => {
    if (data && data.active) {
      logDiagnostic('[MJPEG] Python/HTTP consumer connected - uploading JPEG frames.', 'INFO');
      startMjpegFrameLoop();
    } else {
      logDiagnostic('[MJPEG] No Python/HTTP consumer - frame upload paused.', 'INFO');
      stopMjpegFrameLoop();
    }
  });

  socket.on('peer:joined', async (data) => {
    const joinedId = data.peerId;
    broadcastBatteryToViewers();
    logDiagnostic(`[ROOM] Viewer joined (${joinedId}) [mode: ${data.mediaMode || currentMediaMode}].`, 'INFO');
    if (currentMediaMode === 'tunnel-relay') {
      updateStatus('live', 'Live (zrok Tunnel Relay)');
      if (!tunnelInterval) {
        startTunnelFrameLoop();
      }
    } else {
      updateStatus('connecting', 'Viewer Joined. Connecting WebRTC...');
      await initiateWebRtcConnectionForViewer(joinedId);
    }
  });

  socket.on('webrtc:offer', async (data) => {
    const senderId = data.senderId;
    logDiagnostic(`[SDP] Received SDP offer from receiver ${senderId || 'unknown'}. Creating answer...`, 'INFO');
    const iceServers = await fetchIceServers();
    const peer = createSenderPeerForViewer(senderId || 'default', iceServers);

    try {
      const answer = await peer.handleOffer(data);
      socket.emit('webrtc:answer', {
        sdp: answer.sdp,
        type: answer.type,
        targetId: senderId
      });
      logDiagnostic(`[SDP] Sent SDP answer to receiver ${senderId || 'unknown'}.`, 'INFO');
    } catch (err) {
      logDiagnostic(`[SDP] Error answering offer: ${err.message}`, 'ERROR');
    }
  });

  socket.on('webrtc:answer', async (data) => {
    const viewerId = data.senderId;
    logDiagnostic(`[SDP] Received SDP answer from viewer ${viewerId || 'default'}. Setting remote description...`, 'INFO');
    let peer = viewerId ? viewerPeers.get(viewerId) : null;
    if (!peer && viewerPeers.size === 1) {
      peer = viewerPeers.values().next().value;
    }

    if (peer) {
      try {
        await peer.handleAnswer(data);
        logDiagnostic(`[SDP] Remote description set successfully for viewer ${viewerId || 'default'}.`, 'INFO');
      } catch (err) {
        logDiagnostic(`[SDP] Error setting remote answer: ${err.message}`, 'ERROR');
      }
    } else {
      logDiagnostic('[SDP] Warning: received answer but no peer connection active for this viewer.', 'WARN');
    }
  });

  socket.on('webrtc:ice-candidate', async (data) => {
    const viewerId = data.senderId;
    logDiagnostic(`[ICE] Received remote candidate from ${viewerId || 'default'}: ${parseCandidateSummary(data.candidate)}`, 'INFO');
    let peer = viewerId ? viewerPeers.get(viewerId) : null;
    if (!peer && viewerPeers.size === 1) {
      peer = viewerPeers.values().next().value;
    }

    if (peer) {
      await peer.addIceCandidate(data);
    } else {
      const key = viewerId || 'default';
      if (!pendingCandidatesByViewer.has(key)) {
        pendingCandidatesByViewer.set(key, []);
      }
      pendingCandidatesByViewer.get(key).push(data);
      logDiagnostic(`[ICE] Queued remote candidate for viewer ${key}: ${parseCandidateSummary(data.candidate)}`, 'INFO');
    }
  });

  socket.on('viewer:quality-priority', async (data) => {
    if (!data || !data.viewerId || !isQualityMode(data.mode)) {
      return;
    }
    if (viewerQualityPriority.get(data.viewerId) === data.mode) {
      return;
    }
    viewerQualityPriority.set(data.viewerId, data.mode);
    logDiagnostic(`[ROOM] Viewer ${data.viewerId} requested constant ${describeQualityMode(data.mode)}.`, 'INFO');
    const peer = viewerPeers.get(data.viewerId);
    if (peer) {
      await applyViewerQualityPriority(data.viewerId, peer, { armGrace: true });
    }
  });

  socket.on('peer:left', (data) => {
    const leftId = data ? data.peerId : null;
    logDiagnostic(`[ROOM] Viewer ${leftId || ''} left the room.`, 'INFO');

    if (leftId) {
      if (viewerPeers.has(leftId)) {
        viewerPeers.get(leftId).close();
        viewerPeers.delete(leftId);
      }
      pendingCandidatesByViewer.delete(leftId);
      viewerQualityPriority.delete(leftId);
      viewerAbrState.delete(leftId);
      encoderEvaluatedViewers.delete(leftId);
    } else {
      // Clear all
      for (const peer of viewerPeers.values()) {
        peer.close();
      }
      viewerPeers.clear();
      pendingCandidatesByViewer.clear();
      viewerQualityPriority.clear();
      viewerAbrState.clear();
      encoderEvaluatedViewers.clear();
    }

    updateStreamingStatus();
    if (viewerPeers.size === 0) {
      stopStatsPolling();
    }
  });

  socket.on('room:error', (data) => {
    showError(data.message);
    logDiagnostic(`[ROOM] Signaling error: ${data.message}`, 'ERROR');
  });

  socket.on('intercom:message', (data) => {
    logDiagnostic(`[INTERCOM] Received message from viewer: ${data.message}`, 'INFO');
    playIntercomChime();
    showInfo(`🔔 Intercom chime from viewer!`);
    setTimeout(clearInfo, 3500);
  });

  socket.on('control:controller-joined', (data) => {
    logDiagnostic(`[CONTROL] Controller joined: ${data.controllerId} (reconnected: ${Boolean(data.reconnected)})`, 'INFO');
    activeControllerId = data.controllerId;
    updateControlUIState({
      hasController: true,
      controllerId: data.controllerId,
      inGrace: false
    });
    probeControlHelper(true);
  });

  socket.on('control:controller-left', (data) => {
    logDiagnostic(`[CONTROL] Controller left: ${data.controllerId} (${data.reason})`, 'INFO');
    if (activeControllerId === data.controllerId) {
      activeControllerId = null;
    }
    updateControlUIState({
      hasController: false,
      controllerId: null,
      inGrace: false
    });
  });

  socket.on('control:controller-disconnected', (data) => {
    logDiagnostic(`[CONTROL] Controller disconnected: ${data.controllerId} (inGrace: ${Boolean(data.inGrace)})`, 'WARN');
    updateControlUIState({
      hasController: true,
      controllerId: data.controllerId,
      inGrace: Boolean(data.inGrace)
    });
  });

  socket.on('control:state', (data) => {
    if (typeof data.enabled === 'boolean' && controlToggle) {
      controlToggle.checked = data.enabled;
    }
    if (data.controllerId !== undefined) {
      activeControllerId = data.controllerId;
    } else if (data.hasController === false) {
      activeControllerId = null;
    }
    updateControlUIState(data);
    if (data.enabled) {
      probeControlHelper(true);
    }
  });

  socket.on('control:input', (data) => {
    const inputEvent = data && data.event ? data.event : data;
    const controllerId = data && data.controllerId ? data.controllerId : null;
    if (!controlToggle || !controlToggle.checked) {
      return;
    }
    if (controllerId && controllerId !== activeControllerId) {
      logDiagnostic(`[CONTROL] Blocked signaling input from non-leaseholder ${controllerId}.`, 'WARN');
      return;
    }
    if (!activeControllerId) {
      logDiagnostic('[CONTROL] Blocked signaling input: no active controller lease.', 'WARN');
      return;
    }
    forwardInputToLocalHelper(inputEvent);
  });

  socket.on('studio:activate', (data) => {
    const viewerId = data && data.viewerId;
    if (viewerId) {
      logDiagnostic(`[Studio] Activated as primary broadcast camera. Connecting to viewer ${viewerId}...`, 'INFO');
      initiateWebRtcConnectionForViewer(viewerId);
    }
  });
}

function playIntercomChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(587.33, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    // Non-fatal
  }
}

function startStatsPolling() {
  stopStatsPolling();
  statsInterval = setInterval(async () => {
    if (viewerPeers.size > 0) {
      let aggregatedFps = 0;
      let primaryPath = null;
      let primaryRtt = null;
      for (const [vId, peer] of viewerPeers.entries()) {
        const stats = await peer.getStatsReport();
        if (stats) {
          if (stats.framesPerSecond) {
            aggregatedFps = Math.max(aggregatedFps, stats.framesPerSecond);
          }
          if (stats.pathKind && !primaryPath) {
            primaryPath = stats.pathKind;
          }
          if (stats.rtt && !primaryRtt) {
            primaryRtt = stats.rtt;
          }
          evaluateVideoEncoder(vId, stats);
          if (stats.rtt) {
            logSenderStats('STATS', vId, peer, stats);
          }

          // Adaptive bitrate: a level change needs two consecutive RTT samples; only 'fps' viewers get a smaller picture
          const abrStep = stepAbr(getAbrState(vId), stats.rawRttMs);
          if (abrStep.changed) {
            const viewerMode = viewerQualityPriority.get(vId) || DefaultQualityMode;
            const ceilingBps = peer.qualityCeilingBps || getRecommendedBitrateHints(viewerMode).encodingMaxBitrateBps;
            const limits = getAbrLimits(abrStep.level, viewerMode, ceilingBps);
            await peer.applyBitrateLimit(limits.maxBitrateBps, limits.scaleResolutionDownBy);
            logDiagnostic(`[ABR:${vId}] RTT ${stats.rawRttMs} ms: ${abrStep.previousLevel} -> ${abrStep.level} (max ${(limits.maxBitrateBps / 1000000).toFixed(1)} Mbps, scale ${limits.scaleResolutionDownBy}).`, abrStep.level === AbrLevel.Ok ? 'INFO' : 'WARN');
            if (abrStep.level === AbrLevel.Ok) {
              await applyViewerQualityPriority(vId, peer, { armGrace: true });
            }
          }
        }
      }

      if (primaryPath) {
        setPathIndicator(primaryPath);
        if (primaryPath !== lastLoggedPathKind) {
          lastLoggedPathKind = primaryPath;
          const description = describePath(primaryPath);
          logDiagnostic(`[PATH] ${description ? description.text : primaryPath}`, primaryPath === 'lan' ? 'INFO' : 'WARN');
        }
      }

      updateVitals({
        fps: aggregatedFps ? Math.round(aggregatedFps) : null,
        resolution: (localVideo.videoWidth && localVideo.videoHeight) ? `${localVideo.videoWidth} × ${localVideo.videoHeight}` : null,
        path: primaryPath,
        viewers: getConnectedViewerCount(),
        rtt: primaryRtt
      });
    }
  }, 4000);
}

function stopStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

function startMjpegFrameLoop() {
  stopMjpegFrameLoop();
  // Capture frame every 66ms (~15 FPS), only while an HTTP/Python consumer is connected
  mjpegInterval = setInterval(() => {
    if (!socket || !localVideo || !cameraManager.currentStream || localVideo.readyState < 2 || mjpegIsEncoding) {
      return;
    }

    const sourceWidth = localVideo.videoWidth || 640;
    const sourceHeight = localVideo.videoHeight || 480;
    const scale = Math.min(1, MjpegMaxWidth / sourceWidth);
    const videoWidth = Math.round(sourceWidth * scale);
    const videoHeight = Math.round(sourceHeight * scale);

    // Resize canvas if dimensions changed
    if (mjpegCanvas.width !== videoWidth || mjpegCanvas.height !== videoHeight) {
      mjpegCanvas.width = videoWidth;
      mjpegCanvas.height = videoHeight;
    }

    mjpegIsEncoding = true;
    mjpegContext.drawImage(localVideo, 0, 0, videoWidth, videoHeight);
    mjpegCanvas.toBlob((blob) => {
      if (!blob || !socket) {
        mjpegIsEncoding = false;
        return;
      }
      blob.arrayBuffer().then((buffer) => {
        if (buffer.byteLength <= MjpegMaxFrameBytes) {
          socket.emit('mjpeg:frame', buffer);
        } else {
          logDiagnostic(`[MJPEG] Skipped oversized frame (${Math.round(buffer.byteLength / 1024)} KB).`, 'WARN');
        }
        mjpegIsEncoding = false;
      }).catch(() => {
        mjpegIsEncoding = false;
      });
    }, 'image/jpeg', 0.7);
  }, 66);
}

function stopMjpegFrameLoop() {
  if (mjpegInterval) {
    clearInterval(mjpegInterval);
    mjpegInterval = null;
  }
  mjpegIsEncoding = false;
}

function startTunnelFrameLoop() {
  stopTunnelFrameLoop();
  stopStatsPolling();

  tunnelStartTime = Date.now();
  tunnelFramesSent = 0;
  tunnelBytesSent = 0;
  tunnelEncodeTimes = [];

  const resVal = tunnelResolutionSelect ? tunnelResolutionSelect.value : '640x360';
  let targetWidth = 640;
  let targetHeight = 360;
  if (resVal === 'native') {
    targetWidth = localVideo.videoWidth || 1280;
    targetHeight = localVideo.videoHeight || 720;
  } else {
    const parts = resVal.split('x').map((n) => parseInt(n, 10));
    const boundW = parts[0] || 640;
    const boundH = parts[1] || 360;
    const srcW = localVideo.videoWidth || boundW;
    const srcH = localVideo.videoHeight || boundH;
    const scale = Math.min(boundW / srcW, boundH / srcH, 1);
    targetWidth = Math.round(srcW * scale) || boundW;
    targetHeight = Math.round(srcH * scale) || boundH;
  }
  const targetFps = parseInt(tunnelFpsSelect ? tunnelFpsSelect.value : '10', 10);
  const targetQuality = parseFloat(tunnelQualitySelect ? tunnelQualitySelect.value : '0.6');
  const intervalMs = Math.floor(1000 / targetFps);

  tunnelCanvas.width = targetWidth;
  tunnelCanvas.height = targetHeight;

  logDiagnostic(`Starting experimental tunnel relay loop: ${targetWidth}x${targetHeight} @ ${targetFps} FPS (Q=${targetQuality})`);

  tunnelInterval = setInterval(() => {
    if (!socket || !localVideo || !cameraManager.currentStream || localVideo.readyState < 2 || tunnelIsEncoding) {
      return;
    }

    tunnelIsEncoding = true;
    const encodeStart = performance.now();

    tunnelContext.drawImage(localVideo, 0, 0, targetWidth, targetHeight);
    tunnelCanvas.toBlob((blob) => {
      const encodeDuration = performance.now() - encodeStart;
      tunnelEncodeTimes.push(encodeDuration);
      if (tunnelEncodeTimes.length > 30) tunnelEncodeTimes.shift();

      if (blob && socket) {
        blob.arrayBuffer().then((buffer) => {
          if (buffer.byteLength > TunnelMaxFrameBytes) {
            logDiagnostic(`[Tunnel] Skipped frame of ${Math.round(buffer.byteLength / 1024)} KB (limit ${Math.round(TunnelMaxFrameBytes / 1024)} KB). Lower the tunnel resolution or JPEG quality.`, 'WARN');
          } else {
            socket.emit('tunnel:frame', buffer);
            tunnelFramesSent += 1;
            tunnelBytesSent += buffer.byteLength;
          }
          tunnelIsEncoding = false;
        }).catch(() => {
          tunnelIsEncoding = false;
        });
      } else {
        tunnelIsEncoding = false;
      }
    }, 'image/jpeg', targetQuality);
  }, intervalMs);

  // Poll diagnostics for tunnel mode
  statsInterval = setInterval(() => {
    const elapsedSecs = Math.max(1, Math.round((Date.now() - tunnelStartTime) / 1000));
    const avgFps = (tunnelFramesSent / elapsedSecs).toFixed(1);
    const avgEncodeMs = tunnelEncodeTimes.length > 0
      ? (tunnelEncodeTimes.reduce((a, b) => a + b, 0) / tunnelEncodeTimes.length).toFixed(1)
      : '0.0';
    const mbSent = (tunnelBytesSent / (1024 * 1024)).toFixed(2);
    const estMbPerHour = ((tunnelBytesSent / elapsedSecs) * 3600 / (1024 * 1024)).toFixed(1);

    logDiagnostic(
      `[Tunnel Stats] Elapsed: ${elapsedSecs}s | Sent: ${tunnelFramesSent} frames (${avgFps} FPS) | ` +
      `Data: ${mbSent} MB (Est: ${estMbPerHour} MB/hr) | Encode: ${avgEncodeMs}ms`
    );

    updateVitals({
      fps: Math.round(parseFloat(avgFps) || 0),
      resolution: (tunnelResolutionSelect && tunnelResolutionSelect.value !== 'native') ? tunnelResolutionSelect.value : (localVideo ? `${localVideo.videoWidth} × ${localVideo.videoHeight}` : null),
      path: 'tunnel-relay',
      viewers: 1
    });
  }, 4000);
}

function stopTunnelFrameLoop() {
  if (tunnelInterval) {
    clearInterval(tunnelInterval);
    tunnelInterval = null;
  }
  tunnelIsEncoding = false;
}

function stopSession() {
  logDiagnostic('Stopping stream and releasing camera...');
  stopWatchdog();
  if (autoRejoinTimer) {
    clearTimeout(autoRejoinTimer);
    autoRejoinTimer = null;
  }
  isRejoining = false;
  isStreamingRequested = false;
  hasJoinedRoom = false;
  getChatManager().setRoom(null);
  stopStatsPolling();
  stopMjpegFrameLoop();
  stopTunnelFrameLoop();

  updateVitals({
    fps: null,
    resolution: null,
    path: null,
    viewers: 0,
    rtt: null
  });

  if (appWorkspace) {
    appWorkspace.classList.remove('streaming-active');
  }
  const senderVideoHudStop = document.getElementById('senderVideoHud');
  if (senderVideoHudStop) {
    senderVideoHudStop.style.display = 'none';
  }
  if (btnToggleFacing) {
    btnToggleFacing.style.display = 'inline-flex';
  }

  if (setupFormBody) {
    setupFormBody.style.display = 'block';
  }
  if (btnToggleSetup) {
    btnToggleSetup.style.display = 'none';
    btnToggleSetup.textContent = 'Collapse';
  }
  if (btnHudTorch) {
    btnHudTorch.style.display = 'none';
    btnHudTorch.style.color = 'inherit';
    torchActive = false;
  }

  if (pythonLinkCard) {
    pythonLinkCard.style.display = 'none';
  }
  if (shareQrCard) {
    shareQrCard.style.display = 'none';
  }
  if (localViewerCard) {
    localViewerCard.style.display = 'none';
  }
  setPathIndicator(null);
  lastLoggedPathKind = null;

  if (socket) {
    socket.emit('stream:state', { state: 'stopped' });
    socket.emit('room:leave');
  }

  for (const peer of viewerPeers.values()) {
    peer.close();
  }
  viewerPeers.clear();
  pendingCandidatesByViewer.clear();
  viewerQualityPriority.clear();
  viewerAbrState.clear();
  encoderEvaluatedViewers.clear();

  cleanupSourceVideoElement();
  cameraManager.stopCapture();
  if (localVideo && localVideo.srcObject) {
    localVideo.srcObject = null;
  }
  if (videoOverlay) {
    videoOverlay.style.display = 'block';
  }

  wakeLockController.release().catch(() => {});
  if (streamRecorder && streamRecorder.isRecording) {
    streamRecorder.stop();
  }
  updateHardwareCapabilitiesUI();

  if (btnStart) {
    btnStart.disabled = false;
    btnStart.style.display = 'inline-flex';
  }
  if (btnStop) {
    btnStop.disabled = true;
    btnStop.style.display = 'none';
  }
  updateStatus('stopped', 'Stopped');
  logDiagnostic('Capture and session stopped.');
}

if (btnStart) {
  btnStart.addEventListener('click', startSession);
}
if (btnStop) {
  btnStop.addEventListener('click', () => {
    logDiagnostic('User clicked "Stop Streaming" (manual stop).', 'INFO');
    isStreamingRequested = false;
    if (autoRejoinTimer) {
      clearTimeout(autoRejoinTimer);
      autoRejoinTimer = null;
    }
    stopSession();
  });
}

// Sharing a screen means switching to another window, which hides this tab. A full rejoin would tear down healthy
// viewer connections (and renegotiate every viewer), so only re-offer to viewers whose connection actually died.
const repairsInFlight = new Set();
const DisconnectedRepairDelayMs = 5000;

async function repairViewerPeer(viewerId, state) {
  if (repairsInFlight.has(viewerId)) {
    return;
  }
  repairsInFlight.add(viewerId);
  try {
    logDiagnostic(`[Lifecycle] Viewer ${viewerId} connection is ${state}; re-offering to this viewer only.`, 'INFO');
    await initiateWebRtcConnectionForViewer(viewerId);
  } finally {
    repairsInFlight.delete(viewerId);
  }
}

// 'disconnected' often heals by itself within seconds after a tab switch, so it is only repaired if it persists.
async function repairUnhealthyViewerPeers() {
  for (const [viewerId, peer] of Array.from(viewerPeers.entries())) {
    const state = peer.peerConnection ? peer.peerConnection.connectionState : 'closed';
    if (state === 'failed' || state === 'closed') {
      await repairViewerPeer(viewerId, state);
    } else if (state === 'disconnected') {
      setTimeout(() => {
        const current = viewerPeers.get(viewerId);
        if (current === peer && current.peerConnection && current.peerConnection.connectionState !== 'connected') {
          repairViewerPeer(viewerId, 'disconnected');
        }
      }, DisconnectedRepairDelayMs);
    }
  }
}

function canRepairViewersInPlace() {
  if (!sourceSelect || sourceSelect.value !== 'screen' || viewerPeers.size === 0) {
    return false;
  }
  return Boolean(cameraManager.currentStream &&
    cameraManager.currentStream.getVideoTracks().some((t) => t.readyState === 'live'));
}

// Mobile screen wake / app return / network online listeners
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isStreamingRequested) {
    logDiagnostic('[Lifecycle] Screen/tab became visible. Verifying stream health...', 'INFO');
    wakeLockController.request().catch(() => {});
    if (localVideo && localVideo.paused) {
      localVideo.play().catch(() => {});
    }
    if (!socket || !socket.connected) {
      if (socket) socket.connect();
    } else if (canRepairViewersInPlace()) {
      repairUnhealthyViewerPeers();
    } else if (!hasJoinedRoom) {
      rejoinRoomAsSender();
    }
  }
});

window.addEventListener('online', () => {
  if (isStreamingRequested) {
    logDiagnostic('[Lifecycle] Network connection restored (online). Re-establishing stream...', 'INFO');
    if (!socket || !socket.connected) {
      if (socket) socket.connect();
    } else {
      rejoinRoomAsSender();
    }
  }
});

if (btnToggleFacing) {
  btnToggleFacing.addEventListener('click', async () => {
    const newFacing = cameraManager.toggleFacingMode();
    logDiagnostic(`Switched facing mode to ${newFacing}`);
    if (isStreamingActive() && (!sourceSelect || sourceSelect.value === 'webcam')) {
      await applyDynamicSourceChange();
    }
  });
}

// Window unload cleanup
window.addEventListener('beforeunload', () => {
  stopSession();
});

// Initialize default state
setupDiagnosticsControls('btnCopyLogs', 'btnClearLogs', 'diagnosticsLog');
setupCollapsibleDrawer('btnToggleDiagnostics', 'diagnosticsLog', '📋 Technical Vitals & Diagnostics ▼', '📋 Technical Vitals & Diagnostics ▲');
if (roomIdInput) {
  roomIdInput.value = generateRandomRoomId();
}
populateCameraDevices();
fetchIceServers().catch(() => {});

mdnsController = setupMdnsWarningAndGuidance();
const btnOpenMdnsGuideFromCard = document.getElementById('btnOpenMdnsGuideFromCard');
if (btnOpenMdnsGuideFromCard && mdnsController) {
  btnOpenMdnsGuideFromCard.addEventListener('click', () => {
    mdnsController.openModal();
  });
}

// URL query parameters parsing for auto-connect & prefilling
const streamParams = parseUrlStreamParams();
if (streamParams.roomId && roomIdInput) {
  roomIdInput.value = streamParams.roomId;
}
if (streamParams.pin && accessPinInput) {
  accessPinInput.value = streamParams.pin;
}
if (streamParams.mode && mediaModeSelect) {
  mediaModeSelect.value = streamParams.mode;
}
if (streamParams.autostart) {
  logDiagnostic(`[AutoStart] Autostart query parameter detected. Launching capture for room "${streamParams.roomId}"...`, 'INFO');
  setTimeout(() => {
    startSession();
  }, 400);
}

ensureSocket();
logDiagnostic('Sender client ready. Click "Start Streaming" to begin.');


function updateViewerShareCard(targetRoomId, targetPin) {
  const shareRoomCode = document.getElementById('shareRoomCode');
  const sharePinCode = document.getElementById('sharePinCode');
  const chkIncludePin = document.getElementById('chkIncludePinInLink');
  const shareLinkModeLabel = document.getElementById('shareLinkModeLabel');

  if (shareRoomCode) {
    shareRoomCode.textContent = targetRoomId || '------';
  }
  if (sharePinCode) {
    sharePinCode.textContent = targetPin || '123456';
  }

  const includePin = chkIncludePin ? chkIncludePin.checked : true;
  let viewerUrl = '';
  if (includePin) {
    viewerUrl = `${window.location.origin}/viewer?room=${encodeURIComponent(targetRoomId)}&pin=${encodeURIComponent(targetPin || '')}&autostart=1`;
    if (shareLinkModeLabel) {
      shareLinkModeLabel.textContent = 'Auto-joins directly';
      shareLinkModeLabel.style.color = 'var(--accent-emerald)';
    }
  } else {
    viewerUrl = `${window.location.origin}/viewer?room=${encodeURIComponent(targetRoomId)}`;
    if (shareLinkModeLabel) {
      shareLinkModeLabel.textContent = 'Room only — send PIN separately';
      shareLinkModeLabel.style.color = 'var(--accent-amber)';
    }
  }

  if (viewerQrLink) {
    viewerQrLink.href = viewerUrl;
    viewerQrLink.textContent = viewerUrl;
  }
  if (viewerQrLinkInput) {
    viewerQrLinkInput.value = viewerUrl;
  }
  if (shareQrCard) {
    shareQrCard.style.display = 'flex';
  }

  fetch(`/api/qr?text=${encodeURIComponent(viewerUrl)}`)
    .then((res) => res.json())
    .then((data) => {
      if (viewerQrImg && data.dataUrl) {
        viewerQrImg.src = data.dataUrl;
      }
    })
    .catch(() => {});
}

const chkIncludePin = document.getElementById('chkIncludePinInLink');
if (chkIncludePin) {
  chkIncludePin.addEventListener('change', () => {
    if (hasJoinedRoom && currentRoomId) {
      updateViewerShareCard(currentRoomId, currentAccessPin);
    }
  });
}

// Gated Developer Mode Diagnostics for Sender
const devToolsSection = document.getElementById('devToolsSection');
const btnToggleDevMode = document.getElementById('btnToggleDevMode');
const isDevUrl = window.location.search.includes('dev=1') || window.location.search.includes('dev=true');
let isDevStored = false;
try {
  isDevStored = localStorage.getItem('lancam_dev_mode') === 'true';
} catch (_) {}

if (devToolsSection && (isDevUrl || isDevStored)) {
  devToolsSection.style.display = 'block';
  if (btnToggleDevMode) {
    btnToggleDevMode.textContent = '⚙ Hide Developer Diagnostics';
  }
}
if (btnToggleDevMode && devToolsSection) {
  btnToggleDevMode.addEventListener('click', () => {
    const isCurrentlyShown = devToolsSection.style.display !== 'none';
    devToolsSection.style.display = isCurrentlyShown ? 'none' : 'block';
    btnToggleDevMode.textContent = isCurrentlyShown ? '⚙ Developer Diagnostics' : '⚙ Hide Developer Diagnostics';
    try {
      localStorage.setItem('lancam_dev_mode', isCurrentlyShown ? 'false' : 'true');
    } catch (_) {}
  });
}

const initSenderVideoHud = document.getElementById('senderVideoHud');
if (initSenderVideoHud) {
  initSenderVideoHud.style.display = 'none';
}
if (btnToggleFacing) {
  btnToggleFacing.style.display = 'inline-flex';
}
