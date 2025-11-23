require('dotenv').config();
const builder = require('electron-builder');
const Platform = builder.Platform;

builder.build({
  config: {
    appId: 'com.redd.task',
    productName: 'ReDD Task',
    copyright: 'Copyright © 2025 ReDD',
    directories: {
      output: 'dist',
      buildResources: 'assets'
    },
    mac: {
      identity: "ULRIK LYNGS (7YEYWQKK25)",
      category: 'public.app-category.productivity',
      target: ['dmg', 'zip'],
      icon: 'assets/icon.icns',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      // electron-builder 26+ uses @electron/notarize automatically if APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID are set
      // setting notarize: false disables it, we want it enabled so we omit the field or set it to true if we need to force it (but true is invalid in new schema if an object was expected in old schema)
      // The error message says configuration.mac.notarize should be a boolean.
      // It seems we should just remove the explicit notarize config block since we are providing env vars
    },
    win: {
      target: 'nsis',
      icon: 'assets/icon.ico'
    },
    linux: {
      target: ['AppImage', 'deb'],
      category: 'Utility',
      icon: 'assets/icon.png'
    }
  }
}).then(() => {
  console.log('Build complete!');
}).catch((error) => {
  console.error('Build failed:', error);
});
