import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { copyToClipboard, setupDiagnosticsControls, copyTextToClipboard } from '../src/public/js/ui-utils.js';

describe('Resilient Clipboard Copying in Secure and Insecure LAN Contexts', () => {
  let dom;
  let originalWindow;
  let originalDocument;
  let originalClipboardDescriptor;

  beforeEach(() => {
    originalWindow = global.window;
    originalDocument = global.document;
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');

    dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div id="diagnosticsLog">[12:00:00.000] [INFO] Sample diagnostic entry</div>
      <button id="btnCopyDiag">Copy Diagnostics</button>
      <button id="btnClearDiag">Clear Diagnostics</button>
      <button id="btnCopyLink">Copy Link</button>
    </body></html>`, { url: 'http://192.168.1.100:3000' });

    global.window = dom.window;
    global.document = dom.window.document;
  });

  afterEach(() => {
    if (dom && dom.window) {
      dom.window.close();
    }
    global.window = originalWindow;
    global.document = originalDocument;

    if (originalClipboardDescriptor) {
      Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete globalThis.navigator.clipboard;
    }
  });

  function setMockClipboard(clipboardObj) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: clipboardObj,
      configurable: true,
      writable: true
    });
  }

  test('copyToClipboard uses navigator.clipboard.writeText in secure context', async () => {
    let copiedText = '';
    setMockClipboard({
      writeText: async (t) => {
        copiedText = t;
      }
    });

    const result = await copyToClipboard('Hello Secure World');
    assert.strictEqual(result, true);
    assert.strictEqual(copiedText, 'Hello Secure World');
  });

  test('copyToClipboard falls back to execCommand when navigator.clipboard is undefined (LAN IP HTTP)', async () => {
    // Insecure context (HTTP non-localhost): navigator.clipboard is undefined
    setMockClipboard(undefined);
    let execCommandCalled = false;
    let execCommandArg = '';

    global.document.execCommand = (cmd) => {
      execCommandCalled = true;
      execCommandArg = cmd;
      return true;
    };

    const result = await copyToClipboard('LAN Diagnostic Log Data');
    assert.strictEqual(result, true);
    assert.strictEqual(execCommandCalled, true);
    assert.strictEqual(execCommandArg, 'copy');

    // Verify cleanup: textarea should be cleanly removed from DOM
    const textareas = global.document.querySelectorAll('textarea');
    assert.strictEqual(textareas.length, 0, 'Off-screen textarea should be cleanly removed');
  });

  test('copyToClipboard falls back to execCommand if navigator.clipboard.writeText throws an error', async () => {
    setMockClipboard({
      writeText: async () => {
        throw new Error('NotAllowedError: Read/write permission denied');
      }
    });
    let execCommandCalled = false;
    global.document.execCommand = (cmd) => {
      execCommandCalled = true;
      return true;
    };

    const result = await copyToClipboard('Fallback after writeText rejection');
    assert.strictEqual(result, true);
    assert.strictEqual(execCommandCalled, true);
  });

  test('copyToClipboard returns false gracefully if both clipboard API and execCommand fail', async () => {
    setMockClipboard(undefined);
    global.document.execCommand = () => {
      return false;
    };

    const result = await copyToClipboard('Failure test');
    assert.strictEqual(result, false);
  });

  test('setupDiagnosticsControls successfully copies logs without throwing when navigator.clipboard is undefined', async () => {
    // Insecure context (LAN IP HTTP): navigator.clipboard is undefined
    setMockClipboard(undefined);
    let execCommandCalled = false;
    global.document.execCommand = (cmd) => {
      if (cmd === 'copy') {
        execCommandCalled = true;
        return true;
      }
      return false;
    };

    setupDiagnosticsControls('btnCopyDiag', 'btnClearDiag', 'diagnosticsLog');

    const copyBtn = global.document.getElementById('btnCopyDiag');
    const logEl = global.document.getElementById('diagnosticsLog');

    // Trigger click on copy button
    copyBtn.click();

    // Allow promise microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(execCommandCalled, true, 'execCommand copy should be triggered via fallback');
    assert.strictEqual(copyBtn.textContent, '✓ Copied!', 'Copy button should show confirmation text');
    assert.ok(
      !logEl.textContent.includes('Cannot read properties of undefined'),
      'Log must not contain undefined writeText error'
    );
  });

  test('copyTextToClipboard works in insecure context and shows feedback label', async () => {
    setMockClipboard(undefined);
    global.document.execCommand = () => true;

    const btn = global.document.getElementById('btnCopyLink');
    btn.innerHTML = 'Copy Link';

    const success = await copyTextToClipboard('http://192.168.1.100:3000/viewer', btn, '✓ Link Copied!');
    assert.strictEqual(success, true);
    assert.strictEqual(btn.innerHTML, '✓ Link Copied!');
  });
});
