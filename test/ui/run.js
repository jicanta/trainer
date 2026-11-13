'use strict';
// End-to-end check of the whole app, headless, against local stand-ins for Codeforces, Claude and a local model server.
//   npm run test:ui                      run everything
//   CPGYM_SHOTS=/some/dir npm run test:ui    also save a screenshot of every screen
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { launch } = require('./harness');
const fakeCf = require('./fake-cf');
const fakeLocal = require('./fake-local');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const step = (name) => { steps.push(name); console.log(`\n== ${name}`); };

(async () => {
  const cf = await fakeCf.start();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpgym-ui-'));
  const ghLog = path.join(dataDir, 'gh-args.json');
  const { app, page, problems, shot } = await launch({
    dataDir, env: { CPGYM_CF_ORIGIN: cf.origin, CPGYM_CF_API: cf.api, CPGYM_WATCH_MS: '700', CPGYM_GH: path.join(__dirname, 'fake-gh.js'), CPGYM_GH_LOG: ghLog },
  });
  const call = async (method, params) => {
    const r = await page.evaluate(([m, p]) => window.gymBridge.call(m, p), [method, params]);
    if (!r.ok) throw new Error(`${method}: ${r.error}`);
    return r.data;
  };
  const snap = async (name) => { if (process.env.CPGYM_SHOTS) { await wait(350); console.log('  shot', await shot(name)); } };
  const nav = async (label, selector) => { await page.click(`.nav-item:has-text("${label}")`); await page.waitForSelector(selector, { timeout: 15000 }); };
  const guest = (script) => app.evaluate(async ({ webContents }, src) => {
    const wc = webContents.getAllWebContents().filter((w) => w.getType() === 'webview').pop();
    return wc ? wc.executeJavaScript(src) : null;
  }, script);
  const untilCaptured = async (pid) => {
    for (let i = 0; i < 60; i++) { const info = await call('statement.info', { pid }); if (info.captured) return info; await wait(250); }
    throw new Error(`statement of ${pid} was never captured`);
  };

  try {
    step('Onboarding: unknown handle is rejected, a real one connects and syncs');
    await page.waitForSelector('.onboard-title', { timeout: 20000 });
    await snap('01-onboarding');
    await page.fill('.onboard input.input', 'nobody-here');
    await page.click('button[type=submit]');
    await page.waitForSelector('.toast.error', { timeout: 15000 });
    assert.match(await page.textContent('.toast.error'), /not found/i);
    await page.fill('.onboard input.input', 'tester');
    await page.click('button[type=submit]');
    await page.waitForSelector('.found', { timeout: 30000 });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Start training')); return b && !b.disabled; }, null, { timeout: 30000 });
    await page.fill('input[type=number] >> nth=0', '1500');
    await snap('02-onboarding-ready');
    await page.click('text=Start training');
    await page.waitForSelector('.hero-value', { timeout: 15000 });
    assert.strictEqual((await page.textContent('.hero-value')).trim(), '1500');
    const boot = await call('boot');
    assert.strictEqual(boot.problems, 900);
    assert.strictEqual(boot.user.handle, 'tester');
    await call('settings.set', { claudePath: path.join(__dirname, 'fake-claude.js'), coachModel: 'default', checkinMinutes: 10 });
    await snap('03-home-empty');

    step('Practice: the picker hides tags and offers unseen problems in the band');
    await nav('Practice', '.problem-row');
    const list = await call('practice.shortlist', {});
    assert.strictEqual(list.items.length, 6);
    assert.ok(list.items.every((p) => !('tags' in p) && p.rating >= 1500 && p.rating <= 1800), 'inside the band, and no tags');
    assert.ok(list.items.every((p) => !(p.contestId < 1512 && 'ABCD'.includes(p.index))), 'problems the user already submitted to are not offered');
    assert.ok((await page.locator('.problem-row').count()) >= 6);
    await snap('04-practice');

    step('Solve: statement captured from the page, spoilers hidden, clock phases, pause');
    await page.click('.problem-row >> nth=0 >> text=Start');
    await page.waitForSelector('.work', { timeout: 15000 });
    let a = await call('attempt.active');
    assert.strictEqual(a.tags, null, 'tags are not sent to the UI while solving');
    const info = await untilCaptured(a.pid);
    assert.ok(info.hasTutorial, 'the official tutorial is stored for the coach');
    const pageState = await guest(`({ tags: [...document.querySelectorAll('.tag-box')].filter((e) => e.offsetParent !== null).length, header: !!document.querySelector('#header').offsetParent, sidebar: !!document.querySelector('#sidebar').offsetParent, statement: !!document.querySelector('.problem-statement').offsetParent })`);
    assert.deepStrictEqual(pageState, { tags: 0, header: false, sidebar: false, statement: true });
    await snap('05-solve');
    await page.fill('.idea-row input', 'try sorting first');
    await page.press('.idea-row input', 'Enter');
    await page.waitForFunction(() => document.querySelector('.notes textarea').value.includes('try sorting first'));
    await page.click('.seg-item:has-text("Code")');
    await wait(300);
    await page.click('.work-bar button:has-text("Pause")');
    await page.waitForSelector('.stage-cover:not(.hidden)');
    await snap('06-paused');
    await page.click('.stage-cover button:has-text("Resume")');
    await page.waitForSelector('.stage-cover.hidden', { state: 'attached' });
    a = await call('attempt.active');
    assert.strictEqual(a.phase, 'code');
    assert.ok(a.thinkMs > 0 && a.codeMs > 0 && a.pausedMs > 0);
    await page.click('.stage-bar label.check');
    await wait(400);
    assert.strictEqual(await guest(`!!document.querySelector('#header').offsetParent`), true, 'the full Codeforces page can be shown');
    assert.strictEqual(await guest(`[...document.querySelectorAll('.tag-box')].filter((e) => e.offsetParent !== null).length`), 0, 'tags stay hidden even then');
    await page.click('.stage-bar label.check');

    step('Focus: leaving keeps the clock running; check-in and stuck notices appear on time');
    await page.click('.work-bar button[title^="Back to Today"]');
    await page.waitForSelector('.next-title');
    assert.match(await page.textContent('.next-card'), /In progress/);
    await page.click('.sidebar .running');
    await page.waitForSelector('.work', { timeout: 15000 });
    await page.click('.seg-item:has-text("Think")');
    const shift = (minutes) => { // move the clock: pretend this much thinking time has passed
      const { DatabaseSync } = require('node:sqlite');
      const raw = new DatabaseSync(path.join(dataDir, 'cpgym.db'));
      raw.prepare("UPDATE attempts SET phase_started_at = phase_started_at - ? WHERE status = 'active'").run(minutes * 60000);
      raw.close();
    };
    shift(11);
    await page.reload();
    await page.waitForSelector('.notice:has-text("What are you trying right now")', { timeout: 15000 });
    await snap('06b-checkin');
    await page.fill('.notice input', 'differences between neighbours');
    await page.click('.notice button:has-text("Log it")');
    await page.waitForFunction(() => document.querySelector('.notes textarea').value.includes('differences between neighbours'));
    await page.waitForFunction(() => !document.querySelector('.notice input'));
    shift(26);
    await page.reload();
    await page.waitForSelector('.notice:has-text("No new idea for")', { timeout: 15000 });
    await snap('06c-stuck');
    await page.click('.notice button:has-text("Keep thinking")');
    await page.waitForFunction(() => !document.querySelector('.notice.warm'));
    a = await call('attempt.active');
    assert.strictEqual(a.stuckCheckins, 1);
    assert.ok(a.thinkMs + (Date.now() - a.phaseStartedAt) >= 37 * 60000, 'the shifted time is on the thinking clock');

    step('Coach: a hint is confirmed, answered, and costs credit; chat follows');
    await page.click('.tab:has-text("Ask yourself")');
    assert.ok((await page.locator('.ask li').count()) >= 12);
    await page.click('.tab:has-text("Coach")');
    await page.click('.hint-btn:has-text("Technique?")');
    await page.click('.dialog button:has-text("Ask")');
    await page.waitForSelector('.msg.coach:not(.pending) .md', { timeout: 30000 });
    assert.match(await page.textContent('.msg.coach:not(.pending) .md'), /standard technique: gcd over the divisors/);
    a = await call('attempt.active');
    assert.strictEqual(a.hintLevel, 1);
    await page.fill('.chat-input', 'Is sorting the intended approach?');
    await page.press('.chat-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.msg.coach:not(.pending)').length >= 2, null, { timeout: 30000 });
    await snap('07-coach');

    step('Verdicts: a wrong answer is counted, an accepted run ends the attempt on its own');
    cf.submit(a.pid, 'WRONG_ANSWER');
    await page.waitForSelector('.vchip', { timeout: 15000 });
    assert.match(await page.textContent('.vchip'), /Wrong answer on test 5/);
    assert.strictEqual(await page.locator('.toast.good').count(), 0);
    cf.submit(a.pid, 'OK');
    await page.waitForSelector('text=Save reflection', { timeout: 15000 });
    await wait(400);
    assert.strictEqual(await page.locator('.toast.good').count(), 1, 'one confirmation, not two');
    let done = await call('attempt.get', { id: a.id });
    assert.strictEqual(done.status, 'solved');
    assert.strictEqual(done.wrongSubs, 1);
    assert.strictEqual(done.score, 0.75, 'solved with the technique check');
    assert.ok(done.tags.length === 2, 'tags are revealed after the attempt');
    await snap('08-reflect');

    step('Reflection: the coach drafts it, it is saved, and the level moved');
    await page.click('button:has-text("Draft with coach")');
    await page.waitForFunction(() => document.querySelector('textarea.textarea').value.includes('gcd'), null, { timeout: 30000 });
    assert.strictEqual(await page.inputValue('select.select'), 'wrong_path');
    await snap('09-reflect-draft');
    await page.click('button:has-text("Save reflection")');
    await page.waitForSelector('.hero-value', { timeout: 15000 });
    done = await call('attempt.get', { id: a.id });
    assert.ok(done.reflected && done.takeaway.length > 10);
    assert.ok(Number((await page.textContent('.hero-value')).trim()) > 1500, 'a solve above level raises the level');

    step('Idea drill: written idea, coach verdict, result recorded');
    await nav('Practice', '.problem-row');
    await page.click('.seg-item:has-text("Idea only")');
    await page.click('.problem-row >> nth=1 >> text=Start');
    await page.waitForSelector('.work', { timeout: 15000 });
    a = await call('attempt.active');
    assert.strictEqual(a.mode, 'idea');
    await untilCaptured(a.pid);
    assert.strictEqual(await page.locator('.seg-item:has-text("Code")').count(), 0, 'no coding phase in an idea drill');
    await page.fill('.notes textarea', 'm must divide all differences a_i - a_(i+k), so take their gcd for each divisor k. O(d(n) n log n).');
    await page.click('.side-foot button:has-text("Check my idea")');
    await page.waitForSelector('text=Save reflection', { timeout: 30000 });
    done = await call('attempt.get', { id: a.id });
    assert.strictEqual(done.ideaVerdict, 'correct');
    assert.strictEqual(done.status, 'solved');
    assert.match(await page.textContent('.chat-card .badge.green'), /correct/i);
    await snap('10-idea-verdict');
    await page.click('button:has-text("Later")');
    await page.waitForSelector('.hero-value');

    step('Reminder and parking: the last lesson is shown first, a parked problem returns to the queue');
    await nav('Practice', '.problem-row');
    await page.click('.seg-item:has-text("Solve and code")');
    await page.click('.problem-row >> nth=2 >> text=Start');
    await page.waitForSelector('.work', { timeout: 15000 });
    await page.waitForSelector('.notice:has-text("Before you start")', { timeout: 8000 });
    assert.match(await page.textContent('.notice:has-text("Before you start")'), /Restate/);
    await snap('11-reminder');
    a = await call('attempt.active');
    await page.click('.side-foot button:has-text("Park")');
    await page.click('.dialog button:has-text("Park it")');
    await page.waitForSelector('.hero-value', { timeout: 15000 });
    const queue = await call('queue.list');
    assert.ok(queue.some((q) => q.pid === a.pid && q.kind === 'parked' && !q.due));
    await page.waitForSelector('.badge:has-text("Parked")');
    await snap('12-home-queue');

    step('Give up: the full solution ends credit and queues an upsolve');
    await nav('Practice', '.problem-row');
    await page.click('.problem-row >> nth=3 >> text=Start');
    await page.waitForSelector('.work', { timeout: 15000 });
    a = await call('attempt.active');
    await untilCaptured(a.pid);
    await page.click('.tab:has-text("Coach")');
    await page.click('.hint-btn:has-text("Solution")');
    await page.click('.dialog button:has-text("Show solution")');
    await page.waitForSelector('.msg.coach:not(.pending) .md', { timeout: 30000 });
    await page.waitForSelector('.side-foot button:has-text("Implement later")');
    await page.click('.side-foot button:has-text("Implement later")');
    await page.click('.dialog button:has-text("Stop here")');
    await page.waitForSelector('text=Save reflection', { timeout: 15000 });
    done = await call('attempt.get', { id: a.id });
    assert.strictEqual(done.status, 'failed');
    assert.strictEqual(done.score, 0);
    assert.ok((await call('queue.list')).some((q) => q.pid === a.pid && q.kind === 'upsolve' && q.due));
    await page.click('button:has-text("Save reflection")');
    await page.waitForSelector('.hero-value');
    assert.match(await page.textContent('.next-title'), /Upsolve/, 'upsolving is suggested before anything new');

    step('Fallback: when the page has no statement it can be pasted for the coach');
    await call('queue.remove', { id: (await call('queue.list')).find((q) => q.kind === 'upsolve').id });
    await nav('Practice', '.problem-row');
    await page.fill('input[placeholder^="1920C"]', 'https://codeforces.com/contest/9999/problem/Z');
    await page.click('form button:has-text("Open")');
    await page.waitForSelector('.work', { timeout: 15000 });
    a = await call('attempt.active');
    assert.strictEqual(a.pid, '9999Z');
    await page.waitForFunction(() => /browser check/.test(document.querySelector('.stage-note').textContent), null, { timeout: 15000 });
    await page.click('.tab:has-text("Coach")');
    await page.click('button:has-text("Paste it instead")');
    await page.fill('.dialog textarea', 'Given an array of n integers, count the pairs (i, j) with i < j and a_i + a_j divisible by k. n <= 2e5.');
    await page.click('.dialog button:has-text("Save")');
    await page.waitForFunction(() => [...document.querySelectorAll('.pane-note')].every((e) => !e.textContent.includes('Paste it instead') || e.classList.contains('hidden')));
    assert.strictEqual((await call('statement.info', { pid: '9999Z' })).captured, true);
    await page.click('.side-foot button:has-text("Discard")');
    await page.click('.dialog button:has-text("Discard")');
    await page.waitForSelector('.hero-value', { timeout: 15000 });

    step('Contest: hidden ratings, tabs, an accepted run, early end, results and debrief');
    await nav('Contest', '.ladder-step');
    await snap('13-contest-setup');
    await page.click('.seg-item:has-text("4") >> nth=0');
    await page.click('button:has-text("Start contest")');
    await page.click('.dialog button:has-text("Start contest")');
    await page.waitForSelector('.ctab', { timeout: 15000 });
    let run = await call('contest.active');
    assert.strictEqual(run.problems.length, 4);
    assert.ok(run.problems.every((p) => p.rating === null && p.tags === null), 'ratings and tags hidden while the contest runs');
    await untilCaptured(run.problems[0].pid);
    await page.click('.ctab >> nth=1');
    await wait(500);
    await snap('14-contest-running');
    cf.submit(run.problems[1].pid, 'WRONG_ANSWER');
    cf.submit(run.problems[0].pid, 'OK');
    await page.waitForSelector('.ctab.solved', { timeout: 15000 });
    await page.waitForFunction(() => /-1/.test(document.querySelectorAll('.ctab')[1].textContent), null, { timeout: 15000 });
    await page.click('.work-bar button:has-text("End contest")');
    await page.click('.dialog button:has-text("End contest")');
    await page.waitForSelector('.tile-value', { timeout: 15000 });
    run = await call('contest.get', { id: run.id });
    assert.strictEqual(run.status, 'finished');
    assert.strictEqual(run.solved, 1);
    assert.ok(run.perf > 800 && run.problems.every((p) => p.rating !== null));
    await page.click('button:has-text("Debrief with coach")');
    await page.waitForSelector('.chat-card .msg.coach:not(.pending) .md', { timeout: 30000 });
    await snap('15-contest-results');

    step('Insights: charts, tables, and a coach review applied to problem selection');
    await nav('Insights', '.viz-card');
    await wait(500);
    assert.ok((await page.locator('.viz-card svg.viz').count()) >= 4, 'charts are drawn');
    await page.click('.viz-card >> nth=1 >> text=Table');
    await page.waitForSelector('.viz-card >> nth=1 >> table.table');
    await snap('16-insights');
    await page.click('button:has-text("Write a review")');
    await page.waitForSelector('button:has-text("Apply to my training")', { timeout: 30000 });
    await page.click('button:has-text("Apply to my training")');
    await page.waitForSelector('.badge:has-text("Applied")', { timeout: 15000 });
    const s = (await call('boot')).settings;
    assert.deepStrictEqual(s.focusTags, ['dp', 'graphs']);
    assert.strictEqual(s.habit, 'Write the complexity before coding');
    await page.evaluate(() => { document.querySelector('.main').scrollTop = 1500; });
    await snap('17-insights-lower');

    step('Journal, coach chat and settings');
    await nav('Journal', 'table.table');
    assert.ok((await page.locator('table.table tbody tr').count()) >= 7);
    await snap('18-journal');
    await page.fill('input[placeholder^="Search"]', 'Restate');
    await page.waitForFunction(() => document.querySelectorAll('table.table tbody tr').length === 1, null, { timeout: 10000 });
    await page.click('table.table tbody tr');
    await page.waitForSelector('.timeline');
    assert.match(await page.textContent('.timeline'), /Wrong answer on test 5/);
    await snap('19-journal-detail');
    await nav('Coach', '.chat');
    await page.click('.chip >> nth=0');
    await page.waitForSelector('.coach-page .msg.coach:not(.pending) .md', { timeout: 30000 });
    await snap('20-coach');
    await nav('Settings', '.settings-grid');
    await page.fill('.settings-grid input[type=number] >> nth=1', '2100');
    await page.press('.settings-grid input[type=number] >> nth=1', 'Tab');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('.page-head').textContent), null, { timeout: 8000 });
    assert.strictEqual((await call('boot')).settings.targetRating, 2100);
    await snap('21-settings');

    step('Feedback is filed as a GitHub issue');
    await page.click('.foot-link:has-text("Feedback")');
    await page.click('.dialog .seg-item:has-text("Suggestion")');
    await page.fill('.dialog textarea', 'Show the streak on Today');
    await snap('24-feedback');
    await page.click('.dialog button[type=submit]');
    await page.waitForSelector('.toast.good:has-text("Feedback sent")', { timeout: 10000 });
    const ghArgs = JSON.parse(fs.readFileSync(ghLog, 'utf8'));
    assert.deepStrictEqual(ghArgs.slice(0, 6), ['issue', 'create', '--repo', 'jicanta/trainer', '--title', 'Suggestion: Show the streak on Today']);
    assert.match(ghArgs[7], /^Show the streak on Today\n\n---\nSent from CP Gym .*settings view/);
    assert.deepStrictEqual(ghArgs.slice(8), ['--label', 'feedback', '--label', 'enhancement']);

    step('Themes: cream and dark apply everywhere and persist');
    for (const [label, theme] of [['Cream', 'cream'], ['Dark', 'dark']]) {
      await page.click(`.card .seg-item:has-text("${label}")`);
      await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 8000 });
      assert.strictEqual((await call('boot')).settings.theme, theme);
      await snap(`25-settings-${theme}`);
      for (const [name, sel] of [['Today', '.hero-value'], ['Practice', '.problem-row'], ['Insights', '.viz-card']]) { await nav(name, sel); await wait(400); await snap(`26-${theme}-${name.toLowerCase()}`); }
      await nav('Settings', '.settings-grid');
    }
    await page.click('.card .seg-item:has-text("Light")');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 8000 });

    step('Local model: the coach can run on an OpenAI-compatible server instead of Claude');
    const llm = await fakeLocal.start();
    try {
      await page.click('.settings-grid .seg-item:has-text("Local model")');
      await page.waitForSelector('button:has-text("Test connection")', { timeout: 10000 });
      await page.fill('.settings-grid input[placeholder^="http://localhost:8080"]', llm.origin);
      await page.press('.settings-grid input[placeholder^="http://localhost:8080"]', 'Tab');
      await page.click('button:has-text("Test connection")');
      await page.waitForFunction((m) => document.querySelector('.page').textContent.includes(`Models: ${m}`), llm.model, { timeout: 10000 });
      await snap('22-settings-local');
      const st = await call('coach.status');
      assert.deepStrictEqual([st.backend, st.found, st.url], ['local', true, `${llm.origin}/v1`]);
      await nav('Coach', '.chat');
      assert.match(await page.textContent('.page-sub'), /A local model/);
      const before = await page.locator('.coach-page .msg.coach:not(.pending) .md').count();
      await page.fill('.chat-input', 'What should I do this week?');
      await page.press('.chat-input', 'Enter');
      await page.waitForFunction((n) => document.querySelectorAll('.coach-page .msg.coach:not(.pending) .md').length > n, before, { timeout: 30000 });
      const said = await page.locator('.coach-page .msg.coach:not(.pending) .md').last().textContent();
      assert.match(said, /From the local model/);
      assert.doesNotMatch(said, /What does the data say/, 'the model\'s thinking is not shown');
      await snap('23-coach-local');
    } finally { await llm.close(); }

    step('Dark theme: the embedded statement is dark too');
    await call('settings.set', { theme: 'dark' });
    await nav('Practice', '.problem-row');
    await page.click('.problem-row >> nth=0 >> text=Start');
    await page.waitForSelector('.stage-views webview', { timeout: 15000 });
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.stage-views webview')).filter), /invert/);
    await wait(1500);
    await snap('27-dark-solve');

    assert.deepStrictEqual(problems, [], 'no console errors or warnings in the UI');
    console.log(`\nALL ${steps.length} UI STEPS PASSED`);
  } catch (e) {
    console.error(`\nFAILED in step "${steps[steps.length - 1]}":`, e.message);
    if (problems.length) console.error('console problems:', problems);
    try { console.error('  failure screenshot:', await shot('failure')); } catch { /* window gone */ }
    process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
    await cf.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('UI TEST CRASHED:', e); process.exit(1); });
