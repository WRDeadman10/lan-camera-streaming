/**
 * @file vcam-shm-bridge.js
 * TCP client for the Windows Virtual Camera Shared-Memory Bridge (ADR-022).
 * Streams uncompressed video frames to lancam-setup.exe --bridge on 127.0.0.1:7779,
 * which writes directly into Local\LanCamSharedMemory_Video for zero-latency DirectShow capture.
 */

import net from 'node:net';

export class VcamShmBridge {
  constructor(port = 7779, host = '127.0.0.1', logger = console) {
    this.port = port;
    this.host = host;
    this.logger = logger;
    this.socket = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.closed = false;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  connect() {
    if (this.closed || this.connected || this.socket) {
      return;
    }

    try {
      this.socket = new net.Socket();

      this.socket.connect(this.port, this.host, () => {
        this.connected = true;
        this.logger.info(`Connected to Virtual Camera SHM Bridge daemon on ${this.host}:${this.port}`);
      });

      // Crucial: Call unref so Node event loop never waits on this socket during exit
      this.socket.unref();

      this.socket.on('error', (err) => {
        this.connected = false;
        if (this.socket) {
          try {
            this.socket.destroy();
          } catch {}
          this.socket = null;
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.socket = null;
        if (!this.closed && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 5000);
          if (this.reconnectTimer && typeof this.reconnectTimer.unref === 'function') {
            this.reconnectTimer.unref();
          }
        }
      });
    } catch (err) {
      this.connected = false;
      this.socket = null;
    }
  }

  sendFrame(width, height, rgbBuffer) {
    if (!this.connected || !this.socket || !rgbBuffer || rgbBuffer.length === 0) {
      return false;
    }

    try {
      const header = Buffer.allocUnsafe(12);
      header.writeUInt32LE(width, 0);
      header.writeUInt32LE(height, 4);
      header.writeUInt32LE(rgbBuffer.length, 8);

      this.socket.write(header);
      this.socket.write(rgbBuffer);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to write frame to SHM bridge: ${err.message}`);
      return false;
    }
  }

  isConnected() {
    return this.connected;
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
        this.socket.unref();
      } catch {}
      this.socket = null;
    }
    this.connected = false;
  }
}
