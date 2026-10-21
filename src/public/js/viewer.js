/**
 * @file viewer.js
 * Viewer client controller: handles room join, Socket.IO signaling,
 * WebRTC answer creation, remote track rendering, and connection statistics.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic, parseCandidateSummary, setupDiagnosticsControls, setPathIndicator, describePath, isLocalHostname, fetchLocalServerOrigin, updateVitals, captureFrameSnapshot, copyTextToClipboard, setupCollapsibleDrawer, setupPasswordToggle, StreamRecorder, StreamTransformController, parseUrlStreamParams, buildShareUrl } from './ui-utils.js';
import { WebRtcPeer } from './webrtc-peer.js';
import { calculateVideoRenderBox, translateScreenCoordinates } from './control-coords.js';
import { ZoomController } from './zoom-controller.js';
import { MobileRemoteController } from './mobile-control.js';
import { getChatManager } from './chat.js';

let webrtcPeer = null;
let socket = null;
let currentRoomId = null;
let currentMediaMode = 'webrtc';
let statsInterval = null;
let cachedIceServers = null;
let pendingRemoteCandidates = [];
let lastLoggedPathKind = null;
let isViewerSessionActive = false;
let activeViewerPin = null;
let zoomController = null;
let mobileRemoteController = null;

// Tunnel rendering state
let tunnelIsRendering = false;
let tunnelNextFrameBlob = null;
let tunnelStartTime = 0;
let tunnelFramesReceived = 0;
let tunnelFramesDropped = 0;
let tunnelBytesReceived = 0;

// DOM Elements
const accessPinInput = document.getElementById('accessPin');
const roomIdInput = document.getElementById('roomId');
const mediaModeSelect = document.getElementById('mediaMode');
const qualityPrioritySelect = document.getElementById('qualityPriority');
const QualityPriorityStorageKey = 'lancam_quality_priority';
const btnJoin = document.getElementById('btnJoin');
const btnLeave = document.getElementById('btnLeave');
const btnFullscreen = document.getElementById('btnFullscreen');
const remoteVideo = document.getElementById('remoteVideo');
const remoteCanvas = document.getElementById('remoteCanvas');
const videoOverlay = document.getElementById('videoOverlay');
const videoWrapper = document.getElementById('videoWrapper');
const appWorkspace = document.getElementById('appWorkspace');
const joinCard = document.getElementById('joinCard');
const viewerSessionActivePanel = document.getElementById('viewerSessionActivePanel');
const activeViewerRoomVal = document.getElementById('activeViewerRoomVal');
const pythonLinkCard = document.getElementById('pythonLinkCard');
const pythonStreamUrl = document.getElementById('pythonStreamUrl');
const btnCopyPythonUrl = document.getElementById('btnCopyPythonUrl');
const localViewerHint = document.getElementById('localViewerHint');
const localViewerHintLink = document.getElementById('localViewerHintLink');
const btnHudPip = document.getElementById('btnHudPip');
const btnHudSnapshot = document.getElementById('btnHudSnapshot');
const btnHudFullscreen = document.getElementById('btnHudFullscreen');
const btnOverlayReconnect = document.getElementById('btnOverlayReconnect');
const overlayTitle = document.getElementById('overlayTitle');
const overlaySubtitle = document.getElementById('overlaySubtitle');
const roomHintBadge = document.getElementById('roomHintBadge');
const btnSetWebcam = document.getElementById('btnSetWebcam');
const btnDownloadDriver = document.getElementById('btnDownloadDriver');
const studioSwitcherBar = document.getElementById('studioSwitcherBar');
const studioCamerasList = document.getElementById('studioCamerasList');
let activeStudioCameraId = null;

const btnHudControl = document.getElementById('btnHudControl');
const hudControlPill = document.getElementById('hudControlPill');
const btnReleaseControl = document.getElementById('btnReleaseControl');
const controlModal = document.getElementById('controlModal');
const btnCloseControlModal = document.getElementById('btnCloseControlModal');
const btnCancelControlModal = document.getElementById('btnCancelControlModal');
const btnSubmitControl = document.getElementById('btnSubmitControl');
const controlCredentialInput = document.getElementById('controlCredentialInput');
const controlModalStatus = document.getElementById('controlModalStatus');

const btnSidebarRequestControl = document.getElementById('btnSidebarRequestControl');
const btnSidebarReleaseControl = document.getElementById('btnSidebarReleaseControl');
const viewerControlSidebarCard = document.getElementById('viewerControlSidebarCard');
const viewerControlStatusBadge = document.getElementById('viewerControlStatusBadge');
const viewerControlInactiveState = document.getElementById('viewerControlInactiveState');
const viewerControlActiveState = document.getElementById('viewerControlActiveState');
const viewerControlHelpText = document.getElementById('viewerControlHelpText');
const autoControlPinInput = document.getElementById('autoControlPinInput');
const btnToggleAutoControlPin = document.getElementById('btnToggleAutoControlPin');
const btnToggleControlCred = document.getElementById('btnToggleControlCred');

let isControlActive = false;
let controlSessionToken = null;
let isHostControlEnabled = false;

let rememberedRoomId = '';
let rememberedPin = '';

function getSessionLastRoom() {
  try {
    return sessionStorage.getItem('lancam_last_room') || '';
  } catch (err) {
    return '';
  }
}

function getSessionLastPin() {
  try {
    return sessionStorage.getItem('lancam_last_pin') || '';
  } catch (err) {
    return '';
  }
}

function setSessionLastRoom(roomId, pin) {
  try {
    if (roomId) {
      sessionStorage.setItem('lancam_last_room', roomId);
    }
    if (pin) {
      sessionStorage.setItem('lancam_last_pin', pin);
    }
  } catch (err) {}
}

function sendQualityPriority() {
  if (!socket || !socket.connected || !qualityPrioritySelect) {
    return;
  }
  socket.emit('viewer:quality-priority', { mode: qualityPrioritySelect.value });
  logDiagnostic(`[QUALITY] Requested constant ${qualityPrioritySelect.value === 'both' ? 'FPS and resolution' : qualityPrioritySelect.value === 'fps' ? 'FPS' : 'resolution'} from the sender.`, 'INFO');
}

if (qualityPrioritySelect) {
  try {
    const savedPriority = localStorage.getItem(QualityPriorityStorageKey);
    if (savedPriority === 'fps' || savedPriority === 'resolution' || savedPriority === 'both') {
      qualityPrioritySelect.value = savedPriority;
    }
  } catch (err) {
    // Storage unavailable (private mode); keep the default.
  }
  qualityPrioritySelect.addEventListener('change', () => {
    try {
      localStorage.setItem(QualityPriorityStorageKey, qualityPrioritySelect.value);
    } catch (err) {
      // Non-fatal: the choice still applies to this session.
    }
    sendQualityPriority();
  });
}

function showOverlay(title, subtitle, showReconnect = false) {
  if (!videoOverlay) {
    return;
  }
  if (overlayTitle) {
    overlayTitle.textContent = title;
  }
  if (overlaySubtitle) {
    overlaySubtitle.textContent = subtitle;
  }
  if (btnOverlayReconnect) {
    btnOverlayReconnect.style.display = showReconnect ? 'inline-flex' : 'none';
  }
  const overlayJoinForm = document.getElementById('overlayJoinForm');
  if (overlayJoinForm) {
    overlayJoinForm.style.display = showReconnect ? 'none' : 'block';
  }
  const videoHud = document.querySelector('.viewport-pane > .video-hud');
  if (videoHud) {
    videoHud.style.display = 'none';
  }
  if (streamVitalsBar) {
    streamVitalsBar.style.display = 'none';
  }
  videoOverlay.style.display = 'flex';
}

function isWebRtcConnected() {
  return Boolean(webrtcPeer && webrtcPeer.peerConnection && webrtcPeer.peerConnection.connectionState === 'connected');
}

function hideOverlay() {
  if (videoOverlay) {
    videoOverlay.style.display = 'none';
  }
  if (btnOverlayReconnect) {
    btnOverlayReconnect.style.display = 'none';
  }
  const videoHud = document.querySelector('.viewport-pane > .video-hud');
  if (videoHud) {
    videoHud.style.display = 'flex';
  }
  if (streamVitalsBar) {
    streamVitalsBar.style.display = 'flex';
  }
}

const canvasContext = remoteCanvas ? remoteCanvas.getContext('2d') : null;

setupPasswordToggle('btnTogglePin', 'accessPin');

let isVcamPumping = false;
let vcamPumpingInterval = null;
const vcamCanvas = document.createElement('canvas');
const vcamCtx = vcamCanvas.getContext('2d');

function pumpVcamFrame() {
  if (isVcamPumping) return;
  if (!remoteVideo || remoteVideo.readyState < 2 || remoteVideo.paused || remoteVideo.ended) return;

  const w = remoteVideo.videoWidth || 1280;
  const h = remoteVideo.videoHeight || 720;
  if (vcamCanvas.width !== w || vcamCanvas.height !== h) {
    vcamCanvas.width = w;
    vcamCanvas.height = h;
  }

  isVcamPumping = true;
  vcamCtx.drawImage(remoteVideo, 0, 0, w, h);
  vcamCanvas.toBlob((blob) => {
    if (!blob) {
      isVcamPumping = false;
      return;
    }

    const roomId = currentRoomId || (roomIdInput && roomIdInput.value.trim());
    fetch(`/api/vcam/bridge-frame?room=${encodeURIComponent(roomId)}&w=${w}&h=${h}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob
    })
      .catch(() => {})
      .finally(() => {
        isVcamPumping = false;
      });
  }, 'image/jpeg', 0.82);
}

function startVcamFramePump() {
  if (vcamPumpingInterval) return;
  vcamPumpingInterval = setInterval(pumpVcamFrame, 33); // ~30 FPS with backpressure
}

if (btnSetWebcam) {
  btnSetWebcam.addEventListener('click', () => {
    const roomId = currentRoomId || (roomIdInput && roomIdInput.value.trim());
    const pin = accessPinInput ? accessPinInput.value.trim() : '123456';
    const host = window.location.hostname || '127.0.0.1';
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

    if (!roomId) {
      showError('Please join or enter a Room ID first.');
      return;
    }

    // Start lightweight local WebRTC frame bridge pump
    startVcamFramePump();

    const deeplink = `lancam://stream?room=${encodeURIComponent(roomId)}&pin=${encodeURIComponent(pin)}&host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}`;
    logDiagnostic(`[VCAM] Triggering DirectShow WebRTC webcam deeplink: ${deeplink}`, 'INFO');

    // Trigger deeplink via hidden iframe so the main page never unloads or disconnects WebRTC
    let hiddenIframe = document.getElementById('lancam-deeplink-frame');
    if (!hiddenIframe) {
      hiddenIframe = document.createElement('iframe');
      hiddenIframe.id = 'lancam-deeplink-frame';
      hiddenIframe.style.display = 'none';
      document.body.appendChild(hiddenIframe);
    }
    hiddenIframe.src = deeplink;

    logDiagnostic('[VCAM] Webcam room saved. Choose "LAN Phone Camera" in the Windows Camera app, Teams, Zoom, Chrome, OBS or Unity (reopen the app if it was already open).', 'INFO');
    copyTextToClipboard(deeplink, btnSetWebcam, '✓ Webcam room saved');
  });
}

if (btnDownloadDriver) {
  btnDownloadDriver.addEventListener('click', (event) => {
    event.preventDefault();
    let downloadIframe = document.getElementById('lancam-download-frame');
    if (!downloadIframe) {
      downloadIframe = document.createElement('iframe');
      downloadIframe.id = 'lancam-download-frame';
      downloadIframe.style.display = 'none';
      document.body.appendChild(downloadIframe);
    }
    downloadIframe.src = '/download/lan-camera-setup';
    logDiagnostic('[VCAM] Downloading the LAN Phone Camera driver installer (lan-camera-setupv<version>.exe)...', 'INFO');
  });
}

if (btnCopyPythonUrl) {
  btnCopyPythonUrl.addEventListener('click', () => {
    if (pythonStreamUrl && pythonStreamUrl.value) {
      copyTextToClipboard(pythonStreamUrl.value, btnCopyPythonUrl, '✓ Copied!');
    }
  });
}

// Support Room ID prefill from URL query param ?room=xyz
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
  roomIdInput.value = roomParam;
  if (roomHintBadge) {
    roomHintBadge.textContent = `Room: ${roomParam}`;
    roomHintBadge.style.display = 'inline-block';
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

async function joinRoom() {
  clearError();
  clearInfo();

  let pin = accessPinInput ? accessPinInput.value.trim() : '';
  let roomId = roomIdInput ? roomIdInput.value.trim() : '';

  if (!roomId && rememberedRoomId) {
    roomId = rememberedRoomId;
    if (roomIdInput) {
      roomIdInput.value = rememberedRoomId;
    }
  } else if (!roomId) {
    const sessionRoom = getSessionLastRoom();
    if (sessionRoom) {
      roomId = sessionRoom;
      rememberedRoomId = sessionRoom;
      if (roomIdInput) {
        roomIdInput.value = sessionRoom;
      }
    }
  }

  if (!pin && rememberedPin) {
    pin = rememberedPin;
    if (accessPinInput) {
      accessPinInput.value = rememberedPin;
    }
  } else if (!pin) {
    const sessionPin = getSessionLastPin() || '123456';
    pin = sessionPin;
    rememberedPin = sessionPin;
    if (accessPinInput) {
      accessPinInput.value = sessionPin;
    }
  }

  if (!pin) {
    showError('Please enter an Access PIN.');
    return;
  }
  if (!roomId) {
    showError('Please enter the Room ID.');
    return;
  }

  btnJoin.disabled = true;
  currentMediaMode = mediaModeSelect ? mediaModeSelect.value : 'webrtc';
  updateStatus('connecting', 'Connecting to server...');
  logDiagnostic(`Connecting to signaling server for room "${roomId}" [mode: ${currentMediaMode}]...`);

  if (!socket) {
    socket = io();
    setupSocketListeners();
  }
  getChatManager().setSocket(socket);

  socket.emit('room:join', { roomId, role: 'viewer', pin, mediaMode: currentMediaMode }, async (response) => {
    if (!response || !response.success) {
      const errMsg = response ? response.error : 'Failed to join room';
      showError(errMsg);
      logDiagnostic(`Join failed: ${errMsg}`);
      btnJoin.disabled = false;
      updateStatus('disconnected', 'Join Failed');
      return;
    }

    currentRoomId = roomId;
    rememberedRoomId = roomId;
    rememberedPin = pin;
    setSessionLastRoom(roomId, pin);
    isViewerSessionActive = true;
    activeViewerPin = pin;
    btnLeave.disabled = false;
    logDiagnostic(`Joined room "${roomId}" successfully [mode: ${response.mediaMode}].`);
    getChatManager().setSocket(socket);
    getChatManager().setRoom(roomId, 'viewer');
    sendQualityPriority();

    isHostControlEnabled = Boolean(response.controlState && response.controlState.enabled);
    updateControlUIState();

    if (autoControlPinInput && autoControlPinInput.value.trim()) {
      setTimeout(() => {
        submitControlRequest(autoControlPinInput.value.trim());
      }, 500);
    }

    if (appWorkspace) {
      appWorkspace.classList.add('streaming-active');
    }
    if (joinCard) {
      joinCard.style.display = 'none';
    }
    if (viewerSessionActivePanel) {
      viewerSessionActivePanel.style.display = 'block';
    }
    if (activeViewerRoomVal) {
      activeViewerRoomVal.textContent = `Room: ${roomId}`;
    }

    hideOverlay();
    updateVitals({ path: currentMediaMode === 'tunnel-relay' ? 'tunnel-relay' : '--' });

    // Switch visible video/canvas element according to mode
    if (currentMediaMode === 'tunnel-relay') {
      if (remoteVideo) remoteVideo.style.display = 'none';
      if (remoteCanvas) remoteCanvas.style.display = 'block';
      startTunnelViewerStats();
    } else {
      if (remoteVideo) remoteVideo.style.display = 'block';
      if (remoteCanvas) remoteCanvas.style.display = 'none';
    }

    // Display Direct Python Stream Link
    const streamUrl = `${window.location.origin}/stream/${roomId}?pin=${encodeURIComponent(pin)}`;
    if (pythonStreamUrl) {
      pythonStreamUrl.value = streamUrl;
    }
    if (pythonLinkCard) {
      pythonLinkCard.style.display = 'block';
    }

    if (currentMediaMode === 'tunnel-relay') {
      if (response.hasPeer) {
        updateStatus('waiting', 'Sender present. Awaiting tunnel frames...');
        logDiagnostic('Sender is present in room, waiting for binary tunnel video frames.');
      } else {
        updateStatus('waiting', 'Waiting for Sender (Tunnel Mode)...');
        logDiagnostic('Room joined. Waiting for sender to connect.');
      }
    } else {
      if (response.hasPeer) {
        updateStatus('connecting', 'Sender present. Awaiting offer...');
        logDiagnostic('Sender is present in room, waiting for WebRTC offer.');
      } else {
        updateStatus('waiting', 'Waiting for Sender...');
        logDiagnostic('Room joined. Waiting for sender to connect.');
      }
    }
  });
}

function setupSocketListeners() {
  socket.on('peer:joined', (data) => {
    logDiagnostic(`Sender joined (${data.peerId}) [mode: ${data.mediaMode || currentMediaMode}].`);
    if (currentMediaMode === 'tunnel-relay') {
      updateStatus('waiting', 'Sender connected. Awaiting tunnel frames...');
    } else {
      updateStatus('connecting', 'Sender connected. Waiting for WebRTC offer...');
    }
  });

  socket.on('studio:cameras', ({ cameras }) => {
    if (!studioSwitcherBar || !studioCamerasList) return;
    if (!cameras || cameras.length === 0) {
      studioSwitcherBar.style.display = 'none';
      return;
    }
    studioSwitcherBar.style.display = 'flex';
    studioCamerasList.innerHTML = '';
    cameras.forEach((cam, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.camId = cam.id;
      const isAct = cam.id === activeStudioCameraId || (!activeStudioCameraId && idx === 0);
      btn.className = 'studio-cam-btn' + (isAct ? ' active' : '');
      btn.textContent = cam.label || `Cam ${idx + 1}`;
      btn.addEventListener('click', () => {
        activeStudioCameraId = cam.id;
        socket.emit('studio:switch', { cameraId: cam.id });
        const allBtns = studioCamerasList.querySelectorAll('.studio-cam-btn');
        allBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        logDiagnostic(`[Studio] Switched active camera to ${cam.label}`, 'INFO');
      });
      studioCamerasList.appendChild(btn);
    });
  });

  socket.on('studio:switched', ({ activeCameraId }) => {
    activeStudioCameraId = activeCameraId;
    if (studioCamerasList) {
      const allBtns = studioCamerasList.querySelectorAll('.studio-cam-btn');
      allBtns.forEach((b) => {
        b.classList.toggle('active', b.dataset.camId === activeCameraId);
      });
    }
    logDiagnostic(`[Studio] Active studio camera changed to ${activeCameraId}`, 'INFO');
  });

  socket.on('control:state', (data) => {
    isHostControlEnabled = Boolean(data && data.enabled);
    if (!isHostControlEnabled && isControlActive) {
      releaseControlLocally();
      showInfo('Host disabled remote desktop control.');
    }
    updateControlUIState();
  });

  socket.on('control:revoked', (data) => {
    if (isControlActive) {
      releaseControlLocally();
      showError(data && data.reason ? data.reason : 'Remote desktop control revoked by host.');
      logDiagnostic(`[CONTROL] Control lease revoked: ${data && data.reason ? data.reason : 'Revoked by host'}`, 'WARN');
    }
  });

  // Experimental zrok-tunneled binary video frame reception
  socket.on('tunnel:frame', (buffer) => {
    if (currentMediaMode !== 'tunnel-relay') {
      return;
    }

    if (tunnelStartTime === 0) {
      tunnelStartTime = Date.now();
      updateStatus('live', 'Live (zrok Tunnel Relay)');
      hideOverlay();
    }

    tunnelFramesReceived += 1;
    tunnelBytesReceived += buffer.byteLength || (buffer.length || 0);

    // Drop stale frame if rendering is currently busy
    if (tunnelIsRendering) {
      tunnelFramesDropped += 1;
      tunnelNextFrameBlob = buffer; // replace with freshest frame
      return;
    }

    renderBinaryFrame(buffer);
  });

function createViewerPeer(iceServers) {
  if (webrtcPeer) {
    webrtcPeer.close();
    webrtcPeer = null;
  }

  logDiagnostic('[P2P] Initializing RTCPeerConnection for viewer...', 'INFO');

  webrtcPeer = new WebRtcPeer({
    iceServers,
    onIceCandidate: (candidate) => {
      if (candidate) {
        logDiagnostic(`[ICE] Local candidate gathered: ${parseCandidateSummary(candidate)}`, 'INFO');
        socket.emit('webrtc:ice-candidate', {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex
        });
      } else {
        logDiagnostic('[ICE] Local candidate gathering finished (null end-of-candidates).', 'INFO');
      }
    },
    onIceCandidateError: (event) => {
      logDiagnostic(`[ICE] Candidate error (${event.errorCode}): ${event.errorText || 'STUN/TURN query error'} at ${event.url || 'host'}`, 'WARN');
    },
    onIceGatheringStateChange: (state) => {
      logDiagnostic(`[ICE] Gathering state changed to: ${state}`, 'INFO');
    },
    onSignalingStateChange: (state) => {
      logDiagnostic(`[SDP] Signaling state changed to: ${state}`, 'INFO');
    },
    onTrack: (remoteStream) => {
      logDiagnostic(`[MEDIA] Remote video track received (${remoteStream.getTracks().length} track(s)). Attaching to player...`, 'INFO');
      remoteVideo.srcObject = remoteStream;
      // The track arrives with the SDP, before any media flows; only report live once ICE has connected.
      if (isWebRtcConnected()) {
        hideOverlay();
      }
      remoteVideo.play().then(() => {
        if (isWebRtcConnected()) {
          updateStatus('live', 'Live Feed');
        }
        logDiagnostic('[MEDIA] Playback started successfully.', 'INFO');
      }).catch((err) => {
        logDiagnostic(`[MEDIA] Auto-play blocked: ${err.message}. Click to play.`, 'WARN');
        showInfo('Click on the video player to start playback.');
      });
    },
    onConnectionStateChange: (state) => {
      logDiagnostic(`[P2P] Peer connection state: ${state}`, 'INFO');
      if (state === 'connected') {
        hideOverlay();
        updateStatus('live', 'Live Feed');
        startStatsPolling();
        if (remoteVideo) {
          remoteVideo.play().catch(() => {});
        }
      } else if (state === 'disconnected') {
        updateStatus('disconnected', 'Sender Disconnected');
        stopStatsPolling();
      } else if (state === 'failed') {
        updateStatus('error', 'Connection Failed');
        showOverlay('Connection Failed', 'Could not reach the sender directly. The sender and this device are probably on different networks (no TURN relay configured), or the network blocks the path.', true);
        stopStatsPolling();
      }
    },
    onIceConnectionStateChange: (state) => {
      logDiagnostic(`[ICE] ICE Connection State: ${state}`, 'INFO');
      if (state === 'connected' || state === 'completed') {
        logDiagnostic('[ICE] ✓ WebRTC media connection established successfully!', 'INFO');
      } else if (state === 'failed') {
        logDiagnostic('[ICE] ❌ ICE connection failed! Direct P2P media could not connect.', 'ERROR');
        logDiagnostic('[DIAGNOSIS] Most likely causes on the same Wi-Fi:', 'WARN');
        logDiagnostic('1. Router "AP / client isolation" (or a guest network) blocks phone-to-PC traffic.', 'WARN');
        logDiagnostic('2. Windows Firewall blocks inbound UDP for this browser (Wi-Fi profile set to Public).', 'WARN');
        logDiagnostic('3. A VPN or virtual adapter on this PC hides the real LAN route.', 'WARN');
        logDiagnostic('4. Sender and viewer are on different networks and no TURN relay is configured (set TURN_SERVERS in .env). Screen sharing also hides the sender LAN IP behind an mDNS name that other devices may not resolve.', 'WARN');
        logDiagnostic('LAST RESORT: switch Media Transport Mode to "Fallback - Video through zrok" (Mode B) on both sender and viewer. It works anywhere but consumes zrok quota.', 'INFO');
      }
    },
    onControlChannelStateChange: (state) => {
      logDiagnostic(`[CONTROL] DataChannel state: ${state}`, 'INFO');
    }
  });

  webrtcPeer.createPeerConnection();

  // Flush any remote candidates that arrived before peer was ready
  if (pendingRemoteCandidates.length > 0) {
    logDiagnostic(`[ICE] Flushing ${pendingRemoteCandidates.length} queued remote candidate(s)...`, 'INFO');
    while (pendingRemoteCandidates.length > 0) {
      const cand = pendingRemoteCandidates.shift();
      webrtcPeer.addIceCandidate(cand);
    }
  }

  return webrtcPeer;
}

  socket.on('webrtc:offer', async (data) => {
    if (currentMediaMode === 'tunnel-relay') {
      return; // Ignore WebRTC offers when in tunnel-relay mode
    }
    logDiagnostic('[SDP] Received WebRTC offer from sender. Creating answer...', 'INFO');
    updateStatus('connecting', 'Negotiating connection...');

    const iceServers = await fetchIceServers();
    createViewerPeer(iceServers);

    try {
      const answer = await webrtcPeer.handleOffer(data);
      logDiagnostic('[SDP] Created local WebRTC answer.', 'INFO');
      socket.emit('webrtc:answer', {
        sdp: answer.sdp,
        type: answer.type
      });
      logDiagnostic('[SDP] Sent WebRTC answer to sender.', 'INFO');
    } catch (err) {
      logDiagnostic(`[SDP] Error answering offer: ${err.message}`, 'ERROR');
      showError(`Signaling error: ${err.message}`);
    }
  });

  socket.on('webrtc:ice-candidate', async (data) => {
    logDiagnostic(`[ICE] Received remote candidate: ${parseCandidateSummary(data.candidate)}`, 'INFO');
    if (webrtcPeer) {
      await webrtcPeer.addIceCandidate(data);
    } else {
      logDiagnostic(`[ICE] Queued remote candidate before peer ready: ${parseCandidateSummary(data.candidate)}`, 'INFO');
      pendingRemoteCandidates.push(data);
    }
  });

  socket.on('stream:state', (data) => {
    logDiagnostic(`[ROOM] Stream state update: ${data.state}`, 'INFO');
    if (data.state === 'stopped') {
      updateStatus('stopped', 'Stream Stopped by Sender');
      showOverlay('Stream Stopped', 'Sender stopped the stream.', true);
    } else if (data.state === 'source-changed' || data.state === 'live') {
      // Signaling-only event: in WebRTC mode it must not claim "live" before the media connection is up.
      if (currentMediaMode === 'tunnel-relay' || isWebRtcConnected()) {
        updateStatus('live', 'Live Feed');
        hideOverlay();
        if (remoteVideo) {
          remoteVideo.play().catch(() => {});
        }
      }
    }
  });

  socket.on('sender:battery', (data) => {
    if (!data || typeof data.level !== 'number') return;
    const vitalBatteryItem = document.getElementById('vitalBatteryItem');
    const vitalBattery = document.getElementById('vitalBattery');
    const hudBatteryPill = document.getElementById('hudBatteryPill');
    const hudBatteryIcon = document.getElementById('hudBatteryIcon');
    const hudBatteryText = document.getElementById('hudBatteryText');

    const chargingIcon = data.charging ? ' ⚡' : '';
    let color = '#22c55e'; // green
    if (data.level <= 20) {
      color = '#ef4444'; // red
    } else if (data.level <= 50) {
      color = '#eab308'; // yellow
    }

    if (vitalBatteryItem && vitalBattery) {
      vitalBatteryItem.style.display = 'flex';
      vitalBattery.textContent = `${data.level}%${chargingIcon}`;
      vitalBattery.style.color = color;
    }

    if (hudBatteryPill && hudBatteryText) {
      hudBatteryPill.style.display = 'inline-flex';
      hudBatteryText.textContent = `${data.level}%`;
      hudBatteryText.style.color = color;
      if (hudBatteryIcon) {
        hudBatteryIcon.textContent = data.charging ? '⚡' : (data.level <= 20 ? '🪫' : '🔋');
      }
    }
  });

  socket.on('peer:left', () => {
    logDiagnostic('[ROOM] Sender left the room.', 'INFO');
    updateStatus('waiting', 'Sender Left. Waiting...');
    setPathIndicator(null);
    lastLoggedPathKind = null;
    pendingRemoteCandidates = [];
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject = null;
    }
    const vitalBatteryItem = document.getElementById('vitalBatteryItem');
    const hudBatteryPill = document.getElementById('hudBatteryPill');
    if (vitalBatteryItem) vitalBatteryItem.style.display = 'none';
    if (hudBatteryPill) hudBatteryPill.style.display = 'none';
    if (isControlActive) {
      releaseControlLocally();
    }
    isHostControlEnabled = false;
    updateControlUIState();
    showOverlay('Sender Disconnected', 'Sender left the room. Waiting for reconnection...', true);
    stopStatsPolling();
    if (webrtcPeer) {
      webrtcPeer.close();
      webrtcPeer = null;
    }
  });

  socket.on('room:error', (data) => {
    showError(data.message);
    logDiagnostic(`[ROOM] Signaling error: ${data.message}`, 'ERROR');
  });

  socket.on('connect', () => {
    logDiagnostic(`[SOCKET] Connected to signaling server (ID: ${socket.id})`, 'INFO');
    if (isViewerSessionActive && currentRoomId && activeViewerPin) {
      logDiagnostic(`[AutoReconnect] Viewer socket reconnected. Rejoining room "${currentRoomId}"...`, 'INFO');
      updateStatus('connecting', 'Rejoining room...');
      socket.emit('room:join', { roomId: currentRoomId, role: 'viewer', pin: activeViewerPin, mediaMode: currentMediaMode }, (response) => {
        if (response && response.success) {
          logDiagnostic(`[AutoReconnect] Viewer rejoined room "${currentRoomId}" successfully.`, 'INFO');
          getChatManager().setSocket(socket);
          getChatManager().setRoom(currentRoomId, 'viewer');
          sendQualityPriority();
          isHostControlEnabled = Boolean(response.controlState && response.controlState.enabled);
          updateControlUIState();
          if (response.hasPeer) {
            updateStatus('connecting', 'Sender present. Awaiting offer...');
          } else {
            updateStatus('waiting', 'Waiting for Sender...');
          }
        }
      });
    }
  });

  socket.on('disconnect', (reason) => {
    logDiagnostic(`[SOCKET] Disconnected from signaling server (${reason})`, 'WARN');
    stopStatsPolling();
    if (isControlActive) {
      releaseControlLocally();
    }
    if (isViewerSessionActive) {
      updateStatus('connecting', 'Connection Lost - Reconnecting...');
    } else {
      updateStatus('disconnected', 'Server Disconnected');
    }
  });

  socket.on('connect_error', (err) => {
    logDiagnostic(`[SOCKET] Connection error: ${err.message}`, 'ERROR');
  });
}

function startStatsPolling() {
  stopStatsPolling();
  statsInterval = setInterval(async () => {
    if (webrtcPeer) {
      const stats = await webrtcPeer.getStatsReport();
      if (stats && stats.rtt) {
        const pairInfo = `${stats.localCandidateType || '?'} (${stats.localAddress || '?'}) <-> ${stats.remoteCandidateType || '?'} (${stats.remoteAddress || '?'})`;
        const fps = stats.framesPerSecond !== null && stats.framesPerSecond !== undefined ? `${stats.framesPerSecond} FPS` : 'active';
        const res = stats.frameWidth ? ` (${stats.frameWidth}x${stats.frameHeight})` : '';
        logDiagnostic(`[STATS] Pair: ${pairInfo} | RTT: ${stats.rtt} | Inbound: ${fps}${res}`, 'INFO');
      }
      if (stats && stats.pathKind) {
        setPathIndicator(stats.pathKind);
        if (stats.pathKind !== lastLoggedPathKind) {
          lastLoggedPathKind = stats.pathKind;
          const description = describePath(stats.pathKind);
          logDiagnostic(`[PATH] ${description ? description.text : stats.pathKind}`, stats.pathKind === 'lan' ? 'INFO' : 'WARN');
        }
      }
      if (stats) {
        const fpsVal = (stats.framesPerSecond !== null && stats.framesPerSecond !== undefined) ? Math.round(stats.framesPerSecond) : null;
        const resVal = (stats.frameWidth && stats.frameHeight) ? `${stats.frameWidth} × ${stats.frameHeight}` : (remoteVideo && remoteVideo.videoWidth ? `${remoteVideo.videoWidth} × ${remoteVideo.videoHeight}` : null);
        updateVitals({
          fps: fpsVal,
          resolution: resVal,
          path: stats.pathKind,
          rtt: stats.rtt
        });
      }
    }
  }, 4000);
}


function startTunnelViewerStats() {
  stopStatsPolling();
  statsInterval = setInterval(() => {
    if (tunnelStartTime === 0) {
      return;
    }
    const elapsedSecs = Math.max(1, Math.round((Date.now() - tunnelStartTime) / 1000));
    const avgFps = (tunnelFramesReceived / elapsedSecs).toFixed(1);
    const mbRecv = (tunnelBytesReceived / (1024 * 1024)).toFixed(2);
    const estMbPerHour = ((tunnelBytesReceived / elapsedSecs) * 3600 / (1024 * 1024)).toFixed(1);

    logDiagnostic(
      `[Tunnel Stats] Elapsed: ${elapsedSecs}s | Recv: ${tunnelFramesReceived} frames (${avgFps} FPS) | ` +
      `Dropped: ${tunnelFramesDropped} | Data: ${mbRecv} MB (Est: ${estMbPerHour} MB/hr)`
    );

    updateVitals({
      fps: Math.round(parseFloat(avgFps) || 0),
      resolution: (remoteCanvas && remoteCanvas.width && remoteCanvas.height) ? `${remoteCanvas.width} × ${remoteCanvas.height}` : null,
      path: 'tunnel-relay'
    });
  }, 4000);
}

function renderBinaryFrame(buffer) {
  tunnelIsRendering = true;
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    if (remoteCanvas && canvasContext) {
      if (remoteCanvas.width !== img.width || remoteCanvas.height !== img.height) {
        remoteCanvas.width = img.width;
        remoteCanvas.height = img.height;
      }
      canvasContext.drawImage(img, 0, 0, img.width, img.height);
    }
    URL.revokeObjectURL(objectUrl);
    tunnelIsRendering = false;

    // Drain queued freshest frame if any
    if (tunnelNextFrameBlob) {
      const nextBuf = tunnelNextFrameBlob;
      tunnelNextFrameBlob = null;
      renderBinaryFrame(nextBuf);
    }
  };

  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    tunnelIsRendering = false;
  };

  img.src = objectUrl;
}

function stopStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

function leaveRoom() {
  logDiagnostic('Leaving room...');
  if (isControlActive) {
    releaseControlLocally();
  }
  if (zoomController) {
    zoomController.resetZoom();
  }
  isViewerSessionActive = false;
  activeViewerPin = null;
  getChatManager().setRoom(null);
  stopStatsPolling();

  if (socket) {
    socket.emit('room:leave');
  }

  if (webrtcPeer) {
    webrtcPeer.close();
    webrtcPeer = null;
  }

  if (remoteVideo.srcObject) {
    remoteVideo.srcObject = null;
  }
  const vitalBatteryItem = document.getElementById('vitalBatteryItem');
  const hudBatteryPill = document.getElementById('hudBatteryPill');
  if (vitalBatteryItem) vitalBatteryItem.style.display = 'none';
  if (hudBatteryPill) hudBatteryPill.style.display = 'none';
  if (remoteCanvas && canvasContext) {
    canvasContext.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  }

  tunnelStartTime = 0;
  tunnelFramesReceived = 0;
  tunnelFramesDropped = 0;
  tunnelBytesReceived = 0;
  tunnelNextFrameBlob = null;
  tunnelIsRendering = false;

  if (vcamPumpingInterval) {
    clearInterval(vcamPumpingInterval);
    vcamPumpingInterval = null;
  }

  const lastRoom = rememberedRoomId || currentRoomId || getSessionLastRoom();
  if (lastRoom) {
    rememberedRoomId = lastRoom;
    showOverlay('Stream Inactive', `Left room "${lastRoom}". Click Reconnect to join again.`, true);
    if (roomIdInput && !roomIdInput.value) {
      roomIdInput.value = lastRoom;
    }
    if (accessPinInput && !accessPinInput.value && rememberedPin) {
      accessPinInput.value = rememberedPin;
    }
  } else {
    showOverlay('Stream Inactive', 'Enter the Room ID and click Join Stream to watch live', false);
  }

  if (isControlActive) {
    releaseControl();
  }
  isHostControlEnabled = false;
  updateControlUIState();

  currentRoomId = null;

  updateVitals({
    fps: null,
    resolution: null,
    path: null,
    rtt: null
  });

  if (pythonLinkCard) {
    pythonLinkCard.style.display = 'none';
  }

  if (appWorkspace) {
    appWorkspace.classList.remove('streaming-active');
  }
  if (joinCard) {
    joinCard.style.display = 'block';
  }
  if (viewerSessionActivePanel) {
    viewerSessionActivePanel.style.display = 'none';
  }

  btnJoin.disabled = false;
  btnLeave.disabled = true;
  pendingRemoteCandidates = [];
  setPathIndicator(null);
  lastLoggedPathKind = null;
  updateStatus('disconnected', 'Disconnected');
  logDiagnostic('Left room.');
}

btnJoin.addEventListener('click', joinRoom);
btnLeave.addEventListener('click', leaveRoom);

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoWrapper.requestFullscreen().catch((err) => {
      logDiagnostic(`Fullscreen error: ${err.message}`, 'WARN');
    });
  } else {
    document.exitFullscreen();
  }
});

function handleFullscreenChange() {
  const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  document.body.classList.toggle('is-fullscreen', isFs);
  if (videoWrapper) {
    videoWrapper.classList.toggle('is-fullscreen', isFs);
  }
}

document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

if (videoWrapper) {
  videoWrapper.addEventListener('dblclick', (e) => {
    if (e.target && e.target.closest('button, a, input, select')) {
      return;
    }
    if (isControlActive) {
      e.preventDefault();
      return;
    }
    btnFullscreen.click();
  });
}

const gridOverlay = document.getElementById('gridOverlay');
const transformController = new StreamTransformController(remoteVideo, gridOverlay);

if (videoWrapper) {
  zoomController = new ZoomController({
    containerElement: videoWrapper,
    targetElements: [remoteVideo, remoteCanvas],
    minScale: 1.0,
    maxScale: 4.0,
    isControlActive: () => isControlActive
  });

  mobileRemoteController = new MobileRemoteController({
    containerElement: videoWrapper,
    videoElement: remoteVideo,
    getVideoElement: () => (currentMediaMode === 'tunnel-relay' ? remoteCanvas : remoteVideo),
    zoomController,
    sendControlInput,
    isControlActive: () => isControlActive,
    releaseControl
  });
}

function syncVideoTransforms() {
  if (!zoomController || !transformController) {
    return;
  }
  const parts = [];
  if (transformController.rotationDegrees !== 0) {
    parts.push(`rotate(${transformController.rotationDegrees}deg)`);
  }
  if (transformController.isMirrored) {
    parts.push('scaleX(-1)');
  }
  zoomController.setExternalTransform(parts.join(' '));
}
const btnHudFlipH = document.getElementById('btnHudFlipH');
const btnHudRotate = document.getElementById('btnHudRotate');
const btnHudGrid = document.getElementById('btnHudGrid');
const btnHudAudio = document.getElementById('btnHudAudio');
const btnPushToTalk = document.getElementById('btnPushToTalk');
const btnHudRecord = document.getElementById('btnHudRecord');
const recIndicator = document.getElementById('recIndicator');
const recTimerText = document.getElementById('recTimerText');
const btnShareViewerLink = document.getElementById('btnShareViewerLink');

if (btnHudAudio && remoteVideo) {
  btnHudAudio.addEventListener('click', () => {
    remoteVideo.muted = !remoteVideo.muted;
    btnHudAudio.style.color = remoteVideo.muted ? 'inherit' : '#10b981';
    logDiagnostic(`[Audio] Remote audio playback ${remoteVideo.muted ? 'muted' : 'unmuted'}.`, 'INFO');
  });
}

if (btnPushToTalk) {
  btnPushToTalk.addEventListener('click', () => {
    if (socket && currentRoomId) {
      socket.emit('intercom:message', { type: 'chime', message: 'Viewer paged sender' });
      btnPushToTalk.style.color = 'var(--accent-cyan)';
      logDiagnostic('[Intercom] Talkback chime sent to sender.', 'INFO');
      setTimeout(() => {
        btnPushToTalk.style.color = 'inherit';
      }, 1000);
    } else {
      showError('Join a live room before sending intercom chime.');
    }
  });
}

if (btnHudFlipH) {
  btnHudFlipH.addEventListener('click', () => {
    const isMirrored = transformController.toggleMirror();
    btnHudFlipH.style.color = isMirrored ? 'var(--accent-cyan)' : 'inherit';
    syncVideoTransforms();
  });
}

if (btnHudRotate) {
  btnHudRotate.addEventListener('click', () => {
    transformController.rotate();
    syncVideoTransforms();
  });
}

if (btnHudGrid) {
  btnHudGrid.addEventListener('click', () => {
    const isActive = transformController.toggleGrid();
    btnHudGrid.style.color = isActive ? 'var(--accent-cyan)' : 'inherit';
  });
}

let streamRecorder = null;
if (btnHudRecord && remoteVideo) {
  streamRecorder = new StreamRecorder(remoteVideo, {
    onStart: () => {
      if (recIndicator) { recIndicator.classList.add('active'); }
      btnHudRecord.style.color = '#ef4444';
      logDiagnostic('[Record] Video recording started on viewer.', 'INFO');
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
      if (currentRoomId) {
        streamRecorder.start();
      } else {
        showError('Join a live room before starting recording.');
      }
    }
  });
}

if (btnShareViewerLink) {
  btnShareViewerLink.addEventListener('click', () => {
    const url = buildShareUrl('/viewer', {
      roomId: currentRoomId || roomIdInput?.value || '',
      pin: accessPinInput?.value || '',
      autostart: true
    });
    copyTextToClipboard(url, btnShareViewerLink, '✓ Link Copied!');
  });
}

if (btnHudFullscreen) {
  btnHudFullscreen.addEventListener('click', () => {
    btnFullscreen.click();
  });
}

if (btnHudSnapshot) {
  btnHudSnapshot.addEventListener('click', () => {
    const targetElement = currentMediaMode === 'tunnel-relay' ? remoteCanvas : remoteVideo;
    if (targetElement) {
      const ok = captureFrameSnapshot(targetElement, 'viewer-stream-snapshot');
      if (ok) {
        logDiagnostic('[HUD] Captured stream still snapshot image.', 'INFO');
      }
    }
  });
}

if (btnHudPip) {
  btnHudPip.addEventListener('click', async () => {
    if (document.pictureInPictureEnabled && remoteVideo) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await remoteVideo.requestPictureInPicture();
        }
      } catch (err) {
        logDiagnostic(`Picture-in-Picture error: ${err.message}`, 'WARN');
      }
    }
  });
}

if (btnOverlayReconnect) {
  btnOverlayReconnect.addEventListener('click', () => {
    const rid = rememberedRoomId || (roomIdInput && roomIdInput.value.trim()) || getSessionLastRoom();
    const rpin = rememberedPin || (accessPinInput && accessPinInput.value.trim()) || getSessionLastPin() || '123456';
    if (rid && roomIdInput) {
      roomIdInput.value = rid;
    }
    if (rpin && accessPinInput) {
      accessPinInput.value = rpin;
    }
    logDiagnostic(`[Reconnect] Reconnecting to room "${rid || 'unknown'}"...`, 'INFO');
    joinRoom();
  });
}

// Window unload cleanup
window.addEventListener('beforeunload', () => {
  if (streamRecorder && streamRecorder.isRecording) {
    streamRecorder.stop();
  }
  leaveRoom();
});

function updateControlUIState() {
  if (mobileRemoteController) {
    if (isControlActive) {
      mobileRemoteController.onControlGranted();
    } else {
      mobileRemoteController.onControlReleased();
    }
  }

  if (viewerControlSidebarCard) {
    viewerControlSidebarCard.style.display = isViewerSessionActive ? 'block' : 'none';
  }

  if (isControlActive) {
    if (viewerControlStatusBadge) {
      viewerControlStatusBadge.textContent = 'Controlling Host';
      viewerControlStatusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      viewerControlStatusBadge.style.color = 'var(--accent-emerald)';
    }
    if (viewerControlInactiveState) {
      viewerControlInactiveState.style.display = 'none';
    }
    if (viewerControlActiveState) {
      viewerControlActiveState.style.display = 'block';
    }
  } else if (isHostControlEnabled) {
    if (viewerControlStatusBadge) {
      viewerControlStatusBadge.textContent = 'Host Enabled';
      viewerControlStatusBadge.style.background = 'rgba(56, 189, 248, 0.2)';
      viewerControlStatusBadge.style.color = 'var(--accent-cyan)';
    }
    if (viewerControlInactiveState) {
      viewerControlInactiveState.style.display = 'block';
    }
    if (viewerControlActiveState) {
      viewerControlActiveState.style.display = 'none';
    }
    if (viewerControlHelpText) {
      viewerControlHelpText.textContent = 'Host has enabled remote control. Click below to enter the 6-digit PIN or permanent password.';
      viewerControlHelpText.style.color = 'var(--text-secondary)';
    }
  } else {
    if (viewerControlStatusBadge) {
      viewerControlStatusBadge.textContent = 'Host Disabled';
      viewerControlStatusBadge.style.background = 'rgba(255, 255, 255, 0.1)';
      viewerControlStatusBadge.style.color = 'var(--text-muted)';
    }
    if (viewerControlInactiveState) {
      viewerControlInactiveState.style.display = 'block';
    }
    if (viewerControlActiveState) {
      viewerControlActiveState.style.display = 'none';
    }
    if (viewerControlHelpText) {
      viewerControlHelpText.textContent = 'Host has not enabled remote control yet. You can still enter your PIN or password.';
      viewerControlHelpText.style.color = 'var(--text-muted)';
    }
  }

  if (btnHudControl) {
    btnHudControl.style.display = isViewerSessionActive ? 'inline-flex' : 'none';
    btnHudControl.style.color = isControlActive ? 'var(--accent-cyan)' : 'inherit';
    btnHudControl.title = isControlActive
      ? 'Active Remote Desktop Control (Click to Release)'
      : (isHostControlEnabled ? 'Request Remote Desktop Control (Ready)' : 'Remote Desktop Control (Host Disabled)');
  }
  if (hudControlPill) {
    hudControlPill.style.display = isControlActive ? 'inline-flex' : 'none';
  }
}

function openControlModal() {
  if (!isViewerSessionActive || !currentRoomId) {
    showError('Join a live room first to request remote desktop control.');
    return;
  }
  if (controlModal) {
    controlModal.style.display = 'flex';
    if (controlCredentialInput) {
      if (autoControlPinInput && autoControlPinInput.value.trim() && !controlCredentialInput.value) {
        controlCredentialInput.value = autoControlPinInput.value.trim();
      }
      controlCredentialInput.focus();
    }
    if (controlModalStatus) {
      if (!isHostControlEnabled) {
        controlModalStatus.textContent = 'Note: Remote Control is currently disabled on the host PC. You may enter the PIN now, or ask the host to check "Remote Desktop Control".';
        controlModalStatus.style.color = 'var(--accent-amber)';
      } else {
        controlModalStatus.textContent = '';
        controlModalStatus.style.color = 'inherit';
      }
    }
  }
}

function closeControlModal() {
  if (controlModal) {
    controlModal.style.display = 'none';
  }
}

function submitControlRequest(credentialOverride = null) {
  if (!currentRoomId || !socket) {
    return;
  }
  const credential = (credentialOverride !== null && typeof credentialOverride === 'string')
    ? credentialOverride.trim()
    : (controlCredentialInput ? controlCredentialInput.value.trim() : '');

  if (!credential) {
    if (controlModalStatus) {
      controlModalStatus.textContent = 'Please enter PIN or password.';
      controlModalStatus.style.color = 'var(--accent-red)';
    }
    return;
  }

  if (controlModalStatus) {
    controlModalStatus.textContent = 'Authenticating...';
    controlModalStatus.style.color = 'var(--text-secondary)';
  }

  socket.emit('control:request-lease', {
    roomId: currentRoomId,
    credential
  }, (response) => {
    if (response && response.success) {
      isControlActive = true;
      controlSessionToken = response.sessionToken;
      updateControlUIState();
      closeControlModal();
      logDiagnostic('[CONTROL] Remote desktop control lease granted.', 'INFO');
      showInfo('Remote desktop control active. Press Release button to exit.');
    } else {
      const errMsg = response && response.error ? response.error : 'Failed to acquire control lease';
      if (controlModal && controlModal.style.display !== 'flex') {
        openControlModal();
      }
      if (controlModalStatus) {
        controlModalStatus.textContent = errMsg;
        controlModalStatus.style.color = 'var(--accent-red)';
      }
      logDiagnostic(`[CONTROL] Control lease request failed: ${errMsg}`, 'WARN');
    }
  });
}

function releaseControl() {
  if (isControlActive && socket && socket.connected && currentRoomId) {
    socket.emit('control:release', { roomId: currentRoomId });
  }
  releaseControlLocally();
}

function releaseControlLocally() {
  if (isControlActive) {
    isControlActive = false;
    controlSessionToken = null;
    sendControlInput({ type: 'release_all' });
    updateControlUIState();
    logDiagnostic('[CONTROL] Remote desktop control released.', 'INFO');
    showInfo('Remote desktop control released.');
  }
}

function sendControlInput(event) {
  if (!isControlActive && event.type !== 'release_all') {
    return;
  }
  if (controlSessionToken) {
    event.sessionToken = controlSessionToken;
  }
  // Try WebRTC DataChannel first
  if (webrtcPeer && webrtcPeer.isControlDataChannelOpen()) {
    if (webrtcPeer.sendControlInput(event)) {
      return;
    }
  }
  // Fallback to signaling socket
  if (socket && socket.connected && currentRoomId) {
    socket.emit('control:input', {
      roomId: currentRoomId,
      event
    });
  }
}

function setupRemoteControlHandlers() {
  if (btnHudControl) {
    btnHudControl.addEventListener('click', () => {
      if (isControlActive) {
        releaseControl();
      } else {
        openControlModal();
      }
    });
  }

  if (btnSidebarRequestControl) {
    btnSidebarRequestControl.addEventListener('click', () => {
      openControlModal();
    });
  }

  if (btnSidebarReleaseControl) {
    btnSidebarReleaseControl.addEventListener('click', () => {
      releaseControl();
    });
  }

  if (btnReleaseControl) {
    btnReleaseControl.addEventListener('click', () => {
      releaseControl();
    });
  }

  if (btnCloseControlModal) {
    btnCloseControlModal.addEventListener('click', closeControlModal);
  }

  if (btnCancelControlModal) {
    btnCancelControlModal.addEventListener('click', closeControlModal);
  }

  if (btnSubmitControl) {
    btnSubmitControl.addEventListener('click', () => submitControlRequest());
  }

  if (btnToggleControlCred && controlCredentialInput) {
    setupPasswordToggle('controlCredentialInput', 'btnToggleControlCred');
  }

  if (btnToggleAutoControlPin && autoControlPinInput) {
    setupPasswordToggle('autoControlPinInput', 'btnToggleAutoControlPin');
  }

  if (controlCredentialInput) {
    controlCredentialInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitControlRequest();
      }
    });
  }

  const bindDesktopPointerControls = (targetEl) => {
    if (!targetEl) {
      return;
    }

    const isTouchOrSynthetic = (e) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        return true;
      }
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
        return true;
      }
      return false;
    };

    targetEl.addEventListener('pointermove', (e) => {
      if (!isControlActive || isTouchOrSynthetic(e)) {
        return;
      }
      const rect = targetEl.getBoundingClientRect();
      const vw = targetEl.videoWidth || targetEl.width || rect.width;
      const vh = targetEl.videoHeight || targetEl.height || rect.height;
      const zoomState = zoomController ? zoomController.getState() : { scale: 1.0, panX: 0, panY: 0 };
      const coords = translateScreenCoordinates(
        e.clientX,
        e.clientY,
        rect,
        vw,
        vh,
        true,
        zoomState.scale,
        zoomState.panX,
        zoomState.panY
      );
      if (coords) {
        sendControlInput({
          type: 'mouse_move',
          x: coords.x,
          y: coords.y
        });
        if (mobileRemoteController) {
          mobileRemoteController.updateCursorOverlay(coords.x, coords.y);
        }
      }
    });

    targetEl.addEventListener('pointerdown', (e) => {
      if (!isControlActive || isTouchOrSynthetic(e)) {
        return;
      }
      e.preventDefault();
      const rect = targetEl.getBoundingClientRect();
      const vw = targetEl.videoWidth || targetEl.width || rect.width;
      const vh = targetEl.videoHeight || targetEl.height || rect.height;
      const zoomState = zoomController ? zoomController.getState() : { scale: 1.0, panX: 0, panY: 0 };
      const coords = translateScreenCoordinates(
        e.clientX,
        e.clientY,
        rect,
        vw,
        vh,
        true,
        zoomState.scale,
        zoomState.panX,
        zoomState.panY
      );
      let button = 'left';
      if (e.button === 1) {
        button = 'middle';
      } else if (e.button === 2) {
        button = 'right';
      }
      if (coords) {
        sendControlInput({
          type: 'mouse_move',
          x: coords.x,
          y: coords.y
        });
        if (mobileRemoteController) {
          mobileRemoteController.updateCursorOverlay(coords.x, coords.y);
        }
      }
      sendControlInput({
        type: 'mouse_down',
        button
      });
    });

    targetEl.addEventListener('pointerup', (e) => {
      if (!isControlActive || isTouchOrSynthetic(e)) {
        return;
      }
      e.preventDefault();
      const rect = targetEl.getBoundingClientRect();
      const vw = targetEl.videoWidth || targetEl.width || rect.width;
      const vh = targetEl.videoHeight || targetEl.height || rect.height;
      const zoomState = zoomController ? zoomController.getState() : { scale: 1.0, panX: 0, panY: 0 };
      const coords = translateScreenCoordinates(
        e.clientX,
        e.clientY,
        rect,
        vw,
        vh,
        true,
        zoomState.scale,
        zoomState.panX,
        zoomState.panY
      );
      let button = 'left';
      if (e.button === 1) {
        button = 'middle';
      } else if (e.button === 2) {
        button = 'right';
      }
      if (coords) {
        sendControlInput({
          type: 'mouse_move',
          x: coords.x,
          y: coords.y
        });
        if (mobileRemoteController) {
          mobileRemoteController.updateCursorOverlay(coords.x, coords.y);
        }
      }
      sendControlInput({
        type: 'mouse_up',
        button
      });
    });

    targetEl.addEventListener('contextmenu', (e) => {
      if (isControlActive) {
        e.preventDefault();
      }
    });

    targetEl.addEventListener('wheel', (e) => {
      if (!isControlActive) {
        return;
      }
      e.preventDefault();
      sendControlInput({
        type: 'mouse_wheel',
        deltaX: e.deltaX,
        deltaY: e.deltaY
      });
    }, { passive: false });
  };

  bindDesktopPointerControls(remoteVideo);
  bindDesktopPointerControls(remoteCanvas);

  window.addEventListener('keydown', (e) => {
    if (!isControlActive) {
      return;
    }
    const targetTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || (document.activeElement && document.activeElement.isContentEditable)) {
      return;
    }

    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'PageUp' || e.code === 'PageDown' || e.code === 'Backspace' || e.code === 'Home' || e.code === 'End') {
      e.preventDefault();
    }

    sendControlInput({
      type: 'key_down',
      code: e.code
    });
  });

  window.addEventListener('keyup', (e) => {
    if (!isControlActive) {
      return;
    }
    const targetTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || (document.activeElement && document.activeElement.isContentEditable)) {
      return;
    }

    sendControlInput({
      type: 'key_up',
      code: e.code
    });
  });

  window.addEventListener('blur', () => {
    if (isControlActive) {
      sendControlInput({ type: 'release_all' });
    }
  });
}

async function showLocalViewerHint() {
  if (!localViewerHint || !localViewerHintLink || isLocalHostname(window.location.hostname)) {
    return;
  }
  const localOrigin = await fetchLocalServerOrigin();
  if (!localOrigin) {
    return;
  }
  const roomQuery = currentRoomId ? `?room=${encodeURIComponent(currentRoomId)}` : (roomIdInput?.value ? `?room=${encodeURIComponent(roomIdInput.value)}` : '');
  const localViewerUrl = `${localOrigin}/viewer${roomQuery}`;
  localViewerHintLink.href = localViewerUrl;
  localViewerHintLink.textContent = localViewerUrl;
  localViewerHint.classList.add('visible');
  logDiagnostic('[HINT] This viewer is loaded through a public URL. Use the localhost viewer on the PC to avoid any zrok traffic.', 'WARN');
}

// Initialize default state
setupDiagnosticsControls('btnCopyLogs', 'btnClearLogs', 'diagnosticsLog');
setupCollapsibleDrawer('btnToggleDiagnostics', 'diagnosticsLog', '📋 Technical Diagnostics & WebRTC Vitals ▼', '📋 Technical Diagnostics & WebRTC Vitals ▲');
setupRemoteControlHandlers();
updateControlUIState();
showLocalViewerHint();
fetchIceServers().catch(() => {});

// URL query parameters parsing for auto-connect & prefilling
const streamParams = parseUrlStreamParams();
const initRoom = streamParams.roomId || urlParams.get('room') || getSessionLastRoom();
const initPin = streamParams.pin || urlParams.get('pin') || getSessionLastPin();

if (initRoom) {
  rememberedRoomId = initRoom;
  if (roomIdInput) {
    roomIdInput.value = initRoom;
  }
  if (roomHintBadge) {
    roomHintBadge.textContent = `Room: ${initRoom}`;
    roomHintBadge.style.display = 'inline-flex';
  }
}
if (initPin) {
  rememberedPin = initPin;
  if (accessPinInput) {
    accessPinInput.value = initPin;
  }
}
if (streamParams.mode && mediaModeSelect) {
  mediaModeSelect.value = streamParams.mode;
}
if (streamParams.controlPin && autoControlPinInput) {
  autoControlPinInput.value = streamParams.controlPin;
}
function syncOverlayInputs() {
  const overlayRoom = document.getElementById('overlayRoomId');
  const overlayPin = document.getElementById('overlayAccessPin');
  const btnOverlayJoin = document.getElementById('btnOverlayJoin');

  if (overlayRoom && roomIdInput) {
    overlayRoom.value = roomIdInput.value;
    overlayRoom.addEventListener('input', () => {
      roomIdInput.value = overlayRoom.value;
    });
    roomIdInput.addEventListener('input', () => {
      overlayRoom.value = roomIdInput.value;
    });
  }
  if (overlayPin && accessPinInput) {
    overlayPin.value = accessPinInput.value;
    overlayPin.addEventListener('input', () => {
      accessPinInput.value = overlayPin.value;
    });
    accessPinInput.addEventListener('input', () => {
      overlayPin.value = accessPinInput.value;
    });
  }
  if (btnOverlayJoin && btnJoin) {
    btnOverlayJoin.addEventListener('click', () => {
      btnJoin.click();
    });
  }
  setupPasswordToggle('btnToggleOverlayPin', 'overlayAccessPin');
}

function setupDevModeGating() {
  const devToolsSection = document.getElementById('devToolsSection');
  const btnToggleDevMode = document.getElementById('btnToggleDevMode');
  const isDevUrl = window.location.search.includes('dev=1') || window.location.search.includes('dev=true');
  let isDevStored = false;
  try {
    isDevStored = localStorage.getItem('lancam_dev_mode') === 'true';
  } catch (_) {}

  const isDev = isDevUrl || isDevStored;
  if (devToolsSection && isDev) {
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
}

syncOverlayInputs();
setupDevModeGating();

if (streamParams.autostart && initRoom) {
  logDiagnostic(`[AutoStart] Autostart query parameter detected. Automatically joining room "${initRoom}"...`, 'INFO');
  setTimeout(() => {
    joinRoom();
  }, 400);
}

logDiagnostic('Viewer client ready.');
