/**
 * @file zrok-helper.js
 * Helpers for discovering zrok binary, inspecting existing shares,
 * reserving deterministic or generated share names, and managing share life-cycle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Discovers the zrok/zrok2 binary from PATH or standard Windows install directories.
 * @returns {string|null}
 */
export function findZrokBinary() {
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

/**
 * Retrieves all shares from the zrok account overview JSON output.
 * @param {string} zrokBinary
 * @returns {Array<object>}
 */
export function getZrokShares(zrokBinary) {
  try {
    const raw = execSync(`"${zrokBinary}" overview`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return [];
    }
    const data = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    const shares = [];
    if (Array.isArray(data?.environments)) {
      for (const env of data.environments) {
        if (Array.isArray(env?.shares)) {
          for (const s of env.shares) {
            shares.push(s);
          }
        }
      }
    }
    return shares;
  } catch {
    return [];
  }
}

/**
 * Finds an existing reserved or reusable share.
 * Prioritizes:
 * 1. An explicitly reserved share (s.reserved === true) targeting the port
 * 2. Any explicitly reserved share
 * 3. Any share targeting the configured port
 * 4. Any share in the environment
 * @param {Array<object>} shares
 * @param {number|string} port
 * @returns {object|null}
 */
export function findExistingShare(shares, port) {
  if (!Array.isArray(shares) || shares.length === 0) {
    return null;
  }
  const portStr = String(port);

  // 1. Reserved share targeting our port
  const reservedForPort = shares.find(
    (s) => s.reserved === true && s.backendProxyEndpoint && s.backendProxyEndpoint.includes(`:${portStr}`)
  );
  if (reservedForPort) {
    return reservedForPort;
  }

  // 2. Any reserved share
  const anyReserved = shares.find((s) => s.reserved === true);
  if (anyReserved) {
    return anyReserved;
  }

  // 3. Any share targeting our port
  const matchingPort = shares.find(
    (s) => s.backendProxyEndpoint && s.backendProxyEndpoint.includes(`:${portStr}`)
  );
  if (matchingPort) {
    return matchingPort;
  }

  // 4. Any share in the environment
  return shares[0];
}

/**
 * Generates candidate words for reserving a unique share name.
 * zrok requires lowercase alphanumeric, 4-32 characters.
 * @returns {string[]}
 */
export function generateCandidateWords() {
  const suffixes = [
    'stream', 'live', 'cam', 'view', 'feed', 'hub', 'node', 'air',
    'cast', 'lens', 'scope', 'link', 'relay', 'beam', 'wave', 'desk'
  ];
  const candidates = ['lancam', 'lancamera'];
  for (const s of suffixes) {
    candidates.push(`lancam${s}`);
  }
  for (let i = 0; i < 5; i++) {
    const randomHex = Math.random().toString(36).slice(2, 6);
    candidates.push(`lancam${randomHex}`);
  }
  return candidates;
}

/**
 * Reserves a new share in zrok if none exists.
 * Tries candidates and falls back to auto-generated name.
 * @param {string} zrokBinary
 * @param {string} targetUrl
 * @returns {{ token: string, url: string } | null}
 */
export function reserveNewShare(zrokBinary, targetUrl) {
  const candidates = generateCandidateWords();

  for (const word of candidates) {
    try {
      console.log(`Attempting to reserve share name '${word}'...`);
      const out = execSync(
        `"${zrokBinary}" reserve public "${targetUrl}" -n "${word}" --backend-mode proxy --json-output`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const jsonStart = out.indexOf('{');
      const jsonEnd = out.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const res = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
        if (res && res.token) {
          console.log(`Successfully reserved share '${res.token}'!`);
          return {
            token: res.token,
            url: res.frontend_endpoints?.[0] || `https://${res.token}.share.zrok.io`
          };
        }
      }
    } catch {
      console.log(`Could not reserve '${word}'. Generating another name...`);
    }
  }

  try {
    console.log('Reserving public share with auto-generated name...');
    const out = execSync(
      `"${zrokBinary}" reserve public "${targetUrl}" --backend-mode proxy --json-output`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const jsonStart = out.indexOf('{');
    const jsonEnd = out.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const res = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
      if (res && res.token) {
        console.log(`Successfully reserved share '${res.token}'!`);
        return {
          token: res.token,
          url: res.frontend_endpoints?.[0] || `https://${res.token}.share.zrok.io`
        };
      }
    }
  } catch (err) {
    console.warn('Failed to reserve public share:', err.message);
  }

  return null;
}
