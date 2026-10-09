/**
 * @file config.js
 * Centralized server configuration with strict environment variable validation.
 */

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

function parseString(val, defaultVal) {
  if (val === undefined || val === null || val === '') {
    return defaultVal;
  }
  return String(val).trim();
}

function parseIceServers() {
  const iceServers = [];

  const rawStun = process.env.STUN_SERVERS;
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
        'stun:stun1.l.google.com:19302'
      ]
    });
  }

  const rawTurn = process.env.TURN_SERVERS;
  if (rawTurn && rawTurn.trim().length > 0) {
    const turnUrls = rawTurn.split(',').map((u) => u.trim()).filter(Boolean);
    const turnConfig = {
      urls: turnUrls
    };
    if (process.env.TURN_USERNAME) {
      turnConfig.username = process.env.TURN_USERNAME;
    }
    if (process.env.TURN_CREDENTIAL) {
      turnConfig.credential = process.env.TURN_CREDENTIAL;
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
  const trustProxy = env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1';
  const logLevel = parseString(env.LOG_LEVEL, 'info').toLowerCase();
  const zrokToken = parseString(env.ZROK_TOKEN, '');

  if (accessPin.length < 4) {
    throw new Error('Invalid configuration: ACCESS_PIN must be at least 4 characters long.');
  }

  const iceServers = parseIceServers();

  return {
    port,
    host,
    accessPin,
    corsOrigin,
    trustProxy,
    logLevel,
    iceServers,
    zrokToken
  };
}
