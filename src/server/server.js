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
