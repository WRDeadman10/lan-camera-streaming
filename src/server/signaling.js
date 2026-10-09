/**
 * @file signaling.js
 * Socket.IO signaling event setup and validation.
 */

import { Server } from 'socket.io';
import { RoomManager } from './room-manager.js';

export function setupSignaling(httpServer, config, logger) {
  const roomManager = new RoomManager(config.accessPin);

  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin === '*' ? true : config.corsOrigin,
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e5 // 100 KB max payload limit to reject large malformed payloads
  });

  const failedAttempts = new Map(); // socketId -> { count: number, blockedUntil: number }

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

        const { roomId, role, pin } = payload;
        const result = roomManager.createOrJoinRoom(roomId, role, socket.id, pin);

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
        logger.info(`Socket ${socket.id} joined room "${roomId}" as ${role}`);

        if (typeof callback === 'function') {
          callback(result);
        }

        // Notify client and peer if peer is present
        if (result.hasPeer && result.peerSocketId) {
          io.to(result.peerSocketId).emit('peer:joined', {
            role,
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

    // MJPEG Frame upload from sender for Python/HTTP inference
    socket.on('mjpeg:frame', (data) => {
      const membership = roomManager.getMembership(socket.id);
      if (!membership || membership.role !== 'sender') {
        return;
      }

      if (!config.mjpegStreamer) {
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
        }
      }
    });
  });

  return { io, roomManager };
}
