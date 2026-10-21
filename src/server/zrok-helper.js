/**
 * @file zrok-helper.js
 * Helpers for discovering zrok/zrok2 binary, inspecting existing shares,
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
      const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd} || which ${cmd}`;
      execSync(checkCmd, { stdio: 'ignore' });
      return cmd;
    } catch {
      // Continue search
    }
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const homeDir = process.env.HOME || '';
  const possiblePaths = [
    'C:\\scrcpy-win64-v2.4\\zrok2.exe',
    path.join(localAppData, 'Programs', 'zrok', 'zrok.exe'),
    'C:\\Program Files\\zrok\\zrok.exe',
    '/usr/local/bin/zrok',
    '/usr/bin/zrok',
    '/opt/zrok/bin/zrok',
    '/opt/zrok/zrok',
    path.join(homeDir, '.zrok', 'bin', 'zrok')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Checks whether the zrok binary is zrok v2 / zrok2.
 * @param {string} zrokBinary
 * @returns {boolean}
 */
export function isZrokV2(zrokBinary) {
  if (!zrokBinary) {
    return false;
  }
  const lower = zrokBinary.toLowerCase();
  if (lower.endsWith('zrok2') || lower.endsWith('zrok2.exe') || lower.includes('zrok2')) {
    return true;
  }
  try {
    const out = execSync(`"${zrokBinary}" version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.includes('zrok2') || /v2\./i.test(out);
  } catch {
    return false;
  }
}

/**
 * Retrieves raw overview data (parsed JSON) from zrok account.
 * Supports both zrok2 (requiring --json) and legacy zrok v0.4.x.
 * @param {string} zrokBinary
 * @returns {object|null}
 */
export function getZrokOverviewData(zrokBinary) {
  if (!zrokBinary) {
    return null;
  }
  // Try with --json flag first (required in zrok2)
  try {
    const raw = execSync(`"${zrokBinary}" overview --json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const sIdx = raw.indexOf('{');
    const eIdx = raw.lastIndexOf('}');
    if (sIdx !== -1 && eIdx > sIdx) {
      return JSON.parse(raw.slice(sIdx, eIdx + 1));
    }
  } catch {
    // If --json is an unknown flag in older zrok versions, fallback below
  }

  // Fallback to overview without --json (legacy zrok v0.4)
  try {
    const raw = execSync(`"${zrokBinary}" overview`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const sIdx = raw.indexOf('{');
    const eIdx = raw.lastIndexOf('}');
    if (sIdx !== -1 && eIdx > sIdx) {
      return JSON.parse(raw.slice(sIdx, eIdx + 1));
    }
  } catch {
    // Ignore error
  }

  return null;
}

/**
 * Parses overview JSON and normalizes all shares and reserved names.
 * Extracts active environment shares and named reservations (e.g. 'lan').
 * @param {object} data
 * @returns {Array<object>}
 */
export function parseZrokOverviewJson(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const shares = [];
  if (Array.isArray(data.environments)) {
    for (const env of data.environments) {
      if (Array.isArray(env?.shares)) {
        for (const s of env.shares) {
          const target = s.target || s.backendProxyEndpoint || '';
          let ep = s.frontendEndpoint || null;
          if (!ep && Array.isArray(s.frontendEndpoints) && s.frontendEndpoints.length > 0) {
            ep = s.frontendEndpoints[0].startsWith('http')
              ? s.frontendEndpoints[0]
              : `https://${s.frontendEndpoints[0]}`;
          }
          if (!ep && s.shareToken) {
            ep = `https://${s.shareToken}.share.zrok.io`;
          }
          const nameObj = data.names?.find(
            (n) => n.name === s.shareToken || n.shareToken === s.shareToken
          );
          const isRes = s.reserved === true || Boolean(nameObj?.reserved);
          const nsToken = nameObj?.namespaceToken || 'public';
          const nameStr = nameObj?.name || s.shareToken;

          shares.push({
            shareToken: s.shareToken,
            name: nameStr,
            namespaceToken: nsToken,
            nameSelection: nameObj ? `${nsToken}:${nameStr}` : (isRes ? `public:${s.shareToken}` : null),
            target,
            backendProxyEndpoint: target,
            frontendEndpoint: ep,
            frontendEndpoints: Array.isArray(s.frontendEndpoints) ? s.frontendEndpoints : [ep].filter(Boolean),
            reserved: isRes,
            isNamedReservation: Boolean(nameObj?.reserved)
          });
        }
      }
    }
  }

  if (Array.isArray(data.names)) {
    for (const n of data.names) {
      if (n.reserved === true) {
        const existing = shares.find((s) => s.shareToken === n.shareToken || s.name === n.name);
        const nsName = n.namespaceName || 'shares.zrok.io';
        const nsToken = n.namespaceToken || 'public';
        const token = n.shareToken && n.shareToken !== '-' ? n.shareToken : n.name;
        const ep = `https://${n.name}.${nsName}`;
        if (!existing) {
          shares.push({
            shareToken: token,
            name: n.name,
            namespaceToken: nsToken,
            nameSelection: `${nsToken}:${n.name}`,
            target: '',
            backendProxyEndpoint: '',
            frontendEndpoint: ep,
            frontendEndpoints: [`${n.name}.${nsName}`],
            reserved: true,
            isNamedReservation: true
          });
        } else {
          existing.reserved = true;
          existing.name = n.name;
          existing.backendShareToken = existing.shareToken;
          existing.shareToken = n.name;
          existing.nameSelection = `${nsToken}:${n.name}`;
          existing.isNamedReservation = true;
          existing.frontendEndpoint = ep;
        }
      }
    }
  }

  return shares;
}

/**
 * Retrieves all shares from the zrok account overview.
 * Accepts binary path, pre-parsed object, or raw JSON string.
 * @param {string|object} zrokBinaryOrData
 * @returns {Array<object>}
 */
export function getZrokShares(zrokBinaryOrData) {
  if (typeof zrokBinaryOrData === 'object' && zrokBinaryOrData !== null) {
    return parseZrokOverviewJson(zrokBinaryOrData);
  }
  if (typeof zrokBinaryOrData === 'string') {
    const sIdx = zrokBinaryOrData.indexOf('{');
    const eIdx = zrokBinaryOrData.lastIndexOf('}');
    if (sIdx !== -1 && eIdx > sIdx) {
      try {
        const parsed = JSON.parse(zrokBinaryOrData.slice(sIdx, eIdx + 1));
        return parseZrokOverviewJson(parsed);
      } catch {
        // Continue to binary lookup
      }
    }
  }
  const data = getZrokOverviewData(zrokBinaryOrData);
  return parseZrokOverviewJson(data);
}

/**
 * Cleans up stale shares for a given port or target reserved name before hosting.
 * In zrok2, if a previous process exited abruptly, the share backend token remains attached
 * to the reserved name (e.g. 'lan'), blocking new processes with "in use by share '<token>'".
 * Deleting the stale share in zrok2 releases the binding without deleting the reserved name.
 * @param {string} zrokBinary
 * @param {number|string} port
 * @param {string|null} targetName
 */
export function cleanupStaleZrokShares(zrokBinary, port, targetName = null) {
  if (!zrokBinary) {
    return;
  }
  const isV2 = isZrokV2(zrokBinary);
  const portStr = String(port);

  try {
    const data = getZrokOverviewData(zrokBinary);
    if (!data) {
      return;
    }

    const tokensToDelete = new Set();

    // 1. If a reserved name (e.g. 'lan') is currently in use by a share token
    if (Array.isArray(data.names)) {
      for (const n of data.names) {
        const matchesTarget = targetName ? n.name === targetName : n.reserved === true;
        if (matchesTarget && n.shareToken && n.shareToken !== '-') {
          tokensToDelete.add(n.shareToken);
        }
      }
    }

    // 2. Any active share in environments targeting our port
    if (Array.isArray(data.environments)) {
      for (const env of data.environments) {
        if (Array.isArray(env?.shares)) {
          for (const s of env.shares) {
            const tgt = s.target || s.backendProxyEndpoint || '';
            if (tgt.includes(`:${portStr}`)) {
              tokensToDelete.add(s.shareToken);
            }
          }
        }
      }
    }

    for (const token of tokensToDelete) {
      try {
        console.log(`Releasing stale zrok share '${token}'...`);
        execSync(`"${zrokBinary}" delete share ${token}`, { stdio: 'ignore' });
      } catch {}
    }
  } catch {}
}

/**
 * Finds an existing reserved or reusable share.
 * Prioritizes:
 * 1. An explicitly reserved share targeting the port
 * 2. An explicitly reserved named share matching 'lan'
 * 3. Any explicitly reserved share
 * 4. Any share targeting the configured port
 * 5. Any share in the environment
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
    (s) => s.reserved === true && (s.backendProxyEndpoint || s.target) && (s.backendProxyEndpoint || s.target).includes(`:${portStr}`)
  );
  if (reservedForPort) {
    return reservedForPort;
  }

  // 2. Explicitly reserved named share for 'lan'
  const lanReserved = shares.find(
    (s) => s.reserved === true && (s.name === 'lan' || s.shareToken === 'lan')
  );
  if (lanReserved) {
    return lanReserved;
  }

  // 3. Any reserved share
  const anyReserved = shares.find((s) => s.reserved === true);
  if (anyReserved) {
    return anyReserved;
  }

  // 4. Any share targeting our port
  const matchingPort = shares.find(
    (s) => (s.backendProxyEndpoint || s.target) && (s.backendProxyEndpoint || s.target).includes(`:${portStr}`)
  );
  if (matchingPort) {
    return matchingPort;
  }

  // 5. Any share in the environment
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
 * Supports both zrok2 (create name + modify name -r) and legacy zrok v0.4 (reserve public).
 * @param {string} zrokBinary
 * @param {string} targetUrl
 * @returns {{ token: string, name?: string, nameSelection?: string, url: string } | null}
 */
export function reserveNewShare(zrokBinary, targetUrl) {
  const candidates = generateCandidateWords();
  const isV2 = isZrokV2(zrokBinary);

  if (isV2) {
    for (const word of candidates) {
      try {
        console.log(`Attempting to reserve share name '${word}'...`);
        execSync(`"${zrokBinary}" create name ${word} -n public`, {
          stdio: ['ignore', 'ignore', 'pipe']
        });
        execSync(`"${zrokBinary}" modify name ${word} -r -n public`, {
          stdio: ['ignore', 'ignore', 'pipe']
        });
        console.log(`Successfully reserved share '${word}'!`);
        return {
          token: word,
          name: word,
          nameSelection: `public:${word}`,
          url: `https://${word}.shares.zrok.io`
        };
      } catch {
        console.log(`Could not reserve '${word}'. Generating another name...`);
      }
    }
    return null;
  }

  // Legacy zrok v0.4.x reservation
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
            name: word,
            nameSelection: `public:${word}`,
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
          name: res.token,
          nameSelection: `public:${res.token}`,
          url: res.frontend_endpoints?.[0] || `https://${res.token}.share.zrok.io`
        };
      }
    }
  } catch (err) {
    console.warn('Failed to reserve public share:', err.message);
  }

  return null;
}
