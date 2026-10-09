/**
 * @file tunnel-relay.js
 * Experimental zrok-tunneled binary video frame relay service.
 * Deliberately routes binary camera frames through the Windows application server.
 * Enforces frame size boundaries, rate limits, backpressure drop policy, and metrics tracking.
 */

export class TunnelRelay {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxFrameSizeBytes=512000] 500 KB default maximum JPEG frame size
   * @param {number} [options.maxFps=30] Upper bound frame rate enforcement
   */
  constructor(options = {}) {
    this.maxFrameSizeBytes = options.maxFrameSizeBytes || 512000;
    this.maxFps = options.maxFps || 30;
    this.minFrameIntervalMs = Math.floor(1000 / this.maxFps);

    // roomId -> { lastFrameTime: number, totalFrames: number, totalBytes: number, droppedFrames: number }
    this.roomStats = new Map();
  }

  /**
   * Validates and processes an incoming binary frame from an authorized sender.
   * Drops stale frames if backpressure or rate limit threshold is violated.
   *
   * @param {string} roomId
   * @param {Buffer|ArrayBuffer} rawData
   * @returns {{ valid: boolean, buffer?: Buffer, dropped?: boolean, reason?: string }}
   */
  processIncomingFrame(roomId, rawData) {
    if (!rawData) {
      return { valid: false, reason: 'Empty frame data' };
    }

    let buffer = null;
    if (Buffer.isBuffer(rawData)) {
      buffer = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      buffer = Buffer.from(rawData);
    } else if (ArrayBuffer.isView(rawData)) {
      buffer = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    } else {
      return { valid: false, reason: 'Malformed payload: Expected raw binary buffer or ArrayBuffer' };
    }

    if (buffer.length === 0) {
      return { valid: false, reason: 'Zero-byte frame received' };
    }

    if (buffer.length > this.maxFrameSizeBytes) {
      return { valid: false, reason: `Frame exceeds max size limit (${buffer.length} > ${this.maxFrameSizeBytes})` };
    }

    // JPEG header check: 0xFF, 0xD8
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return { valid: false, reason: 'Invalid JPEG magic bytes' };
    }

    const now = Date.now();
    let stats = this.roomStats.get(roomId);
    if (!stats) {
      stats = {
        lastFrameTime: 0,
        totalFrames: 0,
        totalBytes: 0,
        droppedFrames: 0
      };
      this.roomStats.set(roomId, stats);
    }

    // Rate-limiting / backpressure: drop if incoming interval is too rapid
    if (now - stats.lastFrameTime < this.minFrameIntervalMs) {
      stats.droppedFrames += 1;
      return { valid: true, dropped: true, reason: 'Frame rate limit backpressure drop' };
    }

    stats.lastFrameTime = now;
    stats.totalFrames += 1;
    stats.totalBytes += buffer.length;

    return { valid: true, buffer, dropped: false };
  }

  /**
   * Returns copy of throughput statistics for a room.
   * @param {string} roomId
   */
  getRoomStats(roomId) {
    const stats = this.roomStats.get(roomId);
    if (!stats) {
      return {
        totalFrames: 0,
        totalBytes: 0,
        droppedFrames: 0
      };
    }
    return { ...stats };
  }

  /**
   * Resets and cleans up state for a closed room.
   * @param {string} roomId
   */
  cleanRoom(roomId) {
    this.roomStats.delete(roomId);
  }
}
