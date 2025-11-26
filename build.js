require('dotenv').config();
const builder = require('electron-builder');
const Platform = builder.Platform;

// Check command line arguments
const buildMac = process.argv.includes('--mac');
const buildWin = process.argv.includes('--win');
const buildLinux = process.argv.includes('--linux');

// If no flags, default to current platform
const targets = [];
if (buildMac) targets.push(Platform.MAC);
if (buildWin) targets.push(Platform.WINDOWS);
if (buildLinux) targets.push(Platform.LINUX);

if (targets.length === 0) {
   console.log("No platform flags detected (--mac, --win, --linux). Building for current platform only.");
   // electron-builder defaults to current platform if 'targets' is not specified
   // so we don't need to push anything to targets here if we want that default behavior.
}

builder.build({
  // ONLY pass targets if we actually selected some.
  // If targets is empty/undefined, electron-builder defaults to current OS.
  targets: targets.length > 0 ? builder.createTargets(targets) : undefined,

  config: {
    // Disable snap builds globally to avoid multipass dependency
    snap: null,
    appId: 'com.redd.todo',
    productName: 'ReDD Todo',
    copyright: 'Copyright © 2025 Reduce Digital Distraction Ltd',
    directories: {
      output: 'dist',
      buildResources: 'assets'
    },
    mac: {
      identity: "ULRIK LYNGS (7YEYWQKK25)",
      category: 'public.app-category.productivity',
      // CHANGE: Replace the simple target array with an object specifying 'universal' architecture
      target: [
        {
          target: 'dmg',
          arch: ['universal']
        },
        {
          target: 'zip',
          arch: ['universal']
        }
      ],
      icon: 'assets/icon.icns',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
    },
    win: {
      // Build both the installer (nsis) and a zip (portable files)
      target: [
        {
          target: 'nsis',
          arch: ['x64'] // FORCE x64 (Intel/AMD)
        },
        {
          target: 'zip',
          arch: ['x64'] // FORCE x64
        }
      ],
      icon: 'assets/icon.ico'
    },
    linux: {
      target: ['AppImage', 'deb'],
      category: 'Utility',
      icon: 'assets/icon.png'
    },
    // Only build x64 by default to avoid arm64 builds on M4 Mac
    defaultArch: 'x64'
  }
}).then(() => {
  console.log('Build complete!');
}).catch((error) => {
  console.error('Build failed:', error);
});
