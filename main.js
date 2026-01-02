const { app, BrowserWindow, ipcMain, Menu, shell, screen } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const fs = require('fs');
const log = require('electron-log');

let PanelWindow;
try {
  ({ PanelWindow } = require('@redd/electron-panel-window-darwin'));
} catch (e) {
  PanelWindow = null;
}

// Basecamp OAuth Configuration
const BC_CLIENT_ID = 'd83392d7842f055157c3fef1f5464b2e15a013dc';
const BC_REDIRECT_URI = 'http://localhost:3000/callback';
const NETLIFY_EXCHANGE_URL = 'https://redd-todo.netlify.app/.netlify/functions/exchange';

let mainWindow;
let focusWindow;
let pendingFocusPayload = null;
let activeFocusTaskId = null;

// Ensure logs go to a file we can inspect in production (incl. Mac App Store builds)
log.transports.file.level = 'info';

function getFocusWindowClass() {
  if (process.platform === 'darwin' && PanelWindow) return PanelWindow;
  return BrowserWindow;
}

function positionFocusWindow(win) {
  try {
    const [w, h] = win.getSize();
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const area = display.workArea; // respects menu bar/dock
    const x = Math.round(area.x + area.width - w - 20);
    const y = Math.round(area.y + 20);
    win.setPosition(x, y);
  } catch (e) {
    // best-effort positioning only
  }
}

function ensureFocusWindow() {
  if (focusWindow) return focusWindow;

  const FocusWindowClass = getFocusWindowClass();

  focusWindow = new FocusWindowClass({
    width: 320,
    height: 60,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    fullscreenable: true, // for the in-focus fullscreen toggle
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'src/images/icon.png')
  });

  focusWindow.loadFile('src/index.html', { query: { focus: '1' } });

  focusWindow.once('ready-to-show', () => {
    positionFocusWindow(focusWindow);
    if (process.platform === 'darwin' && typeof focusWindow.showInactive === 'function') {
      focusWindow.showInactive();
    } else {
      focusWindow.show();
    }
  });

  focusWindow.webContents.on('did-finish-load', () => {
    if (process.platform === 'darwin') {
      try {
        focusWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch (e) {
        // ignore
      }
      try {
        focusWindow.setAlwaysOnTop(true, 'floating');
      } catch (e) {
        focusWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      try {
        focusWindow.setWindowButtonVisibility(false);
      } catch (e) {
        // ignore
      }
    }

    if (pendingFocusPayload) {
      focusWindow.webContents.send('enter-focus-mode', pendingFocusPayload);
    }
  });

  focusWindow.on('closed', () => {
    focusWindow = null;
    pendingFocusPayload = null;
    activeFocusTaskId = null;
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('focus-status-changed', { activeTaskId: null });
    }
  });

  return focusWindow;
}

function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // { role: 'appMenu' }
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // { role: 'fileMenu' }
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // { role: 'editMenu' }
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    // { role: 'viewMenu' }
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // { role: 'windowMenu' }
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://electronjs.org');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

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
    maximizable: true,
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
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Helper for JXA execution
function runJxa(script) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const process = spawn('osascript', ['-l', 'JavaScript']);

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => stdout += data);
    process.stderr.on('data', (data) => stderr += data);

    process.on('close', (code) => {
      if (code !== 0) {
        console.error('JXA Error:', stderr);
        reject(stderr);
        return;
      }
      try {
        if (!stdout.trim()) {
          resolve(null);
        } else {
          resolve(JSON.parse(stdout));
        }
      } catch (e) {
        // If not JSON, return raw string
        resolve(stdout.trim());
      }
    });

    process.stdin.write(script);
    process.stdin.end();
  });
}

// Native Swift Connector for Reminders
function runRemindersConnector(args) {
  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');

    let binaryPath;
    if (app.isPackaged) {
      binaryPath = path.join(process.resourcesPath, 'reminders-connector');
    } else {
      binaryPath = path.join(__dirname, 'src/reminders-connector');
    }

    const exists = fs.existsSync(binaryPath);
    log.info('[Reminders] runRemindersConnector start', {
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      binaryPath,
      exists,
      args
    });

    if (!exists) {
      const err = new Error(`Reminders connector binary not found at: ${binaryPath}`);
      log.error('[Reminders] runRemindersConnector missing binary', { binaryPath });
      reject(err);
      return;
    }

    execFile(binaryPath, args, (error, stdout, stderr) => {
      if (error) {
        log.error('[Reminders] Connector Error', {
          message: error.message,
          code: error.code,
          errno: error.errno,
          stderr: (stderr || '').toString().trim(),
          stdout: (stdout || '').toString().trim()
        });
        console.error('Connector Error:', stderr || error.message);
        reject(error);
        return;
      }
      if (stderr && stderr.toString().trim()) {
        log.warn('[Reminders] Connector stderr', stderr.toString().trim());
      }
      try {
        log.info('[Reminders] Connector stdout (raw)', (stdout || '').toString().trim());
        resolve(JSON.parse(stdout));
      } catch (e) {
        log.error('[Reminders] JSON Parse Error', {
          message: e.message,
          stdout: (stdout || '').toString().trim()
        });
        console.error('JSON Parse Error:', stdout);
        resolve([]);
      }
    });
  });
}

ipcMain.handle('fetch-reminders-lists', async () => {
  if (process.platform !== 'darwin') return [];
  return runRemindersConnector(['lists']);
});

ipcMain.handle('fetch-reminders-tasks', async (event, listId) => {
  if (process.platform !== 'darwin') return [];
  return runRemindersConnector(['tasks', listId]);
});

ipcMain.handle('update-reminders-status', async (event, taskId, completed) => {
  if (process.platform !== 'darwin') return;
  return runRemindersConnector(['update-status', taskId, completed.toString()]);
});

ipcMain.handle('update-reminders-title', async (event, taskId, title) => {
  if (process.platform !== 'darwin') return;
  return runRemindersConnector(['update-title', taskId, title]);
});

ipcMain.handle('delete-reminders-task', async (event, taskId) => {
  if (process.platform !== 'darwin') return;
  return runRemindersConnector(['delete-task', taskId]);
});

ipcMain.handle('create-reminders-task', async (event, listId, title) => {
  if (process.platform !== 'darwin') return;
  return runRemindersConnector(['create-task', listId, title]);
});

// Update checker
const { autoUpdater } = require('electron-updater');

// Configure logging for autoUpdater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

ipcMain.on('check-for-updates', () => {
  // In development, allow checking but it might not find anything unless configured
  if (process.env.NODE_ENV === 'development') {
    console.log('Checking for updates in development mode...');
    // Optional: Force dev update config if needed, or just log
    // autoUpdater.forceDevUpdateConfig = true; 
  }

  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.log('Update check error (expected in dev):', err.message);
  });
});

autoUpdater.on('update-available', () => {
  mainWindow.webContents.send('update-available');
});

autoUpdater.on('update-downloaded', () => {
  mainWindow.webContents.send('update-downloaded');
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});


app.on('ready', () => {
  createMainWindow();
  createMenu();

  if (process.env.NODE_ENV !== 'development') {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

// IPC listeners for focus mode
ipcMain.on('enter-focus-mode', (event, taskName) => {
  const targetWindow = (process.platform === 'darwin' && focusWindow) ? focusWindow : mainWindow;

  if (targetWindow) {
    // Capture current position
    const [currentX, currentY] = targetWindow.getPosition();

    // Start with a reasonable default size, will be adjusted by set-focus-window-size
    targetWindow.setSize(320, 60);
    // Restore position (setSize might center or move it on some platforms/configs)
    targetWindow.setPosition(currentX, currentY);

    targetWindow.setResizable(true);
    targetWindow.setAlwaysOnTop(true, 'screen-saver');
    targetWindow.setMinimizable(false);
    // Hide macOS traffic light buttons in focus mode
    if (process.platform === 'darwin') {
      targetWindow.setWindowButtonVisibility(false);
      try {
        targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch (e) {
        // ignore
      }
    }
  }
});

ipcMain.on('set-focus-window-size', (event, width) => {
  const targetWindow = (process.platform === 'darwin' && focusWindow) ? focusWindow : mainWindow;

  if (targetWindow) {
    targetWindow.setFullScreen(false); // Ensure not fullscreen when resizing
    const [currentX, currentY] = targetWindow.getPosition();
    targetWindow.setSize(width, 60);
    targetWindow.setPosition(currentX, currentY);
    // Removed mainWindow.center() to preserve position
  }
});

ipcMain.on('enter-fullscreen-focus', () => {
  const targetWindow = (process.platform === 'darwin' && focusWindow) ? focusWindow : mainWindow;

  if (targetWindow) {
    targetWindow.setResizable(true); // Allow resize for fullscreen transition
    try {
      targetWindow.setFullScreen(true);
    } catch (e) {
      const display = screen.getDisplayMatching(targetWindow.getBounds());
      targetWindow.setBounds(display.bounds);
    }
    targetWindow.setAlwaysOnTop(true, 'screen-saver');
  }
});

ipcMain.on('exit-focus-mode', () => {
  // On macOS we use a dedicated focus window; exiting closes it.
  if (process.platform === 'darwin' && focusWindow) {
    activeFocusTaskId = null;
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('focus-status-changed', { activeTaskId: null });
    }
    focusWindow.close();
    return;
  }

  if (mainWindow) {
    mainWindow.setFullScreen(false);
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

// Create/show the dedicated focus panel window (macOS only)
ipcMain.on('open-focus-window', (event, payload) => {
  if (process.platform !== 'darwin') return;

  pendingFocusPayload = payload || null;
  activeFocusTaskId = payload?.taskId || null;
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('focus-status-changed', { activeTaskId: activeFocusTaskId });
  }
  const win = ensureFocusWindow();
  if (!win) return;

  // If already loaded, send immediately
  try {
    if (!win.webContents.isLoadingMainFrame() && pendingFocusPayload) {
      win.webContents.send('enter-focus-mode', pendingFocusPayload);
    }
  } catch (e) {
    // ignore
  }

  // Keep it visible and floating
  try {
    win.setAlwaysOnTop(true, 'floating');
  } catch (e) {
    win.setAlwaysOnTop(true, 'screen-saver');
  }
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    // ignore
  }

  try {
    if (typeof win.showInactive === 'function') {
      win.showInactive();
    } else {
      win.show();
    }
  } catch (e) {
    // ignore
  }
});

// IPC listeners for window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

// Renderer helper: allow secondary windows (e.g. focus panel) to request a UI refresh.
ipcMain.on('refresh-main-window', () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('refresh-data');
  }
});

// Broadcast task updates between windows (main <-> focus panel)
ipcMain.on('task-updated', (event, payload) => {
  if (!payload || !payload.taskId) return;
  const senderId = event?.sender?.id;

  if (mainWindow && mainWindow.webContents && mainWindow.webContents.id !== senderId) {
    mainWindow.webContents.send('task-updated', payload);
  }
  if (focusWindow && focusWindow.webContents && focusWindow.webContents.id !== senderId) {
    focusWindow.webContents.send('task-updated', payload);
  }
});

// Custom window dragging logic related variables
let dragInterval = null;

ipcMain.on('window-drag-start', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) return;

  const cursorPoint = screen.getCursorScreenPoint();
  const [winX, winY] = targetWindow.getPosition();
  const offset = { x: cursorPoint.x - winX, y: cursorPoint.y - winY };

  if (dragInterval) clearInterval(dragInterval);

  dragInterval = setInterval(() => {
    const cursor = screen.getCursorScreenPoint();
    try {
      targetWindow.setPosition(cursor.x - offset.x, cursor.y - offset.y);
    } catch (e) {
      clearInterval(dragInterval);
    }
  }, 10); // Update every 10ms
});

ipcMain.on('window-drag-end', () => {
  if (dragInterval) {
    clearInterval(dragInterval);
    dragInterval = null;
  }
});

async function exchangeCodeForToken(code) {

  // Call Netlify function to exchange code for token
  const response = await fetch(NETLIFY_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code,
      redirect_uri: BC_REDIRECT_URI,
      client_id: BC_CLIENT_ID
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return await response.json();
}


// Basecamp Authentication Logic
ipcMain.on('start-basecamp-auth', (event) => {
  const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);

    if (reqUrl.pathname === '/callback') {
      const code = reqUrl.query.code;

      if (code) {
        try {
          // Exchange code for token via Netlify function
          const tokenData = await exchangeCodeForToken(code);

          // Send tokens back to renderer
          if (mainWindow) {
            mainWindow.webContents.send('basecamp-auth-success', {
              ...tokenData,
              client_id: BC_CLIENT_ID
            });
          }

          // Show success message
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; text-align: center; padding-top: 50px;">
                <h1>Authentication successful!</h1>
                <p>You can close this window and return to ReDD Do.</p>
                <script>window.close()</script>
              </body>
            </html>
          `);
        } catch (error) {
          console.error('Token exchange error:', error);
          res.writeHead(500);
          res.end('Authentication failed: ' + error.message);
          if (mainWindow) {
            mainWindow.webContents.send('basecamp-auth-error', error.message);
          }
        }
      }

      // Close server shortly after to ensure response is sent
      setTimeout(() => server.close(), 1000);
    }
  });

  server.listen(3000, () => {
    const authUrl = `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=${BC_CLIENT_ID}&redirect_uri=${encodeURIComponent(BC_REDIRECT_URI)}`;
    shell.openExternal(authUrl);
  });

  server.on('error', (e) => {
    console.error('Server error', e);
    if (e.code === 'EADDRINUSE') {
      console.log('Port 3000 in use, retrying...');
      setTimeout(() => {
        server.close();
        server.listen(3000);
      }, 1000);
    }
  });

});
