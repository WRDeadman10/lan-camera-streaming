/**
 * @file control-bridge.js
 * TCP bridge connecting the Node.js application server to the native Windows remote-control helper on 127.0.0.1:8765.
 * Strictly adheres to AGENTS.md conventions (explicit types, no var, safe release).
 */

import net from 'node:net';

export class ControlBridge {
  /**
   * @param {Object} [options]
   * @param {string} [options.host='127.0.0.1']
   * @param {number} [options.port=8765]
   * @param {string} [options.authToken='']
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = typeof options.port === 'number' ? options.port : 8765;
    this.authToken = options.authToken || '';
    this.logger = options.logger || console;

    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectTimer = null;
    this.isExplicitlyClosed = false;

    // Incoming buffer for line-delimited JSON
    this.incomingBuffer = '';

    // Pending response callbacks: Map<string, Function>
    this.pendingCallbacks = new Map();
  }

  /**
   * Connect to native helper.
   * @returns {Promise<boolean>}
   */
  connect() {
    this.isExplicitlyClosed = false;

    return new Promise((resolve) => {
      if (this.socket && this.connected) {
        resolve(true);
        return;
      }

      this._cleanupSocket();

      const socket = new net.Socket();
      this.socket = socket;
      socket.setNoDelay(true);

      let resolved = false;

      const onConnectSuccess = () => {
        this.connected = true;
        this.logger.info(`[CONTROL-BRIDGE] Connected to native helper at ${this.host}:${this.port}`);

        if (this.authToken) {
          this._sendAuth(this.authToken);
        } else {
          this.authenticated = true;
        }

        if (!resolved) {
          resolved = true;
          resolve(true);
        }
      };

      socket.once('connect', onConnectSuccess);

      socket.on('data', (chunk) => {
        this._handleData(chunk);
      });

      socket.on('error', (err) => {
        this.connected = false;
        this.authenticated = false;
        this.logger.debug(`[CONTROL-BRIDGE] Helper socket error: ${err.message}`);
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      socket.on('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.logger.debug('[CONTROL-BRIDGE] Helper socket closed');
        if (!this.isExplicitlyClosed) {
          this._scheduleReconnect();
        }
      });

      socket.connect(this.port, this.host);
    });
  }

  /**
   * Disconnect from native helper.
   */
  disconnect() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      try {
        // Attempt clean release-all before closing socket
        if (this.connected) {
          this.releaseAll();
        }
      } catch {
        // Ignore during teardown
      }
      this._cleanupSocket();
    }
  }

  /**
   * Clean up socket references and listeners.
   * @private
   */
  _cleanupSocket() {
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.destroy();
      } catch {
        // Ignore destroy error
      }
      this.socket = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.incomingBuffer = '';
  }

  /**
   * Schedule automatic reconnect to helper.
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectTimer || this.isExplicitlyClosed) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitlyClosed && !this.connected) {
        this.connect().catch(() => {});
      }
    }, 2000);
  }

  /**
   * Send auth handshake message.
   * @private
   * @param {string} token
   */
  _sendAuth(token) {
    this._sendRaw({
      type: 'auth',
      token
    });
  }

  /**
   * Handle incoming raw data stream and parse line-delimited JSON.
   * @private
   * @param {Buffer} chunk
   */
  _handleData(chunk) {
    this.incomingBuffer += chunk.toString('utf8');

    let newlineIndex = 0;
    while ((newlineIndex = this.incomingBuffer.indexOf('\n')) !== -1) {
      const line = this.incomingBuffer.slice(0, newlineIndex).trim();
      this.incomingBuffer = this.incomingBuffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line);
          this._handleMessage(parsed);
        } catch (err) {
          this.logger.warn(`[CONTROL-BRIDGE] Received malformed JSON from helper: ${line}`);
        }
      }
    }
  }

  /**
   * Process parsed message from native helper.
   * @private
   * @param {Object} msg
   */
  _handleMessage(msg) {
    if (msg.authenticated) {
      this.authenticated = true;
      this.logger.info('[CONTROL-BRIDGE] Helper authentication confirmed');
    }
  }

  /**
   * Send raw message object as line-delimited JSON.
   * @private
   * @param {Object} obj
   * @returns {boolean}
   */
  _sendRaw(obj) {
    if (!this.socket || !this.connected) {
      return false;
    }

    try {
      const payload = `${JSON.stringify(obj)}\n`;
      return this.socket.write(payload);
    } catch (err) {
      this.logger.warn(`[CONTROL-BRIDGE] Failed to write to helper socket: ${err.message}`);
      return false;
    }
  }

  /**
   * Dispatch input event received from controller.
   * Validates structure before sending.
   * @param {Object} event
   * @returns {boolean}
   */
  sendInput(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      return false;
    }

    switch (event.type) {
      case 'mouse_move': {
        const x = typeof event.x === 'number' ? Math.max(0, Math.min(1, event.x)) : 0;
        const y = typeof event.y === 'number' ? Math.max(0, Math.min(1, event.y)) : 0;
        return this._sendRaw({ type: 'mouse_move', x, y });
      }

      case 'mouse_down':
      case 'mouse_up':
      case 'mouse_click': {
        const button = typeof event.button === 'string' ? event.button : 'left';
        return this._sendRaw({ type: event.type, button });
      }

      case 'mouse_wheel': {
        const deltaY = typeof event.deltaY === 'number' ? Math.round(event.deltaY) : 0;
        const deltaX = typeof event.deltaX === 'number' ? Math.round(event.deltaX) : 0;
        return this._sendRaw({ type: 'mouse_wheel', deltaY, deltaX });
      }

      case 'key_down':
      case 'key_up':
      case 'key_tap': {
        const code = typeof event.code === 'string' ? event.code : '';
        if (!code) {
          return false;
        }
        return this._sendRaw({ type: event.type, code });
      }

      case 'set_display_bounds': {
        const left = typeof event.left === 'number' ? event.left : 0;
        const top = typeof event.top === 'number' ? event.top : 0;
        const width = typeof event.width === 'number' ? event.width : 0;
        const height = typeof event.height === 'number' ? event.height : 0;
        return this._sendRaw({ type: 'set_display_bounds', left, top, width, height });
      }

      default:
        return false;
    }
  }

  /**
   * Release all held keys and mouse buttons.
   * @returns {boolean}
   */
  releaseAll() {
    return this._sendRaw({ type: 'release_all' });
  }

  /**
   * Trigger hardware emergency stop.
   * @returns {boolean}
   */
  emergencyStop() {
    return this._sendRaw({ type: 'emergency_stop' });
  }

  /**
   * Reset hardware emergency stop.
   * @returns {boolean}
   */
  resetEmergencyStop() {
    return this._sendRaw({ type: 'reset_emergency_stop' });
  }

  /**
   * Send ping to helper.
   * @returns {boolean}
   */
  ping() {
    return this._sendRaw({ type: 'ping' });
  }

  /**
   * Check if bridge is connected to helper.
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && (this.authToken ? this.authenticated : true);
  }
}
