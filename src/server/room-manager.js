import crypto from 'node:crypto';
/**
 * @file room-manager.js
 * In-memory room manager enforcing 1-sender and 1-viewer capacity,
 * authentication via access PIN, and state cleanup.
 */

export class RoomManager {
  constructor(accessPin) {
    this.accessPin = accessPin;
    // Map<roomId, { senderSocketId: string|null, viewerSocketIds: Set<string>, mediaMode: string, createdAt: number, lastActiveAt: number }>
    this.rooms = new Map();
    // Map<socketId, { roomId: string, role: 'sender'|'viewer', mediaMode: string }>
    this.socketToRoom = new Map();
  }

  validatePin(pin) {
    return typeof pin === 'string' && pin.trim() === this.accessPin;
  }

  validateRoomId(roomId) {
    if (typeof roomId !== 'string') {
      return false;
    }
    const trimmed = roomId.trim();
    // 3 to 32 alphanumeric, hyphen or underscore chars
    return /^[a-zA-Z0-9_-]{3,32}$/.test(trimmed);
  }

  createOrJoinRoom(roomId, role, socketId, pin, mediaMode = 'webrtc', options = {}) {
    if (!this.validatePin(pin)) {
      return { success: false, error: 'Invalid access PIN' };
    }

    if (!this.validateRoomId(roomId)) {
      return { success: false, error: 'Invalid Room ID. Must be 3-32 alphanumeric characters.' };
    }

    // Support canonical roles: 'camera-sender' / 'sender', 'webrtc-receiver' / 'viewer', 'studio-sender'
    let normalizedRole = role;
    let isStudioSender = false;
    if (role === 'camera-sender') {
      normalizedRole = 'sender';
    } else if (role === 'studio-sender') {
      normalizedRole = 'sender';
      isStudioSender = true;
    } else if (role === 'webrtc-receiver') {
      normalizedRole = 'viewer';
    }

    if (normalizedRole !== 'sender' && normalizedRole !== 'viewer') {
      return { success: false, error: 'Invalid role. Must be "camera-sender" ("sender") or "webrtc-receiver" ("viewer").' };
    }

    // Validate mediaMode
    const normalizedMode = mediaMode === 'tunnel-relay' ? 'tunnel-relay' : 'webrtc';

    // Check if socket is already in a room
    if (this.socketToRoom.has(socketId)) {
      this.leave(socketId);
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        senderSocketId: null,
        senderSocketIds: new Set(),
        viewerSocketIds: new Set(),
        isStudio: isStudioSender || Boolean(options && options.studioMode),
        mediaMode: normalizedMode,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      };
      this.rooms.set(roomId, room);
    } else {
      // Validate that mediaMode matches room's established mode
      if (room.mediaMode !== normalizedMode) {
        return {
          success: false,
          error: `Media mode mismatch. This room is configured for "${room.mediaMode}" mode.`
        };
      }
      if (isStudioSender || (options && options.studioMode)) {
        room.isStudio = true;
      }
    }

    let evictedSenderId = null;
    if (normalizedRole === 'sender') {
      if (room.isStudio) {
        room.senderSocketIds.add(socketId);
        if (!room.senderSocketId) {
          room.senderSocketId = socketId;
        }
      } else {
        if (room.senderSocketId && room.senderSocketId !== socketId) {
          if (options && options.reconnect) {
            if (room.senderToken && options.senderToken && options.senderToken !== room.senderToken) {
              return { success: false, error: 'Unauthorized sender eviction: invalid sender token.' };
            }
            if (room.senderToken && !options.senderToken) {
              return { success: false, error: 'Unauthorized sender eviction: senderToken required.' };
            }
            evictedSenderId = room.senderSocketId;
            room.senderSocketIds.delete(evictedSenderId);
            this.socketToRoom.delete(evictedSenderId);
            room.senderSocketId = socketId;
            room.senderSocketIds.add(socketId);
          } else {
            return { success: false, error: 'Room already has an active sender.' };
          }
        } else {
          room.senderSocketId = socketId;
          room.senderSocketIds.add(socketId);
          if (!room.senderToken) {
            room.senderToken = (options && options.senderToken) || crypto.randomUUID();
          }
        }
      }
    } else {
      // Multiple concurrent viewers are allowed
      room.viewerSocketIds.add(socketId);
    }

    room.lastActiveAt = Date.now();
    this.socketToRoom.set(socketId, { roomId, role: normalizedRole, mediaMode: room.mediaMode });

    const hasPeer = normalizedRole === 'sender'
      ? room.viewerSocketIds.size > 0
      : Boolean(room.senderSocketId);

    const peerSocketId = normalizedRole === 'sender'
      ? (room.viewerSocketIds.size > 0 ? Array.from(room.viewerSocketIds)[0] : null)
      : room.senderSocketId;

    const peerSocketIds = normalizedRole === 'sender'
      ? Array.from(room.viewerSocketIds)
      : Array.from(room.senderSocketIds);

    return {
      success: true,
      roomId,
      role: normalizedRole,
      mediaMode: room.mediaMode,
      isStudio: Boolean(room.isStudio),
      hasPeer,
      peerSocketId,
      peerSocketIds,
      evictedSenderId,
      senderToken: room.senderToken || null
    };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getMembership(socketId) {
    return this.socketToRoom.get(socketId) || null;
  }

  getPeerSocketId(socketId) {
    const membership = this.socketToRoom.get(socketId);
    if (!membership) {
      return null;
    }

    const room = this.rooms.get(membership.roomId);
    if (!room) {
      return null;
    }

    if (membership.role === 'sender') {
      return room.viewerSocketIds.size > 0 ? Array.from(room.viewerSocketIds)[0] : null;
    }

    return room.senderSocketId;
  }

  getViewerSocketIds(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    return Array.from(room.viewerSocketIds);
  }

  getSenderSocketIds(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }
    return room.senderSocketIds ? Array.from(room.senderSocketIds) : (room.senderSocketId ? [room.senderSocketId] : []);
  }

  leave(socketId) {
    const membership = this.socketToRoom.get(socketId);
    if (!membership) {
      return null;
    }

    const { roomId, role } = membership;
    this.socketToRoom.delete(socketId);

    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    let peerSocketId = null;
    let peerSocketIds = [];
    if (role === 'sender') {
      if (room.senderSocketIds) {
        room.senderSocketIds.delete(socketId);
      }
      if (room.senderSocketId === socketId) {
        room.senderSocketId = room.senderSocketIds && room.senderSocketIds.size > 0
          ? Array.from(room.senderSocketIds)[0]
          : null;
      }
      peerSocketIds = Array.from(room.viewerSocketIds);
      peerSocketId = peerSocketIds.length > 0 ? peerSocketIds[0] : null;
    } else {
      room.viewerSocketIds.delete(socketId);
      peerSocketId = room.senderSocketId;
      if (peerSocketId) {
        peerSocketIds = room.senderSocketIds && room.senderSocketIds.size > 0
          ? Array.from(room.senderSocketIds)
          : [peerSocketId];
      }
    }

    // If both all senders and all viewers left, delete room
    const sendersRemaining = room.senderSocketIds ? room.senderSocketIds.size : (room.senderSocketId ? 1 : 0);
    if (sendersRemaining === 0 && room.viewerSocketIds.size === 0) {
      this.rooms.delete(roomId);
    } else {
      room.lastActiveAt = Date.now();
    }

    return { roomId, role, peerSocketId, peerSocketIds, socketId, isStudio: Boolean(room.isStudio) };
  }

  cleanStaleRooms(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      if (!room.senderSocketId && room.viewerSocketIds.size === 0) {
        this.rooms.delete(roomId);
        cleaned++;
      } else if (now - room.lastActiveAt > maxAgeMs) {
        if (room.senderSocketId) this.socketToRoom.delete(room.senderSocketId);
        for (const vId of room.viewerSocketIds) {
          this.socketToRoom.delete(vId);
        }
        this.rooms.delete(roomId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

