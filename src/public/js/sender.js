/**
 * @file sender.js
 * Sender client controller: handles camera capture, Socket.IO signaling,
 * and WebRTC peer connection to viewer.
 */

import { showError, clearError, showInfo, clearInfo, updateStatus, logDiagnostic } from './ui-utils.js';
import { CameraManager } from './camera-manager.js';
import { WebRtcPeer } from './webrtc-peer.js';

const cameraManager = new CameraManager();
let webrtcPeer = null;
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
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnToggleFacing = document.getElementById('btnToggleFacing');
const localVideo = document.getElementById('localVideo');
const videoOverlay = document.getElementById('videoOverlay');
const pythonLinkCard = document.getElementById('pythonLinkCard');
const pythonStreamUrl = document.getElementById('pythonStreamUrl');
const btnCopyPythonUrl = document.getElementById('btnCopyPythonUrl');

if (mediaModeSelect) {
  mediaModeSelect.addEventListener('change', () => {
    if (tunnelConfigPanel) {
      tunnelConfigPanel.style.display = mediaModeSelect.value === 'tunnel-relay' ? 'block' : 'none';
    }
  });
}

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

function generateRandomRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = 'room-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
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
    stream = await cameraManager.startCapture({
      deviceId: selectedDeviceId,
      width: 1280,
      height: 720,
      frameRate: 30
    });

    localVideo.srcObject = stream;
    videoOverlay.style.display = 'none';
    await localVideo.play().catch(() => {});
    logDiagnostic('Camera capture started.');

    // Once permission is granted, populate detailed device labels if available
    await populateCameraDevices();
  } catch (err) {
    updateStatus('error', 'Camera Error');
    showError(err.message);
    logDiagnostic(`Camera capture failed: ${err.message}`);
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

    // Display Direct Python Stream Link
    const streamUrl = `${window.location.origin}/stream/${roomId}?pin=${encodeURIComponent(pin)}`;
    if (pythonStreamUrl) {
      pythonStreamUrl.value = streamUrl;
    }
    if (pythonLinkCard) {
      pythonLinkCard.style.display = 'block';
    }
    logDiagnostic(`Python stream available at: ${streamUrl}`);

    // Start sending MJPEG frames for Python consumers
    startMjpegFrameLoop();

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
        updateStatus('connecting', 'Viewer present. Connecting WebRTC...');
        await initiateWebRtcConnection();
      } else {
        updateStatus('waiting', 'Waiting for Viewer / Python...');
        logDiagnostic('Waiting for viewer or Python consumer to connect.');
      }
    }
  });
}

async function initiateWebRtcConnection() {
  logDiagnostic('Creating WebRTC peer connection and SDP offer...');
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
    onConnectionStateChange: (state) => {
      logDiagnostic(`WebRTC Connection State: ${state}`);
      if (state === 'connected') {
        updateStatus('live', 'Live Streaming');
        socket.emit('stream:state', { state: 'live' });
        startStatsPolling();
      } else if (state === 'disconnected') {
        updateStatus('waiting', 'Viewer Disconnected');
        stopStatsPolling();
      } else if (state === 'failed') {
        updateStatus('error', 'P2P Connection Failed');
        stopStatsPolling();
      }
    },
    onIceConnectionStateChange: (state) => {
      logDiagnostic(`ICE Connection State: ${state}`);
    }
  });

  webrtcPeer.createPeerConnection();

  // Add captured tracks
  if (cameraManager.currentStream) {
    cameraManager.currentStream.getTracks().forEach((track) => {
      webrtcPeer.addTrack(track, cameraManager.currentStream);
    });
  }

  const offer = await webrtcPeer.createOffer();
  socket.emit('webrtc:offer', {
    sdp: offer.sdp,
    type: offer.type
  });
  logDiagnostic('Sent SDP offer to viewer.');
}

function setupSocketListeners() {
  socket.on('peer:joined', async (data) => {
    logDiagnostic(`Viewer joined (${data.peerId}) [mode: ${data.mediaMode || currentMediaMode}].`);
    if (currentMediaMode === 'tunnel-relay') {
      updateStatus('live', 'Live (zrok Tunnel Relay)');
      startTunnelFrameLoop();
    } else {
      updateStatus('connecting', 'Viewer Joined. Connecting WebRTC...');
      await initiateWebRtcConnection();
    }
  });

  socket.on('webrtc:offer', async (data) => {
    logDiagnostic('Received SDP offer from external receiver. Creating answer...');
    if (!webrtcPeer) {
      const iceServers = await fetchIceServers();
      webrtcPeer = new WebRtcPeer({
        iceServers,
        onIceCandidate: (candidate) => {
          socket.emit('webrtc:ice-candidate', {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex
          });
        },
        onConnectionStateChange: (state) => {
          logDiagnostic(`WebRTC Connection State: ${state}`);
          if (state === 'connected') {
            updateStatus('live', 'Live Streaming');
            socket.emit('stream:state', { state: 'live' });
            startStatsPolling();
          } else if (state === 'disconnected') {
            updateStatus('waiting', 'Receiver Disconnected');
            stopStatsPolling();
          } else if (state === 'failed') {
            updateStatus('error', 'P2P Connection Failed');
            stopStatsPolling();
          }
        },
        onIceConnectionStateChange: (state) => {
          logDiagnostic(`ICE Connection State: ${state}`);
        }
      });
      webrtcPeer.createPeerConnection();
      if (cameraManager.currentStream) {
        cameraManager.currentStream.getTracks().forEach((track) => {
          webrtcPeer.addTrack(track, cameraManager.currentStream);
        });
      }
    }

    try {
      const answer = await webrtcPeer.handleOffer(data);
      socket.emit('webrtc:answer', {
        sdp: answer.sdp,
        type: answer.type
      });
      logDiagnostic('Sent SDP answer to external receiver.');
    } catch (err) {
      logDiagnostic(`Error answering external offer: ${err.message}`);
    }
  });

  socket.on('webrtc:answer', async (data) => {
    logDiagnostic('Received SDP answer from receiver.');
    if (webrtcPeer) {
      await webrtcPeer.handleAnswer(data);
    }
  });

  socket.on('webrtc:ice-candidate', async (data) => {
    if (webrtcPeer) {
      await webrtcPeer.addIceCandidate(data);
    }
  });

  socket.on('peer:left', () => {
    logDiagnostic('Viewer left the room.');
    updateStatus('waiting', 'Viewer Left. Waiting...');
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
      if (stats && stats.rtt) {
        logDiagnostic(`WebRTC Stats: RTT=${stats.rtt}, Local=${stats.localCandidateType}, Remote=${stats.remoteCandidateType}`);
      }
    }
  }, 5000);
}

function stopStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

function startMjpegFrameLoop() {
  stopMjpegFrameLoop();
  // Capture frame every 66ms (~15 FPS) for Python inference stream
  mjpegInterval = setInterval(() => {
    if (!socket || !localVideo || !cameraManager.currentStream || localVideo.readyState < 2) {
      return;
    }

    const videoWidth = localVideo.videoWidth || 640;
    const videoHeight = localVideo.videoHeight || 480;

    // Resize canvas if dimensions changed
    if (mjpegCanvas.width !== videoWidth || mjpegCanvas.height !== videoHeight) {
      mjpegCanvas.width = videoWidth;
      mjpegCanvas.height = videoHeight;
    }

    mjpegContext.drawImage(localVideo, 0, 0, videoWidth, videoHeight);
    mjpegCanvas.toBlob((blob) => {
      if (blob && socket) {
        blob.arrayBuffer().then((buffer) => {
          socket.emit('mjpeg:frame', buffer);
        }).catch(() => {});
      }
    }, 'image/jpeg', 0.7);
  }, 66);
}

function stopMjpegFrameLoop() {
  if (mjpegInterval) {
    clearInterval(mjpegInterval);
    mjpegInterval = null;
  }
}

function startTunnelFrameLoop() {
  stopTunnelFrameLoop();

  tunnelStartTime = Date.now();
  tunnelFramesSent = 0;
  tunnelBytesSent = 0;
  tunnelEncodeTimes = [];

  const resVal = tunnelResolutionSelect ? tunnelResolutionSelect.value : '640x360';
  const [targetWidth, targetHeight] = resVal.split('x').map((n) => parseInt(n, 10));
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
          socket.emit('tunnel:frame', buffer);
          tunnelFramesSent += 1;
          tunnelBytesSent += buffer.byteLength;
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

  if (pythonLinkCard) {
    pythonLinkCard.style.display = 'none';
  }

  if (socket) {
    socket.emit('stream:state', { state: 'stopped' });
    socket.emit('room:leave');
  }

  if (webrtcPeer) {
    webrtcPeer.close();
    webrtcPeer = null;
  }

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
roomIdInput.value = generateRandomRoomId();
populateCameraDevices();
logDiagnostic('Sender client ready. Click "Start Streaming" to begin.');
