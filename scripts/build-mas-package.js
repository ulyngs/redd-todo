#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const repoRoot = path.resolve(__dirname, '..');
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml');
const tempTauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.appstore.temp.conf.json');
const masEntitlementsPath = path.join(repoRoot, 'build', 'entitlements.mas.plist');
const masInheritEntitlementsPath = path.join(repoRoot, 'build', 'entitlements.mas.inherit.plist');
const targetTriple = 'universal-apple-darwin';
const skipTauriBuild = process.argv.includes('--skip-tauri-build');
const optional = process.argv.includes('--optional');

function runOrThrow(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function fail(message) {
  console.error(`\n[build:mas] ${message}\n`);
  process.exit(1);
}

function skip(message) {
  console.warn(`\n[build:mas] ${message}\n`);
  process.exit(0);
}

function makeAppStoreConfig(baseConfig) {
  const config = JSON.parse(JSON.stringify(baseConfig));
  if (!config.app) config.app = {};
  config.app.macOSPrivateApi = false;
  return config;
}

function removePrivateApiFeature(cargoTomlContent) {
  const tauriDepRegex = /(tauri\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*)(\][^}]*\})/m;
  const match = cargoTomlContent.match(tauriDepRegex);
  if (!match) {
    // No explicit features array on tauri dependency; nothing to strip.
    return cargoTomlContent;
  }

  const features = match[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^"(.*)"$/, '$1'));
  const filtered = features.filter((feature) => feature !== 'macos-private-api');
  const replacementFeatures = filtered.map((feature) => `"${feature}"`).join(', ');
  return cargoTomlContent.replace(tauriDepRegex, `$1${replacementFeatures}$3`);
}

function detectIdentityFromKeychain(preferredPatterns) {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'basic'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) return null;

  const output = result.stdout || '';
  const lines = output.split('\n');

  for (const pattern of preferredPatterns) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) return match[0].replace(/^"|"$/g, '');
    }
  }
  return null;
}

function autoDetectInstallerIdentity() {
  return detectIdentityFromKeychain([
    /"3rd Party Mac Developer Installer:[^"]+"/i,
    /"Developer ID Installer:[^"]+"/i
  ]);
}

function autoDetectAppIdentity() {
  return detectIdentityFromKeychain([
    /"Apple Distribution:[^"]+"/i,
    /"3rd Party Mac Developer Application:[^"]+"/i,
    /"Developer ID Application:[^"]+"/i
  ]);
}

if (process.platform !== 'darwin') {
  if (optional) skip('Skipping .pkg generation because host OS is not macOS.');
  fail('build:mas must be run on macOS.');
}

if (!fs.existsSync(tauriConfigPath)) {
  if (optional) skip(`Skipping .pkg generation because config is missing: ${tauriConfigPath}`);
  fail(`Missing Tauri config: ${tauriConfigPath}`);
}
if (!fs.existsSync(cargoTomlPath)) {
  if (optional) skip(`Skipping .pkg generation because Cargo.toml is missing: ${cargoTomlPath}`);
  fail(`Missing Cargo.toml: ${cargoTomlPath}`);
}

const installerIdentity =
  process.env.APPLE_INSTALLER_IDENTITY ||
  (process.env.APPLE_IDENTITY && /installer/i.test(process.env.APPLE_IDENTITY) ? process.env.APPLE_IDENTITY : null) ||
  autoDetectInstallerIdentity();
if (!installerIdentity) {
  if (optional) {
    skip(
      'Skipping .pkg generation because APPLE_INSTALLER_IDENTITY is not set.\n' +
      'Set it to your "3rd Party Mac Developer Installer" identity for Transporter uploads.'
    );
  }
  fail(
    'Missing installer signing identity.\n' +
    'Example:\n' +
    '  APPLE_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Your Company (TEAMID)" npm run build:mas'
  );
}

console.log(`[build:mas] Using installer identity: ${installerIdentity}`);

const appIdentity =
  process.env.APPLE_APP_IDENTITY ||
  process.env.APPLE_DISTRIBUTION_IDENTITY ||
  autoDetectAppIdentity() ||
  (process.env.APPLE_IDENTITY && process.env.APPLE_IDENTITY.includes(':') ? process.env.APPLE_IDENTITY : null);
if (!appIdentity) {
  fail(
    'Missing app signing identity.\n' +
    'Set APPLE_APP_IDENTITY (or APPLE_DISTRIBUTION_IDENTITY), e.g.:\n' +
    '  APPLE_APP_IDENTITY="Apple Distribution: Your Company (TEAMID)" npm run build:mas'
  );
}
console.log(`[build:mas] Using app identity: ${appIdentity}`);

if (!fs.existsSync(masEntitlementsPath) || !fs.existsSync(masInheritEntitlementsPath)) {
  fail(
    `Missing MAS entitlement files. Expected:\n` +
    `  - ${masEntitlementsPath}\n` +
    `  - ${masInheritEntitlementsPath}`
  );
}

const originalTauriConfigRaw = fs.readFileSync(tauriConfigPath, 'utf8');
const originalCargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const tauriConfig = JSON.parse(originalTauriConfigRaw);
const needsAppStoreOverride = !!tauriConfig?.app?.macOSPrivateApi;

if (skipTauriBuild && needsAppStoreOverride) {
  if (optional) {
    skip(
      'Skipping .pkg generation because existing build artifacts were created with macOSPrivateApi enabled.\n' +
      'Run build:mas without --skip-tauri-build to rebuild in App-Store-safe mode.'
    );
  }
  fail(
    'Cannot use --skip-tauri-build while macOSPrivateApi is enabled.\n' +
    'Run build:mas (without skip) to rebuild in App-Store-safe mode.'
  );
}

let exitCode = 0;
try {
  const buildConfigPath = tempTauriConfigPath;
  const appStoreConfig = makeAppStoreConfig(tauriConfig);
  fs.writeFileSync(buildConfigPath, JSON.stringify(appStoreConfig, null, 2));

  // Remove private API cargo feature for App Store build only.
  fs.writeFileSync(cargoTomlPath, removePrivateApiFeature(originalCargoToml));

  // 1) Build app bundle with Tauri (or reuse if caller already built with App Store-safe config).
  if (!skipTauriBuild) {
    runOrThrow('npm', ['run', 'tauri:build:mas-app'], {
      env: {
        ...process.env,
        CI: 'true',
        npm_config_ci: 'false',
        NPM_CONFIG_CI: 'false'
      }
    });
  }

  // 2) Locate generated .app.
  const productName = appStoreConfig.productName || 'ReDD Do';
  const appBundlePath = path.join(
    repoRoot,
    'src-tauri',
    'target',
    targetTriple,
    'release',
    'bundle',
    'macos',
    `${productName}.app`
  );
  if (!fs.existsSync(appBundlePath)) {
    throw new Error(`Could not find app bundle at: ${appBundlePath}`);
  }

  // 3) Ensure sandbox entitlements are signed onto executable payloads required by Transporter.
  const remindersConnectorPath = path.join(appBundlePath, 'Contents', 'Resources', 'reminders-connector');
  if (fs.existsSync(remindersConnectorPath)) {
    runOrThrow('codesign', [
      '--force',
      '--sign',
      appIdentity,
      '--entitlements',
      masInheritEntitlementsPath,
      '--timestamp=none',
      remindersConnectorPath
    ]);
  }

  runOrThrow('codesign', [
    '--force',
    '--sign',
    appIdentity,
    '--entitlements',
    masEntitlementsPath,
    '--timestamp=none',
    appBundlePath
  ]);

  // 4) Build MAS upload package (.pkg) for Transporter.
  const outputDir = path.join(repoRoot, 'for-distribution', targetTriple, 'mas');
  fs.mkdirSync(outputDir, { recursive: true });
  const pkgPath = path.join(outputDir, `${productName}.pkg`);
  if (fs.existsSync(pkgPath)) fs.rmSync(pkgPath, { force: true });

  runOrThrow('productbuild', [
    '--component',
    appBundlePath,
    '/Applications',
    '--sign',
    installerIdentity,
    pkgPath
  ]);

  console.log(`\n[build:mas] Done. Transporter package:\n${pkgPath}\n`);
} catch (err) {
  console.error(`\n[build:mas] ${err.message}\n`);
  exitCode = 1;
} finally {
  try {
    fs.writeFileSync(cargoTomlPath, originalCargoToml);
  } catch (restoreErr) {
    console.warn(`[build:mas] Warning: failed to restore Cargo.toml: ${restoreErr.message}`);
    exitCode = 1;
  }
  try {
    if (fs.existsSync(tempTauriConfigPath)) fs.rmSync(tempTauriConfigPath, { force: true });
  } catch (cleanupErr) {
    console.warn(`[build:mas] Warning: failed to remove temp config: ${cleanupErr.message}`);
    exitCode = 1;
  }
}

process.exit(exitCode);
