/**
 * @file viewer.js
 * Viewer client controller: handles room join, Socket.IO signaling,
 * WebRTC answer creation, remote track rendering, and connection statistics.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic, parseCandidateSummary, setupDiagnosticsControls } from './ui-utils.js';
import { WebRtcPeer } from './webrtc-peer.js';

let webrtcPeer = null;
let socket = null;
let currentRoomId = null;
let currentMediaMode = 'webrtc';
let statsInterval = null;
let cachedIceServers = null;
let pendingRemoteCandidates = [];

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
const btnJoin = document.getElementById('btnJoin');
const btnLeave = document.getElementById('btnLeave');
const btnFullscreen = document.getElementById('btnFullscreen');
const remoteVideo = document.getElementById('remoteVideo');
const remoteCanvas = document.getElementById('remoteCanvas');
const videoOverlay = document.getElementById('videoOverlay');
const videoWrapper = document.getElementById('videoWrapper');
const pythonLinkCard = document.getElementById('pythonLinkCard');
const pythonStreamUrl = document.getElementById('pythonStreamUrl');
const btnCopyPythonUrl = document.getElementById('btnCopyPythonUrl');

const canvasContext = remoteCanvas ? remoteCanvas.getContext('2d') : null;

if (btnCopyPythonUrl) {
  btnCopyPythonUrl.addEventListener('click', () => {
    if (pythonStreamUrl && pythonStreamUrl.value) {
      navigator.clipboard.writeText(pythonStreamUrl.value);
      btnCopyPythonUrl.textContent = 'Copied!';
      setTimeout(() => {
        btnCopyPythonUrl.textContent = 'Copy';
      }, 2000);
    }
  });
}

// Support Room ID prefill from URL query param ?room=xyz
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
  roomIdInput.value = roomParam;
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

async function joinRoom() {
  clearError();
  clearInfo();

  const pin = accessPinInput.value.trim();
  const roomId = roomIdInput.value.trim();

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
    btnLeave.disabled = false;
    logDiagnostic(`Joined room "${roomId}" successfully [mode: ${response.mediaMode}].`);

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

  // Experimental zrok-tunneled binary video frame reception
  socket.on('tunnel:frame', (buffer) => {
    if (currentMediaMode !== 'tunnel-relay') {
      return;
    }

    if (tunnelStartTime === 0) {
      tunnelStartTime = Date.now();
      updateStatus('live', 'Live (zrok Tunnel Relay)');
      if (videoOverlay) videoOverlay.style.display = 'none';
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
      videoOverlay.style.display = 'none';
      remoteVideo.play().then(() => {
        updateStatus('live', 'Live Feed');
        logDiagnostic('[MEDIA] Playback started successfully.', 'INFO');
      }).catch((err) => {
        logDiagnostic(`[MEDIA] Auto-play blocked: ${err.message}. Click to play.`, 'WARN');
        showInfo('Click on the video player to start playback.');
      });
    },
    onConnectionStateChange: (state) => {
      logDiagnostic(`[P2P] Peer connection state: ${state}`, 'INFO');
      if (state === 'connected') {
        updateStatus('live', 'Live Feed');
        startStatsPolling();
      } else if (state === 'disconnected') {
        updateStatus('disconnected', 'Sender Disconnected');
        stopStatsPolling();
      } else if (state === 'failed') {
        updateStatus('error', 'Connection Failed');
        stopStatsPolling();
      }
    },
    onIceConnectionStateChange: (state) => {
      logDiagnostic(`[ICE] ICE Connection State: ${state}`, 'INFO');
      if (state === 'connected' || state === 'completed') {
        logDiagnostic('[ICE] ✓ WebRTC media connection established successfully!', 'INFO');
      } else if (state === 'failed') {
        logDiagnostic('[ICE] ❌ ICE connection failed! Direct P2P media could not connect.', 'ERROR');
        logDiagnostic('[DIAGNOSIS] Why does WebRTC fail between Windows & Android on the same Wi-Fi?', 'WARN');
        logDiagnostic('1. Android mDNS host candidate (.local) could not be resolved by Windows over LAN.', 'WARN');
        logDiagnostic('2. Wi-Fi client isolation or Windows Firewall blocking inbound peer UDP packets.', 'WARN');
        logDiagnostic('3. Router lacks NAT Loopback / Hairpinning to loop STUN srflx UDP packets on same LAN.', 'WARN');
        logDiagnostic('💡 FIX: Switch Media Transport Mode to "Experimental — Video through zrok" (Mode B) in the dropdown above, which routes frames reliably through the server WebSocket!', 'INFO');
      }
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
      videoOverlay.textContent = 'Sender stopped the stream.';
      videoOverlay.style.display = 'block';
    }
  });

  socket.on('peer:left', () => {
    logDiagnostic('[ROOM] Sender left the room.', 'INFO');
    updateStatus('waiting', 'Sender Left. Waiting...');
    pendingRemoteCandidates = [];
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject = null;
    }
    videoOverlay.textContent = 'Sender left the room. Waiting for reconnection...';
    videoOverlay.style.display = 'block';
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
  });

  socket.on('disconnect', (reason) => {
    logDiagnostic(`[SOCKET] Disconnected from signaling server (${reason})`, 'WARN');
    updateStatus('disconnected', 'Server Disconnected');
    stopStatsPolling();
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
  if (remoteCanvas && canvasContext) {
    canvasContext.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  }

  tunnelStartTime = 0;
  tunnelFramesReceived = 0;
  tunnelFramesDropped = 0;
  tunnelBytesReceived = 0;
  tunnelNextFrameBlob = null;
  tunnelIsRendering = false;

  videoOverlay.textContent = 'Enter Room ID and click "Join Room" to view stream';
  videoOverlay.style.display = 'block';

  if (pythonLinkCard) {
    pythonLinkCard.style.display = 'none';
  }

  btnJoin.disabled = false;
  btnLeave.disabled = true;
  pendingRemoteCandidates = [];
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

// Window unload cleanup
window.addEventListener('beforeunload', () => {
  leaveRoom();
});

// Initialize default state
setupDiagnosticsControls('btnCopyLogs', 'btnClearLogs', 'diagnosticsLog');
fetchIceServers().catch(() => {});
logDiagnostic('Viewer client ready.');
