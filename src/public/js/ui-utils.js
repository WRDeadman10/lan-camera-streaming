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
