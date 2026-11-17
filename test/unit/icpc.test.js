'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeDb, rng, allSettings } = require('./helpers');
const icpc = require('../../src/icpc');
const recommend = require('../../src/recommend');
const { Sessions } = require('../../src/sessions');
const { tally } = require('../../scripts/build-icpc');

// Contests of 100 official teams with one problem per solve count, and one too small to trust.
const SOLVED = [98, 90, 75, 60, 50, 40, 30, 20, 12, 6, 2, 0];
const contest = (id, name, season, stars, teams, tag) => ({
  id, name, season, stars, teams, problems: SOLVED.map((s, i) => [String.fromCharCode(65 + i), `${tag} problem ${i}`, Math.round(s * teams[0] / 100), 0]),
});
function fixture() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cpgym-icpc-')), 'icpc.json');
  fs.writeFileSync(file, JSON.stringify({ builtAt: '2026-01-01', contests: [
    contest(105001, 'Regional 2024', '2024-2025', 3, [100, 0], 'R24'),
    contest(104001, 'Regional 2022', '2022-2023', 4, [100, 0], 'R22'),
    contest(103001, 'Regional 2012', '2012-2013', 3, [100, 0], 'R12'),
    contest(105002, 'Tiny 2024', '2024-2025', 3, [8, 3], 'T'),
  ] }));
  return file;
}

test('fewer solves means a higher estimated rating, and a stronger field shifts it up', () => {
  const three = icpc.rate(contest(1, 'x', null, 3, [100, 0], 'x')).map((r) => r[1]);
  for (let i = 1; i < three.length; i++) assert.ok(three[i] >= three[i - 1], `${three}`);
  assert.ok(three[three.length - 1] - three[0] >= 1200, 'from almost everyone to no one is a wide range');
  assert.ok(three.every((r) => r % 100 === 0 && r >= 800 && r <= 3500));
  const four = icpc.rate(contest(1, 'x', null, 4, [100, 0], 'x')).map((r) => r[1]);
  assert.ok(four[4] > three[4]);
  assert.strictEqual(icpc.rate(contest(1, 'x', null, 3, [8, 3], 'x')), null, 'too few teams to tell');
});

test('virtual teams set the level when the official field is weak or strong', () => {
  // Same official scoreboard; in one contest the Codeforces teams found the set much easier.
  const c = contest(1, 'x', null, 3, [100, 0], 'x');
  const withVirtual = (solved) => ({ ...c, teams: [100, 100], problems: c.problems.map((p, i) => [p[0], p[1], p[2], solved[i]]) });
  const base = icpc.rate(c).map((r) => r[1]);
  const easy = icpc.rate(withVirtual(SOLVED.map((s) => Math.min(100, s + 30)))).map((r) => r[1]);
  const mid = [3, 4, 5, 6, 7];
  assert.ok(mid.every((i) => easy[i] < base[i]), `${easy} against ${base}`);
  for (let i = 1; i < easy.length; i++) assert.ok(easy[i] >= easy[i - 1], 'the order inside the contest is kept');
});

test('the build counts official and virtual teams apart, and leaves practice out', () => {
  const sub = (id, type, ghost, index, verdict) => ({ author: { participantId: id, participantType: type, ghost }, problem: { index, name: `P${index}` }, verdict });
  const t = tally([
    sub(1, 'VIRTUAL', true, 'A', 'OK'), sub(1, 'VIRTUAL', true, 'A', 'OK'), sub(1, 'VIRTUAL', true, 'B', 'WRONG_ANSWER'),
    sub(2, 'VIRTUAL', false, 'B', 'OK'), sub(4, 'CONTESTANT', false, 'A', 'OK'), sub(3, 'PRACTICE', false, 'A', 'OK'), sub(3, 'PRACTICE', false, 'C', 'OK'),
  ]);
  assert.deepStrictEqual(t, { teams: [1, 2], problems: [['A', 'PA', 1, 1], ['B', 'PB', 0, 1], ['C', 'PC', 0, 0]] });
});

test('ICPC problems load once, are offered in the band by source, and open in the Gym', () => {
  const db = makeDb();
  const file = fixture();
  assert.deepStrictEqual(icpc.load(db, file), { loaded: true, problems: 36 });
  assert.strictEqual(icpc.load(db, file).loaded, false, 'the same file is not loaded twice');
  const settings = allSettings(db);

  const list = recommend.shortlist(db, settings, 1500, { rng: rng(1), source: 'icpc' });
  assert.ok(list.length > 0);
  for (const p of list) {
    assert.ok(p.contestId >= 104001, 'only ICPC problems, none older than the year limit');
    assert.ok(p.rating >= 1400 && p.rating <= 1900, `rating ${p.rating} around the band`);
    assert.ok(p.solvedCount <= 100);
    assert.strictEqual(p.teams, 100);
    assert.ok(/^Regional 20(22|24)$/.test(p.contestName));
  }
  assert.ok(recommend.shortlist(db, settings, 1500, { rng: rng(1) }).every((p) => p.contestId < 100000), 'the Codeforces picker is unchanged');

  const sessions = new Sessions({ db, getSettings: () => allSettings(db) });
  const { attempt } = sessions.start({ pid: list[0].pid, origin: 'icpc' });
  assert.strictEqual(attempt.url, `https://codeforces.com/gym/${list[0].contestId}/problem/${list[0].index}`);
  assert.strictEqual(attempt.rating, list[0].rating);
  assert.ok(!recommend.shortlist(db, settings, 1500, { rng: rng(1), source: 'icpc' }).some((p) => p.pid === list[0].pid), 'an open problem is not offered again');
  assert.strictEqual(recommend.lookup(db, `https://codeforces.com/gym/${list[0].contestId}/problem/${list[0].index}`).name, list[0].name);
});
