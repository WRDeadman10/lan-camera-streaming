/**
 * @file scripts/build-exe.js
 * Builds a standalone single-executable application (lan-camera-streaming.exe)
 * using Node.js Single Executable Application (SEA), esbuild, and postject.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const appVersion = pkg.version || '1.0.0';

  console.log('=================================================');
  console.log(` Building Standalone Console Executable (.exe) v${appVersion}`);
  console.log('=================================================');

  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 1. Build embedded static assets registry
  console.log('[1/5] Compiling embedded static assets...');
  execSync(`node "${path.join(__dirname, 'build-embedded-assets.js')}"`, { stdio: 'inherit' });

  // 2. Bundle CLI entry point using esbuild
  console.log('[2/5] Bundling application with esbuild...');
  const bundlePath = path.join(distDir, 'bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/server/cli.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    banner: {
      js: "const import_meta_url = require('url').pathToFileURL(__filename).toString();"
    },
    define: {
      'import.meta.url': 'import_meta_url',
      '__APP_VERSION__': JSON.stringify(appVersion)
    },
    outfile: bundlePath,
    minify: false
  });
  console.log(`Bundle generated: ${bundlePath} (${(fs.statSync(bundlePath).size / 1024 / 1024).toFixed(2)} MB)`);

  // 3. Generate SEA configuration & preparation blob
  console.log('[3/5] Generating Node SEA preparation blob...');
  const seaConfigPath = path.join(distDir, 'sea-config.json');
  const blobPath = path.join(distDir, 'sea-prep.blob');

  const seaConfig = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true
  };

  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
  execSync(`node --experimental-sea-config "${seaConfigPath}"`, { stdio: 'inherit' });

  // 4. Copy node.exe to target executable
  const targetExePath = path.join(distDir, 'lan-camera-streaming.exe');
  console.log(`[4/5] Copying node runtime to ${targetExePath}...`);
  fs.copyFileSync(process.execPath, targetExePath);

  // 5. Inject SEA blob using postject
  console.log('[5/6] Injecting SEA blob into executable...');
  const postjectCmd = `npx postject "${targetExePath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;
  execSync(postjectCmd, { stdio: 'inherit' });

  // 5b. Embed icon and version resources into PE executable
  console.log('[+] Embedding application icon and version info into executable...');
  const iconPath = path.join(rootDir, 'assets/icon.ico');
  try {
    const ResEdit = await import('resedit');
    const exeBytes = fs.readFileSync(targetExePath);
    const exe = ResEdit.NtExecutable.from(exeBytes, { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);

    if (fs.existsSync(iconPath)) {
      const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        1,
        1033,
        iconFile.icons.map((item) => item.data)
      );
    }

    const vParts = appVersion.split('.').map((n) => parseInt(n, 10) || 0);
    while (vParts.length < 4) {
      vParts.push(0);
    }
    const versionRes = ResEdit.Resource.VersionInfo.createEmpty();
    versionRes.setFileVersion(vParts[0], vParts[1], vParts[2], vParts[3]);
    versionRes.setProductVersion(vParts[0], vParts[1], vParts[2], vParts[3]);
    versionRes.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: 'LAN Camera Streaming',
        FileDescription: 'LAN Camera Streaming Console Application',
        ProductVersion: appVersion,
        FileVersion: appVersion
      }
    );
    versionRes.outputToResourceEntries(res.entries);

    res.outputResource(exe);
    const newExeBytes = exe.generate();
    fs.writeFileSync(targetExePath, Buffer.from(newExeBytes));
    console.log(`[+] Successfully embedded icon & version v${appVersion} into executable!`);
  } catch (err) {
    console.warn(`[!] Warning: Could not embed resources into executable (${err.message}).`);
  }

  const exeSizeMb = (fs.statSync(targetExePath).size / 1024 / 1024).toFixed(2);

  // 6. Expose .env and .env.example alongside the executable for user configuration
  console.log('[6/6] Exposing .env configuration file in dist/ for user customization...');
  const distEnvPath = path.join(distDir, '.env');
  const distEnvExamplePath = path.join(distDir, '.env.example');
  const srcEnvExamplePath = path.join(rootDir, '.env.example');
  const srcEnvPath = path.join(rootDir, '.env');

  if (fs.existsSync(srcEnvExamplePath)) {
    fs.copyFileSync(srcEnvExamplePath, distEnvExamplePath);
  }

  if (!fs.existsSync(distEnvPath)) {
    if (fs.existsSync(srcEnvPath)) {
      fs.copyFileSync(srcEnvPath, distEnvPath);
    } else if (fs.existsSync(srcEnvExamplePath)) {
      fs.copyFileSync(srcEnvExamplePath, distEnvPath);
    }
  }

  // Copy icon files into dist/ as well
  if (fs.existsSync(iconPath)) {
    fs.copyFileSync(iconPath, path.join(distDir, 'icon.ico'));
  }
  const iconPngPath = path.join(rootDir, 'assets/icon.png');
  if (fs.existsSync(iconPngPath)) {
    fs.copyFileSync(iconPngPath, path.join(distDir, 'icon.png'));
  }

  console.log('\n=================================================');
  console.log(` SUCCESS: Standalone executable created!`);
  console.log(` Binary: ${targetExePath} (${exeSizeMb} MB)`);
  console.log(` Icon:   Embedded into EXE + dist/icon.ico`);
  console.log(` Config: ${distEnvPath} (user editable)`);
  console.log('=================================================\n');

  // Verify executable by running --help
  console.log('Verifying executable with --help:');
  const helpOutput = execSync(`"${targetExePath}" --help`, { encoding: 'utf8' });
  console.log(helpOutput);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
