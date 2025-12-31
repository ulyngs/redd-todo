# ReDD Do

A simple, beautiful, and distraction-free todo app for Mac, Windows, and Linux built with Electron. Designed to help you focus on one task at a time while keeping track of your time.

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
*   **Cross-Platform**: Native apps for Mac, Windows, and Linux.
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
*   Node.js (v14 or higher)
*   npm

### Installation
```bash
npm install
```

### Running
```bash
# Development mode (with dev tools)
npm run dev

# Production mode
npm start
```

## 📦 Building for Distribution

We use `electron-builder` to create native installers.

```bash
# Build for all platforms
npm run build

# Build for specific platform
npm run build:mac   # Creates .dmg / .zip (Universal)
npm run build:win   # Creates .exe (x64)
npm run build:linux # Creates .AppImage / .deb
```

Note: To build with custom icons, place your icon files in the `assets/` directory:
*   `assets/icon.icns` (Mac)
*   `assets/icon.ico` (Windows)
*   `assets/icon.png` (Linux)

## 📁 Project Structure

```
redd-todo/
├── main.js              # Electron main process (window mgmt, IPC)
├── build.js             # Build script using electron-builder
├── package.json         # Dependencies and build config
├── assets/              # App icons
├── src/
│   ├── index.html       # Application entry point
│   ├── styles.css       # Styling (App + Focus mode)
│   ├── app.js           # Renderer logic (UI, Basecamp sync, focus mode)
│   └── images/          # UI assets
└── README.md
```

## Terms of Use

This code is licensed under the [CC BY-NC-ND 3.0](https://creativecommons.org/licenses/by-nc-nd/3.0/) licence.
