/**
 * @file sender.js
 * Sender client controller: handles camera capture, Socket.IO signaling,
 * and WebRTC peer connection to viewer.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic, parseCandidateSummary, setupDiagnosticsControls, setPathIndicator, describePath, isLocalHostname, fetchLocalServerOrigin, updateVitals, captureFrameSnapshot, copyTextToClipboard, setupCollapsibleDrawer, setupPasswordToggle, StreamRecorder, WakeLockController, StreamTransformController, parseUrlStreamParams, buildShareUrl } from './ui-utils.js';
import { CameraManager } from './camera-manager.js';
import { WebRtcPeer } from './webrtc-peer.js';
import { BatteryMonitor } from './battery-monitor.js';

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
let isRejoining = false;
let autoRejoinTimer = null;
let watchdogInterval = null;
let activeRoomId = null;
let activePin = null;
let isStudioSender = false;

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
// Show/hide appropriate input based on selected source and apply dynamic switch
function updateSourceInputsVisibility() {
  const value = sourceSelect ? sourceSelect.value : 'webcam';
  if (value === 'file') {
    if (fileInputGroup) { fileInputGroup.style.display = 'block'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'none'; }
  } else if (value === 'url') {
    if (fileInputGroup) { fileInputGroup.style.display = 'none'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'block'; }
  } else {
    if (fileInputGroup) { fileInputGroup.style.display = 'none'; }
    if (urlInputGroup) { urlInputGroup.style.display = 'none'; }
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
    if (isStreamingActive() && (!sourceSelect || sourceSelect.value === 'webcam')) {
      await applyDynamicSourceChange();
    }
  });
}
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
const focusDistanceGroup = document.getElementById('focusDistanceGroup');
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
      cachedIceServers = data.iceServers;
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

    localVideo.srcObject = newStream;
    videoOverlay.style.display = 'none';
    await localVideo.play().catch(() => {});

    cameraManager.currentStream = newStream;

    const newVideoTrack = newStream.getVideoTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];

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
    if (sourceChoice === 'webcam') {
      const selectedDeviceId = cameraSelect.value || null;
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
      stream = await cameraManager.startCapture({
        deviceId: selectedDeviceId,
        width: targetWidth,
        height: targetHeight,
        frameRate: 30,
        withAudio
      });
    } else if (sourceChoice === 'file') {
      const file = fileInput && fileInput.files[0];
      if (!file) {
        throw new Error('No video file selected');
      }
      stream = await getLocalFileStream(file);
    } else if (sourceChoice === 'url') {
      const url = urlInput ? urlInput.value.trim() : '';
      if (!url) {
        throw new Error('No video URL provided');
      }
      stream = await getRemoteUrlStream(url);
    }

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
          videoSender.replaceTrack(videoTrack).catch(err => {
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
    btnStart.disabled = false;
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
    return;
  }

  currentRoomId = roomId;
  currentMediaMode = mediaModeSelect ? mediaModeSelect.value : 'webrtc';

  // Initialize Socket.IO connection
  if (!socket) {
    socket = io();
    setupSocketListeners();
  }

  startWatchdog();

  const role = isStudioSender ? 'studio-sender' : 'sender';
  logDiagnostic(`Joining room "${roomId}" as ${role} [mode: ${currentMediaMode}]...`);
  updateStatus('connecting', 'Joining Room...');

  socket.emit('room:join', { roomId, role, pin, mediaMode: currentMediaMode, reconnect: true }, async (response) => {
    if (!response || !response.success) {
      const errMsg = response ? response.error : 'Connection to room failed';
      showError(errMsg);
      logDiagnostic(`Join failed: ${errMsg}. Will automatically retry in 3 seconds...`, 'WARN');
      updateStatus('connecting', `Join failed (${errMsg}) - Retrying...`);
      scheduleAutoRejoin(3000);
      return;
    }

    logDiagnostic(`Joined room "${roomId}" as ${role} [mode: ${response.mediaMode}].`);
    broadcastBatteryToViewers();

    // Display Share QR Code for Viewer
    const viewerUrl = `${window.location.origin}/viewer?room=${encodeURIComponent(roomId)}`;
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

    showLocalViewerLink(roomId);

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
    reconnect: true
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

    logDiagnostic(`[AutoReconnect] Successfully rejoined room "${activeRoomId}" as ${role} [mode: ${response.mediaMode}].`, 'INFO');
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
        startStatsPolling();
      } else if (state === 'failed') {
        logDiagnostic(`[P2P:${viewerId}] Connection failed.`, 'ERROR');
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
    }
  });

  peer.createPeerConnection();

  // Add captured tracks
    // Add captured tracks and enforce full‑resolution encoding
    if (cameraManager.currentStream) {
      cameraManager.currentStream.getTracks().forEach((track) => {
        logDiagnostic(`[MEDIA:${viewerId}] Added local ${track.kind} track to peer (${track.label || 'camera'}).`, 'INFO');
        const sender = peer.addTrack(track, cameraManager.currentStream);
        if (track.kind === 'video' && sender && sender.getParameters) {
          try {
            const params = sender.getParameters();
            if (!params.encodings) { params.encodings = [{}]; }
            params.encodings[0].scaleResolutionDownBy = 1.0; // keep original resolution
            params.encodings[0].maxBitrate = 5000000; // optional higher bitrate
            // Prefer maintaining resolution over framerate when bandwidth is limited
            params.degradationPreference = 'maintain-resolution';
            sender.setParameters(params);
            logDiagnostic(`[MEDIA:${viewerId}] Enforced full‑resolution on video sender.`, 'INFO');
          } catch (e) {
            logDiagnostic(`[MEDIA:${viewerId}] Failed to set full‑resolution parameters: ${e.message}`, 'WARN');
          }
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

function setupSocketListeners() {
  socket.on('connect', () => {
    logDiagnostic(`[SOCKET] Connected to signaling server (ID: ${socket.id})`, 'INFO');
    if (isStreamingRequested && activeRoomId) {
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

  socket.on('peer:left', (data) => {
    const leftId = data ? data.peerId : null;
    logDiagnostic(`[ROOM] Viewer ${leftId || ''} left the room.`, 'INFO');

    if (leftId && viewerPeers.has(leftId)) {
      const peer = viewerPeers.get(leftId);
      peer.close();
      viewerPeers.delete(leftId);
      pendingCandidatesByViewer.delete(leftId);
    } else if (!leftId) {
      // Clear all
      for (const peer of viewerPeers.values()) {
        peer.close();
      }
      viewerPeers.clear();
      pendingCandidatesByViewer.clear();
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
          if (stats.rtt) {
            const pairInfo = `${stats.localCandidateType || '?'} (${stats.localAddress || '?'}) <-> ${stats.remoteCandidateType || '?'} (${stats.remoteAddress || '?'})`;
            logDiagnostic(`[STATS:${vId}] Pair: ${pairInfo} | RTT: ${stats.rtt} | FPS: ${stats.framesPerSecond || 'active'}`, 'INFO');
          }

          // Adaptive Bitrate (ABR) Controller
          if (stats.rawRttMs !== null) {
            if (stats.rawRttMs > 350) {
              await peer.applyBitrateLimit(600000, 2.0);
              logDiagnostic(`[ABR:${vId}] High RTT (${stats.rawRttMs}ms): Throttled to 600 kbps (0.5x scale)`, 'WARN');
            } else if (stats.rawRttMs > 150) {
              await peer.applyBitrateLimit(1500000, 1.5);
              logDiagnostic(`[ABR:${vId}] Moderate RTT (${stats.rawRttMs}ms): Scaled to 1.5 Mbps (0.66x scale)`, 'INFO');
            } else if (stats.rawRttMs < 80) {
              await peer.applyBitrateLimit(4000000, 1.0);
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
    targetWidth = parts[0] || 640;
    targetHeight = parts[1] || 360;
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
    } else {
      rejoinRoomAsSender();
    }
  }
});

window.addEventListener('online', () => {
  if (isStreamingRequested) {
    logDiagnostic('[Lifecycle] Network connection restored (online). Re-establishing stream...', 'INFO');
    if (socket) socket.connect();
    rejoinRoomAsSender();
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

logDiagnostic('Sender client ready. Click "Start Streaming" to begin.');
