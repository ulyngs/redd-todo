#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const targetTriple = process.argv[2] || 'x86_64-unknown-linux-gnu';
const targetRoot = path.join(repoRoot, 'for-distribution', targetTriple);

function fail(message) {
  console.error(`\n[rename:linux] ${message}\n`);
  process.exit(1);
}

function readVersion() {
  if (!fs.existsSync(tauriConfigPath)) {
    fail(`Missing Tauri config: ${tauriConfigPath}`);
  }
  const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
  if (!tauriConfig.version) {
    fail('Missing version in src-tauri/tauri.conf.json');
  }
  return tauriConfig.version;
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, out);
    } else {
      out.push(fullPath);
    }
  }
  return out;
}

function detectArchToken(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('aarch64') || lower.includes('arm64')) return 'arm64';
  if (lower.includes('x86_64') || lower.includes('amd64') || lower.includes('x64')) return 'x64';
  return null;
}

function resolveExtension(fileName) {
  if (fileName.endsWith('.AppImage')) return '.AppImage';
  if (fileName.endsWith('.deb')) return '.deb';
  if (fileName.endsWith('.rpm')) return '.rpm';
  if (fileName.endsWith('.tar.gz')) return '.tar.gz';
  if (fileName.endsWith('.tar.xz')) return '.tar.xz';
  return null;
}

function main() {
  if (!fs.existsSync(targetRoot)) {
    console.warn(`[rename:linux] Target output directory not found: ${targetRoot}`);
    return;
  }

  const version = readVersion();
  const files = walkFiles(targetRoot);
  let renamed = 0;

  for (const filePath of files) {
    const originalName = path.basename(filePath);
    const ext = resolveExtension(originalName);
    if (!ext) continue;

    const arch = detectArchToken(originalName);
    const kebabName = `redd-do-${version}${arch ? `-${arch}` : ''}${ext}`;
    if (originalName === kebabName) continue;

    const renamedPath = path.join(path.dirname(filePath), kebabName);
    fs.renameSync(filePath, renamedPath);
    renamed += 1;
    console.log(`[rename:linux] ${originalName} -> ${kebabName}`);
  }

  if (renamed === 0) {
    console.log('[rename:linux] No Linux artifacts required renaming.');
  } else {
    console.log(`[rename:linux] Renamed ${renamed} Linux artifact(s).`);
  }
}

main();
