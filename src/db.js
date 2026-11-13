'use strict';
// SQLite storage (node:sqlite, built into Node 22+/Electron 35+). One file, no native modules.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE problems (
    pid TEXT PRIMARY KEY, contest_id INTEGER NOT NULL, idx TEXT NOT NULL, name TEXT NOT NULL,
    rating INTEGER, tags TEXT NOT NULL DEFAULT '[]', solved_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX problems_rating ON problems(rating);
  CREATE INDEX problems_contest ON problems(contest_id);

  CREATE TABLE cf_contests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, start INTEGER, duration INTEGER, kind TEXT);

  CREATE TABLE cf_submissions (
    id INTEGER PRIMARY KEY, pid TEXT NOT NULL, contest_id INTEGER, idx TEXT, name TEXT, rating INTEGER, tags TEXT,
    verdict TEXT, created INTEGER NOT NULL, rel_time INTEGER, participant TEXT, lang TEXT, passed INTEGER
  );
  CREATE INDEX cf_sub_pid ON cf_submissions(pid);
  CREATE INDEX cf_sub_created ON cf_submissions(created);

  CREATE TABLE cf_rating_history (
    contest_id INTEGER PRIMARY KEY, contest_name TEXT, rank INTEGER, t INTEGER, old_rating INTEGER, new_rating INTEGER
  );

  CREATE TABLE attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL, contest_id INTEGER, idx TEXT, name TEXT NOT NULL, rating INTEGER, tags TEXT NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL, origin TEXT, contest_run_id INTEGER, label TEXT, queue_id INTEGER,
    status TEXT NOT NULL, phase TEXT NOT NULL, resume_phase TEXT,
    started_at INTEGER NOT NULL, ended_at INTEGER, phase_started_at INTEGER NOT NULL, heartbeat_at INTEGER,
    think_ms INTEGER NOT NULL DEFAULT 0, code_ms INTEGER NOT NULL DEFAULT 0, paused_ms INTEGER NOT NULL DEFAULT 0,
    progress_mark_ms INTEGER NOT NULL DEFAULT 0, checkin_mark_ms INTEGER NOT NULL DEFAULT 0,
    wrong_subs INTEGER NOT NULL DEFAULT 0, hint_level INTEGER NOT NULL DEFAULT 0, coach_msgs INTEGER NOT NULL DEFAULT 0,
    drifts INTEGER NOT NULL DEFAULT 0, checkins INTEGER NOT NULL DEFAULT 0, stuck_checkins INTEGER NOT NULL DEFAULT 0,
    budget_ms INTEGER, stuck_ms INTEGER, level_at_start REAL,
    score REAL, solved_at INTEGER, manual INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '', key_idea TEXT, missed TEXT, mistake TEXT, takeaway TEXT,
    reflected INTEGER NOT NULL DEFAULT 0, idea_verdict TEXT
  );
  CREATE INDEX attempts_pid ON attempts(pid);
  CREATE INDEX attempts_started ON attempts(started_at);
  CREATE INDEX attempts_run ON attempts(contest_run_id);

  CREATE TABLE attempt_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id INTEGER NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT
  );
  CREATE INDEX events_attempt ON attempt_events(attempt_id);

  CREATE TABLE contest_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, cf_contest_id INTEGER,
    duration_ms INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL,
    level_at_start REAL, perf REAL, solved INTEGER, penalty INTEGER, notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT NOT NULL, kind TEXT NOT NULL, due_at INTEGER NOT NULL,
    reason TEXT, created_at INTEGER NOT NULL, done_at INTEGER, source_attempt_id INTEGER
  );
  CREATE INDEX queue_open ON queue(done_at, due_at);

  CREATE TABLE statements (
    pid TEXT PRIMARY KEY, text TEXT NOT NULL, tutorial TEXT, tutorial_url TEXT, fetched_at INTEGER NOT NULL
  );
  CREATE TABLE analyses (pid TEXT PRIMARY KEY, content TEXT NOT NULL, model TEXT, grounded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);

  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, scope_id INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL, content TEXT NOT NULL, kind TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX chat_scope ON chat_messages(scope, scope_id);

  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, content TEXT NOT NULL, focus TEXT, applied INTEGER NOT NULL DEFAULT 0
  );
  `,
];

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class DB {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.stmts = new Map();
    this.migrate();
  }

  migrate() {
    const v = this.raw.prepare('PRAGMA user_version').get().user_version;
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[i]);
        this.raw.exec(`PRAGMA user_version = ${i + 1}`);
        this.raw.exec('COMMIT');
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      }
    }
  }

  stmt(sql) {
    let s = this.stmts.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }
  get(sql, ...p) { const r = this.stmt(sql).get(...p.map(norm)); return r ? { ...r } : undefined; }
  all(sql, ...p) { return this.stmt(sql).all(...p.map(norm)).map((r) => ({ ...r })); }
  run(sql, ...p) { return this.stmt(sql).run(...p.map(norm)); }
  insert(sql, ...p) { return Number(this.run(sql, ...p).lastInsertRowid); }

  tx(fn) {
    this.raw.exec('BEGIN');
    try { const r = fn(); this.raw.exec('COMMIT'); return r; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }

  getSetting(key, def) {
    const r = this.get('SELECT value FROM settings WHERE key = ?', key);
    if (!r) return def;
    try { return JSON.parse(r.value); } catch { return def; }
  }
  setSetting(key, value) {
    this.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  close() { this.stmts.clear(); this.raw.close(); }
}

const SETTING_DEFAULTS = {
  handle: '',
  onboarded: false,
  levelBase: 1500,        // starting level estimate; the gym moves it from here
  targetRating: 2000,
  difficulty: 'standard', // comfortable | standard | stretch
  weakFocus: true,        // bias problem selection toward weak topics (tags stay hidden)
  minYear: 2019,
  minSolved: 300,
  sessionMinutes: 60,     // time you usually have for one sitting
  budgetMinutes: 45,      // soft cap for a problem at your level (scaled by difficulty)
  stuckMinutes: 25,       // "stuck" = this long without a new idea (Errichto: 20-30 min)
  checkinMinutes: 10,     // focus check-in cadence while thinking (0 = off)
  contestMinutes: 120,
  contestProblems: 5,
  monthlyGoal: 30,        // problems solved per month, rated at your level or above
  coachModel: 'opus',     // default | opus | sonnet | haiku | fable
  claudePath: '',
  coachBackend: 'claude', // claude | local (an OpenAI-compatible server: llama-server, LM Studio, Ollama)
  localUrl: 'http://localhost:8080/v1',
  localModel: '',         // empty = whatever the server has loaded
  localApiKey: '',
  focusTags: [],
  focusUntil: 0,
  habit: '',              // the one thinking habit from the last coach review
  focusLayout: true,      // hide Codeforces chrome around the statement
  theme: 'light',         // light | cream | dark
};

function allSettings(db) {
  const out = { ...SETTING_DEFAULTS };
  for (const r of db.all('SELECT key, value FROM settings')) {
    if (!(r.key in SETTING_DEFAULTS)) continue;
    try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
  }
  return out;
}

function openDb(dir) {
  return new DB(dir === ':memory:' ? ':memory:' : path.join(dir, 'cpgym.db'));
}

module.exports = { DB, openDb, allSettings, SETTING_DEFAULTS };
