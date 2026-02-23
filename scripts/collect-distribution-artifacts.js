#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tauriTargetRoot = path.join(repoRoot, 'src-tauri', 'target');
const distRoot = path.join(repoRoot, 'for-distribution');

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function copyRecursiveSync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Resolve the bundle directory for a given target (or the default build).
// '__default__' is a sentinel meaning src-tauri/target/release/bundle/
function getBundleDir(target) {
  if (target === '__default__') {
    return path.join(tauriTargetRoot, 'release', 'bundle');
  }
  return path.join(tauriTargetRoot, target, 'release', 'bundle');
}

function collectDmg(target) {
  const bundleDir = getBundleDir(target);
  const dmgDir = path.join(bundleDir, 'dmg');
  if (!fs.existsSync(dmgDir)) {
    console.warn(`[collect] No dmg directory found: ${dmgDir}`);
    return 0;
  }

  // Clean any old .dmg files and target subfolders from for-distribution/
  for (const existing of fs.readdirSync(distRoot)) {
    const existingPath = path.join(distRoot, existing);
    if (existing.endsWith('.dmg') || (existing !== '.DS_Store' && fs.statSync(existingPath).isDirectory())) {
      fs.rmSync(existingPath, { recursive: true, force: true });
    }
  }

  let copied = 0;
  for (const file of fs.readdirSync(dmgDir)) {
    if (file.endsWith('.dmg')) {
      const srcPath = path.join(dmgDir, file);
      const destPath = path.join(distRoot, file);
      fs.copyFileSync(srcPath, destPath);
      copied += 1;
      console.log(`[collect] Copied ${file} -> for-distribution/`);
    }
  }

  if (copied === 0) {
    console.warn(`[collect] No .dmg files found in ${dmgDir}`);
  }
  return copied;
}

function collectNonMac(target) {
  const bundleDir = getBundleDir(target);
  const targetOut = path.join(distRoot, target);
  if (fs.existsSync(targetOut)) {
    fs.rmSync(targetOut, { recursive: true, force: true });
  }
  fs.mkdirSync(targetOut, { recursive: true });

  let copied = 0;
  for (const bundleType of fs.readdirSync(bundleDir)) {
    const bundleTypeDir = path.join(bundleDir, bundleType);
    if (!fs.statSync(bundleTypeDir).isDirectory()) continue;

    for (const artifactName of fs.readdirSync(bundleTypeDir)) {
      const srcPath = path.join(bundleTypeDir, artifactName);
      const destPath = path.join(targetOut, bundleType, artifactName);
      copyRecursiveSync(srcPath, destPath);
      copied += 1;
    }
  }

  if (copied > 0) {
    console.log(`[collect] Copied ${copied} artifact(s) for ${target} -> for-distribution/${target}`);
  } else {
    console.warn(`[collect] No artifacts found in ${bundleDir}`);
  }
  return copied;
}

function collectFromTarget(target) {
  const bundleDir = getBundleDir(target);
  if (!fs.existsSync(bundleDir)) {
    console.warn(`[collect] No bundle directory found: ${bundleDir}`);
    return 0;
  }

  const isMac = target === '__default__'
    ? fs.existsSync(path.join(bundleDir, 'dmg'))
    : target.includes('apple-darwin');

  return isMac ? collectDmg(target) : collectNonMac(target);
}

function main() {
  const requestedTarget = parseArg('--target');
  fs.mkdirSync(distRoot, { recursive: true });

  if (requestedTarget) {
    // Explicit target specified
    const total = collectFromTarget(requestedTarget);
    if (total > 0) {
      console.log(`[collect] Distribution artifacts ready in: ${distRoot}`);
    }
    return;
  }

  // No target specified: use the default release/bundle path
  const defaultBundleDir = path.join(tauriTargetRoot, 'release', 'bundle');
  if (fs.existsSync(defaultBundleDir)) {
    const total = collectFromTarget('__default__');
    if (total > 0) {
      console.log(`[collect] Distribution artifacts ready in: ${distRoot}`);
    }
  } else {
    console.warn('[collect] No Tauri build output found. Run `tauri build` first.');
  }
}

main();
