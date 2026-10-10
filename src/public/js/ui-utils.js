/**
 * @file ui-utils.js
 * Common UI helper utilities for sender and viewer interfaces.
 */

export function showError(message) {
  const alert = document.getElementById('errorAlert');
  if (alert) {
    alert.textContent = message;
    alert.classList.add('visible');
  }
}

export function clearError() {
  const alert = document.getElementById('errorAlert');
  if (alert) {
    alert.textContent = '';
    alert.classList.remove('visible');
  }
}

export function showInfo(message) {
  const alert = document.getElementById('infoAlert');
  if (alert) {
    alert.textContent = message;
    alert.classList.add('visible');
  }
}

export function clearInfo() {
  const alert = document.getElementById('infoAlert');
  if (alert) {
    alert.textContent = '';
    alert.classList.remove('visible');
  }
}

export function updateStatus(state, text) {
  const badge = document.getElementById('statusBadge');
  const textEl = document.getElementById('statusText');
  if (badge && textEl) {
    badge.className = `status-badge status-${state.toLowerCase()}`;
    textEl.textContent = text || state;
  }
}

export function logDiagnostic(message, level = 'INFO') {
  const logEl = document.getElementById('diagnosticsLog');
  const now = new Date();
  const timestamp = now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const prefix = `[${timestamp}] [${level}]`;
  const entry = `${prefix} ${message}\n`;
  if (logEl) {
    logEl.textContent = entry + logEl.textContent;
  }
  if (level === 'ERROR') {
    console.error(`${prefix} ${message}`);
  } else if (level === 'WARN') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function parseCandidateSummary(cand) {
  if (cand === null || cand === undefined) {
    return 'End-of-candidates (null)';
  }
  const str = typeof cand === 'string' ? cand : (cand.candidate || '');
  if (!str || str.trim().length === 0) {
    return 'End-of-candidates (empty)';
  }
  // Candidate format: candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ <type> [raddr <raddr> rport <rport>] ...
  const parts = str.trim().split(/\s+/);
  const proto = parts[2] ? parts[2].toUpperCase() : 'UDP';
  const ip = parts[4] || '?';
  const port = parts[5] || '?';
  let type = 'UNKNOWN';
  const typIdx = parts.indexOf('typ');
  if (typIdx !== -1 && parts[typIdx + 1]) {
    type = parts[typIdx + 1].toUpperCase();
  }
  const isMdns = ip.endsWith('.local');
  const addressInfo = isMdns ? `${ip} [mDNS obfuscated]` : `${ip}:${port}`;
  return `${type} via ${proto} (${addressInfo})`;
}

const PATH_DESCRIPTIONS = {
  lan: { text: 'LAN direct - video stays on your network, 0 bytes through zrok', className: 'path-lan' },
  internet: { text: 'Direct over the internet (STUN) - video does not use zrok', className: 'path-internet' },
  relay: { text: 'TURN relay - video goes through the TURN server, not zrok', className: 'path-relay' }
};

export function describePath(pathKind) {
  return PATH_DESCRIPTIONS[pathKind] || null;
}

export function setPathIndicator(pathKind) {
  const el = document.getElementById('pathIndicator');
  const description = describePath(pathKind);
  if (!el) {
    return;
  }
  if (!description) {
    el.textContent = '';
    el.className = 'path-indicator';
    return;
  }
  el.textContent = description.text;
  el.className = `path-indicator visible ${description.className}`;
}

export function isLocalHostname(hostname) {
  if (!hostname) {
    return false;
  }
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.localhost')) {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!match) {
    return false;
  }
  const first = parseInt(match[1], 10);
  const second = parseInt(match[2], 10);
  return first === 127 || first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

export async function fetchLocalServerOrigin() {
  try {
    const res = await fetch('/api/network-info');
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return `${data.protocol}://localhost:${data.port}`;
  } catch (err) {
    return null;
  }
}

export function setupDiagnosticsControls(copyBtnId, clearBtnId, logElementId = 'diagnosticsLog') {
  const copyBtn = document.getElementById(copyBtnId);
  const clearBtn = document.getElementById(clearBtnId);
  const logEl = document.getElementById(logElementId);

  if (copyBtn && logEl) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(logEl.textContent);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 2000);
      } catch (err) {
        logDiagnostic(`Failed to copy diagnostics: ${err.message}`, 'WARN');
      }
    });
  }

  if (clearBtn && logEl) {
    clearBtn.addEventListener('click', () => {
      logEl.textContent = '';
      logDiagnostic('Diagnostics log cleared.', 'INFO');
    });
  }
}
