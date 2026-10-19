/**
 * @file signaling.js
 * Socket.IO signaling event setup and validation.
 */

import { Server } from 'socket.io';
import { RoomManager } from './room-manager.js';
import { TunnelRelay } from './tunnel-relay.js';
import { RemoteControlManager } from './remote-control-manager.js';
import { ControlBridge } from './control-bridge.js';

export function setupSignaling(httpServer, config, logger) {
  const roomManager = new RoomManager(config.accessPin);
  const tunnelRelay = new TunnelRelay({ maxFrameSizeBytes: 600000, maxFps: 30 });
  const remoteControlManager = new RemoteControlManager({
    authFilePath: config.controlAuthFilePath,
    logger
  });
  const controlBridge = new ControlBridge({
    host: config.controlHelperHost || '127.0.0.1',
    port: config.controlHelperPort || 8765,
    authToken: config.controlHelperToken || '',
    logger
  });
  controlBridge.connect().catch(() => {});

  if (httpServer && typeof httpServer.on === 'function') {
    httpServer.on('close', () => {
      controlBridge.disconnect();
    });
  }

  const io = new Server(httpServer, {
    serveClient: false, // the browser client is served by server.js at /vendor/socket.io.js so it also works inside the standalone exe
    cors: {
      origin: config.corsOrigin === '*' ? true : config.corsOrigin,
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e6 // 1 MB limit to accommodate binary JPEG frames (<=500KB)
  });

  const failedAttempts = new Map(); // socketId -> { count: number, blockedUntil: number }

  // A viewer's chosen video priority is kept server-side so a sender that joins (or restarts) later still learns it
  const QualityModes = new Set(['fps', 'resolution', 'both']);
  const QualityEventLimit = 5;
  const QualityEventWindowMs = 5000;
  const viewerQualityModes = new Map(); // viewer socketId -> 'fps' | 'resolution' | 'both'
  const qualityEventTimes = new Map(); // viewer socketId -> recent event timestamps

  const roomChatHistories = new Map(); // roomId -> Array<ChatMessage>
  const MAX_CHAT_HISTORY = 50;

  function allowQualityEvent(socketId) {
    const now = Date.now();
    const recent = (qualityEventTimes.get(socketId) || []).filter((time) => now - time < QualityEventWindowMs);
    if (recent.length >= QualityEventLimit) {
      qualityEventTimes.set(socketId, recent);
      return false;
    }
    recent.push(now);
    qualityEventTimes.set(socketId, recent);
    return true;
  }

  function forgetViewerQuality(socketId) {
    viewerQualityModes.delete(socketId);
    qualityEventTimes.delete(socketId);
  }

  // Tell the room's sender when MJPEG consumers appear or disappear so it uploads frames only on demand
  if (config.mjpegStreamer) {
    config.mjpegStreamer.onDemandChange = (roomId, active) => {
      // If the local PC viewer is already actively streaming WebRTC frames into the bridge,
      // never ask the phone camera to upload MJPEG frames
      if (active && config.hasLocalVcamBridge && config.hasLocalVcamBridge(roomId)) {
        return;
      }
      const room = roomManager.getRoom(roomId);
      if (room && room.senderSocketId) {
        io.to(room.senderSocketId).emit('mjpeg:demand', { active });
      }
    };
  }

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    // Join room event
    socket.on('room:join', (payload, callback) => {
      try {
        const now = Date.now();
        const record = failedAttempts.get(socket.id);
        if (record && record.blockedUntil > now) {
          const waitSecs = Math.ceil((record.blockedUntil - now) / 1000);
          const err = `Too many failed attempts. Please wait ${waitSecs} seconds before retrying.`;
          logger.warn(`Rate limited socket ${socket.id}`);
          if (typeof callback === 'function') callback({ success: false, error: err });
          return;
        }

        if (!payload || typeof payload !== 'object') {
          const err = 'Invalid payload format.';
          if (typeof callback === 'function') callback({ success: false, error: err });
          return;
        }

        const { roomId, role, pin, mediaMode, reconnect } = payload;
        let shouldReconnect = Boolean(reconnect);
        const existingRoom = roomManager.getRoom(roomId);
        if (existingRoom && existingRoom.senderSocketId && existingRoom.senderSocketId !== socket.id) {
          const oldSock = io.sockets.sockets.get(existingRoom.senderSocketId);
          if (!oldSock || !oldSock.connected) {
            shouldReconnect = true;
          }
        }

        const result = roomManager.createOrJoinRoom(roomId, role, socket.id, pin, mediaMode, {
          reconnect: shouldReconnect,
          studioMode: role === 'studio-sender'
        });

        if (!result.success) {
          const count = (record ? record.count : 0) + 1;
          const blockedUntil = count >= 5 ? now + 30000 : 0; // block for 30s after 5 failures
          failedAttempts.set(socket.id, { count, blockedUntil });

          logger.warn(`Join room failed: ${result.error} (socket: ${socket.id}, room: ${roomId})`);
          if (typeof callback === 'function') callback(result);
          return;
        }

        // Reset failures on success
        failedAttempts.delete(socket.id);

        if (result.evictedSenderId) {
          logger.info(`Evicting stale sender socket ${result.evictedSenderId} in room "${roomId}" for reconnected sender ${socket.id}`);
          const staleSock = io.sockets.sockets.get(result.evictedSenderId);
          if (staleSock) {
            // Tell the old sender it was replaced so it stops instead of auto-rejoining and evicting the new sender back.
            staleSock.emit('sender:evicted', { roomId, replacedBy: socket.id });
            staleSock.leave(roomId);
            staleSock.disconnect(true);
          }
          io.to(roomId).emit('peer:left', { role: 'sender', peerId: result.evictedSenderId });
        }

        socket.join(roomId);
        logger.info(`Socket ${socket.id} joined room "${roomId}" as ${role} [mode: ${result.mediaMode}]`);

        if (result.role === 'sender') {
          remoteControlManager.setSenderSocket(roomId, socket.id);
          const viewerQuality = {};
          for (const viewerId of Array.isArray(result.peerSocketIds) ? result.peerSocketIds : []) {
            if (viewerQualityModes.has(viewerId)) {
              viewerQuality[viewerId] = viewerQualityModes.get(viewerId);
            }
          }
          if (Object.keys(viewerQuality).length > 0) {
            result.viewerQuality = viewerQuality;
          }
          result.controlState = {
            enabled: remoteControlManager.isControlEnabled(roomId),
            sessionPin: remoteControlManager.getSessionPin(roomId),
            hasController: Boolean(remoteControlManager.getActiveController(roomId)),
            hasPermanentPassword: remoteControlManager.hasPermanentPassword()
          };
        } else {
          result.controlState = {
            enabled: remoteControlManager.isControlEnabled(roomId),
            hasController: Boolean(remoteControlManager.getActiveController(roomId)),
            hasPermanentPassword: remoteControlManager.hasPermanentPassword()
          };
        }

        if (typeof callback === 'function') {
          callback(result);
        }

        // A consumer may already be waiting on /stream/:roomId before the sender joins
        if (result.role === 'sender' && config.mjpegStreamer && config.mjpegStreamer.hasDemand(roomId)) {
          if (!config.hasLocalVcamBridge || !config.hasLocalVcamBridge(roomId)) {
            socket.emit('mjpeg:demand', { active: true });
          }
        }

        // Notify client and peer if peer is present
        if (result.hasPeer) {
          const targetPeers = Array.isArray(result.peerSocketIds) && result.peerSocketIds.length > 0
            ? result.peerSocketIds
            : (result.peerSocketId ? [result.peerSocketId] : []);
          for (const peerId of targetPeers) {
            io.to(peerId).emit('peer:joined', {
              role,
              mediaMode: result.mediaMode,
              peerId: socket.id
            });
          }
        }

        if (result.isStudio || roomManager.getRoom(roomId)?.isStudio) {
          const roomObj = roomManager.getRoom(roomId);
          if (roomObj && roomObj.senderSocketIds) {
            const cameras = Array.from(roomObj.senderSocketIds).map((id, idx) => ({
              id,
              label: `Camera ${idx + 1}`
            }));
            io.to(roomId).emit('studio:cameras', { cameras });
          }
        }
      } catch (err) {
        logger.error(`Error in room:join: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal server error' });
        }
      }
    });

    // WebRTC Offer relay
    socket.on('webrtc:offer', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership) {
        socket.emit('room:error', { message: 'Unauthorized: Not in a room.' });
        return;
      }

      if (!payload || typeof payload.sdp !== 'string' || typeof payload.type !== 'string') {
        socket.emit('room:error', { message: 'Malformed SDP offer payload.' });
        return;
      }

      const room = roomManager.getRoom(membership.roomId);
      if (!room) {
        return;
      }

      // If sender emitted offer with target viewerId (or payload.targetId)
      if (membership.role === 'sender') {
        const explicitTargetId = payload.targetId || payload.viewerId;
        if (!explicitTargetId && room.viewerSocketIds.size > 1) {
          // A sender page loaded before multi-viewer support never names a viewer; guessing would hand every
          // offer to the first viewer and leave the others stuck on "Negotiating connection...".
          logger.warn(`Rejected untargeted offer from sender ${socket.id}: ${room.viewerSocketIds.size} viewers in room`);
          socket.emit('room:error', { message: 'This sender page is outdated and cannot serve several viewers. Reload the sender page (hard refresh) and start streaming again.' });
          return;
        }
        const targetId = explicitTargetId || roomManager.getPeerSocketId(socket.id);
        if (targetId && room.viewerSocketIds.has(targetId)) {
          logger.debug(`Relaying SDP offer from sender ${socket.id} to viewer ${targetId}`);
          io.to(targetId).emit('webrtc:offer', {
            sdp: payload.sdp,
            type: payload.type,
            senderId: socket.id
          });
        }
      } else {
        // If an external receiver offers to sender
        if (room.senderSocketId) {
          logger.debug(`Relaying SDP offer from receiver ${socket.id} to sender ${room.senderSocketId}`);
          io.to(room.senderSocketId).emit('webrtc:offer', {
            sdp: payload.sdp,
            type: payload.type,
            senderId: socket.id
          });
        }
      }
    });

    // WebRTC Answer relay
    socket.on('webrtc:answer', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership) {
        socket.emit('room:error', { message: 'Unauthorized: Not in a room.' });
        return;
      }

      if (!payload || typeof payload.sdp !== 'string' || typeof payload.type !== 'string') {
        socket.emit('room:error', { message: 'Malformed SDP answer payload.' });
        return;
      }

      const room = roomManager.getRoom(membership.roomId);
      if (!room) {
        return;
      }

      if (membership.role === 'viewer') {
        // Viewer answering sender
        const targetSenderId = payload.targetId || payload.senderId || room.senderSocketId;
        if (targetSenderId) {
          logger.debug(`Relaying SDP answer from viewer ${socket.id} to sender ${targetSenderId}`);
          io.to(targetSenderId).emit('webrtc:answer', {
            sdp: payload.sdp,
            type: payload.type,
            senderId: socket.id
          });
        }
      } else {
        // Sender answering external receiver offer
        const targetId = payload.targetId || payload.viewerId || roomManager.getPeerSocketId(socket.id);
        if (targetId && room.viewerSocketIds.has(targetId)) {
          logger.debug(`Relaying SDP answer from sender ${socket.id} to receiver ${targetId}`);
          io.to(targetId).emit('webrtc:answer', {
            sdp: payload.sdp,
            type: payload.type,
            senderId: socket.id
          });
        }
      }
    });

    // ICE Candidate relay
    socket.on('webrtc:ice-candidate', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership) {
        socket.emit('room:error', { message: 'Unauthorized: Not in a room.' });
        return;
      }

      if (!payload || (!payload.candidate && payload.candidate !== '')) {
        return;
      }

      const room = roomManager.getRoom(membership.roomId);
      if (!room) {
        return;
      }

      if (membership.role === 'sender') {
        const targetId = payload.targetId || payload.viewerId;
        if (targetId && room.viewerSocketIds.has(targetId)) {
          io.to(targetId).emit('webrtc:ice-candidate', {
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
            senderId: socket.id
          });
        } else {
          // If no specific targetId given, broadcast candidate to all viewers in room
          for (const viewerId of room.viewerSocketIds) {
            io.to(viewerId).emit('webrtc:ice-candidate', {
              candidate: payload.candidate,
              sdpMid: payload.sdpMid,
              sdpMLineIndex: payload.sdpMLineIndex,
              senderId: socket.id
            });
          }
        }
      } else {
        // Viewer sending ICE candidate to sender
        const targetSenderId = payload.targetId || payload.senderId || room.senderSocketId;
        if (targetSenderId) {
          io.to(targetSenderId).emit('webrtc:ice-candidate', {
            candidate: payload.candidate,
            sdpMid: payload.sdpMid,
            sdpMLineIndex: payload.sdpMLineIndex,
            senderId: socket.id
          });
        }
      }
    });

    // Experimental zrok-tunneled binary video frame relay
    socket.on('tunnel:frame', (data) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'sender') {
        return;
      }

      const room = roomManager.getRoom(membership.roomId);
      if (!room || room.viewerSocketIds.size === 0) {
        return; // No viewers connected to receive frame
      }

      const result = tunnelRelay.processIncomingFrame(membership.roomId, data);
      if (!result.valid) {
        logger.warn(`Rejected invalid tunnel frame from sender ${socket.id}: ${result.reason}`);
        return;
      }

      if (result.dropped) {
        // Drop stale frame under backpressure
        return;
      }

      // Forward raw binary buffer directly to all authorized viewers
      for (const viewerId of room.viewerSocketIds) {
        io.to(viewerId).emit('tunnel:frame', result.buffer);
      }
    });

    // Request tunnel relay stats
    socket.on('tunnel:stats', (callback) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership) {
        if (typeof callback === 'function') callback({ success: false, error: 'Unauthorized' });
        return;
      }
      const stats = tunnelRelay.getRoomStats(membership.roomId);
      if (typeof callback === 'function') {
        callback({ success: true, stats });
      }
    });

    // MJPEG Frame upload from sender for Python/HTTP inference
    socket.on('mjpeg:frame', (data) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'sender') {
        return;
      }

      if (!config.mjpegStreamer || !config.mjpegStreamer.hasDemand(membership.roomId)) {
        return;
      }

      // data can be a binary Buffer / ArrayBuffer or binary base64
      let buffer = null;
      if (Buffer.isBuffer(data)) {
        buffer = data;
      } else if (data instanceof ArrayBuffer) {
        buffer = Buffer.from(data);
      } else if (typeof data === 'string' && data.startsWith('data:image/jpeg;base64,')) {
        buffer = Buffer.from(data.slice(23), 'base64');
      }

      if (buffer) {
        config.mjpegStreamer.broadcastFrame(membership.roomId, buffer);
      }
    });

    // Stream state announcement
    socket.on('stream:state', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'sender') {
        return;
      }

      const room = roomManager.getRoom(membership.roomId);
      if (room && payload && typeof payload.state === 'string') {
        for (const viewerId of room.viewerSocketIds) {
          io.to(viewerId).emit('stream:state', { state: payload.state });
        }
      }
    });

    // Intercom / talkback signaling event
    socket.on('intercom:message', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership) return;
      socket.to(membership.roomId).emit('intercom:message', {
        senderId: socket.id,
        role: membership.role,
        message: payload?.message || 'Chime',
        type: payload?.type || 'chime',
        timestamp: Date.now()
      });
    });

    // A viewer chooses whether its video stays at constant FPS, constant resolution, or both; relay it to the sender
    socket.on('viewer:quality-priority', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'viewer') {
        return;
      }
      const mode = payload && typeof payload.mode === 'string' ? payload.mode : '';
      if (!QualityModes.has(mode) || !allowQualityEvent(socket.id)) {
        return;
      }
      const previous = viewerQualityModes.get(socket.id);
      viewerQualityModes.set(socket.id, mode);
      if (previous === mode) {
        return;
      }
      const room = roomManager.getRoom(membership.roomId);
      if (room && room.senderSocketId) {
        io.to(room.senderSocketId).emit('viewer:quality-priority', { viewerId: socket.id, mode });
      }
    });

    // Sender battery status broadcast to viewers
    socket.on('sender:battery', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'sender') {
        return;
      }
      const room = roomManager.getRoom(membership.roomId);
      if (room && payload) {
        const batteryData = {
          level: typeof payload.level === 'number' ? Math.round(payload.level) : null,
          charging: Boolean(payload.charging)
        };
        for (const viewerId of room.viewerSocketIds) {
          io.to(viewerId).emit('sender:battery', batteryData);
        }
      }
    });

    // Leave room
    socket.on('room:leave', () => {
      forgetViewerQuality(socket.id);
      const leaveResult = roomManager.leave(socket.id);
      if (leaveResult) {
        socket.leave(leaveResult.roomId);
        logger.info(`Socket ${socket.id} left room "${leaveResult.roomId}"`);
        if (leaveResult.role === 'sender') {
          for (const vId of leaveResult.peerSocketIds) {
            io.to(vId).emit('peer:left', { role: leaveResult.role, peerId: socket.id });
          }
          tunnelRelay.cleanRoom(leaveResult.roomId);
        } else {
          if (leaveResult.peerSocketId) {
            io.to(leaveResult.peerSocketId).emit('peer:left', { role: leaveResult.role, peerId: socket.id });
          }
        }
        if (leaveResult.isStudio) {
          const roomObj = roomManager.getRoom(leaveResult.roomId);
          const cameras = roomObj && roomObj.senderSocketIds ? Array.from(roomObj.senderSocketIds).map((id, idx) => ({
            id,
            label: `Camera ${idx + 1}`
          })) : [];
          io.to(leaveResult.roomId).emit('studio:cameras', { cameras });
        }
      }
    });

    // Remote Desktop Control: Enable / Disable toggle by sender
    socket.on('control:enable', (payload, callback) => {
      try {
        if (!payload || typeof payload !== 'object' || typeof payload.roomId !== 'string') {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Invalid payload.' });
          }
          return;
        }
        const { roomId, enabled, pin } = payload;
        const membership = roomManager.getMembership(socket.id);
        const isAuthorizedSender = (membership && membership.roomId === roomId && membership.role === 'sender') ||
          (pin && pin === config.accessPin);
        if (!isAuthorizedSender) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Unauthorized. Only sender can toggle remote control.' });
          }
          return;
        }

        const res = remoteControlManager.setControlEnabled(roomId, enabled);
        let sessionPin = null;
        if (enabled) {
          sessionPin = remoteControlManager.getSessionPin(roomId) || remoteControlManager.generateSessionPin(roomId);
        }

        if (res.revokedControllerId) {
          controlBridge.releaseAll();
          io.to(res.revokedControllerId).emit('control:revoked', { reason: 'control_disabled' });
        }

        io.to(roomId).emit('control:state', {
          enabled: Boolean(enabled),
          hasController: Boolean(remoteControlManager.getActiveController(roomId)),
          hasPermanentPassword: remoteControlManager.hasPermanentPassword()
        });

        if (typeof callback === 'function') {
          callback({
            success: true,
            enabled: Boolean(enabled),
            sessionPin,
            hasPermanentPassword: remoteControlManager.hasPermanentPassword()
          });
        }
      } catch (err) {
        logger.error(`Error in control:enable: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Regenerate ephemeral session PIN
    socket.on('control:pin:regenerate', (payload, callback) => {
      try {
        if (!payload || typeof payload !== 'object' || typeof payload.roomId !== 'string') {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Invalid payload.' });
          }
          return;
        }
        const { roomId, pin } = payload;
        const membership = roomManager.getMembership(socket.id);
        const isAuthorizedSender = (membership && membership.roomId === roomId && membership.role === 'sender') ||
          (pin && pin === config.accessPin);
        if (!isAuthorizedSender) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Unauthorized. Only sender can regenerate PIN.' });
          }
          return;
        }

        const newPin = remoteControlManager.generateSessionPin(roomId);
        logger.info(`Session PIN regenerated for room "${roomId}"`);
        if (typeof callback === 'function') {
          callback({ success: true, sessionPin: newPin });
        }
      } catch (err) {
        logger.error(`Error in control:pin:regenerate: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Set permanent password
    socket.on('control:password:set', (payload, callback) => {
      try {
        if (!payload || typeof payload !== 'object' || typeof payload.password !== 'string') {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Invalid password format.' });
          }
          return;
        }
        const membership = roomManager.getMembership(socket.id);
        const pin = payload.pin;
        const isAuthorized = (membership && membership.role === 'sender') ||
          (pin && pin === config.accessPin);
        if (!isAuthorized) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Unauthorized. Only sender can set control password.' });
          }
          return;
        }

        const res = remoteControlManager.setPermanentPassword(payload.password);
        if (res.success) {
          logger.info(`Permanent control password updated by sender ${socket.id}`);
          const targetRoomId = membership ? membership.roomId : null;
          if (targetRoomId) {
            io.to(targetRoomId).emit('control:state', {
              enabled: remoteControlManager.isControlEnabled(targetRoomId),
              hasController: Boolean(remoteControlManager.getActiveController(targetRoomId)),
              hasPermanentPassword: true
            });
          }
        }
        if (typeof callback === 'function') {
          callback(res);
        }
      } catch (err) {
        logger.error(`Error in control:password:set: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Clear permanent password
    socket.on('control:password:clear', (payload, callback) => {
      try {
        const cb = typeof callback === 'function' ? callback : (typeof payload === 'function' ? payload : null);
        const pin = payload && typeof payload === 'object' && typeof payload.pin === 'string' ? payload.pin : null;
        const membership = roomManager.getMembership(socket.id);
        const isAuthorized = (membership && membership.role === 'sender') ||
          (pin && pin === config.accessPin);
        if (!isAuthorized) {
          if (typeof cb === 'function') {
            cb({ success: false, error: 'Unauthorized.' });
          }
          return;
        }

        const res = remoteControlManager.clearPermanentPassword();
        const targetRoomId = membership ? membership.roomId : null;
        if (targetRoomId) {
          io.to(targetRoomId).emit('control:state', {
            enabled: remoteControlManager.isControlEnabled(targetRoomId),
            hasController: Boolean(remoteControlManager.getActiveController(targetRoomId)),
            hasPermanentPassword: false
          });
        }
        if (typeof cb === 'function') {
          cb(res);
        }
      } catch (err) {
        const cb = typeof callback === 'function' ? callback : (typeof payload === 'function' ? payload : null);
        if (typeof cb === 'function') {
          cb({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Check if permanent password exists
    socket.on('control:password:has', (callback) => {
      if (typeof callback === 'function') {
        callback({ hasPassword: remoteControlManager.hasPermanentPassword() });
      }
    });

    // Remote Desktop Control: Request lease
    socket.on('control:request-lease', (payload, callback) => {
      try {
        if (!payload || typeof payload !== 'object' || typeof payload.roomId !== 'string' || typeof payload.credential !== 'string') {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Invalid request payload.' });
          }
          return;
        }
        const { roomId, credential, controllerToken } = payload;
        const membership = roomManager.getMembership(socket.id);
        if (!membership || membership.roomId !== roomId || membership.role !== 'viewer') {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Only room viewers can request control.' });
          }
          return;
        }

        const clientIp = socket.handshake.address;
        const leaseResult = remoteControlManager.requestLease(roomId, socket.id, credential, {
          controllerToken,
          clientIp
        });

        if (leaseResult.success) {
          logger.info(`Control lease granted to viewer ${socket.id} in room "${roomId}" (reconnected: ${Boolean(leaseResult.reconnected)})`);
          const room = roomManager.getRoom(roomId);
          if (room && room.senderSocketId) {
            io.to(room.senderSocketId).emit('control:controller-joined', {
              controllerId: socket.id,
              reconnected: Boolean(leaseResult.reconnected)
            });
          }
          io.to(roomId).emit('control:state', {
            enabled: true,
            hasController: true,
            controllerId: socket.id
          });
        } else {
          logger.warn(`Control lease request rejected for ${socket.id} in room "${roomId}": ${leaseResult.error}`);
        }

        if (typeof callback === 'function') {
          callback(leaseResult);
        }
      } catch (err) {
        logger.error(`Error in control:request-lease: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Release lease
    socket.on('control:release', (payload, callback) => {
      try {
        const roomId = payload && payload.roomId;
        const membership = roomManager.getMembership(socket.id);
        if (!membership || !roomId) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Invalid request.' });
          }
          return;
        }

        const res = remoteControlManager.releaseLease(roomId, socket.id);
        if (res.success) {
          controlBridge.releaseAll();
          logger.info(`Viewer ${socket.id} voluntarily released control in room "${roomId}"`);
          const room = roomManager.getRoom(roomId);
          if (room && room.senderSocketId) {
            io.to(room.senderSocketId).emit('control:controller-left', {
              controllerId: socket.id,
              reason: 'released'
            });
          }
          io.to(roomId).emit('control:state', {
            enabled: remoteControlManager.isControlEnabled(roomId),
            hasController: false,
            inGrace: false
          });
        }
        if (typeof callback === 'function') {
          callback(res);
        }
      } catch (err) {
        logger.error(`Error in control:release: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Revoke lease by host
    socket.on('control:revoke', (payload, callback) => {
      try {
        const roomId = payload && payload.roomId;
        const membership = roomManager.getMembership(socket.id);
        if (!membership || membership.role !== 'sender' || !roomId) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Unauthorized.' });
          }
          return;
        }

        const res = remoteControlManager.revokeLease(roomId);
        if (res.revokedControllerId) {
          controlBridge.releaseAll();
          logger.info(`Sender ${socket.id} revoked control for ${res.revokedControllerId} in room "${roomId}"`);
          io.to(res.revokedControllerId).emit('control:revoked', { reason: 'revoked_by_host' });
          io.to(roomId).emit('control:state', {
            enabled: remoteControlManager.isControlEnabled(roomId),
            hasController: false,
            inGrace: false
          });
        }
        if (typeof callback === 'function') {
          callback({ success: true, revoked: Boolean(res.revokedControllerId) });
        }
      } catch (err) {
        logger.error(`Error in control:revoke: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal error.' });
        }
      }
    });

    // Remote Desktop Control: Fallback signaling input relay
    socket.on('control:input', (payload) => {
      try {
        if (!payload || typeof payload !== 'object' || typeof payload.roomId !== 'string' || !payload.event) {
          return;
        }
        const { roomId, event } = payload;
        const membership = roomManager.getMembership(socket.id);
        const isDirectController = remoteControlManager.isController(roomId, socket.id);
        const activeControllerId = remoteControlManager.getActiveController(roomId);
        const isHostForwarding = Boolean(membership && membership.role === 'sender' && activeControllerId);

        if (!isDirectController && !isHostForwarding) {
          return;
        }

        const effectiveControllerId = isDirectController ? socket.id : activeControllerId;
        remoteControlManager.touchController(roomId, effectiveControllerId);
        controlBridge.sendInput(event);

        const room = roomManager.getRoom(roomId);
        if (room && room.senderSocketId && isDirectController) {
          io.to(room.senderSocketId).emit('control:input', event);
        }
      } catch (err) {
        logger.error(`Error in control:input: ${err.message}`);
      }
    });

    // Studio camera switcher event
    socket.on('studio:switch', (payload) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'viewer') {
        return;
      }
      const room = roomManager.getRoom(membership.roomId);
      if (!room || !room.isStudio) {
        return;
      }
      const targetCameraId = payload && payload.cameraId;
      if (targetCameraId && room.senderSocketIds && room.senderSocketIds.has(targetCameraId)) {
        room.senderSocketId = targetCameraId;
        io.to(membership.roomId).emit('studio:switched', {
          activeCameraId: targetCameraId
        });
      }
    });

    // In-room Chat Message Relay
    socket.on('chat:message', (payload, callback) => {
      try {
        const membership = roomManager.getMembership(socket.id);
        if (!membership) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Unauthorized: Not joined in a room.' });
          }
          return;
        }

        if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string') {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Malformed message payload.' });
          }
          return;
        }

        const rawText = payload.text.trim();
        if (rawText.length === 0) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Message text cannot be empty.' });
          }
          return;
        }

        if (rawText.length > 2000) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Message exceeds maximum length (2000 characters).' });
          }
          return;
        }

        const senderName = typeof payload.senderName === 'string' && payload.senderName.trim().length > 0
          ? payload.senderName.trim().slice(0, 40)
          : (membership.role === 'sender' ? 'Streamer' : 'Viewer');

        const senderUserId = typeof payload.senderUserId === 'string' && payload.senderUserId.trim().length > 0
          ? payload.senderUserId.trim().slice(0, 64)
          : null;

        const message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          roomId: membership.roomId,
          senderId: socket.id,
          senderUserId,
          senderRole: membership.role,
          senderName,
          text: rawText,
          timestamp: Date.now()
        };

        let history = roomChatHistories.get(membership.roomId);
        if (!history) {
          history = [];
          roomChatHistories.set(membership.roomId, history);
        }
        history.push(message);
        if (history.length > MAX_CHAT_HISTORY) {
          history.shift();
        }

        io.to(membership.roomId).emit('chat:message', message);

        if (typeof callback === 'function') {
          callback({ success: true, messageId: message.id, timestamp: message.timestamp });
        }
      } catch (err) {
        logger.error(`Error in chat:message: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal server error' });
        }
      }
    });

    // In-room Chat History Request
    socket.on('chat:history', (payload, callback) => {
      try {
        const membership = roomManager.getMembership(socket.id);
        if (!membership) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Unauthorized: Not joined in a room.' });
          }
          return;
        }

        const history = roomChatHistories.get(membership.roomId) || [];
        if (typeof callback === 'function') {
          callback({ success: true, messages: history });
        }
      } catch (err) {
        logger.error(`Error in chat:history: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Internal server error' });
        }
      }
    });

    // In-room Name Change Notification
    socket.on('chat:name-change', (payload) => {
      try {
        const membership = roomManager.getMembership(socket.id);
        if (!membership) {
          return;
        }

        if (!payload || typeof payload !== 'object') {
          return;
        }

        const oldName = typeof payload.oldName === 'string' ? payload.oldName.trim().slice(0, 40) : '';
        const newName = typeof payload.newName === 'string' ? payload.newName.trim().slice(0, 40) : '';
        if (!newName || oldName === newName) {
          return;
        }

        const sysMessage = {
          id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          roomId: membership.roomId,
          isSystem: true,
          text: `"${oldName || 'A participant'}" changed their name to "${newName}"`,
          timestamp: Date.now()
        };

        let history = roomChatHistories.get(membership.roomId);
        if (!history) {
          history = [];
          roomChatHistories.set(membership.roomId, history);
        }
        history.push(sysMessage);
        if (history.length > MAX_CHAT_HISTORY) {
          history.shift();
        }

        io.to(membership.roomId).emit('chat:system', sysMessage);
      } catch (err) {
        logger.error(`Error in chat:name-change: ${err.message}`);
      }
    });

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} (${reason})`);
      failedAttempts.delete(socket.id);
      forgetViewerQuality(socket.id);

      const ctrlEvents = remoteControlManager.handleSocketDisconnect(socket.id);
      for (const ev of ctrlEvents) {
        if (ev.wasController) {
          controlBridge.releaseAll();
          const roomObj = roomManager.getRoom(ev.roomId);
          if (roomObj && roomObj.senderSocketId) {
            io.to(roomObj.senderSocketId).emit('control:controller-disconnected', {
              controllerId: socket.id,
              inGrace: ev.inGrace
            });
          }
        } else if (ev.wasSender) {
          controlBridge.releaseAll();
          if (ev.revokedControllerId) {
            io.to(ev.revokedControllerId).emit('control:revoked', { reason: 'sender_disconnected' });
          }
        }
      }

      const leaveResult = roomManager.leave(socket.id);
      if (leaveResult) {
        socket.leave(leaveResult.roomId);
        logger.info(`Socket ${socket.id} disconnected from room "${leaveResult.roomId}"`);
        if (leaveResult.role === 'sender') {
          for (const vId of leaveResult.peerSocketIds) {
            io.to(vId).emit('peer:left', { role: leaveResult.role, peerId: socket.id });
          }
          tunnelRelay.cleanRoom(leaveResult.roomId);
          remoteControlManager.cleanRoom(leaveResult.roomId);
        } else {
          if (leaveResult.peerSocketId) {
            io.to(leaveResult.peerSocketId).emit('peer:left', { role: leaveResult.role, peerId: socket.id });
          }
        }
        if (leaveResult.isStudio) {
          const roomObj = roomManager.getRoom(leaveResult.roomId);
          const cameras = roomObj && roomObj.senderSocketIds ? Array.from(roomObj.senderSocketIds).map((id, idx) => ({
            id,
            label: `Camera ${idx + 1}`
          })) : [];
          io.to(leaveResult.roomId).emit('studio:cameras', { cameras });
        }
        if (!roomManager.getRoom(leaveResult.roomId)) {
          roomChatHistories.delete(leaveResult.roomId);
        }
      }
    });
  });

  return { io, roomManager, remoteControlManager, controlBridge, roomChatHistories };
}

