# ReDD Task

A simple, beautiful, and distraction-free todo app for Mac, Windows, and Linux built with Electron.

## ✨ Features

*   **Minimalistic Design**: Clean, Shadcn-inspired UI for a clutter-free experience.
*   **Tabbed Organization**: Manage multiple lists (e.g., "Work", "Personal") with easy-to-use tabs.
*   **Drag & Drop**: Reorder tasks intuitively, including moving them to the very bottom of the list.
*   **Focus Mode**: A special distraction-free window that stays always on top, hiding OS controls (on Mac) and showing only your current task and a timer.
*   **Task Management**:
    *   Add, edit, and delete tasks.
    *   "Done" section for completed items (tasks automatically move down).
    *   Unchecking a done task moves it back up.
*   **Data Persistence**: Your tasks and tabs are saved automatically.
*   **Cross-Platform**: Native apps for Mac, Windows, and Linux.

## 🚀 Usage

### Main Window
*   **Add Tasks**: Type in the input field at the bottom and press Enter or click "Add".
*   **Reorder**: Drag and drop tasks to prioritize them.
*   **Complete**: Click the checkbox. Completed tasks move to the "Done" section.
*   **Focus**: Click the "Target" icon next to any task to enter Focus Mode.

### Tabs
*   **Create**: Click the **+** button to add a new tab via a modal.
*   **Rename**: Click the active tab or double-click any tab to rename it.
*   **Close**: Click the **×** on a tab to close it (if you have more than one).

### Focus Mode
The ultimate distraction-free experience:
*   **Enter**: Click the target icon on a task.
*   **View**: The window shrinks to show only the task name and a timer. On macOS, traffic light buttons are hidden.
*   **Hover**: Hover over the window to see the "Exit/Expand" button.
*   **Move**: Click and drag anywhere on the window to move it around.
*   **Exit**: Click the expand icon (appears on hover) to return to the main list.

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
npm run build:mac   # Creates .dmg / .zip
npm run build:win   # Creates .exe
npm run build:linux # Creates .AppImage / .deb
```

Note: To build with custom icons, place your icon files in the `assets/` directory:
*   `assets/icon.icns` (Mac)
*   `assets/icon.ico` (Windows)
*   `assets/icon.png` (Linux)

## 📁 Project Structure

```
redd-task/
├── main.js              # Electron main process (window mgmt, IPC)
├── package.json         # Dependencies and build config
├── assets/              # App icons
├── src/
│   ├── index.html       # Application entry point
│   ├── styles.css       # All styling (App + Focus mode)
│   └── app.js           # Renderer logic (UI, drag-n-drop, focus mode)
└── README.md
```

## License
MIT License
