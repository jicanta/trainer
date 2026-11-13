'use strict';
// Renders assets/icon.png from markup, using the app's own serif. Run with:
//   node_modules/electron/dist/electron --no-sandbox --ozone-platform=headless scripts/make-icon.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;
const RADIUS = 112;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, useContentSize: true, frame: false, backgroundColor: '#111111' });
  const font = `file://${path.join(__dirname, '..', 'ui', 'fonts', 'newsreader-latin-wght-normal.woff2')}`;
  const html = `<!doctype html><html><head><style>
    @font-face { font-family: N; src: url('${font}') format('woff2'); font-weight: 200 800; }
    html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; background: #111111; overflow: hidden; }
    body { display: grid; place-items: center; }
    .mark { font-family: N, Georgia, serif; font-weight: 500; font-size: 270px; letter-spacing: -0.04em; color: #FBFBFA; line-height: 1; margin-top: -64px; }
    .bar { position: absolute; left: 112px; right: 112px; bottom: 92px; height: 16px; border-radius: 8px; background: #3A3A3A; }
    .bar i { display: block; width: 62%; height: 100%; border-radius: 8px; background: #FBFBFA; }
  </style></head><body><div class="mark">cp</div><div class="bar"><i></i></div></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 500)))');
  // Ask the renderer for a frame through the DevTools protocol: reliable even without a real display.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false });
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE, scale: 1 } });
  const shot = nativeImage.createFromBuffer(Buffer.from(data, 'base64')).resize({ width: SIZE, height: SIZE });
  // Round the corners by clearing alpha outside a rounded square.
  const px = shot.toBitmap();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x < RADIUS ? RADIUS - x : x >= SIZE - RADIUS ? x - (SIZE - RADIUS - 1) : 0;
      const dy = y < RADIUS ? RADIUS - y : y >= SIZE - RADIUS ? y - (SIZE - RADIUS - 1) : 0;
      if (dx && dy && dx * dx + dy * dy > RADIUS * RADIUS) px.writeUInt32LE(0, (y * SIZE + x) * 4);
    }
  }
  const out = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, nativeImage.createFromBitmap(px, { width: SIZE, height: SIZE }).toPNG());
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
  app.exit(0);
});
