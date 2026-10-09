/**
 * @file viewer.js
 * Viewer client controller: handles room join, Socket.IO signaling,
 * WebRTC answer creation, remote track rendering, and connection statistics.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic } from './ui-utils.js';
import { WebRtcPeer } from './webrtc-peer.js';

let webrtcPeer = null;
let socket = null;
let currentRoomId = null;
let currentMediaMode = 'webrtc';
let statsInterval = null;

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
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      return data.iceServers;
    }
  } catch (err) {
    logDiagnostic(`Failed to load ICE servers config: ${err.message}`);
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

  socket.on('webrtc:offer', async (data) => {
    if (currentMediaMode === 'tunnel-relay') {
      return; // Ignore WebRTC offers when in tunnel-relay mode
    }
    logDiagnostic('Received WebRTC offer from sender. Creating answer...');
    updateStatus('connecting', 'Negotiating connection...');

    const iceServers = await fetchIceServers();

    if (webrtcPeer) {
      webrtcPeer.close();
    }

    webrtcPeer = new WebRtcPeer({
      iceServers,
      onIceCandidate: (candidate) => {
        socket.emit('webrtc:ice-candidate', {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex
        });
      },
      onTrack: (remoteStream) => {
        logDiagnostic('Remote video track received!');
        remoteVideo.srcObject = remoteStream;
        videoOverlay.style.display = 'none';
        remoteVideo.play().then(() => {
          updateStatus('live', 'Live Feed');
          logDiagnostic('Playback started.');
        }).catch((err) => {
          logDiagnostic(`Auto-play blocked: ${err.message}. Click to play.`);
          showInfo('Click on the video player to start playback.');
        });
      },
      onConnectionStateChange: (state) => {
        logDiagnostic(`WebRTC Connection State: ${state}`);
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
        logDiagnostic(`ICE Connection State: ${state}`);
      }
    });

    try {
      const answer = await webrtcPeer.handleOffer(data);
      socket.emit('webrtc:answer', {
        sdp: answer.sdp,
        type: answer.type
      });
      logDiagnostic('Sent WebRTC answer to sender.');
    } catch (err) {
      logDiagnostic(`Error answering offer: ${err.message}`);
      showError(`Signaling error: ${err.message}`);
    }
  });

  socket.on('webrtc:ice-candidate', async (data) => {
    if (webrtcPeer) {
      await webrtcPeer.addIceCandidate(data);
    }
  });

  socket.on('stream:state', (data) => {
    logDiagnostic(`Stream state update: ${data.state}`);
    if (data.state === 'stopped') {
      updateStatus('stopped', 'Stream Stopped by Sender');
      videoOverlay.textContent = 'Sender stopped the stream.';
      videoOverlay.style.display = 'block';
    }
  });

  socket.on('peer:left', () => {
    logDiagnostic('Sender left the room.');
    updateStatus('waiting', 'Sender Left. Waiting...');
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
    logDiagnostic(`Signaling error: ${data.message}`);
  });

  socket.on('disconnect', () => {
    logDiagnostic('Disconnected from signaling server.');
    updateStatus('disconnected', 'Server Disconnected');
    stopStatsPolling();
  });
}

function startStatsPolling() {
  stopStatsPolling();
  statsInterval = setInterval(async () => {
    if (webrtcPeer) {
      const stats = await webrtcPeer.getStatsReport();
      if (stats) {
        let text = `WebRTC:`;
        if (stats.rtt) text += ` RTT=${stats.rtt};`;
        if (stats.localCandidateType && stats.remoteCandidateType) {
          text += ` Path=${stats.localCandidateType} <-> ${stats.remoteCandidateType};`;
        }
        if (stats.frameWidth && stats.frameHeight) {
          text += ` Res=${stats.frameWidth}x${stats.frameHeight};`;
        }
        if (stats.framesPerSecond) {
          text += ` FPS=${stats.framesPerSecond};`;
        }
        logDiagnostic(text);
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
  updateStatus('disconnected', 'Disconnected');
  logDiagnostic('Left room.');
}

btnJoin.addEventListener('click', joinRoom);
btnLeave.addEventListener('click', leaveRoom);

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    videoWrapper.requestFullscreen().catch((err) => {
      logDiagnostic(`Fullscreen error: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
});

// Window unload cleanup
window.addEventListener('beforeunload', () => {
  leaveRoom();
});

logDiagnostic('Viewer client ready.');
