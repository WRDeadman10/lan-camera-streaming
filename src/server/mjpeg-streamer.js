/**
 * @file mjpeg-streamer.js
 * Manages MJPEG HTTP streams for rooms. Receives JPEG frames from active
 * sender clients and broadcasts multipart/x-mixed-replace streams to HTTP consumers (Python/OpenCV).
 * Frame upload is demand-driven: a room only has "demand" while an HTTP consumer is connected
 * (or a snapshot is pending), so senders never upload frames nobody is reading.
 */

export class MjpegStreamer {
  constructor() {
    // Map<roomId, Set<httpResponse>>
    this.subscribers = new Map();
    // Map<roomId, Buffer> - cached latest frame for immediate response to new subscribers
    this.latestFrames = new Map();
    // Map<roomId, number> - epoch ms when the cached frame was received
    this.latestFrameTimes = new Map();
    // Map<roomId, Set<{ resolve: Function, timer: Timeout }>> - pending snapshot requests
    this.frameWaiters = new Map();
    // Map<roomId, true> - last demand state announced through onDemandChange
    this.demandState = new Map();
    // Callback (roomId, active) invoked whenever a room's demand flips
    this.onDemandChange = null;
  }

  hasDemand(roomId) {
    const subs = this.subscribers.get(roomId);
    const waiters = this.frameWaiters.get(roomId);
    return Boolean((subs && subs.size > 0) || (waiters && waiters.size > 0));
  }

  addSubscriber(roomId, res) {
    if (!this.subscribers.has(roomId)) {
      this.subscribers.set(roomId, new Set());
    }
    const subs = this.subscribers.get(roomId);
    subs.add(res);

    // Set multipart HTTP headers
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=--frame',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'close',
      'Access-Control-Allow-Origin': '*'
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Send latest frame immediately if available
    const latest = this.latestFrames.get(roomId);
    if (latest) {
      this._writeFrame(res, latest);
    }

    res.on('close', () => {
      subs.delete(res);
      if (subs.size === 0 && this.subscribers.get(roomId) === subs) {
        this.subscribers.delete(roomId);
      }
      this._syncDemand(roomId);
    });

    this._syncDemand(roomId);
  }

  broadcastFrame(roomId, frameBuffer) {
    this.latestFrames.set(roomId, frameBuffer);
    this.latestFrameTimes.set(roomId, Date.now());

    const waiters = this.frameWaiters.get(roomId);
    if (waiters && waiters.size > 0) {
      this.frameWaiters.delete(roomId);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(frameBuffer);
      }
      this._syncDemand(roomId);
    }

    const subs = this.subscribers.get(roomId);
    if (!subs || subs.size === 0) {
      return 0;
    }

    for (const res of subs) {
      try {
        this._writeFrame(res, frameBuffer);
      } catch (err) {
        subs.delete(res);
      }
    }
    return subs.size;
  }

  getFreshFrame(roomId, maxAgeMs = 5000, timeoutMs = 3000) {
    const latest = this.latestFrames.get(roomId);
    const receivedAt = this.latestFrameTimes.get(roomId) || 0;
    if (latest && Date.now() - receivedAt <= maxAgeMs) {
      return Promise.resolve(latest);
    }

    return new Promise((resolve) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const waiters = this.frameWaiters.get(roomId);
        if (waiters) {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            this.frameWaiters.delete(roomId);
          }
        }
        this._syncDemand(roomId);
        resolve(null);
      }, timeoutMs);

      if (!this.frameWaiters.has(roomId)) {
        this.frameWaiters.set(roomId, new Set());
      }
      this.frameWaiters.get(roomId).add(waiter);
      this._syncDemand(roomId);
    });
  }

  hasSubscribers(roomId) {
    const subs = this.subscribers.get(roomId);
    return Boolean(subs && subs.size > 0);
  }

  getSubscriberCount(roomId) {
    const subs = this.subscribers.get(roomId);
    return subs ? subs.size : 0;
  }

  clearRoom(roomId) {
    const subs = this.subscribers.get(roomId);
    if (subs) {
      for (const res of subs) {
        try {
          res.end();
        } catch (e) {
          // ignore
        }
      }
      this.subscribers.delete(roomId);
    }
    this.latestFrames.delete(roomId);
    this.latestFrameTimes.delete(roomId);
    this._syncDemand(roomId);
  }

  _syncDemand(roomId) {
    const active = this.hasDemand(roomId);
    const wasActive = this.demandState.get(roomId) === true;
    if (active === wasActive) {
      return;
    }

    if (active) {
      this.demandState.set(roomId, true);
    } else {
      this.demandState.delete(roomId);
    }

    if (typeof this.onDemandChange === 'function') {
      this.onDemandChange(roomId, active);
    }
  }

  _writeFrame(res, buffer) {
    res.write('--frame\r\n');
    res.write('Content-Type: image/jpeg\r\n');
    res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
    res.write(buffer);
    res.write('\r\n');
  }
}
