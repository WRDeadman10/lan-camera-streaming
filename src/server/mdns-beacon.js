/**
 * @file mdns-beacon.js
 * Lightweight zero-dependency mDNS (multicast DNS) beacon that announces
 * the LAN Camera service and responds to lancam.local queries.
 */

import dgram from 'node:dgram';
import os from 'node:os';

const MDNS_MULTICAST_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;

export class MdnsBeacon {
  constructor(port = 7777, logger = console) {
    this.port = port;
    this.logger = logger;
    this.socket = null;
    this.isRunning = false;
  }

  getLocalIpv4List() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  }

  start() {
    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      if (typeof this.socket.unref === 'function') {
        this.socket.unref();
      }

      this.socket.on('error', (err) => {
        this.logger.debug?.(`[mDNS] Beacon socket error: ${err.message}`);
        this.stop();
      });

      this.socket.on('message', (msg, rinfo) => {
        const queryStr = msg.toString('latin1').toLowerCase();
        if (queryStr.includes('lancam') || queryStr.includes('_lancam')) {
          this.sendAnnouncement(rinfo.address, rinfo.port);
        }
      });

      this.socket.bind(MDNS_PORT, () => {
        try {
          if (this.socket) {
            this.socket.addMembership(MDNS_MULTICAST_ADDR);
            this.socket.setMulticastTTL(255);
            this.socket.setMulticastLoopback(true);
            if (typeof this.socket.unref === 'function') {
              this.socket.unref();
            }
            this.isRunning = true;
            this.logger.debug?.(`[mDNS] Zero-conf beacon active on ${MDNS_MULTICAST_ADDR}:${MDNS_PORT}`);
          }
        } catch (e) {
          this.logger.debug?.(`[mDNS] Membership error: ${e.message}`);
        }
      });
    } catch (err) {
      this.logger.debug?.(`[mDNS] Failed to initialize beacon: ${err.message}`);
    }
  }

  sendAnnouncement(targetAddress = MDNS_MULTICAST_ADDR, targetPort = MDNS_PORT) {
    if (!this.socket || !this.isRunning) {
      return;
    }
    try {
      const ips = this.getLocalIpv4List();
      if (ips.length === 0) return;

      const ipParts = ips[0].split('.').map((p) => parseInt(p, 10));

      const header = Buffer.from([
        0x00, 0x00, // ID
        0x84, 0x00, // Flags
        0x00, 0x00, // QDCOUNT
        0x00, 0x01, // ANCOUNT
        0x00, 0x00, // NSCOUNT
        0x00, 0x00  // ARCOUNT
      ]);

      const name = Buffer.from([
        0x06, 0x6c, 0x61, 0x6e, 0x63, 0x61, 0x6d,
        0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
        0x00
      ]);

      const record = Buffer.from([
        0x00, 0x01,
        0x80, 0x01,
        0x00, 0x00, 0x00, 0x78,
        0x00, 0x04,
        ipParts[0], ipParts[1], ipParts[2], ipParts[3]
      ]);

      const packet = Buffer.concat([header, name, record]);
      this.socket.send(packet, 0, packet.length, targetPort, targetAddress);
    } catch {
      // Non-fatal
    }
  }

  stop() {
    this.isRunning = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
  }

  close() {
    this.stop();
  }
}
