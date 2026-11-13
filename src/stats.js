'use strict';
// Everything the dashboards and the coach read: level, topic profile, time, mistakes, Codeforces history.
const { replay, clamp } = require('./model');

// Topics that decide results below ~2100. Advanced tags are ignored on purpose
// (Um_nik: "Stop learning useless algorithms, go and solve some problems").
const CORE_TAGS = [
  'greedy', 'math', 'constructive algorithms', 'implementation', 'brute force', 'dp', 'sortings', 'binary search',
  'graphs', 'dfs and similar', 'trees', 'number theory', 'data structures', 'combinatorics', 'two pointers',
  'strings', 'bitmasks', 'dsu', 'shortest paths', 'geometry', 'probabilities', 'games', 'hashing', 'interactive',
  'divide and conquer',
];

const MISTAKES = {
  none: 'Nothing went wrong',
  no_idea: 'Did not find the key observation',
  wrong_path: 'Stayed too long on a wrong approach',
  not_recognized: 'Knew the technique, did not recognize it',
  unknown_technique: 'Did not know the technique',
  misread: 'Misread the statement',
  bug: 'Implementation bug',
  edge_case: 'Missed an edge case or overflow',
  complexity: 'Misjudged complexity',
  slow: 'Too slow to implement',
  focus: 'Lost focus',
};

const DAY = 86400000;
const parseTags = (s) => { if (Array.isArray(s)) return s; try { return JSON.parse(s || '[]'); } catch { return []; } };
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const startOfWeek = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const startOfMonth = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(1); return d.getTime(); };
const idxKey = (idx) => { const m = /^([A-Za-z]+)(\d*)$/.exec(idx || ''); return m ? [m[1].toUpperCase(), Number(m[2] || 0)] : [String(idx), 0]; };
const byIdx = (a, b) => { const [x1, y1] = idxKey(a.idx); const [x2, y2] = idxKey(b.idx); return x1 < x2 ? -1 : x1 > x2 ? 1 : y1 - y2; };

function outcomeOf(a) {
  if (a.status === 'active') return 'active';
  if (a.status === 'abandoned') return 'abandoned';
  if (a.status === 'parked') return 'parked';
  if (a.status === 'solved') {
    if (a.mode === 'upsolve' || a.hint_level >= 4) return 'upsolved';
    return a.hint_level > 0 ? 'assisted' : 'clean';
  }
  return 'failed';
}

function summarize(a) {
  return {
    id: a.id, pid: a.pid, contestId: a.contest_id, index: a.idx, name: a.name, rating: a.rating, tags: parseTags(a.tags),
    mode: a.mode, origin: a.origin, status: a.status, outcome: outcomeOf(a), hintLevel: a.hint_level,
    thinkMs: a.think_ms, codeMs: a.code_ms, wrongSubs: a.wrong_subs, drifts: a.drifts,
    startedAt: a.started_at, endedAt: a.ended_at, solvedAt: a.solved_at, score: a.score,
    keyIdea: a.key_idea, missed: a.missed, mistake: a.mistake, takeaway: a.takeaway, reflected: !!a.reflected,
    contestRunId: a.contest_run_id, label: a.label, ideaVerdict: a.idea_verdict, manual: !!a.manual,
  };
}

function countedAttempts(db) {
  return db.all(
    `SELECT id, pid, rating, tags, mode, status, score, ended_at, hint_level, think_ms, code_ms, level_at_start
     FROM attempts WHERE status NOT IN ('active','abandoned') AND score IS NOT NULL AND rating IS NOT NULL`,
  ).map((a) => ({ ...a, tags: parseTags(a.tags) }));
}

function skill(db, settings) {
  return replay(countedAttempts(db), settings.levelBase);
}

// Per-topic picture: gym results, topic Elo, Codeforces history, and a weakness score in [0, 1.5]
// that the recommender uses as a sampling weight (the tags themselves stay hidden while solving).
function topicProfile(db, settings, sk) {
  sk = sk || skill(db, settings);
  const level = sk.level;
  const hist = {};
  const rows = db.all(`SELECT pid, MAX(rating) AS rating, MAX(tags) AS tags, MAX(verdict = 'OK') AS ok FROM cf_submissions GROUP BY pid`);
  for (const r of rows) {
    for (const t of parseTags(r.tags)) {
      const h = hist[t] || (hist[t] = { solved: 0, atLevel: 0, failed: 0 });
      if (r.ok) { h.solved++; if (r.rating != null && r.rating >= level - 200) h.atLevel++; } else h.failed++;
    }
  }
  const hasHistory = rows.length > 0;

  // How often each topic shows up around the level the user is training for.
  const lo = Math.round(level / 100) * 100;
  const band = db.all('SELECT tags FROM problems WHERE rating BETWEEN ? AND ?', lo, lo + 400);
  const freq = {};
  for (const r of band) for (const t of parseTags(r.tags)) freq[t] = (freq[t] || 0) + 1;

  const gym = {};
  for (const a of countedAttempts(db)) {
    for (const t of a.tags) {
      const g = gym[t] || (gym[t] = { attempts: 0, clean: 0, assisted: 0, failed: 0, think: [] });
      g.attempts++;
      if (a.status === 'solved' && a.hint_level === 0) g.clean++;
      else if (a.status === 'solved' && a.hint_level < 4) g.assisted++;
      else g.failed++;
      if (a.status === 'solved' && a.mode !== 'contest' && a.think_ms > 0) g.think.push(a.think_ms / 60000);
    }
  }

  const focus = settings.focusUntil > Date.now() ? new Set(settings.focusTags || []) : new Set();
  return CORE_TAGS.map((tag) => {
    const g = gym[tag] || { attempts: 0, clean: 0, assisted: 0, failed: 0, think: [] };
    const h = hist[tag] || { solved: 0, atLevel: 0, failed: 0 };
    const tl = sk.tags[tag];
    const share = band.length ? (freq[tag] || 0) / band.length : 0;
    const importance = clamp(share / 0.08, 0, 1);
    const deficit = tl && tl.n >= 2 ? clamp((level - tl.level) / 200, 0, 1.5) : 0;
    const exposure = hasHistory ? clamp(1 - h.atLevel / 8, 0, 1) : 0;
    return {
      tag, attempts: g.attempts, clean: g.clean, assisted: g.assisted, failed: g.failed,
      cleanRate: g.attempts ? g.clean / g.attempts : null,
      level: tl && tl.n >= 2 ? Math.round(tl.level) : null,
      thinkMin: g.think.length ? Math.round(median(g.think)) : null,
      cfSolved: h.solved, cfAtLevel: h.atLevel, cfFailed: h.failed,
      share, weakness: Number(((0.6 * deficit + 0.4 * exposure) * importance).toFixed(3)), focus: focus.has(tag),
    };
  });
}

function queueItems(db, now = Date.now()) {
  const rows = db.all(
    `SELECT q.*, p.name, p.rating, p.contest_id, p.idx FROM queue q LEFT JOIN problems p ON p.pid = q.pid
     WHERE q.done_at IS NULL ORDER BY q.due_at`);
  return rows.map((q) => ({
    id: q.id, pid: q.pid, kind: q.kind, dueAt: q.due_at, due: q.due_at <= now, reason: q.reason,
    name: q.name || q.pid, rating: q.rating, contestId: q.contest_id, index: q.idx, createdAt: q.created_at,
  }));
}

function activeMinutes(db, from, to) {
  const a = db.get(
    `SELECT COALESCE(SUM(think_ms + code_ms), 0) AS ms FROM attempts
     WHERE contest_run_id IS NULL AND status != 'abandoned' AND started_at >= ? AND started_at < ?`, from, to).ms;
  const c = db.get(
    `SELECT COALESCE(SUM(COALESCE(ended_at, started_at + duration_ms) - started_at), 0) AS ms FROM contest_runs
     WHERE status != 'aborted' AND started_at >= ? AND started_at < ?`, from, to).ms;
  return Math.round((a + c) / 60000);
}

function overview(db, settings, now = Date.now()) {
  const sk = skill(db, settings);
  const level = Math.round(sk.level);
  const monthAgo = sk.history.filter((h) => h.t <= now - 30 * DAY).pop();
  const wk = startOfWeek(now);
  const mo = startOfMonth(now);
  const weekRows = db.all(`SELECT status, hint_level, mode, started_at FROM attempts WHERE status NOT IN ('active','abandoned') AND started_at >= ?`, wk);
  const days = new Set(weekRows.map((r) => new Date(r.started_at).toDateString()));
  const notEasy = db.get(
    `SELECT COUNT(*) AS n FROM attempts WHERE status = 'solved' AND hint_level < 4 AND mode != 'upsolve'
     AND ended_at >= ? AND rating IS NOT NULL AND rating >= COALESCE(level_at_start, ?) - 100`, mo, settings.levelBase).n;
  const queue = queueItems(db, now);
  const lastContest = db.get(`SELECT * FROM contest_runs WHERE status = 'finished' ORDER BY ended_at DESC LIMIT 1`);
  const recent = db.all(`SELECT * FROM attempts WHERE status NOT IN ('active','abandoned') ORDER BY ended_at DESC LIMIT 6`).map(summarize);
  const unreflected = db.get(`SELECT COUNT(*) AS n FROM attempts WHERE status IN ('solved','failed') AND reflected = 0 AND mode != 'contest'`).n;
  const daysSinceContest = lastContest ? Math.floor((now - lastContest.ended_at) / DAY) : null;

  const dueUpsolve = queue.filter((q) => q.kind === 'upsolve' && q.due);
  const dueOther = queue.filter((q) => q.kind !== 'upsolve' && q.due);
  const minutes = settings.sessionMinutes || 60;
  let suggestion;
  if (dueUpsolve.length) {
    suggestion = { kind: 'queue', queueId: dueUpsolve[0].id, title: `Upsolve ${dueUpsolve[0].name}`, detail: 'You have seen how it is solved. Implement it yourself before taking on anything new.' };
  } else if (minutes >= settings.contestMinutes && (daysSinceContest === null || daysSinceContest >= 6)) {
    suggestion = { kind: 'contest', title: 'Virtual contest', detail: daysSinceContest === null ? 'No contest logged yet.' : `Your last contest was ${daysSinceContest} days ago.` };
  } else if (dueOther.length) {
    const q = dueOther[0];
    suggestion = { kind: 'queue', queueId: q.id, title: `${q.kind === 'redo' ? 'Re-solve' : 'Return to'} ${q.name}`, detail: q.kind === 'redo' ? 'Check that the idea stuck: solve it again without notes.' : 'You parked this a while ago. Try it with fresh eyes.' };
  } else if (minutes <= 35) {
    suggestion = { kind: 'idea', title: 'Idea drill', detail: 'Short on time: think one problem through to a full solution, skip the coding.' };
  } else {
    suggestion = { kind: 'practice', title: 'Practice problem', detail: 'One problem slightly above your level, tags hidden.' };
  }

  return {
    level: { value: level, base: settings.levelBase, n: sk.n, target: settings.targetRating, change30: monthAgo ? level - monthAgo.level : sk.n ? level - Math.round(settings.levelBase) : 0 },
    cf: db.getSetting('cfUser', null),
    week: { minutes: activeMinutes(db, wk, now + 1), problems: weekRows.length, clean: weekRows.filter((r) => r.status === 'solved' && r.hint_level === 0).length, days: days.size },
    month: { notEasy, goal: settings.monthlyGoal },
    queue: { items: queue, due: queue.filter((q) => q.due).length },
    lastContest: lastContest ? { id: lastContest.id, title: lastContest.title, endedAt: lastContest.ended_at, solved: lastContest.solved, perf: lastContest.perf } : null,
    daysSinceContest, recent, unreflected, suggestion,
    focus: settings.focusUntil > now ? settings.focusTags : [],
  };
}

// What the user's real Codeforces rounds say: where they stop, how fast they are, what they fail.
function cfAnalysis(db, settings, level, now = Date.now()) {
  if (!db.get('SELECT COUNT(*) AS n FROM cf_submissions').n) return null;
  const solved = db.all(`SELECT pid, MAX(rating) AS rating, MIN(created) AS t FROM cf_submissions WHERE verdict = 'OK' AND rating IS NOT NULL GROUP BY pid`);
  const hist = {};
  for (const s of solved) {
    const h = hist[s.rating] || (hist[s.rating] = { rating: s.rating, all: 0, recent: 0 });
    h.all++;
    if (s.t * 1000 >= now - 180 * DAY) h.recent++;
  }
  const solvedByRating = Object.values(hist).sort((a, b) => a.rating - b.rating);

  const live = db.all(
    `SELECT contest_id, pid, verdict, rel_time, created FROM cf_submissions
     WHERE participant IN ('CONTESTANT','OUT_OF_COMPETITION') AND contest_id < 100000 ORDER BY created`);
  const byContest = new Map();
  for (const s of live) {
    if (!byContest.has(s.contest_id)) byContest.set(s.contest_id, []);
    byContest.get(s.contest_id).push(s);
  }
  const everSolved = new Set(db.all(`SELECT DISTINCT pid FROM cf_submissions WHERE verdict = 'OK'`).map((r) => r.pid));
  const inGym = new Set(db.all(`SELECT DISTINCT pid FROM attempts WHERE status != 'abandoned'`).map((r) => r.pid));
  const inQueue = new Set(db.all('SELECT pid FROM queue WHERE done_at IS NULL').map((r) => r.pid));
  const recent = [...byContest.entries()].sort((a, b) => b[1][b[1].length - 1].created - a[1][a[1].length - 1].created).slice(0, 30);

  const wallRatings = [];
  const wallTags = {};
  const failedTags = {};
  const speed = {};
  const upsolve = [];
  let contests = 0;
  let solvedTotal = 0;
  for (const [cid, subs] of recent) {
    const problems = db.all('SELECT pid, idx, name, rating, tags FROM problems WHERE contest_id = ?', cid).sort(byIdx);
    if (!problems.length) continue;
    const meta = db.get('SELECT name, start FROM cf_contests WHERE id = ?', cid) || {};
    contests++;
    const okAt = new Map();
    const tried = new Set();
    for (const s of subs) {
      tried.add(s.pid);
      if (s.verdict === 'OK' && !okAt.has(s.pid)) okAt.set(s.pid, s.rel_time ?? 0);
    }
    solvedTotal += okAt.size;
    let prev = 0;
    for (const [pid, t] of [...okAt.entries()].sort((a, b) => a[1] - b[1])) {
      const p = problems.find((x) => x.pid === pid);
      if (p && p.rating != null) (speed[p.rating] || (speed[p.rating] = [])).push(Math.max(1, (t - prev) / 60));
      prev = t;
    }
    for (const p of problems) {
      if (tried.has(p.pid) && !okAt.has(p.pid)) for (const t of parseTags(p.tags)) failedTags[t] = (failedTags[t] || 0) + 1;
    }
    const wall = problems.find((p) => !okAt.has(p.pid) && p.rating != null);
    if (wall) {
      wallRatings.push(wall.rating);
      for (const t of parseTags(wall.tags)) wallTags[t] = (wallTags[t] || 0) + 1;
      if (!everSolved.has(wall.pid) && !inGym.has(wall.pid) && !inQueue.has(wall.pid) && wall.rating <= level + 400 && upsolve.length < 8) {
        upsolve.push({ pid: wall.pid, name: wall.name, rating: wall.rating, contestName: meta.name || `Contest ${cid}`, start: meta.start || null });
      }
    }
  }
  const top = (o) => Object.entries(o).map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  const speedByRating = Object.entries(speed).map(([rating, xs]) => ({ rating: Number(rating), n: xs.length, minutes: Math.round(median(xs)) }))
    .filter((s) => s.n >= 2).sort((a, b) => a.rating - b.rating);
  return {
    solvedByRating, contests, avgSolved: contests ? Number((solvedTotal / contests).toFixed(1)) : null,
    wallMedian: wallRatings.length ? median(wallRatings) : null, wallTags: top(wallTags), failedTags: top(failedTags),
    speedByRating, upsolve,
    ratingHistory: db.all('SELECT t, new_rating AS rating, contest_name AS name FROM cf_rating_history ORDER BY t').map((r) => ({ t: r.t * 1000, rating: r.rating, name: r.name })),
  };
}

function insights(db, settings, now = Date.now()) {
  const sk = skill(db, settings);
  const level = Math.round(sk.level);
  const rows = db.all(`SELECT * FROM attempts WHERE status NOT IN ('active','abandoned')`);
  const counted = rows.filter((a) => a.score != null && a.rating != null);

  const byRatingMap = {};
  for (const a of counted) {
    const b = byRatingMap[a.rating] || (byRatingMap[a.rating] = { rating: a.rating, clean: 0, assisted: 0, failed: 0, parked: 0 });
    const o = outcomeOf(a);
    if (o === 'clean') b.clean++; else if (o === 'assisted') b.assisted++; else if (o === 'parked') b.parked++; else b.failed++;
  }
  const timeMap = {};
  for (const a of rows) {
    if (a.status !== 'solved' || a.hint_level >= 4 || a.mode === 'contest' || a.mode === 'idea' || a.rating == null) continue;
    const t = timeMap[a.rating] || (timeMap[a.rating] = { think: [], code: [] });
    t.think.push(a.think_ms / 60000);
    t.code.push(a.code_ms / 60000);
  }
  const mistakes = {};
  for (const a of rows) if (a.reflected && a.mistake && a.mistake !== 'none') mistakes[a.mistake] = (mistakes[a.mistake] || 0) + 1;

  const weekly = [];
  const thisWeek = startOfWeek(now);
  for (let i = 11; i >= 0; i--) {
    const from = startOfWeek(thisWeek - i * 7 * DAY + DAY); // +1 day guards against DST shifts
    const to = startOfWeek(from + 8 * DAY);
    const n = db.get(`SELECT COUNT(*) AS n FROM attempts WHERE status NOT IN ('active','abandoned') AND started_at >= ? AND started_at < ?`, from, to).n;
    weekly.push({ weekStart: from, minutes: activeMinutes(db, from, to), problems: n });
  }

  const focusRows = rows.filter((a) => a.mode !== 'contest');
  const thinkHours = focusRows.reduce((s, a) => s + a.think_ms, 0) / 3600000;
  const drifts = focusRows.reduce((s, a) => s + a.drifts, 0);

  const contests = db.all(`SELECT * FROM contest_runs WHERE status = 'finished' ORDER BY started_at`).map((c) => ({
    id: c.id, title: c.title, kind: c.kind, startedAt: c.started_at, solved: c.solved, perf: c.perf, penalty: c.penalty,
    total: db.get('SELECT COUNT(*) AS n FROM attempts WHERE contest_run_id = ?', c.id).n,
  }));

  return {
    level, base: settings.levelBase, target: settings.targetRating, attempts: counted.length,
    levelSeries: sk.history.map((h) => ({ t: h.t, level: h.level })),
    byRating: Object.values(byRatingMap).sort((a, b) => a.rating - b.rating),
    timeByRating: Object.entries(timeMap).map(([rating, t]) => ({ rating: Number(rating), n: t.think.length, think: Math.round(median(t.think)), code: Math.round(median(t.code)) })).sort((a, b) => a.rating - b.rating),
    topics: topicProfile(db, settings, sk),
    mistakes: Object.entries(mistakes).map(([id, n]) => ({ id, label: MISTAKES[id] || id, n })).sort((a, b) => b.n - a.n),
    weekly,
    focus: { thinkHours: Number(thinkHours.toFixed(1)), drifts, driftsPerHour: thinkHours > 0.2 ? Number((drifts / thinkHours).toFixed(1)) : null, stuckCheckins: focusRows.reduce((s, a) => s + a.stuck_checkins, 0) },
    contests,
    cf: cfAnalysis(db, settings, level, now),
  };
}

// The most frequent recent mistake and the latest lessons, shown before a new problem starts.
function reminder(db) {
  const rows = db.all(`SELECT mistake, takeaway, missed FROM attempts WHERE reflected = 1 ORDER BY ended_at DESC LIMIT 15`);
  const counts = {};
  for (const r of rows) if (r.mistake && r.mistake !== 'none') counts[r.mistake] = (counts[r.mistake] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const lessons = rows.map((r) => r.takeaway).filter((t) => t && t.trim()).slice(0, 2);
  if (!top && !lessons.length) return null;
  return { mistake: top && top[1] >= 2 ? { id: top[0], label: MISTAKES[top[0]] || top[0], n: top[1], of: rows.length } : null, lessons };
}

const mins = (ms) => Math.round((ms || 0) / 60000);

// Compact plain-text picture of the user for the coach.
function coachContext(db, settings, now = Date.now()) {
  const sk = skill(db, settings);
  const level = Math.round(sk.level);
  const cf = db.getSetting('cfUser', null);
  const lines = [];
  lines.push(`Gym level (Elo-style estimate from timed practice, Codeforces scale): ${level}. Starting estimate: ${settings.levelBase}. Counted attempts: ${sk.n}. Goal: ${settings.targetRating}.`);
  if (cf) lines.push(`Codeforces: handle ${cf.handle}, rating ${cf.rating ?? 'unrated'}, max ${cf.maxRating ?? '-'}, ${cf.contests ?? 0} rated contests.`);
  lines.push(`Preferences: ${settings.sessionMinutes} min per sitting, difficulty preset "${settings.difficulty}", stuck threshold ${settings.stuckMinutes} min.`);

  const since = now - 30 * DAY;
  const recent = db.all(`SELECT * FROM attempts WHERE status NOT IN ('active','abandoned') AND ended_at >= ? ORDER BY ended_at DESC`, since);
  if (recent.length) {
    const oc = {};
    for (const a of recent) oc[outcomeOf(a)] = (oc[outcomeOf(a)] || 0) + 1;
    lines.push(`Last 30 days: ${recent.length} attempts (${Object.entries(oc).map(([k, v]) => `${k} ${v}`).join(', ')}), ${activeMinutes(db, since, now + 1)} min trained.`);
  } else lines.push('Last 30 days: no attempts logged in the gym yet.');

  const topics = topicProfile(db, settings, sk);
  const withData = topics.filter((t) => t.attempts >= 2);
  if (withData.length) {
    lines.push('Topics in the gym (attempts, clean solves, topic level): ' + withData.sort((a, b) => (a.level ?? 9999) - (b.level ?? 9999)).slice(0, 12)
      .map((t) => `${t.tag} ${t.attempts}/${t.clean}/${t.level ?? '-'}`).join('; ') + '.');
  }
  const weak = [...topics].sort((a, b) => b.weakness - a.weakness).filter((t) => t.weakness > 0.15).slice(0, 6);
  if (weak.length) lines.push('Weakest topics by the model (gym deficit plus little at-level history on Codeforces): ' + weak.map((t) => `${t.tag} (${t.cfAtLevel} at-level solves on CF)`).join(', ') + '.');

  const ins = insights(db, settings, now);
  if (ins.mistakes.length) lines.push('Recurring mistakes from reflections: ' + ins.mistakes.slice(0, 5).map((m) => `${m.label} x${m.n}`).join('; ') + '.');
  if (ins.focus.driftsPerHour != null) lines.push(`Focus: ${ins.focus.driftsPerHour} self-reported drifts per thinking hour over ${ins.focus.thinkHours} h.`);
  if (ins.timeByRating.length) lines.push('Median time on solved practice problems (rating: think/code min): ' + ins.timeByRating.map((t) => `${t.rating}: ${t.think}/${t.code}`).join(', ') + '.');
  if (ins.contests.length) lines.push('Virtual contests in the gym: ' + ins.contests.slice(-5).map((c) => `${new Date(c.startedAt).toISOString().slice(0, 10)} solved ${c.solved}/${c.total}, performance ${c.perf ?? '-'}`).join('; ') + '.');
  if (ins.cf && ins.cf.contests) {
    lines.push(`Real Codeforces rounds (last ${ins.cf.contests}): ${ins.cf.avgSolved} problems solved on average; the first unsolved problem has median rating ${ins.cf.wallMedian ?? '-'}; its most common tags: ${ins.cf.wallTags.slice(0, 5).map((t) => `${t.tag} ${t.n}`).join(', ') || '-'}.`);
    if (ins.cf.speedByRating.length) lines.push('In-contest median minutes per solved problem by rating: ' + ins.cf.speedByRating.map((s) => `${s.rating}: ${s.minutes}`).join(', ') + '.');
  }

  const log = db.all(`SELECT * FROM attempts WHERE status NOT IN ('active','abandoned') ORDER BY ended_at DESC LIMIT 14`);
  if (log.length) {
    lines.push('Most recent attempts (newest first):');
    for (const a of log) {
      const parts = [`${a.rating ?? '?'} ${a.pid} "${a.name}"`, `[${parseTags(a.tags).join(', ')}]`, a.mode, outcomeOf(a)];
      if (a.mode !== 'contest') parts.push(`think ${mins(a.think_ms)}m code ${mins(a.code_ms)}m`);
      if (a.wrong_subs) parts.push(`${a.wrong_subs} wrong submissions`);
      if (a.mistake && a.mistake !== 'none') parts.push(`mistake: ${MISTAKES[a.mistake] || a.mistake}`);
      if (a.missed) parts.push(`missed: ${a.missed.slice(0, 220)}`);
      if (a.takeaway) parts.push(`lesson: ${a.takeaway.slice(0, 220)}`);
      lines.push('- ' + parts.join(' | '));
    }
  }
  return lines.join('\n');
}

module.exports = {
  CORE_TAGS, MISTAKES, parseTags, median, outcomeOf, summarize, countedAttempts, skill, topicProfile, queueItems,
  overview, insights, cfAnalysis, reminder, coachContext, byIdx, startOfWeek, startOfMonth,
};
