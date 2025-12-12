require('dotenv').config();
const builder = require('electron-builder');
const fs = require('fs');
const path = require('path');
const Platform = builder.Platform;

// Check command line arguments
const buildMac = process.argv.includes('--mac');
const buildWin = process.argv.includes('--win');
const buildLinux = process.argv.includes('--linux');
const buildMas = process.argv.includes('--mas');

// Detect implicit "current platform" builds (when no flags are provided)
const noExplicitPlatformFlags = !buildMac && !buildWin && !buildLinux && !buildMas;
const isImplicitWin = noExplicitPlatformFlags && process.platform === 'win32';
const isImplicitLinux = noExplicitPlatformFlags && process.platform === 'linux';

// Read package.json so we can override metadata for platform-specific builds
const pkgJsonPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

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
  macTargets = [
    {
      target: 'mas',
      arch: ['universal']
    }
  ];
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
      identity: buildMas ? null : process.env.APPLE_IDENTITY,
      category: 'public.app-category.productivity',
      target: macTargets,
      icon: 'assets/icon.icns',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      x64ArchFiles: 'Contents/Resources/reminders-connector',
      extraResources: [
        {
          from: "src/reminders-connector",
          to: "reminders-connector"
        }
      ],
      extendInfo: {
        "ITSAppUsesNonExemptEncryption": false,
        "NSRemindersUsageDescription": "ReDD Todo needs access to your reminders to sync tasks."
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
      identity: process.env.APPLE_IDENTITY
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
        },
        {
          target: 'appx',
          arch: ['x64']
        }
      ],
      icon: 'assets/icon.ico'
    },
    appx: {
      identityName: process.env.WINDOWS_IDENTITY_NAME,
      publisher: process.env.WINDOWS_PUBLISHER,
      publisherDisplayName: process.env.WINDOWS_PUBLISHER_DISPLAY_NAME
    },
    linux: {
      target: [
        {
          target: 'AppImage',
          arch: ['x64', 'arm64']
        },
        {
          target: 'deb',
          arch: ['x64', 'arm64']
        }
      ],
      category: 'Utility',
      icon: 'assets/icon.png',
      artifactName: 'redd-todo-${version}-${arch}.${ext}'
    },
    // electron-panel-window is macOS-only at runtime; excluding it from Windows/Linux
    // packaging avoids electron-builder dependency graph errors on those platforms.
    extraMetadata: (buildWin || buildLinux || isImplicitWin || isImplicitLinux) ? {
      dependencies: Object.fromEntries(
        Object.entries(pkg.dependencies || {}).filter(([name]) => name !== '@ashubashir/electron-panel-window')
      )
    } : undefined,
    defaultArch: 'x64'
  }
}).then(() => {
  console.log('Build complete!');
  
  // Rename linux files to enforce consistent 'x64' naming
  if (buildLinux) {
    const distDir = path.join(__dirname, 'dist');
    try {
      const files = fs.readdirSync(distDir);
      files.forEach(file => {
        if (file.includes('amd64')) {
          const newName = file.replace('amd64', 'x64');
          fs.renameSync(path.join(distDir, file), path.join(distDir, newName));
          console.log(`Renamed ${file} to ${newName}`);
        } else if (file.includes('x86_64')) {
          const newName = file.replace('x86_64', 'x64');
          fs.renameSync(path.join(distDir, file), path.join(distDir, newName));
          console.log(`Renamed ${file} to ${newName}`);
        }
      });
    } catch (e) {
      console.error('Error renaming linux files:', e);
    }
  }
}).catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
