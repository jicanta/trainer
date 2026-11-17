'use strict';
// Problem selection. Picks unseen problems slightly above the current level ("the interesting interval"),
// quietly weighted toward weak topics. Tags never leave this module while a problem is unsolved.
const { roundLevel, clamp } = require('./model');
const { parseTags, topicProfile, byIdx } = require('./stats');
const { GYM_MIN_ID } = require('./icpc');

// Rating offsets from the current level and how often each is drawn.
const BANDS = {
  comfortable: [[-100, 0.25], [0, 0.4], [100, 0.25], [200, 0.1]],
  standard: [[0, 0.2], [100, 0.35], [200, 0.3], [300, 0.15]],
  stretch: [[100, 0.15], [200, 0.35], [300, 0.3], [400, 0.2]],
};
// A contest ladder: sure things, coin flips and a reach, like a real round.
const MIX_OFFSETS = { 4: [-300, -100, 100, 300], 5: [-400, -200, 0, 200, 400], 6: [-500, -300, -100, 100, 300, 500] };

function seen(db) {
  const pids = new Set();
  const names = new Set();
  for (const r of db.all('SELECT DISTINCT pid, name FROM cf_submissions')) { pids.add(r.pid); if (r.name) names.add(r.name); }
  for (const r of db.all(`SELECT DISTINCT pid, name FROM attempts WHERE status != 'abandoned'`)) { pids.add(r.pid); names.add(r.name); }
  for (const r of db.all('SELECT pid FROM queue WHERE done_at IS NULL')) pids.add(r.pid);
  return { pids, names };
}

function candidates(db, settings, { minRating, maxRating, topic, seenSets }) {
  const minStart = Date.UTC(settings.minYear || 2019, 0, 1) / 1000;
  const rows = db.all(
    `SELECT p.pid, p.contest_id, p.idx, p.name, p.rating, p.tags, p.solved_count,
            c.name AS contest_name, c.start AS contest_start, c.kind
     FROM problems p LEFT JOIN cf_contests c ON c.id = p.contest_id
     WHERE p.rating BETWEEN ? AND ? AND p.solved_count >= ? AND p.tags NOT LIKE '%*special%'
       AND COALESCE(c.kind, 'other') != 'excluded' AND COALESCE(c.start, 0) >= ? AND p.contest_id < ?`,
    minRating, maxRating, settings.minSolved ?? 300, minStart, GYM_MIN_ID);
  const s = seenSets || seen(db);
  const out = [];
  for (const r of rows) {
    if (s.pids.has(r.pid) || s.names.has(r.name)) continue;
    r.tags = parseTags(r.tags);
    if (topic && !r.tags.includes(topic)) continue;
    out.push(r);
  }
  return out;
}

// Problems from official ICPC contests. Their rating is an estimate (see icpc.js) and they have no tags.
function icpcCandidates(db, settings, { minRating, maxRating, seenSets }) {
  const rows = db.all(
    `SELECT p.pid, p.contest_id, p.idx, p.name, p.rating, p.solved_count, i.contest_name, i.season, i.teams
     FROM icpc i JOIN problems p ON p.pid = i.pid
     WHERE p.rating BETWEEN ? AND ? AND COALESCE(i.season, 0) >= ?`,
    minRating, maxRating, settings.minYear || 2019);
  const s = seenSets || seen(db);
  return rows.filter((r) => !s.pids.has(r.pid) && !s.names.has(r.name)).map((r) => ({ ...r, tags: [] }));
}
const icpcRecency = (p) => (p.season >= 2022 ? 1 : p.season >= 2020 ? 0.85 : 0.7);

// Weighted sampling without replacement (Efraimidis-Spirakis).
function sample(items, k, weight, rng) {
  return items.map((it) => ({ it, key: Math.pow(rng(), 1 / Math.max(1e-6, weight(it))) }))
    .sort((a, b) => b.key - a.key).slice(0, k).map((x) => x.it);
}

function allocate(weights, n) {
  const raw = weights.map((w) => w * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

// Recent problems from regular Codeforces rounds are the closest to what the user will face next.
const recency = (p) => {
  const y = p.contest_start ? new Date(p.contest_start * 1000).getUTCFullYear() : 2015;
  return (y >= 2022 ? 1 : y >= 2020 ? 0.85 : 0.7) * (p.kind === 'other' || !p.kind ? 0.5 : 1);
};

function weigher(db, settings, level, weakFocus) {
  const weak = {};
  const focus = new Set();
  if (weakFocus) {
    for (const t of topicProfile(db, settings)) {
      weak[t.tag] = t.weakness;
      if (t.focus) focus.add(t.tag);
    }
  }
  return (p) => {
    const tags = p.tags.filter((t) => !t.startsWith('*'));
    const avg = tags.length ? tags.reduce((s, t) => s + (weak[t] || 0), 0) / tags.length : 0;
    const boost = tags.some((t) => focus.has(t)) ? 1.5 : 0;
    return (1 + 1.2 * avg + boost) * recency(p);
  };
}

// What the renderer may see of an unsolved problem: no tags.
function publicProblem(p) {
  return {
    pid: p.pid, contestId: p.contest_id, index: p.idx, name: p.name, rating: p.rating, solvedCount: p.solved_count,
    contestName: p.contest_name || null, year: p.contest_start ? new Date(p.contest_start * 1000).getUTCFullYear() : p.season || null,
    teams: p.teams ?? null, // ICPC only: solvedCount of this many teams
  };
}

function shortlist(db, settings, level, opts = {}) {
  const rng = opts.rng || Math.random;
  const n = opts.n || 6;
  const band = BANDS[opts.difficulty || settings.difficulty] || BANDS.standard;
  const base = roundLevel(level);
  const seenSets = seen(db);
  const weakFocus = opts.weakFocus ?? settings.weakFocus;
  const icpc = opts.source === 'icpc';
  const w = icpc ? icpcRecency : weigher(db, settings, level, weakFocus && !opts.topic);
  const pool = (minRating, maxRating) => (icpc
    ? icpcCandidates(db, settings, { minRating, maxRating, seenSets })
    : candidates(db, settings, { minRating, maxRating, topic: opts.topic, seenSets }));
  const quotas = allocate(band.map((b) => b[1]), n);
  const picks = [];
  band.forEach(([off], i) => {
    if (!quotas[i]) return;
    const r = clamp(base + off, 800, 3500);
    picks.push(...sample(pool(r, r), quotas[i], w, rng));
  });
  if (picks.length < n) {
    const have = new Set(picks.map((p) => p.pid));
    const lo = clamp(base + band[0][0] - 100, 800, 3500);
    const hi = clamp(base + band[band.length - 1][0] + 100, 800, 3500);
    const extra = pool(lo, hi).filter((p) => !have.has(p.pid));
    picks.push(...sample(extra, n - picks.length, w, rng));
  }
  return picks.sort((a, b) => a.rating - b.rating || a.pid.localeCompare(b.pid)).map(publicProblem);
}

// Accepts "1920C", "1920/C", or any Codeforces problem URL.
function parseProblemRef(text) {
  const s = String(text || '').trim();
  let m = /(?:problemset\/problem|contest|gym)\/(\d+)\/(?:problem\/)?([A-Za-z]\d*)/i.exec(s);
  if (!m) m = /^(\d+)\s*[/\-\s]?\s*([A-Za-z]\d*)$/.exec(s);
  if (!m) return null;
  return { contestId: Number(m[1]), index: m[2].toUpperCase(), pid: `${Number(m[1])}${m[2].toUpperCase()}` };
}

function lookup(db, text) {
  const ref = parseProblemRef(text);
  if (!ref) return null;
  const p = db.get(
    `SELECT p.*, COALESCE(c.name, i.contest_name) AS contest_name, c.start AS contest_start, i.season, i.teams FROM problems p
     LEFT JOIN cf_contests c ON c.id = p.contest_id LEFT JOIN icpc i ON i.pid = p.pid WHERE p.pid = ?`, ref.pid);
  if (p) return { ...publicProblem(p), known: true };
  return { pid: ref.pid, contestId: ref.contestId, index: ref.index, name: `Problem ${ref.pid}`, rating: null, solvedCount: null, contestName: null, year: null, known: false };
}

function buildMix(db, settings, level, count, rng = Math.random) {
  const offsets = MIX_OFFSETS[count] || MIX_OFFSETS[5];
  const base = roundLevel(level);
  const seenSets = seen(db);
  const usedContests = new Set();
  const tagUse = {};
  const problems = [];
  for (const off of offsets) {
    const target = clamp(base + off, 800, 3500);
    let pool = [];
    for (const spread of [0, 100, 200]) {
      pool = candidates(db, settings, { minRating: target - spread, maxRating: target + spread, seenSets })
        .filter((p) => !usedContests.has(p.contest_id) && !problems.some((q) => q.pid === p.pid));
      if (pool.length) break;
    }
    if (!pool.length) continue;
    // Prefer variety: avoid a third problem led by the same topic.
    const pick = sample(pool, 1, (p) => recency(p) * ((tagUse[p.tags[0]] || 0) >= 2 ? 0.2 : 1), rng)[0];
    usedContests.add(pick.contest_id);
    for (const t of pick.tags.slice(0, 1)) tagUse[t] = (tagUse[t] || 0) + 1;
    problems.push(pick);
  }
  problems.sort((a, b) => a.rating - b.rating);
  return {
    kind: 'mix', title: `Mixed contest, ${problems.length} problems`, cfContestId: null,
    problems: problems.map((p, i) => ({ ...p, label: String.fromCharCode(65 + i) })),
  };
}

function buildRound(db, settings, level, count, rng = Math.random, now = Date.now()) {
  const kinds = level < 1400 ? ['div3', 'div2', 'div4', 'edu'] : level < 2000 ? ['div2', 'edu'] : ['div1+2', 'div2', 'edu'];
  const minStart = Date.UTC(Math.max(settings.minYear || 2019, 2020), 0, 1) / 1000;
  const seenSets = seen(db);
  const played = new Set(db.all('SELECT DISTINCT contest_id FROM cf_submissions').map((r) => r.contest_id));
  for (const r of db.all(`SELECT DISTINCT contest_id FROM attempts WHERE status != 'abandoned'`)) played.add(r.contest_id);
  const contests = db.all(
    `SELECT id, name, start, kind FROM cf_contests WHERE kind IN (${kinds.map(() => '?').join(',')}) AND start >= ? AND start <= ?
     ORDER BY start DESC LIMIT 200`, ...kinds, minStart, Math.floor(now / 1000) - 3 * 86400);
  const order = sample(contests.filter((c) => !played.has(c.id)), contests.length, () => 1, rng);
  for (const c of order) {
    const ps = db.all('SELECT pid, contest_id, idx, name, rating, tags, solved_count FROM problems WHERE contest_id = ?', c.id).sort(byIdx);
    if (ps.length < Math.min(count, 4) || ps.filter((p) => p.rating != null).length < Math.min(count, 4)) continue;
    if (ps.some((p) => seenSets.pids.has(p.pid) || seenSets.names.has(p.name))) continue;
    const chosen = ps.slice(0, count).map((p) => ({ ...p, tags: parseTags(p.tags), contest_name: c.name, contest_start: c.start, label: p.idx }));
    return { kind: 'round', title: c.name, cfContestId: c.id, problems: chosen };
  }
  return null;
}

module.exports = { shortlist, lookup, parseProblemRef, buildMix, buildRound, candidates, icpcCandidates, seen, publicProblem, BANDS, MIX_OFFSETS };
