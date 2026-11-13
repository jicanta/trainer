'use strict';
// Synthetic, offline fixture: a small Codeforces-like problem set and a user with some history.
const { DB, allSettings } = require('../../src/db');
const { CORE_TAGS } = require('../../src/stats');

const RATINGS = [900, 1100, 1300, 1500, 1600, 1700, 1800, 1900, 2100, 2300];

function makeDb({ contests = 80 } = {}) {
  const db = new DB(':memory:');
  let k = 0;
  db.tx(() => {
    for (let c = 0; c < contests; c++) {
      const id = 1500 + c;
      const start = Date.UTC(2021, 0, 1) / 1000 + c * 14 * 86400;
      db.run('INSERT INTO cf_contests(id, name, start, duration, kind) VALUES(?,?,?,?,?)', id, `Codeforces Round ${id} (Div. 2)`, start, 7200, 'div2');
      RATINGS.forEach((rating, i) => {
        const idx = String.fromCharCode(65 + i);
        const tags = [CORE_TAGS[k % CORE_TAGS.length], CORE_TAGS[(k * 7 + 3) % CORE_TAGS.length]];
        k++;
        db.run('INSERT INTO problems(pid, contest_id, idx, name, rating, tags, solved_count) VALUES(?,?,?,?,?,?,?)',
          `${id}${idx}`, id, idx, `Problem ${c}-${idx} name`, rating, JSON.stringify(tags), 5000 - i * 300);
      });
    }
  });
  db.setSetting('handle', 'tester');
  db.setSetting('levelBase', 1500);
  return db;
}

function addSubmission(db, { id, pid, verdict = 'OK', created = 1700000000, participant = 'CONTESTANT', relTime = 600 }) {
  const p = db.get('SELECT * FROM problems WHERE pid = ?', pid);
  db.run(
    `INSERT INTO cf_submissions(id, pid, contest_id, idx, name, rating, tags, verdict, created, rel_time, participant, lang, passed)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, pid, p.contest_id, p.idx, p.name, p.rating, p.tags, verdict, created, relTime, participant, 'C++', 10);
}

// A Codeforces API submission object for the fake client.
function apiSubmission(db, { id, pid, verdict, t }) {
  const p = db.get('SELECT * FROM problems WHERE pid = ?', pid);
  return {
    id, creationTimeSeconds: Math.floor(t / 1000), relativeTimeSeconds: 2147483647, verdict, passedTestCount: 3, programmingLanguage: 'C++20',
    problem: { contestId: p.contest_id, index: p.idx, name: p.name, rating: p.rating, tags: JSON.parse(p.tags) },
    author: { participantType: 'PRACTICE' },
  };
}

function clock(start = 1800000000000) {
  let t = start;
  const now = () => t;
  now.advance = (min) => { t += Math.round(min * 60000); return t; };
  now.set = (v) => { t = v; };
  return now;
}

// Deterministic RNG (mulberry32).
function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { makeDb, addSubmission, apiSubmission, clock, rng, allSettings, RATINGS };
