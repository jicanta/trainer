'use strict';
// Skill model. An Elo-style estimate on the Codeforces rating scale, replayed from the attempt log
// so the numbers are always derivable from history (delete an attempt and everything recomputes).

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Probability that someone at `level` solves a problem rated `rating` (Codeforces' own rating model).
const expected = (level, rating) => 1 / (1 + Math.pow(10, (rating - level) / 400));

// How much credit a solve earns depending on the help used.
// 0 none, 1 technique check, 2 nudge, 3 key idea, 4 full solution.
const HINT_SCORE = [1, 0.75, 0.5, 0.25, 0];
const HINT_NAMES = ['no hints', 'technique check', 'nudge', 'key idea', 'full solution'];

// The outcome score in [0, 1] that an attempt contributes, or null when it does not count.
function attemptScore(a) {
  if (a.status === 'active' || a.status === 'abandoned') return null;
  if (a.mode === 'upsolve' || a.mode === 'redo') return null; // seen before: says nothing new about level
  if (a.rating == null) return null;
  const hint = HINT_SCORE[clamp(a.hint_level || 0, 0, 4)];
  if (a.mode === 'contest') return a.status === 'solved' ? 1 : 0;
  if (a.mode === 'idea') {
    if (a.idea_verdict === 'correct') return hint;
    if (a.idea_verdict === 'partial') return 0.4 * hint;
    return 0;
  }
  return a.status === 'solved' ? hint : 0;
}

const kFactor = (n) => (n < 15 ? 40 : n < 40 ? 28 : 20);
// A coached idea check is softer evidence than an accepted submission, and contest results are
// several correlated outcomes from one sitting, so both move the level less than a practice solve.
const MODE_WEIGHT = { idea: 0.6, contest: 0.6 };

// Replays counted attempts in chronological order.
// attempts: rows with { id, rating, tags (array), mode, score, ended_at }.
function replay(attempts, base) {
  let level = Number.isFinite(base) ? base : 1500;
  let n = 0;
  const history = [];
  const tags = {};
  const sorted = attempts.filter((a) => a.score != null && a.rating != null)
    .sort((x, y) => (x.ended_at || 0) - (y.ended_at || 0) || x.id - y.id);
  for (const a of sorted) {
    const weight = MODE_WEIGHT[a.mode] || 1;
    const before = level;
    for (const t of a.tags || []) {
      if (t.startsWith('*')) continue;
      const s = tags[t] || (tags[t] = { level: before, n: 0 });
      s.level += (s.n < 8 ? 40 : 24) * weight * (a.score - expected(s.level, a.rating));
      s.n++;
    }
    level += kFactor(n) * weight * (a.score - expected(level, a.rating));
    n++;
    history.push({ t: a.ended_at, level: Math.round(level), attemptId: a.id, delta: level - before });
  }
  return { level, n, history, tags };
}

// Maximum-likelihood performance rating for a contest: the level at which the expected number
// of solves equals the actual number. problems: [{ rating, solved }].
function performance(problems) {
  const ps = problems.filter((p) => p.rating != null);
  if (!ps.length) return null;
  const solved = ps.filter((p) => p.solved).length;
  const ratings = ps.map((p) => p.rating);
  if (solved === 0) return Math.min(...ratings) - 250;
  if (solved === ps.length) return Math.max(...ratings) + 250;
  let lo = Math.min(...ratings) - 800;
  let hi = Math.max(...ratings) + 800;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const exp = ps.reduce((s, p) => s + expected(mid, p.rating), 0);
    if (exp < solved) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

const roundLevel = (l) => clamp(Math.round(l / 100) * 100, 800, 3500);

module.exports = { expected, attemptScore, replay, performance, roundLevel, clamp, HINT_SCORE, HINT_NAMES, kFactor };
