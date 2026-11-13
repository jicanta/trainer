'use strict';
// Live check of the embedded Codeforces page: node test/live/page.js <profile-dir> [problem]
// Loads one real problem in the app (headless) and reports what was captured. One page load; use sparingly.
const { launch } = require('../ui/harness');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dataDir = process.argv[2];
  const pid = process.argv[3] || '1920C';
  if (!dataDir) { console.error('usage: node test/live/page.js <onboarded-profile-dir> [problem]'); process.exit(2); }
  const { app, page, problems } = await launch({ dataDir });
  const call = async (m, p) => { const r = await page.evaluate(([mm, pp]) => window.gymBridge.call(mm, pp), [m, p]); if (!r.ok) throw new Error(r.error); return r.data; };
  try {
    await page.waitForSelector('.shell', { timeout: 20000 });
    const active = await call('attempt.active');
    if (active) await call('attempt.finish', { id: active.id, outcome: 'abandoned' });
    const { attempt } = await call('attempt.start', { pid, origin: 'manual' });
    await page.reload();
    await page.waitForSelector('.work', { timeout: 20000 });
    let info = null;
    for (let i = 0; i < 30; i++) { info = await call('statement.info', { pid }); if (info.captured) break; await wait(1000); }
    const guest = await app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().filter((w) => w.getType() === 'webview').pop();
      return wc ? wc.executeJavaScript(`({ title: document.title, tagsVisible: [...document.querySelectorAll('.tag-box')].filter((e) => e.offsetParent !== null).length, header: !!(document.querySelector('#header') && document.querySelector('#header').offsetParent), statement: !!document.querySelector('.problem-statement') })`) : null;
    });
    console.log('embedded page:', JSON.stringify(guest));
    console.log('stage note:', JSON.stringify(await page.textContent('.stage-note')));
    console.log('captured:', JSON.stringify(info));
    if (info.captured) {
      const db = new DatabaseSync(path.join(dataDir, 'cpgym.db'), { readOnly: true });
      const row = db.prepare('SELECT text, tutorial FROM statements WHERE pid = ?').get(pid);
      console.log(`statement (${row.text.length} chars):\n${row.text.slice(0, 700)}`);
      console.log(`tutorial: ${row.tutorial ? `${row.tutorial.length} chars: ${row.tutorial.slice(0, 200)}` : 'none'}`);
      db.close();
    }
    await call('attempt.finish', { id: attempt.id, outcome: 'abandoned' });
  } finally {
    console.log('console problems:', problems.length ? problems : 'none');
    await app.close();
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
