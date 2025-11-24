const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    frame: false, // Remove default frame for custom styling
    alwaysOnTop: false, // Only on top during focus mode
    resizable: true,
    minimizable: true,
    maximizable: false,
    closable: true,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'src/images/icon.png') // Will add icon later
  });

  mainWindow.loadFile('src/index.html');

  // Remove this in production
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.on('enter-focus-mode', (event, taskName) => {
  if (mainWindow) {
    // Start with a reasonable default size, will be adjusted by set-focus-window-size
    mainWindow.setSize(320, 60);
    mainWindow.setResizable(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setMinimizable(false);
    // Hide macOS traffic light buttons in focus mode
    if (process.platform === 'darwin') {
      mainWindow.setWindowButtonVisibility(false);
    }
  }
});

ipcMain.on('set-focus-window-size', (event, width) => {
  if (mainWindow) {
    mainWindow.setSize(width, 60);
  }
});

/*
ipcMain.on('window-move', (event, { x, y }) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + x, currentY + y);
  }
});
*/

ipcMain.on('exit-focus-mode', () => {
  if (mainWindow) {
    mainWindow.setSize(400, 600);
    mainWindow.setResizable(true);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimizable(true);
    // Show macOS traffic light buttons when exiting focus mode
    if (process.platform === 'darwin') {
      mainWindow.setWindowButtonVisibility(true);
    }
  }
});

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
