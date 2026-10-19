/**
 * @file remote-control-manager.js
 * Remote desktop control credentials, rate limiting, and single-controller lease management.
 * Strictly adheres to AGENTS.md conventions (explicit types, no var, timing-safe auth, safe release).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class RemoteControlManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.authFilePath]
   * @param {number} [options.gracePeriodMs=60000]
   * @param {number} [options.maxFailedAttempts=5]
   * @param {number} [options.rateLimitWindowMs=60000]
   * @param {number} [options.lockoutDurationMs=30000]
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.gracePeriodMs = typeof options.gracePeriodMs === 'number' ? options.gracePeriodMs : 60000;
    this.maxFailedAttempts = typeof options.maxFailedAttempts === 'number' ? options.maxFailedAttempts : 5;
    this.rateLimitWindowMs = typeof options.rateLimitWindowMs === 'number' ? options.rateLimitWindowMs : 60000;
    this.lockoutDurationMs = typeof options.lockoutDurationMs === 'number' ? options.lockoutDurationMs : 30000;
    this.logger = options.logger || console;

    // Resolve permanent auth storage path
    this.authFilePath = options.authFilePath || this._resolveDefaultAuthFilePath();

    // In-memory cache for permanent password credentials
    // { salt: string, passwordHash: string, algorithm: string, updatedAt: number } | null
    this.permanentAuth = this._loadPermanentAuth();

    // Map<roomId, RoomControlState>
    // RoomControlState: {
    //   enabled: boolean,
    //   sessionPin: string | null,
    //   senderSocketId: string | null,
    //   lease: {
    //     controllerSocketId: string,
    //     controllerIdentity: string,
    //     controllerToken: string,
    //     grantedAt: number,
    //     lastActiveAt: number,
    //     reconnectGraceUntil: number | null
    //   } | null
    // }
    this.rooms = new Map();

    // Rate limiting tracking: Map<identifier, { attempts: number[], blockedUntil: number }>
    this.rateLimits = new Map();
  }

  /**
   * Resolve default persistent auth file path on host system.
   * Prefers CONTROL_AUTH_FILE env var, then %LOCALAPPDATA%/LanCamera/control-auth.json, then local project file.
   * @private
   * @returns {string}
   */
  _resolveDefaultAuthFilePath() {
    if (process.env.CONTROL_AUTH_FILE) {
      return process.env.CONTROL_AUTH_FILE;
    }
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      return path.join(process.env.LOCALAPPDATA, 'LanCamera', 'control-auth.json');
    }
    return path.join(process.cwd(), '.control-auth.json');
  }

  /**
   * Load stored permanent auth credentials from disk.
   * @private
   * @returns {Object|null}
   */
  _loadPermanentAuth() {
    try {
      if (fs.existsSync(this.authFilePath)) {
        const raw = fs.readFileSync(this.authFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data.passwordHash === 'string' && typeof data.salt === 'string') {
          return {
            salt: data.salt,
            passwordHash: data.passwordHash,
            algorithm: data.algorithm || 'scrypt',
            updatedAt: data.updatedAt || Date.now()
          };
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to read control auth file at ${this.authFilePath}: ${err.message}`);
    }
    return null;
  }

  /**
   * Save permanent auth credentials to disk atomically.
   * @private
   * @param {Object} authData
   */
  _savePermanentAuth(authData) {
    try {
      const dir = path.dirname(this.authFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.authFilePath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(authData, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.authFilePath);
      this.permanentAuth = authData;
    } catch (err) {
      this.logger.error(`Failed to save control auth file at ${this.authFilePath}: ${err.message}`);
      throw new Error('Failed to persist permanent control password');
    }
  }

  /**
   * Set or update permanent control password.
   * @param {string} password - Raw password (min 6 chars)
   * @returns {{ success: boolean, error?: string }}
   */
  setPermanentPassword(password) {
    if (typeof password !== 'string' || password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters in length' };
    }

    const saltBuffer = crypto.randomBytes(16);
    const salt = saltBuffer.toString('hex');
    const hashBuffer = crypto.scryptSync(password, saltBuffer, 64);
    const passwordHash = hashBuffer.toString('hex');

    const authData = {
      salt,
      passwordHash,
      algorithm: 'scrypt',
      updatedAt: Date.now()
    };

    this._savePermanentAuth(authData);
    return { success: true };
  }

  /**
   * Clear configured permanent control password.
   * @returns {{ success: boolean }}
   */
  clearPermanentPassword() {
    this.permanentAuth = null;
    try {
      if (fs.existsSync(this.authFilePath)) {
        fs.unlinkSync(this.authFilePath);
      }
    } catch (err) {
      this.logger.warn(`Failed to delete control auth file: ${err.message}`);
    }
    return { success: true };
  }

  /**
   * Check if permanent control password is configured.
   * @returns {boolean}
   */
  hasPermanentPassword() {
    return Boolean(this.permanentAuth && this.permanentAuth.passwordHash && this.permanentAuth.salt);
  }

  /**
   * Verify candidate permanent password in constant time.
   * @param {string} candidate
   * @returns {boolean}
   */
  verifyPermanentPassword(candidate) {
    if (!this.hasPermanentPassword() || typeof candidate !== 'string' || candidate.length === 0) {
      return false;
    }

    try {
      const saltBuffer = Buffer.from(this.permanentAuth.salt, 'hex');
      const storedHashBuffer = Buffer.from(this.permanentAuth.passwordHash, 'hex');
      const candidateHashBuffer = crypto.scryptSync(candidate, saltBuffer, storedHashBuffer.length);

      if (storedHashBuffer.length !== candidateHashBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(storedHashBuffer, candidateHashBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Get or initialize room control state.
   * @param {string} roomId
   * @returns {Object}
   */
  getOrCreateRoom(roomId) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        enabled: false,
        sessionPin: null,
        senderSocketId: null,
        lease: null
      };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  /**
   * Generate a cryptographically secure 6-digit session PIN for a room.
   * @param {string} roomId
   * @returns {string} 6-digit PIN string (e.g. "492817")
   */
  generateSessionPin(roomId) {
    const room = this.getOrCreateRoom(roomId);
    const pinNumber = crypto.randomInt(100000, 1000000);
    const pinString = pinNumber.toString();
    room.sessionPin = pinString;
    return pinString;
  }

  /**
   * Get current session PIN for a room.
   * @param {string} roomId
   * @returns {string|null}
   */
  getSessionPin(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.sessionPin : null;
  }

  /**
   * Clear session PIN for a room.
   * @param {string} roomId
   */
  clearSessionPin(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.sessionPin = null;
    }
  }

  /**
   * Verify candidate session PIN in constant time.
   * @param {string} roomId
   * @param {string} candidatePin
   * @returns {boolean}
   */
  verifySessionPin(roomId, candidatePin) {
    const room = this.rooms.get(roomId);
    if (!room || !room.sessionPin || typeof candidatePin !== 'string') {
      return false;
    }

    const currentPin = room.sessionPin.trim();
    const candidate = candidatePin.trim();
    if (currentPin.length !== candidate.length) {
      return false;
    }

    const currentBuffer = Buffer.from(currentPin, 'utf8');
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return crypto.timingSafeEqual(currentBuffer, candidateBuffer);
  }

  /**
   * Enable or disable remote desktop control for a room.
   * If disabled while a lease is active, the lease is revoked.
   * @param {string} roomId
   * @param {boolean} enabled
   * @returns {{ enabled: boolean, revokedControllerId: string|null }}
   */
  setControlEnabled(roomId, enabled) {
    const room = this.getOrCreateRoom(roomId);
    room.enabled = Boolean(enabled);
    let revokedControllerId = null;

    if (!room.enabled && room.lease) {
      revokedControllerId = room.lease.controllerSocketId;
      room.lease = null;
    }

    return {
      enabled: room.enabled,
      revokedControllerId
    };
  }

  /**
   * Check if remote desktop control is enabled for a room.
   * @param {string} roomId
   * @returns {boolean}
   */
  isControlEnabled(roomId) {
    const room = this.rooms.get(roomId);
    return Boolean(room && room.enabled);
  }

  /**
   * Set or update the active sender socket for a room.
   * @param {string} roomId
   * @param {string|null} socketId
   */
  setSenderSocket(roomId, socketId) {
    const room = this.getOrCreateRoom(roomId);
    room.senderSocketId = socketId;
  }

  /**
   * Get sender socket ID for a room.
   * @param {string} roomId
   * @returns {string|null}
   */
  getSenderSocketId(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.senderSocketId : null;
  }

  /**
   * Check rate limit for an identifier (socketId or IP).
   * @param {string} identifier
   * @returns {{ allowed: boolean, retryAfter: number }}
   */
  checkRateLimit(identifier) {
    const now = Date.now();
    const record = this.rateLimits.get(identifier);
    if (!record) {
      return { allowed: true, retryAfter: 0 };
    }

    if (record.blockedUntil > now) {
      const waitSeconds = Math.ceil((record.blockedUntil - now) / 1000);
      return { allowed: false, retryAfter: waitSeconds };
    }

    // Filter attempts inside sliding window
    const recent = record.attempts.filter((timestamp) => now - timestamp < this.rateLimitWindowMs);
    record.attempts = recent;

    if (recent.length >= this.maxFailedAttempts) {
      record.blockedUntil = now + this.lockoutDurationMs;
      const waitSeconds = Math.ceil(this.lockoutDurationMs / 1000);
      return { allowed: false, retryAfter: waitSeconds };
    }

    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Record a failed authentication attempt.
   * @param {string} identifier
   */
  recordFailedAttempt(identifier) {
    const now = Date.now();
    let record = this.rateLimits.get(identifier);
    if (!record) {
      record = { attempts: [], blockedUntil: 0 };
      this.rateLimits.set(identifier, record);
    }
    record.attempts.push(now);
    if (record.attempts.length >= this.maxFailedAttempts) {
      record.blockedUntil = now + this.lockoutDurationMs;
    }
  }

  /**
   * Reset failed authentication attempts on successful auth.
   * @param {string} identifier
   */
  resetRateLimit(identifier) {
    this.rateLimits.delete(identifier);
  }

  /**
   * Request remote desktop control lease.
   * Validates control enabled, rate limiting, existing controller, and PIN/password credential.
   * Supports reconnection of the same controller during the 60-second grace period.
   * @param {string} roomId
   * @param {string} socketId
   * @param {string} credential - Session PIN or Permanent Password
   * @param {Object} [options]
   * @param {string} [options.controllerToken] - Token issued during original lease grant
   * @param {string} [options.identity] - Optional user/viewer identity string
   * @param {string} [options.clientIp] - Client IP for rate-limiting
   * @returns {{ success: boolean, error?: string, retryAfter?: number, controllerToken?: string, reconnected?: boolean, lease?: Object }}
   */
  requestLease(roomId, socketId, credential, options = {}) {
    const room = this.rooms.get(roomId);
    if (!room || !room.enabled) {
      return { success: false, error: 'Remote desktop control is not enabled by the host.' };
    }

    const rateId = options.clientIp || socketId;
    const rateCheck = this.checkRateLimit(rateId);
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: `Too many failed attempts. Please wait ${rateCheck.retryAfter} seconds before retrying.`,
        retryAfter: rateCheck.retryAfter
      };
    }

    const now = Date.now();

    // Check existing lease
    if (room.lease) {
      // Check if lease is in grace period
      if (room.lease.reconnectGraceUntil) {
        if (room.lease.reconnectGraceUntil < now) {
          // Grace period expired, clean lease and allow new request
          room.lease = null;
        } else {
          // Grace period is active. Verify if this is the SAME controller reconnecting
          const isSameSocket = room.lease.controllerSocketId === socketId;
          const isSameToken = options.controllerToken && room.lease.controllerToken === options.controllerToken;

          if (isSameSocket || isSameToken) {
            // Restore lease
            room.lease.controllerSocketId = socketId;
            room.lease.reconnectGraceUntil = null;
            room.lease.lastActiveAt = now;
            this.resetRateLimit(rateId);
            return {
              success: true,
              reconnected: true,
              controllerToken: room.lease.controllerToken,
              lease: {
                controllerSocketId: room.lease.controllerSocketId,
                grantedAt: room.lease.grantedAt,
                lastActiveAt: room.lease.lastActiveAt
              }
            };
          }

          // Another controller is still within their grace window
          return {
            success: false,
            error: 'Another user holds control and has a reconnection grace period active.'
          };
        }
      } else {
        // Active controller currently connected
        if (room.lease.controllerSocketId === socketId) {
          room.lease.lastActiveAt = now;
          return {
            success: true,
            reconnected: true,
            controllerToken: room.lease.controllerToken,
            lease: {
              controllerSocketId: room.lease.controllerSocketId,
              grantedAt: room.lease.grantedAt,
              lastActiveAt: room.lease.lastActiveAt
            }
          };
        }

        return {
          success: false,
          error: 'Another viewer is currently controlling this computer.'
        };
      }
    }

    // Authenticate candidate credential against session PIN or permanent password
    const pinValid = this.verifySessionPin(roomId, credential);
    const passValid = !pinValid && this.verifyPermanentPassword(credential);

    if (!pinValid && !passValid) {
      this.recordFailedAttempt(rateId);
      const updatedRate = this.checkRateLimit(rateId);
      return {
        success: false,
        error: 'Invalid control PIN or permanent password.',
        retryAfter: updatedRate.retryAfter
      };
    }

    // Authentication succeeded! Reset rate limit
    this.resetRateLimit(rateId);

    // Issue unique controller token for reconnection resilience
    const controllerToken = crypto.randomBytes(16).toString('hex');
    room.lease = {
      controllerSocketId: socketId,
      controllerIdentity: options.identity || socketId,
      controllerToken,
      grantedAt: now,
      lastActiveAt: now,
      reconnectGraceUntil: null
    };

    return {
      success: true,
      granted: true,
      controllerToken,
      lease: {
        controllerSocketId: socketId,
        grantedAt: now,
        lastActiveAt: now
      }
    };
  }

  /**
   * Release control lease explicitly by controller.
   * @param {string} roomId
   * @param {string} socketId
   * @returns {{ success: boolean, error?: string }}
   */
  releaseLease(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.lease) {
      return { success: false, error: 'No active controller lease for this room.' };
    }

    if (room.lease.controllerSocketId !== socketId) {
      return { success: false, error: 'Only the active controller can release the lease.' };
    }

    room.lease = null;
    return { success: true };
  }

  /**
   * Revoke control lease immediately by host/sender.
   * @param {string} roomId
   * @returns {{ success: boolean, revokedControllerId: string|null }}
   */
  revokeLease(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.lease) {
      return { success: true, revokedControllerId: null };
    }

    const revokedControllerId = room.lease.controllerSocketId;
    room.lease = null;
    return { success: true, revokedControllerId };
  }

  /**
   * Handle socket disconnection.
   * If sender disconnected: lease is terminated immediately.
   * If controller disconnected: 60-second grace period starts.
   * @param {string} socketId
   * @returns {Array<{ roomId: string, wasSender: boolean, wasController: boolean, inGrace: boolean, revokedControllerId: string|null }>}
   */
  handleSocketDisconnect(socketId) {
    const events = [];
    const now = Date.now();

    for (const [roomId, room] of this.rooms.entries()) {
      if (room.senderSocketId === socketId) {
        let revokedControllerId = null;
        if (room.lease) {
          revokedControllerId = room.lease.controllerSocketId;
          room.lease = null;
        }
        room.senderSocketId = null;
        room.sessionPin = null;
        events.push({
          roomId,
          wasSender: true,
          wasController: false,
          inGrace: false,
          revokedControllerId
        });
      } else if (room.lease && room.lease.controllerSocketId === socketId) {
        room.lease.reconnectGraceUntil = now + this.gracePeriodMs;
        events.push({
          roomId,
          wasSender: false,
          wasController: true,
          inGrace: true,
          revokedControllerId: null
        });
      }
    }

    this.rateLimits.delete(socketId);
    return events;
  }

  /**
   * Check if a socket is the active controller for a room.
   * @param {string} roomId
   * @param {string} socketId
   * @returns {boolean}
   */
  isController(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.enabled || !room.lease) {
      return false;
    }
    if (room.lease.controllerSocketId !== socketId) {
      return false;
    }
    if (room.lease.reconnectGraceUntil && room.lease.reconnectGraceUntil < Date.now()) {
      room.lease = null;
      return false;
    }
    return true;
  }

  /**
   * Touch active controller timestamp.
   * @param {string} roomId
   * @param {string} socketId
   */
  touchController(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (room && room.lease && room.lease.controllerSocketId === socketId) {
      room.lease.lastActiveAt = Date.now();
    }
  }

  /**
   * Get active controller info for a room.
   * @param {string} roomId
   * @returns {{ controllerSocketId: string, grantedAt: number, inGrace: boolean }|null}
   */
  getActiveController(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.lease) {
      return null;
    }
    const now = Date.now();
    if (room.lease.reconnectGraceUntil && room.lease.reconnectGraceUntil < now) {
      room.lease = null;
      return null;
    }
    return {
      controllerSocketId: room.lease.controllerSocketId,
      grantedAt: room.lease.grantedAt,
      inGrace: Boolean(room.lease.reconnectGraceUntil)
    };
  }

  /**
   * Clean up room state when room is destroyed.
   * @param {string} roomId
   * @returns {{ revokedControllerId: string|null }}
   */
  cleanRoom(roomId) {
    const room = this.rooms.get(roomId);
    let revokedControllerId = null;
    if (room && room.lease) {
      revokedControllerId = room.lease.controllerSocketId;
    }
    this.rooms.delete(roomId);
    return { revokedControllerId };
  }
}
