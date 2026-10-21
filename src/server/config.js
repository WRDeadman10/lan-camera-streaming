import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ENV_TEMPLATE = `# LAN Camera Streaming Configuration
# Server network configuration
PORT=3000
HOST=0.0.0.0

# Security & Access Control (PIN required to stream and view)
ACCESS_PIN=123456

# CORS & Trust Proxy settings
CORS_ORIGIN=*
TRUST_PROXY=false

# STUN / TURN Configuration
STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
TURN_SERVERS=
TURN_USERNAME=
TURN_CREDENTIAL=

# zrok public tunnel configuration (leave blank for local mode)
ZROK_TOKEN=

# Optional: TLS certificate and key for HTTPS mode
HTTPS_CERT_PATH=
HTTPS_KEY_PATH=

# Logging level: info, debug, warn, error
LOG_LEVEL=info
`;

export function parseEnvContent(content) {
  const parsed = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) {
        parsed[key] = val;
      }
    }
  }
  return parsed;
}

export function loadEnvFile(customEnvPath = null, options = {}) {
  const targetEnv = options.targetEnv || process.env;
  const createIfMissing = options.createIfMissing ?? true;

  if (customEnvPath) {
    const resolvedPath = path.resolve(customEnvPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Specified environment file does not exist: ${resolvedPath}`);
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = parseEnvContent(content);
    for (const [key, val] of Object.entries(parsed)) {
      targetEnv[key] = val;
    }
    return { loaded: true, path: resolvedPath, created: false, parsed };
  }

  const searchDirs = [
    path.dirname(process.execPath),
    process.cwd()
  ];

  for (const dir of searchDirs) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        const parsed = parseEnvContent(content);
        for (const [key, val] of Object.entries(parsed)) {
          targetEnv[key] = val;
        }
        return { loaded: true, path: candidate, created: false, parsed };
      } catch {
        // Continue searching
      }
    }
  }

  if (createIfMissing) {
    const isNodeBinary = process.execPath.toLowerCase().endsWith('node.exe') || process.execPath.toLowerCase().endsWith('node');
    const targetDir = isNodeBinary ? process.cwd() : path.dirname(process.execPath);
    const targetFile = path.join(targetDir, '.env');
    try {
      fs.writeFileSync(targetFile, DEFAULT_ENV_TEMPLATE, 'utf8');
      const parsed = parseEnvContent(DEFAULT_ENV_TEMPLATE);
      for (const [key, val] of Object.entries(parsed)) {
        targetEnv[key] = val;
      }
      return { loaded: true, path: targetFile, created: true, parsed };
    } catch {
      // Ignore write errors (e.g. read-only filesystem)
    }
  }

  return { loaded: false, path: null, created: false, parsed: {} };
}


function parseInteger(val, defaultVal, min = 1, max = 65535) {
  if (val === undefined || val === null || val === '') {
    return defaultVal;
  }
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid configuration: expected integer between ${min} and ${max}, got "${val}"`);
  }
  return parsed;
}

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') {
    return defaultVal;
  }
  const str = String(val).trim().toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
}

function parseString(val, defaultVal) {
  if (val === undefined || val === null || val === '') {
    return defaultVal;
  }
  return String(val).trim();
}

function parseIceServers(env = process.env) {
  const iceServers = [];

  const rawStun = env.STUN_SERVERS;
  if (rawStun && rawStun.trim().length > 0) {
    const stunUrls = rawStun.split(',').map((u) => u.trim()).filter(Boolean);
    if (stunUrls.length > 0) {
      iceServers.push({ urls: stunUrls });
    }
  } else {
    // Standard STUN default for NAT resolution
    iceServers.push({
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302'
      ]
    });
  }

  const rawTurn = env.TURN_SERVERS;
  if (rawTurn && rawTurn.trim().length > 0) {
    if (rawTurn.includes('openrelay.metered.ca')) {
      console.warn('[WARN] Notice: openrelay.metered.ca is deprecated by Metered and resolves to non-routable IP 192.0.2.1. WebRTC cannot gather relay candidates from it. Please use active credentials from metered.ca (e.g. global.relay.metered.ca) or use Mode B (tunnel-relay).');
    }
    const turnUrls = rawTurn.split(',').map((u) => u.trim()).filter(Boolean);
    const turnConfig = {
      urls: turnUrls
    };
    if (env.TURN_USERNAME) {
      turnConfig.username = env.TURN_USERNAME;
    }
    if (env.TURN_CREDENTIAL) {
      turnConfig.credential = env.TURN_CREDENTIAL;
    }
    iceServers.push(turnConfig);
  }

  return iceServers;
}

export function loadConfig(env = process.env) {
  const port = parseInteger(env.PORT, 3000, 1, 65535);
  const host = parseString(env.HOST, '0.0.0.0');
  const accessPin = parseString(env.ACCESS_PIN, '123456');
  const corsOrigin = parseString(env.CORS_ORIGIN, '*');
  const trustProxy = parseBool(env.TRUST_PROXY, false);
  const logLevel = parseString(env.LOG_LEVEL, 'info').toLowerCase();
  const zrokToken = parseString(env.ZROK_TOKEN, '');
  const httpsCertPath = parseString(env.HTTPS_CERT_PATH, '');
  const httpsKeyPath = parseString(env.HTTPS_KEY_PATH, '');

  if (accessPin.length < 4) {
    throw new Error('Invalid configuration: ACCESS_PIN must be at least 4 characters long.');
  }

  if ((httpsCertPath === '') !== (httpsKeyPath === '')) {
    throw new Error('Invalid configuration: HTTPS_CERT_PATH and HTTPS_KEY_PATH must be set together.');
  }

  const iceServers = parseIceServers(env);
  const enableMdns = parseBool(env.ENABLE_MDNS, true);
  const enableRtsp = parseBool(env.ENABLE_RTSP, true);
  const rtspPort = parseInteger(env.RTSP_PORT, 8554, 1, 65535);
  const rtspHost = parseString(env.RTSP_HOST, '0.0.0.0');
  const enableVcamShmBridge = parseBool(env.ENABLE_VCAM_SHM_BRIDGE, false);
  const vcamShmPort = parseInteger(env.VCAM_SHM_PORT, 7779, 1, 65535);
  const vcamShmHost = parseString(env.VCAM_SHM_HOST, '127.0.0.1');
  const controlHelperHost = parseString(env.CONTROL_HELPER_HOST, '127.0.0.1');
  const controlHelperPort = parseInteger(env.CONTROL_HELPER_PORT, 8765, 1, 65535);
  const controlHelperToken = parseString(env.CONTROL_HELPER_TOKEN, '');

  return {
    port,
    host,
    accessPin,
    corsOrigin,
    trustProxy,
    logLevel,
    iceServers,
    zrokToken,
    httpsCertPath,
    httpsKeyPath,
    useHttps: httpsCertPath !== '',
    enableMdns,
    enableRtsp,
    rtspPort,
    rtspHost,
    enableVcamShmBridge,
    vcamShmPort,
    vcamShmHost,
    controlHelperHost,
    controlHelperPort,
    controlHelperToken
  };
}
