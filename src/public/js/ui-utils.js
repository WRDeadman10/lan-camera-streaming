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

export function logDiagnostic(message) {
  const logEl = document.getElementById('diagnosticsLog');
  if (logEl) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}\n`;
    logEl.textContent = entry + logEl.textContent;
  }
}
