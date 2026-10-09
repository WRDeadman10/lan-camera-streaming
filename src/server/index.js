/**
 * @file index.js
 * Application entry point: initializes configuration, logger, and HTTP server.
 */

import { loadConfig } from './config.js';
import { Logger } from './logger.js';
import { createServer } from './server.js';
import { setupSignaling } from './signaling.js';

const config = loadConfig();
const logger = new Logger(config.logLevel);

const { httpServer } = createServer(config, logger);
const { io, roomManager } = setupSignaling(httpServer, config, logger);

httpServer.listen(config.port, config.host, () => {
  logger.info(`LAN Camera Streaming server listening on http://${config.host}:${config.port}`);
  logger.info(`Health check available at http://${config.host}:${config.port}/health`);
});

function handleShutdown(signal) {
  logger.info(`Received ${signal}, closing server gracefully...`);
  httpServer.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
