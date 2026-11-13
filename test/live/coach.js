'use strict';
// Live check of the coach against the real Claude Code CLI: node test/live/coach.js [model]
// Uses a throwaway database with one known problem. Costs a few small Claude calls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DB, allSettings } = require('../../src/db');
const { Sessions } = require('../../src/sessions');
const { Contests } = require('../../src/contests');
const { Coach } = require('../../src/coach');

const STATEMENT = `Partitioning the Array
time limit per test 3 seconds, memory limit per test 256 megabytes

Allen has an array $a_1, a_2, \\ldots, a_n$. For every positive integer $k$ that is a divisor of $n$, Allen does the following:
- He partitions the array into $n/k$ disjoint subarrays of length $k$.
- Allen earns one point if there exists some positive integer $m$ ($m \\ge 2$) such that if he replaces every element in the array with its remainder when divided by $m$, then all subarrays will be identical.
Help Allen find the number of points he will earn.

Input
Each test consists of multiple test cases. The first line contains $t$ ($1 \\le t \\le 10^4$). Each test case has $n$ ($1 \\le n \\le 2 \\cdot 10^5$) and $a_1, \\ldots, a_n$ ($1 \\le a_i \\le n$). The sum of $n$ over all test cases does not exceed $2 \\cdot 10^5$.

Output
For each test case, output the number of points Allen will earn.

Example
Input
2
4
1 2 1 4
3
1 2 3
Output
2
1`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpgym-coach-'));
  const db = new DB(path.join(dir, 'cpgym.db'));
  db.setSetting('coachModel', process.argv[2] || 'haiku');
  db.run('INSERT INTO problems(pid, contest_id, idx, name, rating, tags, solved_count) VALUES(?,?,?,?,?,?,?)', '1920C', 1920, 'C', 'Partitioning the Array', 1600, JSON.stringify(['brute force', 'math', 'number theory']), 20000);
  db.run('INSERT INTO statements(pid, text, fetched_at) VALUES(?,?,?)', '1920C', STATEMENT, Date.now());
  const getSettings = () => allSettings(db);
  const events = [];
  let deltas = 0;
  const waiters = [];
  const emit = (type, payload) => {
    if (type === 'coach:delta') { deltas++; return; }
    events.push(type);
    if (type === 'coach:done' || type === 'coach:error') waiters.splice(0).forEach((w) => w({ type, payload }));
  };
  const finished = () => new Promise((resolve) => waiters.push(resolve));
  const sessions = new Sessions({ db, getSettings, emit: () => {} });
  const contests = new Contests({ db, getSettings, emit: () => {} });
  const coach = new Coach({ db, getSettings, sessions, contests, emit, dataDir: dir });
  console.log('status:', coach.status());

  const { attempt } = sessions.start({ pid: '1920C' });
  sessions.saveNotes(attempt.id, 'Tried sorting each block. Then thought about checking m = 2 only, but the sample with k = 2 needs more.');
  const show = (label, text) => console.log(`\n--- ${label} ---\n${text}`);
  const run = async (label, start) => {
    const t = Date.now();
    start();
    const r = await finished();
    if (r.type === 'coach:error') throw new Error(`${label}: ${r.payload.error}`);
    show(`${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`, r.payload.message ? r.payload.message.content : JSON.stringify(r.payload));
    return r.payload;
  };

  await run('chat at reveal level 0 (must not confirm or reveal)', () => coach.sendAttempt({ attemptId: attempt.id, text: 'Is this a gcd problem? Just tell me yes or no.' }));
  const analysis = JSON.parse(db.get('SELECT content FROM analyses WHERE pid = ?', '1920C').content);
  show('private analysis (never shown to the user)', JSON.stringify({ needs_technique: analysis.needs_technique, technique: analysis.technique, key_idea: analysis.key_idea, confidence: analysis.confidence, complexity: analysis.complexity }, null, 1));
  await run('hint level 1 (read from the analysis)', () => coach.sendAttempt({ attemptId: attempt.id, hintLevel: 1 }));
  await run('hint level 2 (written by the model)', () => coach.sendAttempt({ attemptId: attempt.id, hintLevel: 2 }));
  await run('chat at reveal level 2', () => coach.sendAttempt({ attemptId: attempt.id, text: 'So should I just check m = 2 and m = 3?' }));
  console.log('\nhint level recorded:', sessions.row(attempt.id).hint_level, '| streamed chunks so far:', deltas);
  sessions.finish(attempt.id, { outcome: 'solved' });
  show('reflection draft', JSON.stringify(await coach.draftReflection({ attemptId: attempt.id }), null, 1));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
