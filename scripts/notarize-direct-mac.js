#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'for-distribution');
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const entitlementsPath = path.join(repoRoot, 'build', 'entitlements.mac.plist');
const dmgBundleDirs = [
  path.join(repoRoot, 'src-tauri', 'target', 'universal-apple-darwin', 'release', 'bundle', 'dmg'),
  path.join(repoRoot, 'src-tauri', 'src-tauri', 'target', 'universal-apple-darwin', 'release', 'bundle', 'dmg')
];

function fail(message) {
  console.error(`\n[notarize:mac] ${message}\n`);
  process.exit(1);
}

function runOrThrow(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
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

function getTauriConfig() {
  if (!fs.existsSync(tauriConfigPath)) {
    fail(`Missing Tauri config: ${tauriConfigPath}`);
  }
  return JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
}

function resolveSourceDmg(productName, version) {
  const candidates = [];
  for (const dir of dmgBundleDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.dmg')) continue;
      if (!name.startsWith(`${productName}_${version}_`)) continue;
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      candidates.push({ fullPath, mtimeMs: stat.mtimeMs });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].fullPath;
}

if (process.platform !== 'darwin') {
  fail('Direct notarization must be run on macOS.');
}

const appleId = process.env.APPLE_ID;
const teamId = process.env.APPLE_TEAM_ID;
const appSpecificPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
if (!appleId || !teamId || !appSpecificPassword) {
  fail('Missing APPLE_ID, APPLE_TEAM_ID, or APPLE_APP_SPECIFIC_PASSWORD in environment.');
}

const tauriConfig = getTauriConfig();
const version = tauriConfig.version;
const productName = tauriConfig.productName || 'ReDD Do';
if (!version) {
  fail('Missing version in src-tauri/tauri.conf.json');
}

const sourceDmgPath = resolveSourceDmg(productName, version);
if (!sourceDmgPath) {
  fail(`Could not find built DMG in expected bundle directories.`);
}

fs.mkdirSync(distDir, { recursive: true });
const outputDmgPath = path.join(distDir, `redd-do-${version}-universal.dmg`);

const appIdentity =
  tauriConfig?.bundle?.macOS?.signingIdentity ||
  process.env.APPLE_DEVELOPER_ID_APP_IDENTITY ||
  detectIdentityFromKeychain([/"Developer ID Application:[^"]+"/i]);

if (!appIdentity) {
  fail('Missing Developer ID Application identity for connector re-signing.');
}
if (!fs.existsSync(entitlementsPath)) {
  fail(`Missing entitlements file: ${entitlementsPath}`);
}

const tempMountPoint = path.join('/tmp', `redd-do-dmg-mount-${Date.now()}`);
const tempStageDir = path.join('/tmp', `redd-do-dmg-stage-${Date.now()}`);
fs.mkdirSync(tempMountPoint, { recursive: true });
fs.mkdirSync(tempStageDir, { recursive: true });

runOrThrow('hdiutil', [
  'attach',
  '-readonly',
  '-nobrowse',
  '-mountpoint',
  tempMountPoint,
  sourceDmgPath
]);
try {
  runOrThrow('ditto', [tempMountPoint, tempStageDir]);
} finally {
  runOrThrow('hdiutil', ['detach', tempMountPoint]);
}

const stagedAppPath = path.join(tempStageDir, `${productName}.app`);
const connectorPath = path.join(stagedAppPath, 'Contents', 'Resources', 'reminders-connector');
if (fs.existsSync(connectorPath)) {
  runOrThrow('codesign', [
    '--force',
    '--sign',
    appIdentity,
    '--options',
    'runtime',
    '--timestamp',
    '--entitlements',
    entitlementsPath,
    connectorPath
  ]);
}

runOrThrow('codesign', [
  '--force',
  '--sign',
  appIdentity,
  '--options',
  'runtime',
  '--timestamp',
  '--entitlements',
  entitlementsPath,
  stagedAppPath
]);

fs.rmSync(outputDmgPath, { force: true });
runOrThrow('hdiutil', [
  'create',
  '-volname',
  productName,
  '-srcfolder',
  tempStageDir,
  '-ov',
  '-format',
  'UDZO',
  outputDmgPath
]);
fs.rmSync(tempStageDir, { recursive: true, force: true });
fs.rmSync(tempMountPoint, { recursive: true, force: true });

console.log(`[notarize:mac] Using source DMG: ${sourceDmgPath}`);
console.log(`[notarize:mac] Output DMG: ${outputDmgPath}`);

try {
  runOrThrow('xcrun', [
    'notarytool',
    'submit',
    outputDmgPath,
    '--apple-id',
    appleId,
    '--team-id',
    teamId,
    '--password',
    appSpecificPassword,
    '--wait'
  ]);

  runOrThrow('xcrun', ['stapler', 'staple', outputDmgPath]);
  runOrThrow('xcrun', ['stapler', 'validate', outputDmgPath]);
  console.log('\n[notarize:mac] Notarization complete and ticket stapled.\n');
} catch (err) {
  fail(err.message);
}
