'use strict';
// npm start. On Linux this hands over to cp-gym.sh, which also decides whether the Chromium sandbox can be used.
// On macOS and Windows it starts Electron directly.
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const extra = process.argv.slice(2);

let cmd;
let args;
if (process.platform === 'linux') {
  cmd = 'bash';
  args = [path.join(__dirname, 'cp-gym.sh'), ...extra];
} else {
  try {
    cmd = require('electron'); // resolves to the path of the Electron binary
  } catch {
    console.error('Electron is not installed yet. Run: npm install');
    process.exit(1);
  }
  args = [root, ...extra];
}

const child = spawn(cmd, args, { stdio: 'inherit' });
child.on('error', (e) => { console.error(e.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
