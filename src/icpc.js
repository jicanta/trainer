'use strict';
// ICPC problems: official ICPC contests from the Codeforces Gym, shipped as data/icpc.json (see scripts/build-icpc.js).
// The Gym has no ratings, so each problem gets one estimated from how many teams solved it.
const fs = require('node:fs');
const path = require('node:path');
const { clamp } = require('./model');

const FILE = path.join(__dirname, '..', 'data', 'icpc.json');
const FORMULA = 2;    // bump to re-estimate ratings already loaded into a database
const MIN_TEAMS = 30; // below this the solve share says little
const GYM_MIN_ID = 100000;

// The rating of a problem that half of a field solves, by the Gym's difficulty stars: [official teams, virtual teams].
// Fitted on the ICPC problems that also have a real rating in the Codeforces problem set (see docs/icpc.md).
const FIELD = { 1: [1200, 1500], 2: [1200, 1500], 3: [1300, 1600], 4: [1700, 1900], 5: [2000, 2200] };
const FIELD_DEFAULT = [1500, 1750];
// Rating points per tenfold change in the odds of solving. Codeforces uses 400 for one person; a field of teams
// is far more uneven than that, and the fit gives about 700.
const SPREAD = 700;

// How far above (or below) the field's strength a problem is, given that `solved` of `teams` got it.
const offset = (solved, teams) => SPREAD * Math.log10((teams - solved + 0.5) / (solved + 0.5));
// How much a count says: nothing below MIN_TEAMS, and little when nearly all or nearly none solved it.
const weight = (solved, teams) => (teams < MIN_TEAMS ? 0 : 1 + Math.min(solved, teams - solved));
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

// Estimated ratings for one contest: [[index, rating]], or null when too few teams played it to tell.
// Both fields give an estimate. Official fields differ a lot from region to region, while the Codeforces teams
// that play these sets virtually are a steadier yardstick, so when both are there the official estimates are
// first moved as a block onto the virtual ones, and then the two are averaged by how much each count says.
function rate(c) {
  const [nO, nV] = c.teams;
  if (nO < MIN_TEAMS && nV < MIN_TEAMS) return null;
  const [fO, fV] = FIELD[c.stars] || FIELD_DEFAULT;
  const rows = c.problems.map(([idx, , sO, sV]) => ({
    idx, o: fO + offset(sO, nO), v: fV + offset(sV, nV), wo: weight(sO, nO), wv: weight(sV, nV),
    both: sO > 0 && sO < nO && sV > 0 && sV < nV,
  }));
  const gaps = nO >= MIN_TEAMS && nV >= MIN_TEAMS ? rows.filter((r) => r.both).map((r) => r.v - r.o) : [];
  const shift = gaps.length >= 3 ? median(gaps) : 0;
  return rows.map((r) => [r.idx, clamp(Math.round(((r.o + shift) * r.wo + r.v * r.wv) / (r.wo + r.wv) / 100) * 100, 800, 3500)]);
}

function load(db, file = FILE) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { loaded: false, problems: 0 }; }
  const stamp = `${data.builtAt}/${FORMULA}`;
  if (db.getSetting('icpcLoaded', '') === stamp) return { loaded: false, problems: db.get('SELECT COUNT(*) AS n FROM icpc').n };
  let n = 0;
  db.tx(() => {
    db.run('DELETE FROM icpc');
    db.run('DELETE FROM problems WHERE contest_id >= ?', GYM_MIN_ID);
    for (const c of data.contests || []) {
      const ratings = /deprecated/i.test(c.name) ? null : rate(c);
      if (!ratings) continue;
      const rating = new Map(ratings);
      // The row shows the official scoreboard when there is one, the virtual teams otherwise.
      const g = c.teams[0] >= MIN_TEAMS ? 0 : 1;
      for (const p of c.problems) {
        const pid = `${c.id}${p[0]}`;
        db.run('INSERT INTO problems(pid, contest_id, idx, name, rating, tags, solved_count) VALUES(?,?,?,?,?,?,?)',
          pid, c.id, p[0], p[1], rating.get(p[0]), '[]', p[2 + g]);
        db.run('INSERT INTO icpc(pid, contest_name, season, teams) VALUES(?,?,?,?)', pid, c.name, parseInt(c.season, 10) || null, c.teams[g]);
        n++;
      }
    }
  });
  db.setSetting('icpcLoaded', stamp);
  return { loaded: true, problems: n };
}

module.exports = { load, rate, FILE, MIN_TEAMS, GYM_MIN_ID };
