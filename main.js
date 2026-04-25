'use strict';

// Electron entry point for AppImage / Windows portable builds.
//
// This file is templated by build-appimage.sh: the __PLACEHOLDER__ strings
// below are replaced at build time with the upstream-specific values
// (short name, tray tooltip). Running this file directly without those
// substitutions will leave literal "__…__" strings and obviously-broken
// userData paths — that's intentional, so misuse fails loud rather than
// silently sharing data with another build.

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, protocol, net, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// --- Build-time-substituted constants ---------------------------------------
const APP_SHORT_NAME = '__SHORT_NAME__'; // setName, partition, userData dir
const APP_TOOLTIP    = '__APP_TOOLTIP__'; // tray tooltip / human-facing name
// ---------------------------------------------------------------------------

// Built web app and icon are bundled next to this file inside the AppImage
// (see electron-builder `files` config in build-appimage.sh).
const APP_DIR = path.join(__dirname, 'www');
const ICON_PNG = path.join(__dirname, 'icon.png');

// Named persistent partition — keeps localStorage/IndexedDB in a stable,
// named subdirectory of userData so login data survives restarts.
const PARTITION = `persist:${APP_SHORT_NAME}`;

// Set app name before ready so WM_CLASS (X11) / app-id (Wayland) and the
// userData directory layout are stable per-upstream.
app.setName(APP_SHORT_NAME);

// Register a privileged custom scheme BEFORE app is ready.
// Plain file:// origins block WASM loading and service worker registration;
// this custom scheme is treated as a secure standard origin so both work.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    allowServiceWorkers: true,
    corsEnabled: false,
  },
}]);

let mainWindow = null;
let tray = null;
app.isQuitting = false;

// Enforce single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

function createTray() {
  // Tray requires a PNG on Linux; SVG is not reliably supported
  tray = new Tray(nativeImage.createFromPath(ICON_PNG));
  tray.setToolTip(APP_TOOLTIP);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => {
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(ses) {
  mainWindow = new BrowserWindow({
    backgroundColor: '#26292c',
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    icon: ICON_PNG,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: ses,
    },
  });

  // Load root so React Router sees '/' and picks the correct initial route
  mainWindow.loadURL('app://localhost/');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  // Get (or create) the named persistent session.
  // Registering the protocol handler on this session — rather than the global
  // protocol object — ensures that storage (localStorage, IndexedDB, cookies)
  // is written to userData/Partitions/<short-name> and persists across restarts.
  const ses = session.fromPartition(PARTITION);

  // Serve the web app through the privileged 'app://' scheme.
  // Paths with a known static-asset extension are served directly; everything
  // else (SPA routes like /home/!roomId or bare /) falls back to index.html.
  ses.protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const ASSET_EXT = /\.(js|css|html|json|png|svg|ico|woff2?|ttf|map|wasm|txt)$/i;
    const filePath = ASSET_EXT.test(pathname)
      ? path.join(APP_DIR, pathname)
      : path.join(APP_DIR, 'index.html');
    return net.fetch(pathToFileURL(filePath).href);
  });

  createWindow(ses);
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ses);
  });
});

app.on('window-all-closed', () => { /* stay in tray */ });
app.on('before-quit', () => { app.isQuitting = true; });

// Open all external links in the system browser
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) setImmediate(() => shell.openExternal(url));
    return { action: 'deny' };
  });
  // Also catch direct navigations (window.location.assign, <a target="_self">, etc.)
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://localhost')) {
      event.preventDefault();
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    }
  });
});
