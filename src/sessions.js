'use strict';
// Attempt lifecycle: one problem, timed in phases (think, code), with the bookkeeping the insights need.
const { attemptScore, clamp } = require('./model');
const stats = require('./stats');

const DAY = 86400000;
// Gym contests (ids from 100000) are not in the problem set and have their own address.
const problemUrl = (contestId, index) => (contestId >= 100000
  ? `https://codeforces.com/gym/${contestId}/problem/${index}`
  : `https://codeforces.com/problemset/problem/${contestId}/${index}`);

class Sessions {
  constructor({ db, getSettings, emit = () => {}, now = () => Date.now() }) {
    this.db = db;
    this.getSettings = getSettings;
    this.emit = emit;
    this.now = now;
  }

  row(id) { return this.db.get('SELECT * FROM attempts WHERE id = ?', id); }
  activeRow() { return this.db.get(`SELECT * FROM attempts WHERE status = 'active' AND contest_run_id IS NULL ORDER BY id DESC LIMIT 1`); }
  active() { const a = this.activeRow(); return a ? this.view(a) : null; }

  // Tags are a spoiler (Um_nik, Errichto): they are only sent to the UI once the attempt is over.
  view(a) {
    if (!a) return null;
    const done = a.status !== 'active';
    return {
      id: a.id, pid: a.pid, contestId: a.contest_id, index: a.idx, name: a.name, rating: a.rating,
      url: problemUrl(a.contest_id, a.idx), mode: a.mode, origin: a.origin, status: a.status, outcome: stats.outcomeOf(a),
      phase: a.phase, resumePhase: a.resume_phase, startedAt: a.started_at, endedAt: a.ended_at, phaseStartedAt: a.phase_started_at,
      thinkMs: a.think_ms, codeMs: a.code_ms, pausedMs: a.paused_ms, progressMarkMs: a.progress_mark_ms, checkinMarkMs: a.checkin_mark_ms,
      wrongSubs: a.wrong_subs, hintLevel: a.hint_level, drifts: a.drifts, checkins: a.checkins, stuckCheckins: a.stuck_checkins,
      budgetMs: a.budget_ms, stuckMs: a.stuck_ms, levelAtStart: a.level_at_start, notes: a.notes,
      tags: done ? stats.parseTags(a.tags) : null, score: a.score, solvedAt: a.solved_at, manual: !!a.manual,
      keyIdea: a.key_idea, missed: a.missed, mistake: a.mistake, takeaway: a.takeaway, reflected: !!a.reflected,
      ideaVerdict: a.idea_verdict, contestRunId: a.contest_run_id, label: a.label,
    };
  }

  event(id, kind, data) {
    this.db.run('INSERT INTO attempt_events(attempt_id, t, kind, data) VALUES(?,?,?,?)', id, this.now(), kind, data ? JSON.stringify(data) : null);
  }

  settle(a, at) {
    const dt = Math.max(0, at - a.phase_started_at);
    if (a.phase === 'think') a.think_ms += dt;
    else if (a.phase === 'code') a.code_ms += dt;
    else if (a.phase === 'paused') a.paused_ms += dt;
    a.phase_started_at = at;
  }

  saveClock(a) {
    this.db.run(
      `UPDATE attempts SET phase = ?, resume_phase = ?, phase_started_at = ?, think_ms = ?, code_ms = ?, paused_ms = ?, heartbeat_at = ? WHERE id = ?`,
      a.phase, a.resume_phase, a.phase_started_at, a.think_ms, a.code_ms, a.paused_ms, this.now(), a.id);
  }

  activeMs(a, at) {
    return a.think_ms + a.code_ms + (a.phase === 'think' || a.phase === 'code' ? Math.max(0, at - a.phase_started_at) : 0);
  }

  mustBeActive(id) {
    const a = this.row(id);
    if (!a) throw new Error('That attempt no longer exists.');
    if (a.status !== 'active') throw new Error('That attempt is already finished.');
    return a;
  }

  start({ pid, mode = 'practice', origin = 'recommended', queueId = null }) {
    if (this.activeRow()) throw new Error('You already have a problem open. Finish or park it first.');
    if (this.db.get(`SELECT id FROM contest_runs WHERE status = 'active'`)) throw new Error('A contest is running. Finish it first.');
    const settings = this.getSettings();
    let queue = null;
    if (queueId) {
      queue = this.db.get('SELECT * FROM queue WHERE id = ? AND done_at IS NULL', queueId);
      if (!queue) throw new Error('That queue item is gone.');
      pid = queue.pid;
      mode = queue.kind === 'upsolve' ? 'upsolve' : queue.kind === 'redo' ? 'redo' : 'practice';
      origin = 'queue';
    }
    let p = this.db.get('SELECT * FROM problems WHERE pid = ?', pid);
    if (!p) {
      const m = /^(\d+)([A-Za-z]\d*)$/.exec(String(pid || ''));
      if (!m) throw new Error(`"${pid}" is not a Codeforces problem id (expected something like 1920C).`);
      p = { pid: `${m[1]}${m[2].toUpperCase()}`, contest_id: Number(m[1]), idx: m[2].toUpperCase(), name: `Problem ${m[1]}${m[2].toUpperCase()}`, rating: null, tags: '[]' };
    }
    const level = stats.skill(this.db, settings).level;
    const offset = p.rating != null ? p.rating - level : 0;
    const scale = clamp(1 + 0.25 * (offset / 100), 0.6, 2) * (mode === 'idea' ? 0.5 : mode === 'upsolve' ? 0.75 : 1);
    const budgetMs = Math.round(settings.budgetMinutes * scale) * 60000;
    const stuckMs = Math.round(settings.stuckMinutes * (offset >= 250 ? 1.6 : 1)) * 60000;
    const t = this.now();
    const id = this.db.insert(
      `INSERT INTO attempts(pid, contest_id, idx, name, rating, tags, mode, origin, queue_id, status, phase, started_at, phase_started_at,
                            heartbeat_at, budget_ms, stuck_ms, level_at_start)
       VALUES(?,?,?,?,?,?,?,?,?, 'active', 'think', ?, ?, ?, ?, ?, ?)`,
      p.pid, p.contest_id, p.idx, p.name, p.rating, p.tags || '[]', mode, origin, queueId, t, t, t, budgetMs, stuckMs, level);
    this.event(id, 'start', { mode, origin });
    return { attempt: this.view(this.row(id)), reminder: stats.reminder(this.db) };
  }

  setPhase(id, phase) {
    if (phase !== 'think' && phase !== 'code') throw new Error('Unknown phase.');
    const a = this.mustBeActive(id);
    if (a.phase === phase) return this.view(a);
    this.settle(a, this.now());
    a.phase = phase;
    a.resume_phase = null;
    this.saveClock(a);
    this.event(id, 'phase', { phase });
    return this.view(a);
  }

  pause(id) {
    const a = this.mustBeActive(id);
    if (a.phase === 'paused') return this.view(a);
    this.settle(a, this.now());
    a.resume_phase = a.phase;
    a.phase = 'paused';
    this.saveClock(a);
    this.event(id, 'pause');
    return this.view(a);
  }

  resume(id) {
    const a = this.mustBeActive(id);
    if (a.phase !== 'paused') return this.view(a);
    this.settle(a, this.now());
    a.phase = a.resume_phase || 'think';
    a.resume_phase = null;
    this.saveClock(a);
    this.event(id, 'resume');
    return this.view(a);
  }

  saveNotes(id, notes) {
    this.db.run('UPDATE attempts SET notes = ? WHERE id = ?', String(notes ?? ''), id);
    return true;
  }

  // A new idea is progress: it resets the stuck clock ("if you aren't out of ideas you aren't stuck").
  logIdea(id, text) {
    const a = this.mustBeActive(id);
    text = String(text || '').trim();
    if (!text) return this.view(a);
    const ms = this.activeMs(a, this.now());
    const stamp = `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    const notes = `${a.notes ? a.notes.replace(/\s+$/, '') + '\n' : ''}[${stamp}] ${text}\n`;
    this.db.run('UPDATE attempts SET notes = ?, progress_mark_ms = ?, checkin_mark_ms = ?, checkins = checkins + 1 WHERE id = ?', notes, ms, ms, id);
    this.event(id, 'idea', { text });
    return this.view(this.row(id));
  }

  checkin(id, type) {
    const a = this.mustBeActive(id);
    const ms = this.activeMs(a, this.now());
    if (type === 'drift') this.db.run('UPDATE attempts SET drifts = drifts + 1, checkin_mark_ms = ? WHERE id = ?', ms, id);
    else this.db.run('UPDATE attempts SET stuck_checkins = stuck_checkins + 1, checkin_mark_ms = ? WHERE id = ?', ms, id);
    this.event(id, type === 'drift' ? 'drift' : 'stuck');
    return this.view(this.row(id));
  }

  useHint(id, level) {
    const a = this.mustBeActive(id);
    level = clamp(Math.round(level), 1, 4);
    const ms = this.activeMs(a, this.now());
    this.db.run('UPDATE attempts SET hint_level = MAX(hint_level, ?), progress_mark_ms = ?, checkin_mark_ms = ? WHERE id = ?', level, ms, ms, id);
    this.event(id, 'hint', { level });
    return this.view(this.row(id));
  }

  queueAdd(a, kind, days, reason) {
    if (this.db.get('SELECT id FROM queue WHERE pid = ? AND kind = ? AND done_at IS NULL', a.pid, kind)) return;
    const t = this.now();
    this.db.run('INSERT INTO queue(pid, kind, due_at, reason, created_at, source_attempt_id) VALUES(?,?,?,?,?,?)', a.pid, kind, t + days * DAY, reason, t, a.id);
  }

  finish(id, { outcome, at, manual = false, ideaVerdict = null } = {}) {
    const a = this.row(id);
    if (!a) throw new Error('That attempt no longer exists.');
    if (a.status !== 'active') return this.view(a);
    if (!['solved', 'failed', 'parked', 'abandoned'].includes(outcome)) throw new Error('Unknown outcome.');
    const now = this.now();
    const t = clamp(at ?? now, a.phase_started_at, now);
    this.settle(a, t);
    a.status = outcome;
    a.phase = 'done';
    a.ended_at = t;
    a.idea_verdict = ideaVerdict;
    a.score = attemptScore(a);
    this.db.tx(() => {
      this.db.run(
        `UPDATE attempts SET status = ?, phase = 'done', resume_phase = NULL, phase_started_at = ?, ended_at = ?, think_ms = ?, code_ms = ?, paused_ms = ?,
                             solved_at = ?, score = ?, manual = ?, idea_verdict = ? WHERE id = ?`,
        outcome, t, t, a.think_ms, a.code_ms, a.paused_ms, outcome === 'solved' ? t : null, a.score, manual ? 1 : 0, ideaVerdict, id);
      this.event(id, 'finish', { outcome, manual });
      if (outcome === 'abandoned') return;
      if (a.queue_id) this.db.run('UPDATE queue SET done_at = ? WHERE id = ?', now, a.queue_id);
      if (outcome === 'parked') {
        this.queueAdd(a, 'parked', 30, 'Parked without spoilers. Come back with fresh eyes.');
      } else if (outcome === 'failed') {
        if (a.mode === 'redo') this.queueAdd(a, 'redo', 21, 'It did not stick yet. Try again in three weeks.');
        else this.queueAdd(a, 'upsolve', 0, a.mode === 'idea' ? 'Your idea missed. Implement the real solution.' : 'You read the solution. Implement it yourself.');
      } else if (outcome === 'solved') {
        if (a.mode === 'upsolve' || a.hint_level >= 3) this.queueAdd(a, 'redo', 14, 'Solved with heavy help. Re-solve it cold to check the idea stuck.');
        else if (a.mode === 'redo' && a.hint_level > 0) this.queueAdd(a, 'redo', 21, 'Needed a hint again. One more round in three weeks.');
      }
    });
    const view = this.view(this.row(id));
    this.emit('attempt', { id, status: outcome });
    return view;
  }

  reflect(id, { keyIdea, missed, mistake, takeaway }) {
    if (mistake && !(mistake in stats.MISTAKES)) mistake = null;
    this.db.run('UPDATE attempts SET key_idea = ?, missed = ?, mistake = ?, takeaway = ?, reflected = 1 WHERE id = ?',
      (keyIdea || '').trim(), (missed || '').trim(), mistake || 'none', (takeaway || '').trim(), id);
    return this.view(this.row(id));
  }

  // Manual correction from the journal (for example when the coach misjudged an idea drill).
  setResult(id, { status, hintLevel }) {
    const a = this.row(id);
    if (!a || a.status === 'active') throw new Error('Only finished attempts can be corrected.');
    if (!['solved', 'failed', 'parked'].includes(status)) throw new Error('Unknown result.');
    a.status = status;
    if (hintLevel != null) a.hint_level = clamp(Math.round(hintLevel), 0, 4);
    if (a.mode === 'idea') a.idea_verdict = status === 'solved' ? 'correct' : 'wrong';
    a.score = attemptScore(a);
    this.db.run('UPDATE attempts SET status = ?, hint_level = ?, idea_verdict = ?, score = ?, solved_at = ?, manual = 1 WHERE id = ?',
      a.status, a.hint_level, a.idea_verdict, a.score, status === 'solved' ? (a.solved_at || a.ended_at) : null, id);
    return this.view(this.row(id));
  }

  remove(id) {
    this.db.tx(() => {
      this.db.run('DELETE FROM attempt_events WHERE attempt_id = ?', id);
      this.db.run(`DELETE FROM chat_messages WHERE scope = 'attempt' AND scope_id = ?`, id);
      this.db.run('DELETE FROM queue WHERE source_attempt_id = ? AND done_at IS NULL', id);
      this.db.run('DELETE FROM attempts WHERE id = ?', id);
    });
    return true;
  }

  detail(id) {
    const a = this.row(id);
    if (!a) return null;
    const events = this.db.all('SELECT t, kind, data FROM attempt_events WHERE attempt_id = ? ORDER BY id', id)
      .map((e) => ({ t: e.t, kind: e.kind, data: e.data ? JSON.parse(e.data) : null }));
    return { ...this.view(a), events };
  }

  list({ limit = 60, offset = 0, outcome, mode, tag, q } = {}) {
    const where = [`status != 'active'`];
    const args = [];
    if (mode) { where.push('mode = ?'); args.push(mode); }
    if (tag) { where.push('tags LIKE ?'); args.push(`%"${tag}"%`); }
    if (q) {
      where.push('(name LIKE ? OR pid LIKE ? OR key_idea LIKE ? OR missed LIKE ? OR takeaway LIKE ? OR notes LIKE ?)');
      const like = `%${q}%`;
      args.push(like, like, like, like, like, like);
    }
    let rows = this.db.all(`SELECT * FROM attempts WHERE ${where.join(' AND ')} ORDER BY COALESCE(ended_at, started_at) DESC`, ...args).map(stats.summarize);
    if (outcome) rows = rows.filter((r) => r.outcome === outcome);
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }

  heartbeat() {
    this.db.run(`UPDATE attempts SET heartbeat_at = ? WHERE status = 'active' AND phase IN ('think','code')`, this.now());
  }

  // After a crash or a forced quit, do not count the downtime as thinking: pause at the last heartbeat.
  recover() {
    const now = this.now();
    for (const a of this.db.all(`SELECT * FROM attempts WHERE status = 'active' AND contest_run_id IS NULL AND phase IN ('think','code')`)) {
      const last = a.heartbeat_at || a.phase_started_at;
      if (now - last < 90000) continue;
      this.settle(a, Math.max(last, a.phase_started_at));
      a.resume_phase = a.phase;
      a.phase = 'paused';
      this.saveClock(a);
      this.event(a.id, 'pause', { reason: 'app closed' });
    }
  }
}

module.exports = { Sessions, problemUrl };
