'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, protocol, net, session } = require('electron');
const path = require('path');

// When installed via PKGBUILD (system install), app.isPackaged is false and we
// use the fixed system paths.  When bundled with electron-builder (AppImage or
// portable release), app.isPackaged is true and we resolve everything relative
// to __dirname (which points at the resources/app/ directory inside the bundle).
const APP_DIR = app.isPackaged
  ? path.join(__dirname, 'www')
  : '/usr/lib/cinny-lapingvino';
const ICON_PNG = app.isPackaged
  ? path.join(__dirname, 'icon.png')
  : '/usr/share/pixmaps/cinny.png';

// Named persistent partition — keeps localStorage/IndexedDB in a stable,
// named subdirectory of userData so login data survives restarts.
const PARTITION = 'persist:cinny-lapingvino';

// Set app name before ready so WM_CLASS (X11) / app-id (Wayland) are correct,
// allowing the compositor to match the running window to the .desktop file.
app.setName('cinny-lapingvino');

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
  tray.setToolTip('Cinny');
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

  // Load via the custom scheme so WASM and service workers function correctly
  mainWindow.loadURL('app://localhost/index.html');

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(() => {
  // Link to the installed .desktop file for Wayland icon resolution
  app.setDesktopName('cinny-lapingvino-git.desktop');

  // Get (or create) the named persistent session.
  // Registering the protocol handler on this session — rather than the global
  // protocol object — ensures that storage (localStorage, IndexedDB, cookies)
  // is written to userData/Partitions/cinny-lapingvino and persists across restarts.
  const ses = session.fromPartition(PARTITION);

  // Serve the web app through the privileged 'app://' scheme.
  // Paths without a file extension are SPA routes — serve index.html so that
  // hash-router redirects (e.g. after login/logout) resolve correctly.
  ses.protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.extname(pathname)
      ? path.join(APP_DIR, pathname)
      : path.join(APP_DIR, 'index.html');
    return net.fetch('file://' + filePath);
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
});
