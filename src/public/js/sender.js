/**
 * @file sender.js
 * Sender client entry point handling UI events.
 */

import { showError, clearError, updateStatus, logDiagnostic } from './ui-utils.js';

logDiagnostic('Sender client initialized.');
updateStatus('stopped', 'Ready');
