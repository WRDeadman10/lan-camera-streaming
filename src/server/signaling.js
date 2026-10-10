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
          socket.emit('mjpeg:demand', { active: true });
        }

        // Notify client and peer if peer is present
        if (result.hasPeer && result.peerSocketId) {
          io.to(result.peerSocketId).emit('peer:joined', {
            role,
            mediaMode: result.mediaMode,
            peerId: socket.id
          });
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

      const peerSocketId = roomManager.getPeerSocketId(socket.id);
      if (peerSocketId) {
        logger.debug(`Relaying SDP offer from ${socket.id} to ${peerSocketId}`);
        io.to(peerSocketId).emit('webrtc:offer', {
          sdp: payload.sdp,
          type: payload.type,
          senderId: socket.id
        });
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

      const peerSocketId = roomManager.getPeerSocketId(socket.id);
      if (peerSocketId) {
        logger.debug(`Relaying SDP answer from ${socket.id} to ${peerSocketId}`);
        io.to(peerSocketId).emit('webrtc:answer', {
          sdp: payload.sdp,
          type: payload.type,
          senderId: socket.id
        });
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

      const peerSocketId = roomManager.getPeerSocketId(socket.id);
      if (peerSocketId) {
        io.to(peerSocketId).emit('webrtc:ice-candidate', {
          candidate: payload.candidate,
          sdpMid: payload.sdpMid,
          sdpMLineIndex: payload.sdpMLineIndex
        });
      }
    });

    // Experimental zrok-tunneled binary video frame relay
    socket.on('tunnel:frame', (data) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'sender') {
        return;
      }

      const peerSocketId = roomManager.getPeerSocketId(socket.id);
      if (!peerSocketId) {
        return; // No viewer connected to receive frame
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

      // Forward raw binary buffer directly to authorized viewer
      io.to(peerSocketId).emit('tunnel:frame', result.buffer);
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

      const peerSocketId = roomManager.getPeerSocketId(socket.id);
      if (peerSocketId && payload && typeof payload.state === 'string') {
        io.to(peerSocketId).emit('stream:state', { state: payload.state });
      }
    });

    // Leave room
    socket.on('room:leave', () => {
      const leaveResult = roomManager.leave(socket.id);
      if (leaveResult) {
        socket.leave(leaveResult.roomId);
        logger.info(`Socket ${socket.id} left room "${leaveResult.roomId}"`);
        if (leaveResult.peerSocketId) {
          io.to(leaveResult.peerSocketId).emit('peer:left', {
            role: leaveResult.role
          });
        } else {
          tunnelRelay.cleanRoom(leaveResult.roomId);
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
        if (leaveResult.peerSocketId) {
          io.to(leaveResult.peerSocketId).emit('peer:left', {
            role: leaveResult.role
          });
        } else {
          tunnelRelay.cleanRoom(leaveResult.roomId);
        }
      }
    });
  });

  return { io, roomManager };
}
