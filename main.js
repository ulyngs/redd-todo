const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const fetch = require('node-fetch');
const { exec } = require('child_process');

// Basecamp OAuth Configuration
const BC_CLIENT_ID = 'd83392d7842f055157c3fef1f5464b2e15a013dc';
const BC_REDIRECT_URI = 'http://localhost:3000/callback';
const NETLIFY_EXCHANGE_URL = 'https://redd-todo.netlify.app/.netlify/functions/exchange';

let mainWindow;

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
    const binaryPath = path.join(__dirname, 'src/reminders-connector');
    
    execFile(binaryPath, args, (error, stdout, stderr) => {
      if (error) {
        console.error('Connector Error:', stderr || error.message);
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
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
autoUpdater.logger = require('electron-log');
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
  if (mainWindow) {
    // Capture current position
    const [currentX, currentY] = mainWindow.getPosition();
    
    // Start with a reasonable default size, will be adjusted by set-focus-window-size
    mainWindow.setSize(320, 60);
    // Restore position (setSize might center or move it on some platforms/configs)
    mainWindow.setPosition(currentX, currentY);
    
    mainWindow.setResizable(true);
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
    mainWindow.setFullScreen(false); // Ensure not fullscreen when resizing
    mainWindow.setSize(width, 60);
    // Removed mainWindow.center() to preserve position
  }
});

ipcMain.on('enter-fullscreen-focus', () => {
  if (mainWindow) {
    mainWindow.setResizable(true); // Allow resize for fullscreen transition
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }
});

ipcMain.on('exit-focus-mode', () => {
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
                <p>You can close this window and return to ReDD Todo.</p>
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
