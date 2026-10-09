/**
 * @file server.js
 * Express application factory setting up routes, static asset serving, and health checks.
 */

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer(config, logger) {
  const app = express();
  const httpServer = http.createServer(app);

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
  app.get('/snapshot/:roomId', (req, res) => {
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

    const frame = config.mjpegStreamer.latestFrames.get(roomId);
    if (!frame) {
      res.status(404).send('No frame available yet for this room');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': frame.length,
      'Cache-Control': 'no-cache'
    });
    res.end(frame);
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
