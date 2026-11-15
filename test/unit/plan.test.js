'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, clock, rng, allSettings } = require('./helpers');
const { Sessions } = require('../../src/sessions');
const { Contests } = require('../../src/contests');
const { Plan, dayKey, ratedFor } = require('../../src/plan');

// 2027-01-11 is a Monday; 10:00 local time.
const MONDAY = new Date(2027, 0, 11, 10, 0).getTime();

function setup({ start = MONDAY, cf = null } = {}) {
  const db = makeDb();
  const now = clock(start);
  const getSettings = () => allSettings(db);
  const sessions = new Sessions({ db, getSettings, now });
  const contests = new Contests({ db, getSettings, now, rng: rng(5) });
  const plan = new Plan({ db, getSettings, now, cf });
  return { db, now, sessions, contests, plan };
}

const kinds = (day) => day.blocks.map((b) => b.kind);

test('a fresh week fits the available time and includes a contest on the long day', () => {
  const { plan } = setup();
  const v = plan.view();
  assert.strictEqual(v.days.length, 7);
  assert.strictEqual(v.days[0].weekday, 'Monday');
  assert.ok(v.days[0].isToday);
  for (const d of v.days) {
    assert.ok(d.planned <= d.minutes * 1.05, `${d.weekday}: ${d.planned} planned in ${d.minutes} minutes`);
    assert.ok(d.blocks.length > 0, `${d.weekday} has something to do`);
  }
  const contestDays = v.days.filter((d) => kinds(d).includes('contest'));
  assert.strictEqual(contestDays.length, 1);
  assert.strictEqual(contestDays[0].weekday, 'Saturday');
  assert.ok(kinds(v.days[6]).includes('upsolve'), 'the day after the contest starts with upsolves');
  assert.ok(v.days.some((d) => d.blocks.some((b) => b.kind === 'practice' && b.difficulty === 'stretch')), 'one challenge day');
  assert.ok(v.profile.notes.length > 0, 'the plan explains itself');
});

test('progress is read from finished attempts, and the streak counts finished days', () => {
  const { plan, sessions, now } = setup();
  let v = plan.view();
  const today = v.todayView;
  const practice = today.blocks.find((b) => b.kind === 'practice');
  assert.ok(practice);
  for (let i = 0; i < practice.n; i++) {
    const { attempt } = sessions.start({ pid: `${1520 + i}E` });
    now.advance(30);
    sessions.finish(attempt.id, { outcome: 'solved', manual: true });
  }
  v = plan.view();
  const b = v.todayView.blocks.find((x) => x.kind === 'practice');
  assert.strictEqual(b.done, practice.n);
  assert.strictEqual(v.todayView.status, 'done');
  assert.strictEqual(v.metrics.streak, 1);
  assert.ok(v.metrics.trained >= 30 * practice.n - 1);
  assert.strictEqual(v.metrics.adherence, 1);

  // Tuesday: nothing done. Wednesday: Tuesday counts as missed and breaks the streak.
  now.set(new Date(2027, 0, 13, 9, 0).getTime());
  v = plan.view();
  assert.strictEqual(v.days[1].status, 'missed');
  assert.strictEqual(v.metrics.streak, 0);
  assert.ok(v.metrics.adherence < 1);
});

test('the plan rebuilds each day from today, keeping past days', () => {
  const { plan, now, db } = setup();
  plan.view();
  const mondayBefore = db.get('SELECT blocks FROM plan_days WHERE day = ?', dayKey(MONDAY)).blocks;
  db.setSetting('planMinutes', [60, 30, 30, 30, 30, 30, 30]);
  now.set(new Date(2027, 0, 12, 9, 0).getTime());
  const v = plan.view();
  assert.strictEqual(db.get('SELECT blocks FROM plan_days WHERE day = ?', dayKey(MONDAY)).blocks, mondayBefore, 'Monday is frozen');
  assert.deepStrictEqual(kinds(v.days[1]), ['idea'], 'a 30 minute day is an idea drill');
  assert.ok(!v.days.some((d) => kinds(d).includes('contest')), 'no contest fits');
});

test('today can be overridden, and manual checks stick through a rebuild', () => {
  const { plan } = setup();
  let v = plan.setToday(90);
  assert.strictEqual(v.todayView.minutes, 90);
  assert.ok(v.todayView.override);
  const i = v.todayView.blocks.findIndex((b) => b.kind === 'practice');
  v = plan.check(v.today, i, true);
  assert.ok(v.todayView.blocks[i].complete);
  v = plan.replan();
  assert.strictEqual(v.todayView.minutes, 60, 'replanning drops the one-off override');
  assert.ok(v.todayView.blocks.find((b) => b.kind === 'practice').complete, 'the check mark survives');
  assert.throws(() => plan.check(v.days[3].key, 0, true), /not come yet/);
});

test('a rated round goes into the plan, counts as the contest and is followed by upsolves', async () => {
  const thursday = new Date(2027, 0, 14, 11, 35).getTime();
  const cf = { contestList: async () => [
    { id: 9001, name: 'Codeforces Round 999 (Div. 2)', phase: 'BEFORE', startTimeSeconds: thursday / 1000, durationSeconds: 7200 },
    { id: 9002, name: 'Codeforces Round 1000 (Div. 1)', phase: 'BEFORE', startTimeSeconds: thursday / 1000 + 86400, durationSeconds: 7200 },
  ] };
  const { plan, db } = setup({ cf });
  db.setSetting('planMinutes', [60, 60, 60, 150, 60, 150, 0]);
  assert.strictEqual(await plan.refreshRounds(), true);
  assert.strictEqual(await plan.refreshRounds(), false, 'cached for twelve hours');
  plan.build();
  const v = plan.view();
  const round = v.days[3].blocks.find((b) => b.kind === 'round');
  assert.ok(round && !round.optional, 'the Div. 2 round fits Thursday');
  assert.strictEqual(round.contestId, 9001);
  assert.ok(!v.days[4].blocks.some((b) => b.kind === 'round'), 'a Div. 1 round is not rated at 1500');
  assert.ok(kinds(v.days[4]).includes('upsolve'));
  assert.strictEqual(v.days.filter((d) => kinds(d).includes('contest')).length, 0, 'the round is this week\'s contest');
  assert.ok(ratedFor('div3', 1500) && !ratedFor('div3', 1700) && ratedFor('div1+2', 2500));
});

test('a weak week shrinks the next one, and the coach summary reads the plan', () => {
  const { plan, now } = setup();
  plan.view();
  now.set(new Date(2027, 0, 18, 9, 0).getTime()); // next Monday, nothing done last week
  const v = plan.view();
  assert.strictEqual(v.profile.scale, 0.75);
  assert.match(v.profile.notes[0], /finished 0%/);
  assert.strictEqual(v.history.length, 2);
  const text = plan.summaryText(v);
  assert.match(text, /Last week: covered 0%/);
  assert.match(text, /Monday/);
});

test('a new upsolve in the queue lands in today\'s plan', () => {
  const { plan, sessions, db } = setup();
  assert.ok(!plan.view().todayView.blocks.some((b) => b.kind === 'upsolve'));
  const { attempt } = sessions.start({ pid: '1530E' });
  sessions.useHint(attempt.id, 4);
  sessions.finish(attempt.id, { outcome: 'failed' });
  assert.ok(db.get(`SELECT id FROM queue WHERE kind = 'upsolve' AND done_at IS NULL`), 'the full solution queued an upsolve');
  const today = plan.view().todayView;
  assert.strictEqual(today.blocks[0].kind, 'upsolve');
  assert.ok(today.planned <= today.minutes * 1.05);
});
