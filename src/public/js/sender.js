/**
 * @file sender.js
 * Sender client controller: handles camera capture, Socket.IO signaling,
 * and WebRTC peer connection to viewer.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic, parseCandidateSummary, setupDiagnosticsControls, setPathIndicator, describePath, isLocalHostname, fetchLocalServerOrigin, updateVitals, captureFrameSnapshot, copyTextToClipboard, setupCollapsibleDrawer } from './ui-utils.js';
import { CameraManager } from './camera-manager.js';
import { WebRtcPeer } from './webrtc-peer.js';

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
const shareQrCard = document.getElementById('shareQrCard');
const viewerQrImg = document.getElementById('viewerQrImg');
const viewerQrLink = document.getElementById('viewerQrLink');
const viewerQrLinkInput = document.getElementById('viewerQrLinkInput');
const btnCopyViewerLink = document.getElementById('btnCopyViewerLink');
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

if (btnToggleSetup && setupFormBody) {
  btnToggleSetup.addEventListener('click', () => {
    const isHidden = setupFormBody.style.display === 'none';
    setupFormBody.style.display = isHidden ? 'block' : 'none';
    btnToggleSetup.textContent = isHidden ? '▲ Collapse' : '⚙️ Expand Settings';
  });
}

if (btnHudFacing) {
  btnHudFacing.addEventListener('click', () => {
    btnToggleFacing.click();
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
    if (cameraManager.currentStream) {
      const track = cameraManager.currentStream.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        try {
          torchActive = !torchActive;
          await track.applyConstraints({ advanced: [{ torch: torchActive }] });
          btnHudTorch.style.color = torchActive ? '#facc15' : 'inherit';
          logDiagnostic(`[HUD] Torch flashlight ${torchActive ? 'enabled' : 'disabled'}.`, 'INFO');
        } catch (e) {
          torchActive = false;
        }
      }
    }
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

btnGenRoom.addEventListener('click', () => {
  roomIdInput.value = generateRandomRoomId();
});

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

  btnStart.disabled = true;
  updateStatus('connecting', 'Starting capture...');
  logDiagnostic('Requesting camera permissions...');

  let stream = null;
  try {
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

    logDiagnostic(`Requesting camera capture (mode: ${resChoice})...`, 'INFO');
    stream = await cameraManager.startCapture({
      deviceId: selectedDeviceId,
      width: targetWidth,
      height: targetHeight,
      frameRate: 30
    });

    localVideo.srcObject = stream;
    videoOverlay.style.display = 'none';
    await localVideo.play().catch(() => {});

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

      const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      if (capabilities.torch && btnHudTorch) {
        btnHudTorch.style.display = 'inline-flex';
      }
    } else {
      logDiagnostic('Camera capture started.', 'INFO');
    }

    updateVitals({
      fps: actualFps,
      resolution: (actualWidth && actualHeight) ? `${actualWidth} × ${actualHeight}` : null,
      viewers: 0,
      path: currentMediaMode === 'tunnel-relay' ? 'tunnel-relay' : '--'
    });

    if (btnToggleSetup) {
      btnToggleSetup.style.display = 'inline-flex';
      if (window.innerWidth <= 640 && setupFormBody) {
        setupFormBody.style.display = 'none';
        btnToggleSetup.textContent = '⚙️ Expand Settings';
      }
    }

    // Once permission is granted, populate detailed device labels if available
    await populateCameraDevices();
  } catch (err) {
    updateStatus('error', 'Camera Error');
    showError(err.message);
    logDiagnostic(`Camera capture failed: ${err.message}`, 'ERROR');
    btnStart.disabled = false;
    return;
  }

  currentRoomId = roomId;
  currentMediaMode = mediaModeSelect ? mediaModeSelect.value : 'webrtc';
  btnStop.disabled = false;

  // Initialize Socket.IO connection
  if (!socket) {
    socket = io();
    setupSocketListeners();
  }

  logDiagnostic(`Joining room "${roomId}" as sender [mode: ${currentMediaMode}]...`);
  updateStatus('connecting', 'Joining Room...');

  socket.emit('room:join', { roomId, role: 'sender', pin, mediaMode: currentMediaMode }, async (response) => {
    if (!response || !response.success) {
      const errMsg = response ? response.error : 'Connection to room failed';
      showError(errMsg);
      logDiagnostic(`Join failed: ${errMsg}`);
      stopSession();
      return;
    }

    logDiagnostic(`Joined room "${roomId}" as sender [mode: ${response.mediaMode}].`);

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
  if (cameraManager.currentStream) {
    cameraManager.currentStream.getTracks().forEach((track) => {
      logDiagnostic(`[MEDIA:${viewerId}] Added local ${track.kind} track to peer (${track.label || 'camera'}).`, 'INFO');
      peer.addTrack(track, cameraManager.currentStream);
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
  });

  socket.on('disconnect', (reason) => {
    logDiagnostic(`[SOCKET] Disconnected from signaling server (${reason})`, 'WARN');
    updateStatus('disconnected', 'Server Disconnected');
    stopStatsPolling();
  });

  socket.on('connect_error', (err) => {
    logDiagnostic(`[SOCKET] Connection error: ${err.message}`, 'ERROR');
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

  if (setupFormBody) {
    setupFormBody.style.display = 'block';
  }
  if (btnToggleSetup) {
    btnToggleSetup.style.display = 'none';
    btnToggleSetup.textContent = '▲ Collapse';
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

  cameraManager.stopCapture();
  if (localVideo.srcObject) {
    localVideo.srcObject = null;
  }
  videoOverlay.style.display = 'block';

  btnStart.disabled = false;
  btnStop.disabled = true;
  updateStatus('stopped', 'Stopped');
  logDiagnostic('Capture and session stopped.');
}

btnStart.addEventListener('click', startSession);
btnStop.addEventListener('click', stopSession);

btnToggleFacing.addEventListener('click', async () => {
  const newFacing = cameraManager.toggleFacingMode();
  logDiagnostic(`Switched facing mode to ${newFacing}`);
  if (cameraManager.currentStream) {
    // Restart active capture with new facing mode
    await startSession();
  }
});

// Window unload cleanup
window.addEventListener('beforeunload', () => {
  stopSession();
});

// Initialize default state
setupDiagnosticsControls('btnCopyLogs', 'btnClearLogs', 'diagnosticsLog');
setupCollapsibleDrawer('btnToggleDiagnostics', 'diagnosticsLog', '📋 Technical Vitals & Diagnostics ▼', '📋 Technical Vitals & Diagnostics ▲');
roomIdInput.value = generateRandomRoomId();
populateCameraDevices();
fetchIceServers().catch(() => {});
logDiagnostic('Sender client ready. Click "Start Streaming" to begin.');
