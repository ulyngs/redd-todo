const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');

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
          label: 'Report an Issue',
          click: async () => {
            await shell.openExternal('https://github.com/ulyngs/redd-todo/issues')
          }
        },
        {
          label: 'Contact Us',
          click: async () => {
             await shell.openExternal('mailto:team@reddfocus.org')
          }
        },
        {
          label: 'Privacy Policy',
          click: async () => {
             await shell.openExternal('https://ulyngs.github.io/redd-todo/privacy_policy')
          }
        },
        {
          label: 'Our Research',
          click: async () => {
            await shell.openExternal('https://reddfocus.org/research')
          }
        },
        {
          label: 'Who We Are',
          click: async () => {
            await shell.openExternal('https://www.reddfocus.org/#team-anchor')
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
/*
ipcMain.on('window-move', (event, { x, y }) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    mainWindow.setPosition(currentX + x, currentY + y);
  }
});
*/
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
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
  if (mainWindow) mainWindow.close();
});
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
  
  server.on('error', (err) => {
      console.error('Server error:', err);
      if (mainWindow) {
          mainWindow.webContents.send('basecamp-auth-error', 'Could not start local server on port 3000. Please ensure it is free.');
      }
  });
});

function exchangeCodeForToken(code) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            code: code,
            redirect_uri: BC_REDIRECT_URI
        });
        
        // Parse URL to handle https vs http if you test locally
        const netlifyUrl = url.parse(NETLIFY_EXCHANGE_URL);
        
        const options = {
            hostname: netlifyUrl.hostname,
            path: netlifyUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON response from server'));
                    }
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

app.whenReady().then(() => {
  createMainWindow();
  createMenu();
});
app.on('window-all-closed', () => {
  app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
