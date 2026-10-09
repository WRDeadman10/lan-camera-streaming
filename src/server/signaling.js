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

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    // Join room event
    socket.on('room:join', (payload, callback) => {
      try {
        if (!payload || typeof payload !== 'object') {
          const err = 'Invalid payload format.';
          if (typeof callback === 'function') callback({ success: false, error: err });
          return;
        }

        const { roomId, role, pin } = payload;
        const result = roomManager.createOrJoinRoom(roomId, role, socket.id, pin);

        if (!result.success) {
          logger.warn(`Join room failed: ${result.error} (socket: ${socket.id}, room: ${roomId})`);
          if (typeof callback === 'function') callback(result);
          return;
        }

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
