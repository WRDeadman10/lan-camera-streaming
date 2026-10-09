/**
 * @file viewer.js
 * Viewer client entry point handling UI events.
 */

import { showError, clearError, updateStatus, logDiagnostic } from './ui-utils.js';

logDiagnostic('Viewer client initialized.');
updateStatus('disconnected', 'Disconnected');
