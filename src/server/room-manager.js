/**
 * @file room-manager.js
 * In-memory room manager enforcing 1-sender and 1-viewer capacity,
 * authentication via access PIN, and state cleanup.
 */

export class RoomManager {
  constructor(accessPin) {
    this.accessPin = accessPin;
    // Map<roomId, { senderSocketId: string|null, viewerSocketId: string|null, createdAt: number, lastActiveAt: number }>
    this.rooms = new Map();
    // Map<socketId, { roomId: string, role: 'sender'|'viewer' }>
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

  createOrJoinRoom(roomId, role, socketId, pin) {
    if (!this.validatePin(pin)) {
      return { success: false, error: 'Invalid access PIN' };
    }

    if (!this.validateRoomId(roomId)) {
      return { success: false, error: 'Invalid Room ID. Must be 3-32 alphanumeric characters.' };
    }

    if (role !== 'sender' && role !== 'viewer') {
      return { success: false, error: 'Invalid role. Must be "sender" or "viewer".' };
    }

    // Check if socket is already in a room
    if (this.socketToRoom.has(socketId)) {
      this.leave(socketId);
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        senderSocketId: null,
        viewerSocketId: null,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      };
      this.rooms.set(roomId, room);
    }

    if (role === 'sender') {
      if (room.senderSocketId && room.senderSocketId !== socketId) {
        return { success: false, error: 'Room already has an active sender.' };
      }
      room.senderSocketId = socketId;
    } else {
      if (room.viewerSocketId && room.viewerSocketId !== socketId) {
        return { success: false, error: 'Room already has an active viewer.' };
      }
      room.viewerSocketId = socketId;
    }

    room.lastActiveAt = Date.now();
    this.socketToRoom.set(socketId, { roomId, role });

    return {
      success: true,
      roomId,
      role,
      hasPeer: Boolean(role === 'sender' ? room.viewerSocketId : room.senderSocketId),
      peerSocketId: role === 'sender' ? room.viewerSocketId : room.senderSocketId
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

    return membership.role === 'sender' ? room.viewerSocketId : room.senderSocketId;
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
    if (role === 'sender') {
      room.senderSocketId = null;
      peerSocketId = room.viewerSocketId;
    } else {
      room.viewerSocketId = null;
      peerSocketId = room.senderSocketId;
    }

    // If both left, delete room
    if (!room.senderSocketId && !room.viewerSocketId) {
      this.rooms.delete(roomId);
    } else {
      room.lastActiveAt = Date.now();
    }

    return { roomId, role, peerSocketId };
  }

  cleanStaleRooms(maxAgeMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [roomId, room] of this.rooms.entries()) {
      if (!room.senderSocketId && !room.viewerSocketId) {
        this.rooms.delete(roomId);
        cleaned++;
      } else if (now - room.lastActiveAt > maxAgeMs) {
        if (room.senderSocketId) this.socketToRoom.delete(room.senderSocketId);
        if (room.viewerSocketId) this.socketToRoom.delete(room.viewerSocketId);
        this.rooms.delete(roomId);
        cleaned++;
      }
    }
    return cleaned;
  }
}
