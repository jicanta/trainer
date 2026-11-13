'use strict';
const { app, BrowserWindow, ipcMain, shell, session, Menu } = require('electron');
const path = require('node:path');
const { openDb, allSettings } = require('./src/db');
const { CF } = require('./src/cf');
const { Sessions } = require('./src/sessions');
const { Contests } = require('./src/contests');
const { Watcher } = require('./src/watcher');
const { Coach } = require('./src/coach');
const { createApi } = require('./src/api');
const { syncProblems, syncUser } = require('./src/sync');

// Keep everything (database, Codeforces login cookies) in one predictable folder.
const dataDir = process.env.CPGYM_DATA_DIR || path.join(app.getPath('appData'), 'cp-gym');
app.setPath('userData', dataDir);
app.setName('CP Gym');

// Test hooks: point the embedded pages and the API at a local stand-in instead of codeforces.com.
const CF_ORIGIN = (process.env.CPGYM_CF_ORIGIN || 'https://codeforces.com').replace(/\/$/, '');
const CF_API = process.env.CPGYM_CF_API || undefined;
const CF_PARTITION = 'persist:codeforces';
const AUTH_HOSTS = new Set(['accounts.google.com', 'github.com', 'www.facebook.com']);
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const isCodeforces = (url) => {
  if (process.env.CPGYM_CF_ORIGIN && String(url).startsWith(`${CF_ORIGIN}/`)) return true;
  const h = hostOf(url);
  return /^https:/.test(url) && (h === 'codeforces.com' || h.endsWith('.codeforces.com'));
};
const isAllowedInView = (url) => isCodeforces(url) || (/^https:/.test(url) && AUTH_HOSTS.has(hostOf(url)));

const WINDOW_BG = { light: '#FBFBFA', cream: '#F6F0E4', dark: '#141413' };

let win = null;
let db = null;
let watcher = null;

const emit = (type, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('gym:event', { type, payload });
};

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1080, minHeight: 680,
    backgroundColor: WINDOW_BG[db ? allSettings(db).theme : 'light'] || WINDOW_BG.light, autoHideMenuBar: true, show: false, title: 'CP Gym',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => { if (!process.env.CPGYM_HIDDEN) win.show(); });
  win.on('closed', () => { win = null; });
  // The embedded Codeforces view may only be a plain browser tab on Codeforces.
  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (!isCodeforces(params.src)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (isCodeforces(url)) contents.loadURL(url);
    else if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (isAllowedInView(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
});

function backgroundSync(api) {
  const s = allSettings(db);
  const now = Date.now();
  const jobs = [];
  if (!db.getSetting('problemsSyncedAt', 0) || now - db.getSetting('problemsSyncedAt', 0) > 3 * 86400000) jobs.push(() => api['sync.problems']());
  if (s.handle && now - db.getSetting('userSyncedAt', 0) > 6 * 3600000) jobs.push(() => api['sync.user']({}));
  jobs.reduce((p, job) => p.then(job).catch(() => {}), Promise.resolve());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    db = openDb(dataDir);
    const getSettings = () => allSettings(db);
    const cf = new CF({ base: CF_API, minGapMs: CF_API ? 150 : undefined });
    const sessions = new Sessions({ db, getSettings, emit });
    const contests = new Contests({ db, getSettings, emit });
    watcher = new Watcher({ db, cf, getSettings, sessions, contests, emit, intervalMs: Number(process.env.CPGYM_WATCH_MS) || 12000 });
    const coach = new Coach({ db, getSettings, sessions, contests, emit, dataDir });
    const api = createApi({
      db, cf, sessions, contests, watcher, coach, emit, dataDir,
      version: app.getVersion(), sandbox: process.env.CPGYM_SANDBOX !== '0', cfOrigin: CF_ORIGIN,
      openExternal: (url) => shell.openExternal(url), openPath: (p) => shell.openPath(p),
    });

    sessions.recover();
    contests.checkDeadline();

    // Codeforces serves its normal pages to a normal browser signature.
    const cfSession = session.fromPartition(CF_PARTITION);
    cfSession.setUserAgent(session.defaultSession.getUserAgent().replace(/\s?Electron\/[\d.]+/, '').replace(/\s?cp-gym\/[\d.]+/i, '').replace(/\s?CP Gym\/[\d.]+/i, ''));
    cfSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

    ipcMain.handle('gym:call', async (_e, method, params) => {
      const fn = Object.prototype.hasOwnProperty.call(api, method) ? api[method] : null;
      if (!fn) return { ok: false, error: `Unknown method: ${method}` };
      try { return { ok: true, data: await fn(params || {}) }; }
      catch (e) { return { ok: false, error: e && e.message ? e.message : String(e), code: e && e.code }; }
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'App', submenu: [{ role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    ]));

    createWindow();
    watcher.start();
    const beat = setInterval(() => { try { sessions.heartbeat(); } catch { /* db closing */ } }, 20000);
    beat.unref();
    backgroundSync(api);

    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (watcher) watcher.stop();
    try { if (db) { db.close(); db = null; } } catch { /* already closed */ }
  });
}
