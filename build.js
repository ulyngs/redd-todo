require('dotenv').config();
const builder = require('electron-builder');
const Platform = builder.Platform;

// Check command line arguments
const buildMac = process.argv.includes('--mac');
const buildWin = process.argv.includes('--win');
const buildLinux = process.argv.includes('--linux');
const buildMas = process.argv.includes('--mas');

// If no flags, default to current platform
const targets = [];
if (buildMac || buildMas) targets.push(Platform.MAC);
if (buildWin) targets.push(Platform.WINDOWS);
if (buildLinux) targets.push(Platform.LINUX);

if (targets.length === 0) {
   console.log("No platform flags detected (--mac, --win, --linux, --mas). Building for current platform only.");
}

// Determine Mac targets
let macTargets = [
  {
    target: 'dmg',
    arch: ['universal']
  },
  {
    target: 'zip',
    arch: ['universal']
  }
];

if (buildMas) {
  macTargets = ['mas'];
}

builder.build({
  targets: targets.length > 0 ? builder.createTargets(targets) : undefined,
  config: {
    snap: null,
    appId: 'com.redd.todo',
    productName: 'ReDD Todo',
    copyright: 'Copyright © 2025 Reduce Digital Distraction Ltd',
    directories: {
      output: 'dist',
      buildResources: 'assets'
    },
    mac: {
      // Explicitly set identity to null so 'mas' target configuration takes precedence when building for MAS
      // Otherwise, the global mac identity (Developer ID) overrides the mas-specific identity
      identity: buildMas ? null : "ULRIK LYNGS (7YEYWQKK25)",
      category: 'public.app-category.productivity',
      target: macTargets,
      icon: 'assets/icon.icns',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      extendInfo: {
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    mas: {
      hardenedRuntime: false,
      type: "distribution",
      category: 'public.app-category.productivity',
      entitlements: 'build/entitlements.mas.plist',
      entitlementsInherit: 'build/entitlements.mas.inherit.plist',
      provisioningProfile: 'build/ReDD_Todo_New.provisionprofile',
      icon: 'assets/icon.icns',
      identity: "ULRIK LYNGS (7YEYWQKK25)"
    },
    win: {
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        },
        {
          target: 'zip',
          arch: ['x64']
        }
      ],
      icon: 'assets/icon.ico'
    },
    linux: {
      target: ['AppImage', 'deb'],
      category: 'Utility',
      icon: 'assets/icon.png'
    },
    defaultArch: 'x64'
  }
}).then(() => {
  console.log('Build complete!');
}).catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
