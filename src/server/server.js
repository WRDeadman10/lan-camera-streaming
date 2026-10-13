/**
 * @file server.js
 * Express application factory setting up routes, static asset serving, and health checks.
 */

import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

import { embeddedAssets } from './embedded-assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SocketClientPath = '/vendor/socket.io.js';

// Prefer the installed socket.io package (always matches the running server); fall back to the copy embedded
// at build time, which is the only source inside the standalone executable (no node_modules there).
function loadSocketClientScript() {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const clientFile = path.join(path.dirname(requireFromHere.resolve('socket.io')), '..', 'client-dist', 'socket.io.js');
    return fs.readFileSync(clientFile);
  } catch {
    const embedded = embeddedAssets ? embeddedAssets[SocketClientPath] : null;
    return embedded ? Buffer.from(embedded.content, 'utf8') : null;
  }
}

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

  // Socket.IO browser client. Not under /socket.io/ because engine.io intercepts every request on that prefix.
  const socketClientScript = loadSocketClientScript();
  if (!socketClientScript) {
    logger.error('Socket.IO browser client script is unavailable; sender and viewer pages cannot connect. Run "npm run build:assets".');
  }
  app.get(SocketClientPath, (req, res) => {
    if (!socketClientScript) {
      res.status(500).send('Socket.IO client script unavailable');
      return;
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(socketClientScript);
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

  // Local WebRTC Virtual Camera Frame Bridge
  const activeVcamBridges = new Map(); // roomId -> timestamp
  config.hasLocalVcamBridge = function(roomId) {
    const lastSeen = activeVcamBridges.get(roomId);
    return Boolean(lastSeen && (Date.now() - lastSeen < 3000));
  };

  app.post('/api/vcam/bridge-frame', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '5mb' }), (req, res) => {
    const roomId = req.query.room;
    const body = req.body;

    if (!body || !body.length) {
      res.status(400).send('Empty frame');
      return;
    }

    if (roomId) {
      activeVcamBridges.set(roomId, Date.now());
      if (config.mjpegStreamer) {
        config.mjpegStreamer.broadcastFrame(roomId, body);
      }
    }

    res.status(200).send('OK');
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

  // Download the virtual camera driver installer (lan-camera-setupv<version>.exe, built by vcam/build.bat)
  const driverInstallerRoutes = [
    '/download/lan-camera-setup',
    '/download/lan-camera-setup.exe',
    '/download/lancam-vcam',
    '/download/lancam-vcam.zip'
  ];
  app.get(driverInstallerRoutes, (req, res) => {
    const exeDir = path.dirname(process.execPath);
    const searchDirs = [
      exeDir,
      path.join(exeDir, 'dist'),
      process.cwd(),
      path.join(process.cwd(), 'dist'),
      path.resolve(__dirname, '../../dist')
    ];

    // Newest lan-camera-setupv*.exe wins when several versions are lying around
    let newest = null;
    for (const dir of searchDirs) {
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!/^lan-camera-setupv.+\.exe$/i.test(name)) {
          continue;
        }
        const fullPath = path.join(dir, name);
        const modified = fs.statSync(fullPath).mtimeMs;
        if (!newest || modified > newest.modified) {
          newest = { fullPath, name, modified };
        }
      }
    }

    if (newest) {
      res.download(newest.fullPath, newest.name);
      return;
    }

    // The standalone exe carries a copy embedded at build time, so it works from any folder.
    const embeddedInstaller = embeddedAssets ? embeddedAssets['/download/lan-camera-setup.exe'] : null;
    if (embeddedInstaller) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${embeddedInstaller.fileName || 'lan-camera-setup.exe'}"`);
      res.send(Buffer.from(embeddedInstaller.content, 'base64'));
      return;
    }

    logger.warn('Driver installer requested but no lan-camera-setupv*.exe was found next to the exe, in dist/, or embedded.');
    res.status(404).send('Driver installer not found. Run build.bat to build it.');
  });

  // Static files directory: check filesystem locations, fallback to embedded assets
  const candidateDirs = [
    path.resolve(__dirname, '../public'),
    path.resolve(path.dirname(process.execPath), 'src/public'),
    path.resolve(path.dirname(process.execPath), 'public'),
    path.resolve(process.cwd(), 'src/public'),
    path.resolve(process.cwd(), 'public')
  ];

  const publicDir = candidateDirs.find((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });

  if (publicDir) {
    app.use(express.static(publicDir));
  }

  // Route handler for pages and fallback for embedded static assets
  app.get(['/', '/sender', '/viewer', '*'], (req, res, next) => {
    let reqPath = req.path;
    if (reqPath === '/') {
      reqPath = '/index.html';
    } else if (reqPath === '/sender') {
      reqPath = '/sender.html';
    } else if (reqPath === '/viewer') {
      reqPath = '/viewer.html';
    }

    if (publicDir) {
      const diskFile = path.join(publicDir, reqPath.replace(/^\//, ''));
      if (fs.existsSync(diskFile) && fs.statSync(diskFile).isFile()) {
        res.sendFile(diskFile);
        return;
      }
    }

    if (embeddedAssets && embeddedAssets[reqPath]) {
      const asset = embeddedAssets[reqPath];
      res.setHeader('Content-Type', asset.mimeType);
      res.setHeader('Cache-Control', 'no-cache');
      if (asset.isBinary) {
        res.send(Buffer.from(asset.content, 'base64'));
      } else {
        res.send(asset.content);
      }
      return;
    }

    next();
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).send('Not Found');
  });

  return { app, httpServer };
}
