'use strict';
// Drives the real app headless through Playwright. Shared by the UI checks.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');

async function launch({ dataDir, size = { width: 1480, height: 940 }, env: extraEnv = {} } = {}) {
  dataDir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cpgym-ui-'));
  const env = { ...process.env, CPGYM_DATA_DIR: dataDir, CPGYM_SANDBOX: '0', ...extraEnv };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox', '--ozone-platform=headless', `--window-size=${size.width},${size.height}`],
    env,
  });
  const page = await app.firstWindow();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.setViewportSize(size).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  const shots = process.env.CPGYM_SHOTS || path.join(dataDir, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const shot = async (name) => { const file = path.join(shots, `${name}.png`); await page.screenshot({ path: file }); return file; };
  return { app, page, problems, shot, dataDir, shots };
}

module.exports = { launch, ROOT };
