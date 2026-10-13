/**
 * @file signaling.js
 * Socket.IO signaling event setup and validation.
 */

import { Server } from 'socket.io';
import { RoomManager } from './room-manager.js';
import { TunnelRelay } from './tunnel-relay.js';

export function setupSignaling(httpServer, config, logger) {
  const roomManager = new RoomManager(config.accessPin);
  const tunnelRelay = new TunnelRelay({ maxFrameSizeBytes: 600000, maxFps: 30 });

  const io = new Server(httpServer, {
    serveClient: false, // the browser client is served by server.js at /vendor/socket.io.js so it also works inside the standalone exe
    cors: {
      origin: config.corsOrigin === '*' ? true : config.corsOrigin,
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e6 // 1 MB limit to accommodate binary JPEG frames (<=500KB)
  });

  const failedAttempts = new Map(); // socketId -> { count: number, blockedUntil: number }

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

        const { roomId, role, pin, mediaMode } = payload;
        const result = roomManager.createOrJoinRoom(roomId, role, socket.id, pin, mediaMode);

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

        socket.join(roomId);
        logger.info(`Socket ${socket.id} joined room "${roomId}" as ${role} [mode: ${result.mediaMode}]`);

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
        if (room.senderSocketId) {
          logger.debug(`Relaying SDP answer from viewer ${socket.id} to sender ${room.senderSocketId}`);
          io.to(room.senderSocketId).emit('webrtc:answer', {
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
        if (room.senderSocketId) {
          io.to(room.senderSocketId).emit('webrtc:ice-candidate', {
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

    // Leave room
    socket.on('room:leave', () => {
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
      }
    });

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} (${reason})`);
      failedAttempts.delete(socket.id);
      const leaveResult = roomManager.leave(socket.id);
      if (leaveResult) {
        socket.leave(leaveResult.roomId);
        logger.info(`Socket ${socket.id} disconnected from room "${leaveResult.roomId}"`);
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
      }
    });
  });

  return { io, roomManager };
}
