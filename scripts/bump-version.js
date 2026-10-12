/**
 * @file scripts/bump-version.js
 * Increments the last digit (patch version) in package.json and package-lock.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version || '1.0.0';

const parts = currentVersion.split('.');
const lastIdx = parts.length - 1;
const lastNum = parseInt(parts[lastIdx], 10);

if (isNaN(lastNum)) {
  parts[lastIdx] = '1';
} else {
  parts[lastIdx] = String(lastNum + 1);
}

const newVersion = parts.join('.');
pkg.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

if (fs.existsSync(lockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = newVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = newVersion;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn(`Could not update package-lock.json: ${err.message}`);
  }
}

console.log(`[+] Version updated: ${currentVersion} -> ${newVersion}`);
