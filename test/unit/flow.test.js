'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, addSubmission, apiSubmission, clock, rng, allSettings } = require('./helpers');
const recommend = require('../../src/recommend');
const stats = require('../../src/stats');
const { Sessions } = require('../../src/sessions');
const { Contests } = require('../../src/contests');
const { Watcher } = require('../../src/watcher');

function setup() {
  const db = makeDb();
  const now = clock();
  const events = [];
  const emit = (type, payload) => events.push({ type, payload });
  const getSettings = () => allSettings(db);
  const sessions = new Sessions({ db, getSettings, emit, now });
  const contests = new Contests({ db, getSettings, emit, now, rng: rng(7) });
  return { db, now, events, getSettings, sessions, contests };
}

test('shortlist stays in the band, hides tags and skips seen problems', () => {
  const { db, getSettings } = setup();
  addSubmission(db, { id: 1, pid: '1500D' });
  addSubmission(db, { id: 2, pid: '1501E', verdict: 'WRONG_ANSWER' });
  const list = recommend.shortlist(db, getSettings(), 1500, { rng: rng(1) });
  assert.strictEqual(list.length, 6);
  for (const p of list) {
    assert.ok(p.rating >= 1500 && p.rating <= 1800, `rating ${p.rating} within the standard band`);
    assert.ok(!('tags' in p), 'tags never reach the picker');
    assert.ok(!['1500D', '1501E'].includes(p.pid), 'attempted problems are not offered again');
  }
  const stretch = recommend.shortlist(db, getSettings(), 1500, { rng: rng(2), difficulty: 'stretch' });
  assert.ok(stretch.every((p) => p.rating >= 1600 && p.rating <= 1900));
  const topic = recommend.shortlist(db, getSettings(), 1500, { rng: rng(3), topic: 'dp' });
  assert.ok(topic.length > 0);
  for (const p of topic) assert.ok(JSON.parse(db.get('SELECT tags FROM problems WHERE pid = ?', p.pid).tags).includes('dp'));
});

test('problem references parse from ids and urls', () => {
  assert.deepStrictEqual(recommend.parseProblemRef('1920C'), { contestId: 1920, index: 'C', pid: '1920C' });
  assert.strictEqual(recommend.parseProblemRef('https://codeforces.com/problemset/problem/1920/C').pid, '1920C');
  assert.strictEqual(recommend.parseProblemRef('https://codeforces.com/contest/2138/problem/C2').pid, '2138C2');
  assert.strictEqual(recommend.parseProblemRef('1920 c').pid, '1920C');
  assert.strictEqual(recommend.parseProblemRef('hello'), null);
});

test('a clean solve: phases, pause and the idea log are timed correctly', () => {
  const { db, now, sessions } = setup();
  const { attempt } = sessions.start({ pid: '1510E' });
  assert.strictEqual(attempt.phase, 'think');
  assert.strictEqual(attempt.tags, null, 'tags are hidden while solving');
  assert.throws(() => sessions.start({ pid: '1511E' }), /already have a problem open/);
  now.advance(10);
  let v = sessions.logIdea(attempt.id, 'sort by right endpoint');
  assert.match(v.notes, /\[10:00\] sort by right endpoint/);
  assert.strictEqual(v.progressMarkMs, 600000);
  sessions.setPhase(attempt.id, 'code');
  now.advance(5);
  sessions.pause(attempt.id);
  now.advance(30);
  sessions.resume(attempt.id);
  now.advance(5);
  v = sessions.finish(attempt.id, { outcome: 'solved' });
  assert.strictEqual(v.thinkMs, 600000);
  assert.strictEqual(v.codeMs, 600000);
  assert.strictEqual(v.pausedMs, 1800000);
  assert.strictEqual(v.score, 1);
  assert.strictEqual(v.outcome, 'clean');
  assert.ok(Array.isArray(v.tags) && v.tags.length === 2, 'tags are revealed after the attempt');
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM queue').n, 0);
  assert.ok(stats.skill(db, allSettings(db)).level > 1500, 'a clean solve above level raises the level');
});

test('hints lower the score and heavy help schedules a re-solve', () => {
  const { db, now, sessions } = setup();
  let a = sessions.start({ pid: '1512F' }).attempt;
  sessions.useHint(a.id, 2);
  now.advance(20);
  let v = sessions.finish(a.id, { outcome: 'solved' });
  assert.strictEqual(v.score, 0.5);
  assert.strictEqual(v.outcome, 'assisted');
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM queue').n, 0);

  a = sessions.start({ pid: '1513F' }).attempt;
  sessions.useHint(a.id, 3);
  now.advance(20);
  v = sessions.finish(a.id, { outcome: 'solved' });
  assert.strictEqual(v.score, 0.25);
  const redo = db.get(`SELECT * FROM queue WHERE pid = '1513F'`);
  assert.strictEqual(redo.kind, 'redo');
  assert.strictEqual(redo.due_at, now() + 14 * 86400000);
});

test('reading the solution queues an upsolve; the upsolve does not move the level', () => {
  const { db, now, sessions } = setup();
  const a = sessions.start({ pid: '1514G' }).attempt;
  sessions.useHint(a.id, 4);
  now.advance(15);
  const failed = sessions.finish(a.id, { outcome: 'failed' });
  assert.strictEqual(failed.score, 0);
  const q = db.get(`SELECT * FROM queue WHERE pid = '1514G' AND done_at IS NULL`);
  assert.strictEqual(q.kind, 'upsolve');
  const levelAfterFail = stats.skill(db, allSettings(db)).level;

  const up = sessions.start({ queueId: q.id }).attempt;
  assert.strictEqual(up.mode, 'upsolve');
  now.advance(25);
  const done = sessions.finish(up.id, { outcome: 'solved' });
  assert.strictEqual(done.score, null);
  assert.strictEqual(done.outcome, 'upsolved');
  assert.ok(db.get('SELECT done_at FROM queue WHERE id = ?', q.id).done_at, 'the queue item is closed');
  assert.strictEqual(db.get(`SELECT kind FROM queue WHERE pid = '1514G' AND done_at IS NULL`).kind, 'redo');
  assert.strictEqual(stats.skill(db, allSettings(db)).level, levelAfterFail);
});

test('parking keeps the problem spoiler-free and brings it back in a month', () => {
  const { db, now, sessions } = setup();
  const a = sessions.start({ pid: '1515F' }).attempt;
  now.advance(40);
  const v = sessions.finish(a.id, { outcome: 'parked' });
  assert.strictEqual(v.outcome, 'parked');
  assert.strictEqual(v.score, 0);
  const q = db.get(`SELECT * FROM queue WHERE pid = '1515F'`);
  assert.strictEqual(q.kind, 'parked');
  assert.strictEqual(q.due_at, now() + 30 * 86400000);
  const items = stats.queueItems(db, now());
  assert.strictEqual(items[0].due, false);
  const again = sessions.start({ queueId: q.id }).attempt;
  assert.strictEqual(again.mode, 'practice');
});

test('abandoned attempts do not count and leave no trace in the queue', () => {
  const { db, now, sessions } = setup();
  const a = sessions.start({ pid: '1516E' }).attempt;
  now.advance(2);
  const v = sessions.finish(a.id, { outcome: 'abandoned' });
  assert.strictEqual(v.score, null);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM queue').n, 0);
  assert.strictEqual(stats.skill(db, allSettings(db)).n, 0);
});

test('idea drills score by the coach verdict', () => {
  const { db, now, sessions } = setup();
  let a = sessions.start({ pid: '1517F', mode: 'idea' }).attempt;
  assert.ok(a.budgetMs < 45 * 60000 * 1.5, 'idea drills get a shorter budget');
  now.advance(12);
  let v = sessions.finish(a.id, { outcome: 'solved', ideaVerdict: 'correct' });
  assert.strictEqual(v.score, 1);
  a = sessions.start({ pid: '1518F', mode: 'idea' }).attempt;
  v = sessions.finish(a.id, { outcome: 'failed', ideaVerdict: 'partial' });
  assert.strictEqual(v.score, 0.4);
  assert.strictEqual(db.get(`SELECT kind FROM queue WHERE pid = '1518F'`).kind, 'upsolve');
  const fixed = sessions.setResult(v.id, { status: 'solved' });
  assert.strictEqual(fixed.score, 1, 'the user can overrule the coach');
});

test('a crash does not count downtime as thinking', () => {
  const { db, now, sessions } = setup();
  const a = sessions.start({ pid: '1519E' }).attempt;
  now.advance(7);
  sessions.heartbeat();
  now.advance(600); // app closed for ten hours
  sessions.recover();
  const v = sessions.view(sessions.row(a.id));
  assert.strictEqual(v.phase, 'paused');
  assert.strictEqual(v.thinkMs, 7 * 60000);
  sessions.resume(a.id);
  now.advance(3);
  assert.strictEqual(sessions.finish(a.id, { outcome: 'solved' }).thinkMs, 10 * 60000);
});

test('reflection feeds the reminder shown before the next problem', () => {
  const { now, sessions } = setup();
  for (const pid of ['1520E', '1521E', '1522E']) {
    const a = sessions.start({ pid }).attempt;
    now.advance(20);
    sessions.finish(a.id, { outcome: 'solved' });
    sessions.reflect(a.id, { keyIdea: 'k', missed: 'm', mistake: 'misread', takeaway: `lesson ${pid}` });
  }
  const { reminder } = sessions.start({ pid: '1523E' });
  assert.strictEqual(reminder.mistake.id, 'misread');
  assert.strictEqual(reminder.mistake.n, 3);
  assert.strictEqual(reminder.lessons.length, 2);
});

test('a virtual contest: hidden ratings, time on problem, results, queue and performance', () => {
  const { db, now, contests, sessions } = setup();
  const run = contests.start({ kind: 'mix', count: 5, minutes: 120 });
  assert.strictEqual(run.problems.length, 5);
  assert.ok(run.problems.every((p) => p.rating === null && p.tags === null), 'ratings and tags stay hidden during the contest');
  assert.throws(() => sessions.start({ pid: '1530E' }), /contest is running/);
  const [A, B, C] = run.problems;
  now.advance(8);
  contests.markSolved(A.attemptId, now());
  contests.focus(run.id, B.attemptId);
  now.advance(20);
  db.run('UPDATE attempts SET wrong_subs = 1 WHERE id = ?', B.attemptId);
  contests.markSolved(B.attemptId, now());
  contests.focus(run.id, C.attemptId);
  now.advance(200); // past the deadline
  const done = contests.checkDeadline();
  assert.strictEqual(done.status, 'finished');
  assert.strictEqual(done.solved, 2);
  assert.strictEqual(done.penalty, 8 + 28 + 10);
  assert.strictEqual(done.endedAt, run.endsAt, 'the contest ends at the deadline, not when the app noticed');
  assert.ok(done.problems.every((p) => p.rating !== null && Array.isArray(p.tags)), 'ratings and tags are revealed afterwards');
  assert.strictEqual(done.problems[0].thinkMs, 8 * 60000);
  assert.strictEqual(done.problems[1].thinkMs, 20 * 60000);
  assert.strictEqual(done.problems[2].thinkMs, 92 * 60000);
  assert.ok(done.perf > 1100 && done.perf < 1600, `performance ${done.perf}`);
  const queued = db.all(`SELECT * FROM queue WHERE kind = 'upsolve' AND done_at IS NULL`);
  assert.strictEqual(queued.length, 2, 'only the two most reachable unsolved problems are queued');
  assert.strictEqual(stats.skill(db, allSettings(db)).n, 5);
});

test('aborting a contest discards it', () => {
  const { db, contests } = setup();
  const run = contests.start({ count: 4 });
  const v = contests.abort(run.id);
  assert.strictEqual(v.status, 'aborted');
  assert.strictEqual(stats.skill(db, allSettings(db)).n, 0);
  assert.strictEqual(contests.active(), null);
});

test('the watcher turns Codeforces verdicts into results', async () => {
  const { db, now, sessions, contests, getSettings, events } = setup();
  let feed = [];
  const cf = { userStatus: async () => feed };
  const emit = (type, payload) => events.push({ type, payload });
  const watcher = new Watcher({ db, cf, getSettings, sessions, contests, emit });
  const a = sessions.start({ pid: '1540F' }).attempt;
  now.advance(15);
  sessions.setPhase(a.id, 'code');
  now.advance(10);
  const tWrong = now();
  now.advance(6);
  const tOk = now();
  now.advance(1);
  feed = [
    apiSubmission(db, { id: 903, pid: '1540F', verdict: 'OK', t: tOk }),
    apiSubmission(db, { id: 902, pid: '1540F', verdict: 'WRONG_ANSWER', t: tWrong }),
    apiSubmission(db, { id: 901, pid: '1540F', verdict: 'OK', t: a.startedAt - 86400000 }), // an old accepted run must be ignored
    apiSubmission(db, { id: 900, pid: '1541A', verdict: 'OK', t: tOk }), // a different problem
  ];
  await watcher.tick();
  const v = sessions.view(sessions.row(a.id));
  assert.strictEqual(v.status, 'solved');
  assert.strictEqual(v.wrongSubs, 1);
  assert.strictEqual(v.solvedAt, Math.floor(tOk / 1000) * 1000, 'solve time is the submission time');
  assert.strictEqual(v.codeMs, 16 * 60000);
  assert.strictEqual(events.filter((e) => e.type === 'submission').length, 2);
  await watcher.tick();
  assert.strictEqual(events.filter((e) => e.type === 'submission').length, 2, 'verdicts are processed once');

  const run = contests.start({ count: 4, minutes: 60 });
  const first = run.problems[0];
  now.advance(70);
  feed = [apiSubmission(db, { id: 950, pid: first.pid, verdict: 'OK', t: now() })];
  await watcher.tick();
  const after = contests.get(run.id);
  assert.strictEqual(after.status, 'finished');
  assert.strictEqual(after.solved, 0, 'a submission after the deadline does not count');
});

test('overview and insights summarize the log', () => {
  const { db, now, sessions, contests } = setup();
  for (let i = 0; i < 6; i++) {
    const a = sessions.start({ pid: `${1550 + i}${i % 2 ? 'E' : 'F'}` }).attempt;
    now.advance(15);
    sessions.setPhase(a.id, 'code');
    now.advance(10);
    if (i % 3 === 0) sessions.useHint(a.id, 4);
    sessions.finish(a.id, { outcome: i % 3 === 0 ? 'failed' : 'solved' });
    sessions.reflect(a.id, { keyIdea: 'idea', missed: 'x', mistake: i % 3 === 0 ? 'no_idea' : 'none', takeaway: 't' });
    now.advance(60 * 24);
  }
  const run = contests.start({ count: 4, minutes: 30 });
  now.advance(5);
  contests.markSolved(run.problems[0].attemptId, now());
  now.advance(40);
  contests.checkDeadline();

  const settings = allSettings(db);
  const o = stats.overview(db, settings, now());
  assert.strictEqual(o.level.n, 10);
  assert.ok(o.queue.items.length >= 2);
  assert.strictEqual(o.suggestion.kind, 'queue', 'upsolving comes before anything new');
  assert.ok(o.recent.length > 0 && Array.isArray(o.recent[0].tags));

  const ins = stats.insights(db, settings, now());
  const total = ins.byRating.reduce((s, b) => s + b.clean + b.assisted + b.failed + b.parked, 0);
  assert.strictEqual(total, 10);
  assert.strictEqual(ins.mistakes[0].id, 'no_idea');
  assert.strictEqual(ins.mistakes[0].n, 2);
  assert.strictEqual(ins.weekly.length, 12);
  assert.ok(ins.weekly.reduce((s, w) => s + w.minutes, 0) >= 6 * 25);
  assert.strictEqual(ins.contests.length, 1);
  assert.strictEqual(ins.levelSeries.length, 10);
  assert.ok(ins.timeByRating.every((t) => t.think === 15 && t.code === 10));
  assert.strictEqual(ins.cf, null);
  const text = stats.coachContext(db, settings, now());
  assert.match(text, /Gym level/);
  assert.match(text, /Most recent attempts/);
});
