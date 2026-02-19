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

function collectFromTarget(targetTriple) {
  const bundleDir = path.join(tauriTargetRoot, targetTriple, 'release', 'bundle');
  if (!fs.existsSync(bundleDir)) {
    console.warn(`[collect] No bundle directory found for ${targetTriple}: ${bundleDir}`);
    return 0;
  }

  const targetOut = path.join(distRoot, targetTriple);
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

  // Also collect updater artifacts/signatures if present.
  const updaterDir = path.join(tauriTargetRoot, targetTriple, 'release', 'bundle', 'updater');
  if (fs.existsSync(updaterDir) && fs.statSync(updaterDir).isDirectory()) {
    for (const updaterArtifact of fs.readdirSync(updaterDir)) {
      const srcPath = path.join(updaterDir, updaterArtifact);
      const destPath = path.join(targetOut, 'updater', updaterArtifact);
      copyRecursiveSync(srcPath, destPath);
      copied += 1;
    }
  }

  if (copied > 0) {
    console.log(`[collect] Copied ${copied} artifact(s) for ${targetTriple} -> for-distribution/${targetTriple}`);
  } else {
    console.warn(`[collect] No artifacts found in ${bundleDir}`);
  }
  return copied;
}

function listAvailableTargets() {
  if (!fs.existsSync(tauriTargetRoot)) return [];
  return fs
    .readdirSync(tauriTargetRoot)
    .filter((name) => fs.statSync(path.join(tauriTargetRoot, name)).isDirectory())
    .filter((name) => fs.existsSync(path.join(tauriTargetRoot, name, 'release', 'bundle')));
}

function main() {
  const requestedTarget = parseArg('--target');
  fs.mkdirSync(distRoot, { recursive: true });

  const targets = requestedTarget ? [requestedTarget] : listAvailableTargets();
  if (targets.length === 0) {
    console.warn('[collect] No Tauri build targets found to collect.');
    process.exit(0);
  }

  let total = 0;
  for (const targetTriple of targets) {
    total += collectFromTarget(targetTriple);
  }

  if (total > 0) {
    console.log(`[collect] Distribution artifacts ready in: ${distRoot}`);
  }
}

main();
