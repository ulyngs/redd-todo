# ReDD Do

A simple, beautiful, and distraction-free todo app for Mac and Windows, built with Tauri. Designed to help you focus on one task at a time while keeping track of your time.

## ✨ Features

*   **Minimalistic Design**: Clean, Shadcn-inspired UI for a clutter-free experience.
*   **Smart Task Management**:
    *   **Time Tracking**: Add expected durations to tasks (e.g., "Write email 15"). The app tracks actual time spent in Focus Mode.
    *   **Drag & Drop**: Reorder tasks intuitively. Drag a task to the bottom of the list to deprioritize it.
    *   **Inline Editing**: Click any task text or duration to edit it instantly.
    *   **Done Section**: Collapsible history of completed tasks with a "Delete All" option and total time spent summary.
*   **Tabbed Organization**: Manage multiple lists (e.g., "Work", "Personal"). Rename tabs by double-clicking or clicking the active tab. Drag tabs to reorder them.
*   **Basecamp 3 Integration**:
    *   Connect your Basecamp account to sync todo lists.
    *   Bi-directional sync: Changes made in the app (add, complete, delete, edit) reflect in Basecamp and vice versa.
    *   Visual indicator for Basecamp-linked lists.
*   **Focus Mode**:
    *   **Distraction-Free Window**: A floating, always-on-top mini window showing only your current task and a timer.
    *   **Fullscreen Mode**: Immerse yourself completely with a single click.
    *   **Smart Timer**: visual countdown based on expected duration. Turns red if you go overtime.
    *   **Quick Actions**: Complete the task or exit focus mode directly from the mini window.
*   **Cross-Platform**: Native apps for Mac and Windows.
*   **Data Persistence**: Your tasks, tabs, and settings are saved automatically.

## 🚀 Usage

### Main Window
*   **Add Tasks**: Type in the input field at the bottom. 
    *   *Tip*: Enter a number in the small box next to the input to set an expected duration (in minutes).
*   **Reorder**: Drag and drop tasks to prioritize them.
*   **Complete**: Click the checkbox. Completed tasks move to the "Done" section.
*   **Edit**: Click any task text or duration to modify it.
*   **Focus**: Click the "Target" icon next to any task to enter Focus Mode.

### Focus Mode
The ultimate distraction-free experience:
1.  Click the **Target icon** on a task.
2.  The window shrinks to show only the task name and a timer.
    *   **Timer**: Counts up or down (if duration set). Shows negative time (red) if you exceed the expected duration.
    *   **Fullscreen**: Click the expand arrows to block out everything else.
3.  **Complete**: Click the checkmark to finish the task and save the time spent.
4.  **Exit**: Click the exit icon to return to the main list without completing.

### Basecamp Integration
Sync your tasks with Basecamp 3:
1.  Click the **Settings (gear)** icon.
2.  Enter your **Account ID**, **Access Token**, and **Email**.
    *   *Note*: You can generate a token from the [Basecamp Developer Launchpad](https://launchpad.37signals.com/integrations).
3.  Click **Connect**.
4.  When creating a new tab (click **+**), you can now select a Basecamp Project and To-do List to sync with.

## 🛠 Development

### Prerequisites
*   Node.js (v18 or higher) and npm
*   Rust toolchain (stable) — install via [rustup](https://rustup.rs)
*   Platform build tools:
    *   **macOS**: Xcode Command Line Tools (`xcode-select --install`)
    *   **Windows**: Visual Studio Build Tools with the "Desktop development with C++" workload, plus WebView2 runtime (usually preinstalled on Win10/11)
    *   **Linux**: see the [Tauri Linux prerequisites](https://tauri.app/start/prerequisites/#linux)

### Installation
```bash
npm install
```

### Running
```bash
# Development mode (hot reload, dev tools)
npm run dev
```

## 📦 Building for Distribution

Builds go through the [Tauri](https://tauri.app) CLI, with platform-specific post-processing scripts in `scripts/`.

```bash
npm run build:mac     # Creates .dmg / .zip (Universal) and attempts the App Store .pkg alongside
npm run build:mas     # Builds only the App Store .pkg for Transporter (macOS only)
npm run build:win     # Creates NSIS/MSI + Microsoft Store package (MSIX)
npm run build:linux   # Creates AppImage / .deb (via scripts/build-linux.sh)
```

After each build, release artifacts are copied into:

`for-distribution/<target-triple>/`

Example targets:
- `for-distribution/universal-apple-darwin/`
- `for-distribution/x86_64-pc-windows-msvc/`
- `for-distribution/x86_64-unknown-linux-gnu/`

For Mac App Store submission, `npm run build:mas` writes:
- `for-distribution/universal-apple-darwin/mas/ReDD Do.pkg`

`build:mas` requires:
- macOS
- `APPLE_APP_IDENTITY` set (e.g. `Apple Distribution: Your Company (TEAMID)`)
- `APPLE_INSTALLER_IDENTITY` set (e.g. `3rd Party Mac Developer Installer: Your Company (TEAMID)`)
- `APPLE_PROVISIONING_PROFILE_PATH` pointing to a Mac App Store provisioning profile whose listed certificate matches the Apple Distribution cert above
- `src-tauri/tauri.conf.json` with `app.macOSPrivateApi` set to `false` (App Store requirement)

For Microsoft Store submission, `npm run build:win` verifies that at least one Store package exists
(`.appx`, `.msix`, `.appxbundle`, `.msixbundle`, `.appxupload`, or `.msixupload`) in:
- `for-distribution/x86_64-pc-windows-msvc/`

Note: To build with custom icons, place your icon files in the `assets/` directory:
*   `assets/icon.icns` (Mac)
*   `assets/icon.ico` (Windows)
*   `assets/icon.png` (Linux)

## 📁 Project Structure

```
redd-todo/
├── package.json         # npm scripts, JS deps
├── src/                 # Frontend (HTML/CSS/JS — runs inside the webview)
│   ├── index.html       # Application entry point
│   ├── styles.css       # Styling (App + Focus mode)
│   ├── app.js           # Renderer logic (UI, Basecamp sync, focus mode)
│   └── images/          # UI assets
├── src-tauri/           # Tauri (Rust) shell
│   ├── src/             # Rust source (commands, window mgmt, OAuth, etc.)
│   ├── Cargo.toml       # Rust deps
│   └── tauri.conf.json  # Tauri config (bundle id, signing, etc.)
├── scripts/             # Build/signing/notarisation helpers
├── build/               # macOS entitlements and provisioning profiles
├── assets/              # App icons
└── README.md
```

## Development
You might need to trigger access for your IDE to Apple Reminders, by running `osascript -e 'tell application "Reminders" to get name of every list'`

## Terms of Use

This code is licensed under the [CC BY-NC-ND 3.0](https://creativecommons.org/licenses/by-nc-nd/3.0/) licence.
