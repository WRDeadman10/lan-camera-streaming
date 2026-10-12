/**
 * @file cli.js
 * Console application entry point for standalone executable and terminal CLI.
 * Provides interactive banner, LAN IP detection, terminal QR code, and optional zrok tunnel supervision.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import qrcodeTerminal from 'qrcode-terminal';

import { loadConfig, loadEnvFile } from './config.js';
import { Logger } from './logger.js';
import { createServer } from './server.js';
import { setupSignaling } from './signaling.js';
import { MjpegStreamer } from './mjpeg-streamer.js';

function parseCliArgs(args) {
  const options = {
    port: null,
    host: null,
    pin: null,
    localOnly: false,
    useZrok: false,
    zrokToken: null,
    certPath: null,
    keyPath: null,
    envPath: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--port' || arg === '-p') {
      options.port = args[++i];
    } else if (arg === '--host') {
      options.host = args[++i];
    } else if (arg === '--pin') {
      options.pin = args[++i];
    } else if (arg === '--local' || arg === '-l') {
      options.localOnly = true;
    } else if (arg === '--zrok' || arg === '-z') {
      options.useZrok = true;
    } else if (arg === '--zrok-token') {
      options.zrokToken = args[++i];
    } else if (arg === '--cert') {
      options.certPath = args[++i];
    } else if (arg === '--key') {
      options.keyPath = args[++i];
    } else if (arg === '--env' || arg === '-e') {
      options.envPath = args[++i];
    }
  }

  return options;
}

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

function printHelp() {
  console.log(`
LAN Camera Streaming v${APP_VERSION} — Standalone Console Application

Usage:
  lan-camera-streaming [options]

Options:
  -p, --port <number>      HTTP port to listen on (default: 3000 or PORT env)
      --host <ip>          Host address to bind to (default: 0.0.0.0 or HOST env)
      --pin <secret>       Access PIN for streaming (default: 123456 or ACCESS_PIN env)
  -l, --local              Run in local LAN mode only (no zrok tunnel)
  -z, --zrok               Run with zrok public HTTPS tunnel
      --zrok-token <token> Account token for zrok authentication
      --cert <path>        Path to TLS certificate for local HTTPS
      --key <path>         Path to TLS private key for local HTTPS
  -e, --env <path>         Custom path to .env configuration file
  -h, --help               Display this help message

Examples:
  lan-camera-streaming --local
  lan-camera-streaming -p 8080 --pin 654321
  lan-camera-streaming --env C:\\config\\.env
  lan-camera-streaming --local -p 3000
`);
}

function getLanIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  const privateRegex = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;

  for (const interfaceName of Object.keys(interfaces)) {
    for (const net of interfaces[interfaceName]) {
      if (net.family === 'IPv4' && !net.internal && privateRegex.test(net.address)) {
        addresses.push(net.address);
      }
    }
  }

  return addresses;
}

function findZrokBinary() {
  const possibleCommands = ['zrok', 'zrok2'];
  for (const cmd of possibleCommands) {
    try {
      execSync(`where ${cmd}`, { stdio: 'ignore' });
      return cmd;
    } catch {
      // Continue search
    }
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const possiblePaths = [
    'C:\\scrcpy-win64-v2.4\\zrok2.exe',
    path.join(localAppData, 'Programs', 'zrok', 'zrok.exe'),
    'C:\\Program Files\\zrok\\zrok.exe'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

async function main() {
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    printHelp();
    process.exit(0);
  }

  let envResult = null;
  try {
    envResult = loadEnvFile(cliOptions.envPath);
  } catch (err) {
    console.error(`Error loading environment file: ${err.message}`);
    process.exit(1);
  }

  // Explicit CLI flags override values from .env
  if (cliOptions.port) {
    process.env.PORT = cliOptions.port;
  }
  if (cliOptions.host) {
    process.env.HOST = cliOptions.host;
  }
  if (cliOptions.pin) {
    process.env.ACCESS_PIN = cliOptions.pin;
  }
  if (cliOptions.certPath) {
    process.env.HTTPS_CERT_PATH = cliOptions.certPath;
  }
  if (cliOptions.keyPath) {
    process.env.HTTPS_KEY_PATH = cliOptions.keyPath;
  }

  const isLocalMode = cliOptions.localOnly || (!cliOptions.useZrok && !process.env.ZROK_TOKEN);

  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  const mjpegStreamer = new MjpegStreamer();
  config.mjpegStreamer = mjpegStreamer;

  const { httpServer } = createServer(config, logger);
  setupSignaling(httpServer, config, logger);

  const scheme = config.useHttps ? 'https' : 'http';

  httpServer.listen(config.port, config.host, async () => {
    console.log('=================================================');
    if (isLocalMode) {
      console.log(` LAN Camera Streaming Console v${APP_VERSION} (Local Mode)`);
    } else {
      console.log(` LAN Camera Streaming & zrok Public Tunnel v${APP_VERSION}`);
    }
    if (envResult && envResult.path) {
      const statusText = envResult.created ? '(created default template)' : '(loaded)';
      console.log(` Config: ${envResult.path} ${statusText}`);
    }
    console.log(` Port: ${config.port} | Host: ${config.host} | PIN: ${config.accessPin} | Scheme: ${scheme}`);
    console.log('=================================================');

    if (envResult && envResult.created) {
      console.log(`\nNotice: Created default .env configuration file at:\n  ${envResult.path}\nYou can open this file in any text editor to customize your settings.\n`);
    } else {
      console.log('');
    }

    let zrokProcess = null;
    let activeShareToken = null;
    let isShuttingDown = false;

    const cleanupAndExit = () => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;
      console.log('\nShutting down server and releasing resources...');

      // Force exit safeguard if keep-alive sockets stall httpServer.close
      const forceExitTimer = setTimeout(() => {
        console.warn('Forcing process exit after timeout.');
        process.exit(0);
      }, 3000);
      forceExitTimer.unref();

      if (zrokProcess) {
        try {
          zrokProcess.kill();
        } catch {}
      }

      const zrokBinary = findZrokBinary();
      if (zrokBinary) {
        try {
          execSync(`"${zrokBinary}" delete share public:lan`, { stdio: 'ignore' });
        } catch {}
        if (activeShareToken) {
          try {
            execSync(`"${zrokBinary}" delete share ${activeShareToken}`, { stdio: 'ignore' });
          } catch {}
        }
      }

      try {
        io.close();
      } catch {}

      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }

      httpServer.close(() => {
        clearTimeout(forceExitTimer);
        console.log('Shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGINT', cleanupAndExit);
    process.on('SIGTERM', cleanupAndExit);

    if (isLocalMode) {
      const lanIps = getLanIpv4Addresses();
      console.log(`Viewer on this PC: ${scheme}://localhost:${config.port}/viewer`);
      for (const ip of lanIps) {
        console.log(`Sender on phone:   ${scheme}://${ip}:${config.port}/sender`);
      }

      if (lanIps.length > 0) {
        const phoneUrl = `${scheme}://${lanIps[0]}:${config.port}/sender`;
        console.log('\nSCAN TO CONNECT ON PHONE:');
        qrcodeTerminal.generate(phoneUrl, { small: true });
      } else {
        console.log('No private LAN IPv4 address detected. Ensure PC is connected to Wi-Fi/Ethernet.');
      }

      if (scheme === 'http') {
        console.log('\nTip: Phone browsers block the camera on plain HTTP.');
        console.log('On phone Chrome, visit: chrome://flags/#unsafely-treat-insecure-origin-as-secure');
        console.log(`Add your phone sender URL and restart Chrome.\n`);
      }

      console.log('Press Ctrl+C to terminate the console application.\n');
    } else {
      const zrokBinary = findZrokBinary();
      if (!zrokBinary) {
        console.warn('Warning: zrok executable was not found. Falling back to local LAN mode.');
        const lanIps = getLanIpv4Addresses();
        console.log(`Viewer on this PC: ${scheme}://localhost:${config.port}/viewer`);
        for (const ip of lanIps) {
          console.log(`Sender on phone:   ${scheme}://${ip}:${config.port}/sender`);
        }
        if (lanIps.length > 0) {
          const phoneUrl = `${scheme}://${lanIps[0]}:${config.port}/sender`;
          console.log('\nSCAN TO CONNECT ON PHONE:');
          qrcodeTerminal.generate(phoneUrl, { small: true });
        }
        console.log('Press Ctrl+C to terminate the console application.\n');
        return;
      }

      const zrokToken = cliOptions.zrokToken || process.env.ZROK_TOKEN;
      if (zrokToken) {
        try {
          const statusOut = execSync(`"${zrokBinary}" status`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          if (!statusOut.includes('Account Token') || !statusOut.includes('<<SET>>')) {
            console.log('Enabling zrok environment with configured token...');
            execSync(`"${zrokBinary}" enable ${zrokToken} --headless`, { stdio: 'ignore' });
          }
        } catch {
          // Continue if already enabled
        }
      }

      // Cleanup stale shares
      try {
        execSync(`"${zrokBinary}" delete share public:lan`, { stdio: 'ignore' });
      } catch {}

      const targetUrl = `http://127.0.0.1:${config.port}`;
      console.log(`Starting zrok public share for ${targetUrl}...`);

      let shareUrl = 'https://lan.shares.zrok.io';

      zrokProcess = spawn(zrokBinary, ['share', 'public', targetUrl, '-n', 'public:lan', '--backend-mode', 'proxy', '--headless'], {
        stdio: 'ignore',
        detached: false
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (zrokProcess.exitCode !== null) {
        console.log("Could not bind to reserved 'public:lan'. Starting dynamic share...");
        zrokProcess = spawn(zrokBinary, ['share', 'public', targetUrl, '--backend-mode', 'proxy', '--headless'], {
          stdio: 'ignore',
          detached: false
        });

        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            const ov = execSync(`"${zrokBinary}" overview`, { encoding: 'utf8' });
            const match = ov.match(new RegExp(`http://127\\.0\\.0\\.1:${config.port}[\\s\\S]*?([a-z0-9]{10,16})`));
            if (match && match[1]) {
              activeShareToken = match[1];
              shareUrl = `https://${activeShareToken}.shares.zrok.io`;
              break;
            }
          } catch {}
        }
      }

      const senderDisplayUrl = `${shareUrl}/sender`;
      console.log('\n=================================================');
      console.log(' SCAN TO CONNECT ON PHONE');
      console.log('=================================================');
      console.log(`Public Stream URL: ${shareUrl}`);
      console.log(`Sender URL:        ${senderDisplayUrl}`);
      console.log(`Viewer on this PC: http://localhost:${config.port}/viewer  (direct, no zrok quota)\n`);

      qrcodeTerminal.generate(senderDisplayUrl, { small: true });

      console.log('\nPress Ctrl+C to terminate both zrok tunnel and server.\n');
    }
  });
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err.message);
  process.exit(1);
});
