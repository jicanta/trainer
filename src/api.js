'use strict';
// The single surface the UI talks to. Every method takes one params object and returns plain data.
const fs = require('node:fs');
const path = require('node:path');
const { allSettings, SETTING_DEFAULTS } = require('./db');
const { syncProblems, syncUser } = require('./sync');
const recommend = require('./recommend');
const stats = require('./stats');
const { HINT_NAMES, HINT_SCORE, clamp } = require('./model');
const { MIX_OFFSETS, BANDS } = require('./recommend');

const NUMBERS = {
  levelBase: [800, 3500], targetRating: [800, 4000], minYear: [2010, 2100], minSolved: [0, 100000], sessionMinutes: [15, 480],
  budgetMinutes: [10, 240], stuckMinutes: [5, 120], checkinMinutes: [0, 60], contestMinutes: [20, 300], contestProblems: [4, 6],
  monthlyGoal: [1, 300], focusUntil: [0, Number.MAX_SAFE_INTEGER],
};
const CHOICES = { difficulty: Object.keys(BANDS), coachModel: ['default', 'opus', 'sonnet', 'haiku', 'fable'], coachBackend: ['claude', 'local'] };

function coerce(key, value) {
  if (key in NUMBERS) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`"${key}" must be a number.`);
    return clamp(Math.round(n), NUMBERS[key][0], NUMBERS[key][1]);
  }
  if (key in CHOICES) {
    if (!CHOICES[key].includes(value)) throw new Error(`"${value}" is not a valid choice for ${key}.`);
    return value;
  }
  if (typeof SETTING_DEFAULTS[key] === 'boolean') return !!value;
  if (Array.isArray(SETTING_DEFAULTS[key])) return Array.isArray(value) ? value.map(String) : [];
  return String(value ?? '').trim();
}

function createApi({ db, cf, sessions, contests, watcher, coach, emit, dataDir, version, sandbox, cfOrigin, openExternal, openPath }) {
  const settings = () => allSettings(db);
  const level = () => stats.skill(db, settings()).level;
  // Sync jobs run one after another; each caller gets its own result.
  let chain = Promise.resolve();
  const once = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };

  const api = {
    boot() {
      return {
        settings: settings(),
        user: db.getSetting('cfUser', null),
        problems: db.get('SELECT COUNT(*) AS n FROM problems').n,
        problemsSyncedAt: db.getSetting('problemsSyncedAt', 0),
        userSyncedAt: db.getSetting('userSyncedAt', 0),
        active: { attempt: sessions.active(), contest: contests.active() },
        coach: coach.status(),
        level: Math.round(level()),
        meta: {
          mistakes: stats.MISTAKES, tags: stats.CORE_TAGS, hintNames: HINT_NAMES, hintScore: HINT_SCORE, mixOffsets: MIX_OFFSETS,
          version, sandbox, dataDir, cfOrigin: cfOrigin || 'https://codeforces.com',
        },
      };
    },

    'settings.set'(patch) {
      for (const [k, v] of Object.entries(patch || {})) {
        if (k in SETTING_DEFAULTS) db.setSetting(k, coerce(k, v));
      }
      return settings();
    },

    // Looks a handle up on Codeforces and pulls its history. Used by onboarding and by "sync now".
    'sync.user'({ handle } = {}) {
      return once(async () => {
        const user = await syncUser(db, cf, handle || settings().handle, emit);
        db.setSetting('handle', user.handle);
        emit('synced', { what: 'user' });
        return user;
      });
    },
    'sync.problems'() {
      return once(async () => {
        const r = await syncProblems(db, cf, emit);
        emit('synced', { what: 'problems' });
        return r;
      });
    },
    'sync.all'() {
      return once(async () => {
        const out = { problems: await syncProblems(db, cf, emit) };
        if (settings().handle) out.user = await syncUser(db, cf, settings().handle, emit);
        emit('synced', { what: 'all' });
        return out;
      });
    },

    'practice.shortlist'(opts = {}) {
      const s = settings();
      const lv = level();
      return {
        level: Math.round(lv), difficulty: opts.difficulty || s.difficulty,
        items: recommend.shortlist(db, s, lv, { difficulty: opts.difficulty, topic: opts.topic || null, weakFocus: opts.weakFocus, n: opts.n }),
      };
    },
    'practice.lookup'({ text }) { return recommend.lookup(db, text); },
    'practice.fromRounds'() {
      const s = settings();
      const a = stats.cfAnalysis(db, s, level());
      return a ? a.upsolve : [];
    },

    'attempt.start'(p) { return sessions.start(p || {}); },
    'attempt.active'() { return sessions.active(); },
    'attempt.reminder'() { return stats.reminder(db); },
    'attempt.phase'({ id, phase }) { return sessions.setPhase(id, phase); },
    'attempt.pause'({ id }) { return sessions.pause(id); },
    'attempt.resume'({ id }) { return sessions.resume(id); },
    'attempt.notes'({ id, notes }) { return sessions.saveNotes(id, notes); },
    'attempt.idea'({ id, text }) { return sessions.logIdea(id, text); },
    'attempt.checkin'({ id, type }) { return sessions.checkin(id, type); },
    'attempt.finish'({ id, outcome }) {
      if (!['solved', 'failed', 'parked', 'abandoned'].includes(outcome)) throw new Error('Unknown outcome.');
      return sessions.finish(id, { outcome, manual: outcome === 'solved' });
    },
    'attempt.reflect'({ id, ...fields }) { return sessions.reflect(id, fields); },
    'attempt.get'({ id }) {
      const d = sessions.detail(id);
      if (!d) return null;
      return { ...d, chat: coach.history('attempt', id), levelNow: Math.round(level()) };
    },
    'attempt.list'(filters) { return sessions.list(filters || {}); },
    'attempt.setResult'({ id, status, hintLevel }) { return sessions.setResult(id, { status, hintLevel }); },
    'attempt.remove'({ id }) { return sessions.remove(id); },

    // The solve view reads the statement (and the official tutorial, when Codeforces has one) out of the
    // embedded page and stores it here, so the coach can be grounded in it.
    'statement.save'({ pid, text, tutorial, tutorialUrl, title }) {
      if (!pid || !text) return false;
      db.run(
        `INSERT INTO statements(pid, text, tutorial, tutorial_url, fetched_at) VALUES(?,?,?,?,?)
         ON CONFLICT(pid) DO UPDATE SET text = excluded.text, tutorial = COALESCE(excluded.tutorial, statements.tutorial),
           tutorial_url = COALESCE(excluded.tutorial_url, statements.tutorial_url), fetched_at = excluded.fetched_at`,
        pid, String(text).slice(0, 60000), tutorial ? String(tutorial).slice(0, 80000) : null, tutorialUrl || null, Date.now());
      if (title) db.run(`UPDATE attempts SET name = ? WHERE pid = ? AND name LIKE 'Problem %'`, String(title).slice(0, 200), pid);
      return true;
    },
    'statement.info'({ pid }) {
      const r = db.get('SELECT tutorial IS NOT NULL AS hasTutorial, tutorial_url, fetched_at FROM statements WHERE pid = ?', pid);
      return r ? { captured: true, hasTutorial: !!r.hasTutorial, tutorialUrl: r.tutorial_url } : { captured: false, hasTutorial: false, tutorialUrl: null };
    },

    'contest.plan'({ count } = {}) {
      const s = settings();
      const n = clamp(Math.round(count || s.contestProblems), 4, 6);
      const base = Math.round(level() / 100) * 100;
      return { level: Math.round(level()), ratings: MIX_OFFSETS[n].map((o) => clamp(base + o, 800, 3500)) };
    },
    'contest.start'(p) { return contests.start(p || {}); },
    'contest.active'() { return contests.active(); },
    'contest.focus'({ id, attemptId }) { return contests.focus(id, attemptId); },
    'contest.solved'({ attemptId }) { return contests.markSolved(attemptId, Date.now(), true); },
    'contest.finish'({ id }) { return contests.finish(id); },
    'contest.abort'({ id }) { return contests.abort(id); },
    'contest.notes'({ id, notes }) { return contests.saveNotes(id, notes); },
    'contest.get'({ id }) {
      const run = contests.get(id);
      return run ? { ...run, chat: coach.history('contest', id), levelNow: Math.round(level()) } : null;
    },
    'contest.list'() { return contests.list(); },
    'contest.remove'({ id }) { return contests.remove(id); },

    'stats.overview'() { return stats.overview(db, settings()); },
    'stats.insights'() { return stats.insights(db, settings()); },

    'queue.list'() { return stats.queueItems(db); },
    'queue.remove'({ id }) { db.run('UPDATE queue SET done_at = ? WHERE id = ? AND done_at IS NULL', Date.now(), id); return true; },
    'queue.add'({ pid, kind = 'redo', days = 0, reason }) {
      if (!['upsolve', 'redo', 'parked'].includes(kind)) throw new Error('Unknown queue kind.');
      if (db.get('SELECT id FROM queue WHERE pid = ? AND done_at IS NULL', pid)) return false;
      const t = Date.now();
      db.run('INSERT INTO queue(pid, kind, due_at, reason, created_at) VALUES(?,?,?,?,?)', pid, kind, t + days * 86400000, reason || 'Added by you.', t);
      return true;
    },

    'coach.status'() { return coach.status(); },
    'coach.testLocal'(p) { return coach.testLocal(p || {}); },
    'coach.history'({ scope, scopeId }) { return coach.history(scope, scopeId || 0); },
    'coach.attempt'(p) { return coach.sendAttempt(p); },
    'coach.general'(p) { return coach.sendGeneral(p); },
    'coach.contest'(p) { return coach.sendContest(p); },
    'coach.checkIdea'(p) { return coach.checkIdea(p); },
    'coach.draftReflection'(p) { return coach.draftReflection(p); },
    'coach.review'() { return coach.review(); },
    'coach.reviews'() { return coach.reviews(); },
    'coach.applyReview'({ id }) { coach.applyReview(id); return settings(); },
    'coach.cancel'({ jobId }) { return coach.cancel(jobId); },
    'coach.clear'({ scope, scopeId }) { return coach.clear(scope, scopeId || 0); },

    'watch.now'() { return watcher.tick(); },
    'watch.status'() { return watcher.last; },

    'data.export'() {
      const dump = {};
      for (const t of ['settings', 'attempts', 'attempt_events', 'contest_runs', 'queue', 'chat_messages', 'reviews']) dump[t] = db.all(`SELECT * FROM ${t}`);
      const file = path.join(dataDir, `cp-gym-export-${new Date().toISOString().slice(0, 10)}.json`);
      fs.writeFileSync(file, JSON.stringify(dump, null, 1));
      return { file };
    },
    'app.openExternal'({ url }) {
      if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only web links can be opened.');
      return openExternal ? openExternal(url) : false;
    },
    'app.openDataDir'() { return openPath ? openPath(dataDir) : false; },
  };
  return api;
}

module.exports = { createApi, coerce };
