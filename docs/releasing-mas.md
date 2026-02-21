# macOS App Store Release (Open-Source Safe)

This project supports building a Transporter-ready macOS App Store package without committing any personal signing data.

## What can be public

- Build scripts and signing workflow
- Generic environment variable names
- Entitlements templates

## What should stay private

- Apple account credentials
- Team-specific certificate names
- Provisioning profile files (`*.mobileprovision`, `*.provisionprofile`)
- Any exported profile/plist dumps containing team IDs or personal names

## Required local setup (on your machine)

Install/sign in to Xcode and ensure these certificates exist in your keychain:

- `Apple Distribution: ...`
- `3rd Party Mac Developer Installer: ...`

Install/download a matching **macOS App Store provisioning profile** for this app bundle ID (configured in `src-tauri/tauri.conf.json` as `identifier`).

## Build command

```bash
npm run build:mas
```

This uses `scripts/build-mas-package.js`, which:

1. Builds an App-Store-safe `.app`
2. Detects/uses signing identities
3. Embeds a matching provisioning profile into:
   - `ReDD Do.app/Contents/embedded.provisionprofile`
4. Re-signs app payloads
5. Produces the Transporter upload package:
   - `for-distribution/universal-apple-darwin/mas/ReDD Do.pkg`

## Optional environment variables

You can override auto-detection with:

- `APPLE_APP_IDENTITY`
- `APPLE_DISTRIBUTION_IDENTITY`
- `APPLE_INSTALLER_IDENTITY`
- `APPLE_PROVISIONING_PROFILE_PATH` (or `APPLE_PROVISIONING_PROFILE`)

Example (generic):

```bash
APPLE_APP_IDENTITY="Apple Distribution: Your Name (TEAMID)" \
APPLE_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Your Name (TEAMID)" \
npm run build:mas
```

## Verify before upload

```bash
pkgutil --check-signature "for-distribution/universal-apple-darwin/mas/ReDD Do.pkg"
```

You can also verify the app bundle contains an embedded provisioning profile:

```bash
ls "src-tauri/target/universal-apple-darwin/release/bundle/macos/ReDD Do.app/Contents/embedded.provisionprofile"
```
