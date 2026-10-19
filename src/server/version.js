/**
 * @file version.js
 * Dynamically resolves application version from package.json, build environment, or fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion = null;

/**
 * Returns the current application version.
 * Checks build-time injection (__APP_VERSION__), package.json on disk, and fallback.
 * @returns {string}
 */
export function getAppVersion() {
  if (cachedVersion) {
    return cachedVersion;
  }

  // 1. Injected at build time by esbuild in single-executable application (SEA)
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    cachedVersion = String(__APP_VERSION__).trim();
    return cachedVersion;
  }

  // 2. Read dynamically from package.json relative to this file
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.resolve(__dirname, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg && pkg.version) {
        cachedVersion = String(pkg.version).trim();
        return cachedVersion;
      }
    }
  } catch {}

  // 3. Fallback: read from package.json in working directory
  try {
    const cwdPkg = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(cwdPkg)) {
      const pkg = JSON.parse(fs.readFileSync(cwdPkg, 'utf8'));
      if (pkg && pkg.version) {
        cachedVersion = String(pkg.version).trim();
        return cachedVersion;
      }
    }
  } catch {}

  // 4. Default fallback matching latest release
  cachedVersion = '1.0.36';
  return cachedVersion;
}
