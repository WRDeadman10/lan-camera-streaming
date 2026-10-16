/**
 * @file rtsp-server.js
 * Embedded RTSP 1.0 (RFC 2326) and RTP JPEG (RFC 2435) server bridge.
 * Allows standard IP-camera clients (VLC, OBS, ffmpeg, security NVRs)
 * to stream from rtsp://<host>:8554/live/<roomId>.
 */

import net from 'node:net';

export class RtspServer {
  constructor(port = 8554, host = '0.0.0.0', logger = console) {
    this.port = port;
    this.host = host;
    this.logger = logger;
    this.server = null;
    this.sessions = new Map(); // sessionId -> sessionObject
    this.allSockets = new Set();
    this.nextSessionId = 100001;
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = net.createServer((socket) => this.handleClient(socket));
        if (typeof this.server.unref === 'function') {
          this.server.unref();
        }

        this.server.on('error', (err) => {
          this.logger.warn(`RTSP server error: ${err.message}`);
        });

        this.server.listen(this.port, this.host, () => {
          this.logger.info(`RTSP bridge listening on rtsp://${this.host}:${this.port}/live/<roomId>`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  handleClient(socket) {
    this.allSockets.add(socket);
    if (typeof socket.unref === 'function') {
      socket.unref();
    }

    let buffer = '';
    const sessionId = String(this.nextSessionId++);
    const session = {
      id: sessionId,
      socket,
      roomId: null,
      playing: false,
      seq: 1,
      ssrc: Math.floor(Math.random() * 0xFFFFFF),
      lastTimestamp: 0
    };

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      // Process complete RTSP request messages ending with \r\n\r\n
      let separatorIdx;
      while ((separatorIdx = buffer.indexOf('\r\n\r\n')) !== -1) {
        const rawReq = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 4);
        this.processRequest(socket, session, rawReq);
      }
    });

    socket.on('close', () => {
      this.sessions.delete(session.id);
      this.allSockets.delete(socket);
    });

    socket.on('error', () => {
      this.sessions.delete(session.id);
      this.allSockets.delete(socket);
    });
  }

  processRequest(socket, session, rawReq) {
    const lines = rawReq.split('\r\n');
    const firstLine = lines[0] || '';
    const [method, url, version] = firstLine.split(' ');

    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const val = line.slice(colonIdx + 1).trim();
        headers[key] = val;
      }
    }

    const cseq = headers['cseq'] || '1';

    // Extract roomId from URL (e.g., rtsp://host:port/live/room123 or /live/room123/trackID=0)
    if (url) {
      const match = url.match(/\/live\/([a-zA-Z0-9_-]+)/);
      if (match) {
        session.roomId = match[1];
      }
    }

    switch (method) {
      case 'OPTIONS': {
        const res = 
          `RTSP/1.0 200 OK\r\n` +
          `CSeq: ${cseq}\r\n` +
          `Public: OPTIONS, DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE\r\n\r\n`;
        socket.write(res);
        break;
      }

      case 'DESCRIBE': {
        const roomId = session.roomId || 'default';
        const sdp = 
          `v=0\r\n` +
          `o=- ${Date.now()} 1 IN IP4 127.0.0.1\r\n` +
          `s=LAN Camera RTSP Stream (${roomId})\r\n` +
          `t=0 0\r\n` +
          `m=video 0 RTP/AVP 26\r\n` +
          `c=IN IP4 0.0.0.0\r\n` +
          `a=control:trackID=0\r\n` +
          `a=rtpmap:26 JPEG/90000\r\n`;

        const res = 
          `RTSP/1.0 200 OK\r\n` +
          `CSeq: ${cseq}\r\n` +
          `Content-Type: application/sdp\r\n` +
          `Content-Length: ${Buffer.byteLength(sdp, 'utf8')}\r\n\r\n` +
          sdp;
        socket.write(res);
        break;
      }

      case 'SETUP': {
        this.sessions.set(session.id, session);
        const transport = headers['transport'] || 'RTP/AVP/TCP;unicast;interleaved=0-1';
        const res = 
          `RTSP/1.0 200 OK\r\n` +
          `CSeq: ${cseq}\r\n` +
          `Session: ${session.id}\r\n` +
          `Transport: ${transport}\r\n\r\n`;
        socket.write(res);
        break;
      }

      case 'PLAY': {
        session.playing = true;
        const res = 
          `RTSP/1.0 200 OK\r\n` +
          `CSeq: ${cseq}\r\n` +
          `Session: ${session.id}\r\n` +
          `RTP-Info: url=trackID=0;seq=${session.seq}\r\n\r\n`;
        socket.write(res);
        break;
      }

      case 'TEARDOWN': {
        session.playing = false;
        this.sessions.delete(session.id);
        const res = 
          `RTSP/1.0 200 OK\r\n` +
          `CSeq: ${cseq}\r\n` +
          `Session: ${session.id}\r\n\r\n`;
        socket.write(res);
        socket.end();
        break;
      }

      default: {
        const res = `RTSP/1.0 501 Not Implemented\r\nCSeq: ${cseq}\r\n\r\n`;
        socket.write(res);
        break;
      }
    }
  }

  broadcastFrame(roomId, jpegBuffer) {
    if (!jpegBuffer || jpegBuffer.length === 0 || this.sessions.size === 0) {
      return;
    }

    const maxPayload = 32000;
    const totalLen = jpegBuffer.length;
    let offset = 0;

    for (const session of this.sessions.values()) {
      if (!session.playing || (session.roomId && session.roomId !== roomId)) {
        continue;
      }

      const timestamp = (Math.floor(Date.now() * 90)) >>> 0;
      offset = 0;

      while (offset < totalLen) {
        const chunkSize = Math.min(maxPayload, totalLen - offset);
        const isLastChunk = (offset + chunkSize >= totalLen);

        // 12-byte RTP header
        const rtpHeader = Buffer.allocUnsafe(12);
        rtpHeader[0] = 0x80; // V=2, P=0, X=0, CC=0
        rtpHeader[1] = 26 | (isLastChunk ? 0x80 : 0x00); // PT=26 (JPEG) + Marker bit
        rtpHeader.writeUInt16BE(session.seq & 0xFFFF, 2);
        rtpHeader.writeUInt32BE(timestamp, 4);
        rtpHeader.writeUInt32BE(session.ssrc, 8);
        session.seq = (session.seq + 1) & 0xFFFF;

        // 8-byte JPEG header (RFC 2435)
        const jpegHeader = Buffer.allocUnsafe(8);
        jpegHeader[0] = 0; // Type-specific
        jpegHeader[1] = (offset >> 16) & 0xFF; // Fragment offset 3 bytes
        jpegHeader[2] = (offset >> 8) & 0xFF;
        jpegHeader[3] = offset & 0xFF;
        jpegHeader[4] = 1; // Type (4:2:2)
        jpegHeader[5] = 255; // Q
        jpegHeader[6] = Math.min(255, Math.floor(1280 / 8)); // Width / 8
        jpegHeader[7] = Math.min(255, Math.floor(720 / 8));  // Height / 8

        const chunkData = jpegBuffer.subarray(offset, offset + chunkSize);
        const rtpPacketLen = rtpHeader.length + jpegHeader.length + chunkData.length;

        // Interleaved frame prefix: '$' (0x24), channel 0, 2-byte length
        const prefix = Buffer.allocUnsafe(4);
        prefix[0] = 0x24; // '$'
        prefix[1] = 0x00; // Channel 0 (RTP video)
        prefix.writeUInt16BE(rtpPacketLen, 2);

        try {
          session.socket.write(prefix);
          session.socket.write(rtpHeader);
          session.socket.write(jpegHeader);
          session.socket.write(chunkData);
        } catch {
          // Socket might have closed
        }

        offset += chunkSize;
      }
    }
  }

  hasClients(roomId) {
    for (const session of this.sessions.values()) {
      if (session.playing && (!session.roomId || session.roomId === roomId)) {
        return true;
      }
    }
    return false;
  }

  close() {
    for (const socket of this.allSockets) {
      try {
        socket.destroy();
      } catch {}
    }
    this.allSockets.clear();
    this.sessions.clear();

    if (this.server) {
      if (typeof this.server.closeAllConnections === 'function') {
        try {
          this.server.closeAllConnections();
        } catch {}
      }
      try {
        this.server.close();
      } catch {}
      this.server = null;
    }
  }
}
