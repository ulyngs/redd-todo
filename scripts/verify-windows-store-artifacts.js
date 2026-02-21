#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const targetTriple = 'x86_64-pc-windows-msvc';
const targetDir = path.join(repoRoot, 'for-distribution', targetTriple);

function listFilesRecursively(rootDir) {
  const files = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current)) {
      const full = path.join(current, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        files.push(full);
      }
    }
  }
  walk(rootDir);
  return files;
}

if (!fs.existsSync(targetDir)) {
  console.error(`[build:win] Missing distribution directory: ${targetDir}`);
  process.exit(1);
}

const files = listFilesRecursively(targetDir);
const storeArtifacts = files.filter((filePath) => {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith('.msi') ||
    lower.endsWith('.exe')
  );
});

if (storeArtifacts.length === 0) {
  console.error(
    '[build:win] No Windows Store submission artifacts found (.msi/.exe).\n' +
    'Check build config and rerun `npm run build:win` on Windows.'
  );
  process.exit(1);
}

console.log('[build:win] Windows Store artifact(s) found:');
storeArtifacts.forEach((artifact) => {
  console.log(`  - ${path.relative(repoRoot, artifact)}`);
});
