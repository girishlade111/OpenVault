/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const url = require('url');

const isDev = !app.isPackaged;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Necessary for File System Access API in local origins
    }
  });

  // Remove the default menu
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadURL('app://-/');
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    let urlObj = new URL(req.url);
    let pathname = decodeURIComponent(urlObj.pathname);
    
    // Default to index.html for root
    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }

    let filePath = path.join(__dirname, 'out', pathname);

    // Basic fallback for Next.js routing (try adding .html if file doesn't exist)
    const fs = require('fs');
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
        filePath += '.html';
    } else if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'out', 'index.html');
    }
    
    return net.fetch(url.pathToFileURL(filePath).toString());
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
