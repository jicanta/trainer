'use strict';
// Virtual contests: 4-6 problems, a hard deadline, verdicts read from Codeforces, results fed back into the model.
const { performance } = require('./model');
const stats = require('./stats');
const { buildMix, buildRound } = require('./recommend');
const { problemUrl } = require('./sessions');

class Contests {
  constructor({ db, getSettings, emit = () => {}, now = () => Date.now(), rng = Math.random }) {
    this.db = db;
    this.getSettings = getSettings;
    this.emit = emit;
    this.now = now;
    this.rng = rng;
  }

  activeRun() { return this.db.get(`SELECT * FROM contest_runs WHERE status = 'active' ORDER BY id DESC LIMIT 1`); }
  active() { const r = this.activeRun(); return r ? this.view(r) : null; }
  attempts(runId) { return this.db.all('SELECT * FROM attempts WHERE contest_run_id = ? ORDER BY id', runId); }

  // While the contest runs, ratings and tags stay hidden, like in a real round.
  view(run) {
    if (!run) return null;
    const live = run.status === 'active';
    const problems = this.attempts(run.id).map((a) => ({
      attemptId: a.id, label: a.label, pid: a.pid, contestId: a.contest_id, index: a.idx, name: a.name, url: problemUrl(a.contest_id, a.idx),
      status: a.status, phase: a.phase, phaseStartedAt: a.phase_started_at, thinkMs: a.think_ms, wrongSubs: a.wrong_subs,
      solvedAt: a.solved_at, solvedMinute: a.solved_at ? Math.floor((a.solved_at - run.started_at) / 60000) : null,
      rating: live ? null : a.rating, tags: live ? null : stats.parseTags(a.tags), reflected: !!a.reflected,
    }));
    return {
      id: run.id, kind: run.kind, title: run.title, cfContestId: run.cf_contest_id, status: run.status,
      startedAt: run.started_at, durationMs: run.duration_ms, endsAt: run.started_at + run.duration_ms, endedAt: run.ended_at,
      levelAtStart: run.level_at_start, perf: run.perf, solved: run.solved, penalty: run.penalty, notes: run.notes, problems,
    };
  }

  start({ kind = 'mix', count, minutes } = {}) {
    if (this.activeRun()) throw new Error('A contest is already running.');
    if (this.db.get(`SELECT id FROM attempts WHERE status = 'active' AND contest_run_id IS NULL`)) throw new Error('You have a problem open. Finish or park it first.');
    const settings = this.getSettings();
    count = Math.min(6, Math.max(4, Math.round(count || settings.contestProblems || 5)));
    minutes = Math.min(300, Math.max(20, Math.round(minutes || settings.contestMinutes || 120)));
    const level = stats.skill(this.db, settings).level;
    let lineup = kind === 'round' ? buildRound(this.db, settings, level, count, this.rng, this.now()) : null;
    if (!lineup) lineup = buildMix(this.db, settings, level, count, this.rng);
    if (lineup.problems.length < 3) throw new Error('Not enough unseen problems for a contest. Sync the problem set or relax the filters in Settings.');
    const t = this.now();
    let runId;
    this.db.tx(() => {
      runId = this.db.insert(
        `INSERT INTO contest_runs(kind, title, cf_contest_id, duration_ms, started_at, status, level_at_start) VALUES(?,?,?,?,?, 'active', ?)`,
        lineup.kind, lineup.title, lineup.cfContestId, minutes * 60000, t, level);
      lineup.problems.forEach((p, i) => {
        this.db.run(
          `INSERT INTO attempts(pid, contest_id, idx, name, rating, tags, mode, origin, contest_run_id, label, status, phase, started_at,
                                phase_started_at, heartbeat_at, level_at_start)
           VALUES(?,?,?,?,?,?, 'contest', 'contest', ?, ?, 'active', ?, ?, ?, ?, ?)`,
          p.pid, p.contest_id, p.idx, p.name, p.rating, JSON.stringify(p.tags || []), runId, p.label, i === 0 ? 'think' : 'paused', t, t, t, level);
      });
    });
    return this.view(this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId));
  }

  settle(a, at) {
    if (a.phase === 'think') a.think_ms += Math.max(0, at - a.phase_started_at);
    a.phase_started_at = at;
  }

  // Time-on-problem: only the problem currently on screen accrues time.
  focus(runId, attemptId) {
    const run = this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId);
    if (!run || run.status !== 'active') return this.view(run);
    const t = this.now();
    for (const a of this.attempts(runId)) {
      if (a.status !== 'active') continue;
      const want = a.id === attemptId ? 'think' : 'paused';
      if (a.phase === want) continue;
      this.settle(a, t);
      this.db.run('UPDATE attempts SET phase = ?, phase_started_at = ?, think_ms = ? WHERE id = ?', want, t, a.think_ms, a.id);
    }
    return this.view(run);
  }

  markSolved(attemptId, at, manual = false) {
    const a = this.db.get('SELECT * FROM attempts WHERE id = ?', attemptId);
    if (!a || a.status !== 'active' || !a.contest_run_id) return null;
    const run = this.db.get('SELECT * FROM contest_runs WHERE id = ?', a.contest_run_id);
    if (!run || run.status !== 'active') return null;
    const t = Math.min(at ?? this.now(), run.started_at + run.duration_ms);
    this.settle(a, Math.max(t, a.phase_started_at));
    this.db.run(`UPDATE attempts SET status = 'solved', phase = 'done', think_ms = ?, solved_at = ?, ended_at = ?, score = 1, manual = ? WHERE id = ?`,
      a.think_ms, t, t, manual ? 1 : 0, a.id);
    this.emit('contest', { id: run.id, event: 'solved', attemptId: a.id });
    if (!this.attempts(run.id).some((x) => x.status === 'active')) return this.finish(run.id);
    return this.view(run);
  }

  finish(runId, { at } = {}) {
    const run = this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId);
    if (!run) throw new Error('That contest no longer exists.');
    if (run.status !== 'active') return this.view(run);
    const settings = this.getSettings();
    const end = Math.min(at ?? this.now(), run.started_at + run.duration_ms);
    const level = stats.skill(this.db, settings).level;
    this.db.tx(() => {
      for (const a of this.attempts(runId)) {
        if (a.status !== 'active') continue;
        this.settle(a, Math.max(end, a.phase_started_at));
        this.db.run(`UPDATE attempts SET status = 'failed', phase = 'done', think_ms = ?, ended_at = ?, score = 0 WHERE id = ?`, a.think_ms, end, a.id);
      }
      const rows = this.attempts(runId);
      const solved = rows.filter((a) => a.status === 'solved');
      const penalty = solved.reduce((s, a) => s + Math.floor((a.solved_at - run.started_at) / 60000) + 10 * a.wrong_subs, 0);
      const perf = performance(rows.map((a) => ({ rating: a.rating, solved: a.status === 'solved' })));
      this.db.run(`UPDATE contest_runs SET status = 'finished', ended_at = ?, perf = ?, solved = ?, penalty = ? WHERE id = ?`, end, perf, solved.length, penalty, runId);
      // Errichto: upsolve one or two more, not everything, and nothing far out of reach.
      const t = this.now();
      rows.filter((a) => a.status !== 'solved' && a.rating != null && a.rating <= level + 400)
        .sort((x, y) => x.rating - y.rating).slice(0, 2).forEach((a) => {
          if (this.db.get(`SELECT id FROM queue WHERE pid = ? AND done_at IS NULL`, a.pid)) return;
          this.db.run(`INSERT INTO queue(pid, kind, due_at, reason, created_at, source_attempt_id) VALUES(?, 'upsolve', ?, ?, ?, ?)`,
            a.pid, t, 'Unsolved in your contest. Upsolving it is how the next level becomes routine.', t, a.id);
        });
    });
    const view = this.view(this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId));
    this.emit('contest', { id: runId, event: 'finished' });
    return view;
  }

  abort(runId) {
    const run = this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId);
    if (!run || run.status !== 'active') return this.view(run);
    const t = this.now();
    this.db.tx(() => {
      this.db.run(`UPDATE attempts SET status = 'abandoned', phase = 'done', ended_at = ?, score = NULL WHERE contest_run_id = ?`, t, runId);
      this.db.run(`UPDATE contest_runs SET status = 'aborted', ended_at = ? WHERE id = ?`, t, runId);
    });
    this.emit('contest', { id: runId, event: 'aborted' });
    return this.view(this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId));
  }

  // Called on a timer and at startup: the clock keeps running even if the app was closed.
  checkDeadline() {
    const run = this.activeRun();
    if (run && this.now() >= run.started_at + run.duration_ms) return this.finish(run.id, { at: run.started_at + run.duration_ms });
    return null;
  }

  saveNotes(runId, notes) { this.db.run('UPDATE contest_runs SET notes = ? WHERE id = ?', String(notes ?? ''), runId); return true; }
  get(runId) { return this.view(this.db.get('SELECT * FROM contest_runs WHERE id = ?', runId)); }
  list() { return this.db.all(`SELECT * FROM contest_runs WHERE status != 'active' ORDER BY started_at DESC LIMIT 50`).map((r) => this.view(r)); }

  remove(runId) {
    this.db.tx(() => {
      const ids = this.attempts(runId).map((a) => a.id);
      for (const id of ids) {
        this.db.run('DELETE FROM attempt_events WHERE attempt_id = ?', id);
        this.db.run('DELETE FROM queue WHERE source_attempt_id = ? AND done_at IS NULL', id);
      }
      this.db.run('DELETE FROM attempts WHERE contest_run_id = ?', runId);
      this.db.run(`DELETE FROM chat_messages WHERE scope = 'contest' AND scope_id = ?`, runId);
      this.db.run('DELETE FROM contest_runs WHERE id = ?', runId);
    });
    return true;
  }
}

module.exports = { Contests };
