/**
 * @file server.js
 * Express application factory setting up routes, static asset serving, and health checks.
 */

import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createHttpServer(app, config) {
  if (!config.useHttps) {
    return http.createServer(app);
  }

  let cert = null;
  let key = null;
  try {
    cert = fs.readFileSync(config.httpsCertPath);
    key = fs.readFileSync(config.httpsKeyPath);
  } catch (err) {
    throw new Error(`Failed to read HTTPS certificate or key (${err.message}). Fix HTTPS_CERT_PATH / HTTPS_KEY_PATH or leave both empty.`);
  }
  return https.createServer({ cert, key }, app);
}

export function createServer(config, logger) {
  const app = express();
  const httpServer = createHttpServer(app, config);

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime())
    });
  });

  // Safe client configuration endpoint (never returns ACCESS_PIN or secrets)
  app.get('/api/config', (req, res) => {
    res.status(200).json({
      iceServers: config.iceServers
    });
  });

  // Scheme and port of this server, used by clients to build a "localhost" viewer link.
  // Deliberately excludes LAN IP addresses: this route is reachable through the public tunnel.
  app.get('/api/network-info', (req, res) => {
    res.status(200).json({
      protocol: config.useHttps ? 'https' : 'http',
      port: config.port
    });
  });

  // QR Code generation endpoint
  app.get('/api/qr', async (req, res) => {
    try {
      const text = req.query.text;
      if (!text || typeof text !== 'string') {
        res.status(400).send('Missing "text" query parameter');
        return;
      }
      const dataUrl = await QRCode.toDataURL(text, {
        margin: 1,
        width: 250,
        color: { dark: '#000000', light: '#ffffff' }
      });
      res.status(200).json({ dataUrl });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  });

  // MJPEG Video stream endpoint for Python / OpenCV / inference
  // Usage in Python: cap = cv2.VideoCapture("http://<host>:3000/stream/<roomId>?pin=123456")
  app.get('/stream/:roomId', (req, res) => {
    const { roomId } = req.params;
    const pin = req.query.pin;

    if (!pin || pin !== config.accessPin) {
      logger.warn(`Unauthorized MJPEG stream request for room "${roomId}"`);
      res.status(401).send('Unauthorized: Invalid or missing access PIN (?pin=...)');
      return;
    }

    if (!config.mjpegStreamer) {
      res.status(503).send('Streamer service unavailable');
      return;
    }

    logger.info(`New MJPEG subscriber connected for room "${roomId}" (remote IP: ${req.ip})`);
    config.mjpegStreamer.addSubscriber(roomId, res);
  });

  // Single JPEG frame snapshot endpoint
  app.get('/snapshot/:roomId', async (req, res) => {
    const { roomId } = req.params;
    const pin = req.query.pin;

    if (!pin || pin !== config.accessPin) {
      res.status(401).send('Unauthorized: Invalid or missing access PIN (?pin=...)');
      return;
    }

    if (!config.mjpegStreamer) {
      res.status(503).send('Streamer service unavailable');
      return;
    }

    try {
      const frame = await config.mjpegStreamer.getFreshFrame(roomId);
      if (!frame) {
        res.status(404).send('No frame available for this room (is the sender streaming?)');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': frame.length,
        'Cache-Control': 'no-cache'
      });
      res.end(frame);
    } catch (err) {
      logger.error(`Snapshot request failed for room "${roomId}": ${err.message}`);
      res.status(500).send('Snapshot failed');
    }
  });

  // Static files directory
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));

  // Route fallbacks for clean URLs
  app.get('/sender', (req, res) => {
    res.sendFile(path.join(publicDir, 'sender.html'));
  });

  app.get('/viewer', (req, res) => {
    res.sendFile(path.join(publicDir, 'viewer.html'));
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).send('Not Found');
  });

  return { app, httpServer };
}
