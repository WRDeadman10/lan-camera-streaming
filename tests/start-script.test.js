/**
 * @file start-script.test.js
 * Verification suite for Linux/Ubuntu startup script (start.sh).
 * Strictly adheres to AGENTS.md conventions (no var, K&R braces).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Ubuntu / Linux Startup Script (start.sh) Verification', () => {
  const startShPath = path.join(rootDir, 'start.sh');

  test('start.sh exists, has bash shebang, and uses LF line endings', () => {
    assert.ok(fs.existsSync(startShPath), 'start.sh must exist in repository root');
    const content = fs.readFileSync(startShPath, 'utf8');

    // Shebang check
    assert.ok(content.startsWith('#!/usr/bin/env bash'), 'start.sh must start with #!/usr/bin/env bash');

    // Strict LF line endings (no CRLF carriage returns)
    assert.strictEqual(content.includes('\r'), false, 'start.sh must not contain Windows CRLF carriage returns');
  });

  test('start.sh implements essential CLI flags and environment configuration', () => {
    const content = fs.readFileSync(startShPath, 'utf8');

    // Arguments and flags
    assert.ok(content.includes('--local-only'), 'Must support --local-only');
    assert.ok(content.includes('-LocalOnly'), 'Must support -LocalOnly');
    assert.ok(content.includes('--help'), 'Must support --help');

    // Environment and first run
    assert.ok(content.includes('.env'), 'Must support .env loading');
    assert.ok(content.includes('npm install'), 'Must support auto npm install on first run');
    assert.ok(content.includes('PORT'), 'Must read PORT');
    assert.ok(content.includes('HOST'), 'Must read HOST');
    assert.ok(content.includes('ACCESS_PIN'), 'Must read ACCESS_PIN');
    assert.ok(content.includes('ZROK_TOKEN'), 'Must read ZROK_TOKEN');
  });

  test('start.sh implements Ubuntu network discovery and health checks', () => {
    const content = fs.readFileSync(startShPath, 'utf8');

    // Network inspection
    assert.ok(content.includes('hostname -I'), 'Must check hostname -I on Linux');
    assert.ok(content.includes('ip -4'), 'Must check ip -4 on Linux');

    // Health check
    assert.ok(content.includes('/health'), 'Must poll /health endpoint');
    assert.ok(content.includes('curl'), 'Must use curl for health checks');
    assert.ok(content.includes('qrcode-terminal'), 'Must render terminal QR code');
  });

  test('start.sh implements zrok lifecycle and signal cleanup traps', () => {
    const content = fs.readFileSync(startShPath, 'utf8');

    // zrok binary discovery and execution
    assert.ok(content.includes('/usr/local/bin/zrok') || content.includes('find_zrok_binary'), 'Must discover zrok on Linux');
    assert.ok(content.includes('zrok-helper.js'), 'Must utilize zrok-helper.js for shared reservation logic');
    assert.ok(content.includes('share public'), 'Must support zrok share public');

    // Signal trap
    assert.ok(content.includes('trap cleanup INT TERM EXIT'), 'Must trap INT, TERM, EXIT for graceful resource teardown');
    assert.ok(content.includes('kill -TERM'), 'Must terminate child processes with SIGTERM');
  });

  test('start.sh executes --help without errors in bash environment', () => {
    let bashBinary = null;
    const possibleBash = [
      'bash',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    ];

    for (const b of possibleBash) {
      try {
        execSync(`"${b}" --version`, { stdio: 'ignore' });
        bashBinary = b;
        break;
      } catch {
        // Continue search
      }
    }

    if (!bashBinary) {
      // Skip runtime invocation if bash is not available on host
      return;
    }

    const output = execSync(`"${bashBinary}" "${startShPath}" --help`, {
      encoding: 'utf8',
      timeout: 5000
    });

    assert.ok(output.includes('LAN Camera Streaming'), 'Output must contain application header');
    assert.ok(output.includes('--local-only'), 'Output must list --local-only option');
  });
});
