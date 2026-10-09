/**
 * @file mjpeg-streamer.js
 * Manages MJPEG HTTP streams for rooms. Receives JPEG frames from active
 * sender clients and broadcasts multipart/x-mixed-replace streams to HTTP consumers (Python/OpenCV).
 */

export class MjpegStreamer {
  constructor() {
    // Map<roomId, Set<httpResponse>>
    this.subscribers = new Map();
    // Map<roomId, Buffer> - cached latest frame for immediate response to new subscribers
    this.latestFrames = new Map();
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

    // Send latest frame immediately if available
    const latest = this.latestFrames.get(roomId);
    if (latest) {
      this._writeFrame(res, latest);
    }

    res.on('close', () => {
      subs.delete(res);
      if (subs.size === 0) {
        this.subscribers.delete(roomId);
      }
    });
  }

  broadcastFrame(roomId, frameBuffer) {
    this.latestFrames.set(roomId, frameBuffer);

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
  }

  _writeFrame(res, buffer) {
    res.write('--frame\r\n');
    res.write('Content-Type: image/jpeg\r\n');
    res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
    res.write(buffer);
    res.write('\r\n');
  }
}
