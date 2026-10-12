/**
 * @file index.js
 * Application entry point: initializes configuration, logger, and HTTP server.
 */

import { loadConfig, loadEnvFile } from './config.js';
import { Logger } from './logger.js';
import { createServer } from './server.js';
import { setupSignaling } from './signaling.js';
import { MjpegStreamer } from './mjpeg-streamer.js';

loadEnvFile(null, { createIfMissing: false });
const config = loadConfig();
const logger = new Logger(config.logLevel);

const mjpegStreamer = new MjpegStreamer();
config.mjpegStreamer = mjpegStreamer;

const { httpServer } = createServer(config, logger);
const { io, roomManager } = setupSignaling(httpServer, config, logger);

const scheme = config.useHttps ? 'https' : 'http';

httpServer.listen(config.port, config.host, () => {
  logger.info(`LAN Camera Streaming server listening on ${scheme}://${config.host}:${config.port}`);
  logger.info(`Health check available at ${scheme}://${config.host}:${config.port}/health`);
});

let isShuttingDown = false;

function handleShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info(`Received ${signal}, closing server gracefully...`);

  const forceExitTimer = setTimeout(() => {
    logger.warn('Forcing process exit after shutdown timeout.');
    process.exit(0);
  }, 3000);
  forceExitTimer.unref();

  try {
    io.close();
  } catch {}

  if (typeof httpServer.closeAllConnections === 'function') {
    httpServer.closeAllConnections();
  }

  httpServer.close(() => {
    clearTimeout(forceExitTimer);
    logger.info('HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
