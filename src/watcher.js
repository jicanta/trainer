'use strict';
// Watches the user's Codeforces submissions while a problem or contest is open,
// so verdicts land in the gym without any manual bookkeeping.
const { upsertSubmission } = require('./sync');

const WRONG = new Set([
  'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'IDLENESS_LIMIT_EXCEEDED',
  'PRESENTATION_ERROR', 'FAILED', 'PARTIAL', 'CHALLENGED', 'CRASHED', 'SECURITY_VIOLATED',
]);

class Watcher {
  constructor({ db, cf, getSettings, sessions, contests, emit = () => {}, intervalMs = 9000 }) {
    Object.assign(this, { db, cf, getSettings, sessions, contests, emit, intervalMs });
    this.busy = false;
    this.timer = null;
    this.last = { ok: true, at: 0, error: null, watching: 0 };
  }

  targets() {
    return this.db.all(`SELECT * FROM attempts WHERE status = 'active' AND mode != 'idea'`);
  }

  matches(a, s) {
    const p = s.problem || {};
    if (`${p.contestId}${p.index}` === a.pid) return true;
    // The same problem can live in two rounds (Div. 1 and Div. 2 twins): match by name too.
    return !!a.name && !/^Problem \d/.test(a.name) && p.name === a.name;
  }

  async tick() {
    if (this.busy) return this.last;
    const settings = this.getSettings();
    this.contests.checkDeadline();
    const targets = this.targets();
    if (!targets.length || !settings.handle) {
      this.last = { ok: true, at: Date.now(), error: null, watching: 0 };
      return this.last;
    }
    this.busy = true;
    try {
      const subs = await this.cf.userStatus(settings.handle, 1, 40);
      const known = new Set(this.db.all(
        `SELECT data FROM attempt_events WHERE kind = 'submission' AND attempt_id IN (${targets.map(() => '?').join(',')})`,
        ...targets.map((a) => a.id)).map((e) => JSON.parse(e.data).id));
      for (const s of [...subs].reverse()) {
        if (!s.verdict || s.verdict === 'TESTING' || known.has(s.id)) continue;
        const t = s.creationTimeSeconds * 1000;
        const a = targets.find((x) => this.matches(x, s) && t >= x.started_at - 2000);
        if (!a) continue;
        const fresh = this.db.get('SELECT * FROM attempts WHERE id = ?', a.id);
        if (!fresh || fresh.status !== 'active') continue;
        let run = null;
        if (a.contest_run_id) {
          run = this.db.get('SELECT * FROM contest_runs WHERE id = ?', a.contest_run_id);
          if (!run || run.status !== 'active' || t > run.started_at + run.duration_ms) continue;
        }
        upsertSubmission(this.db, s);
        this.db.run('INSERT INTO attempt_events(attempt_id, t, kind, data) VALUES(?,?,?,?)', a.id, t, 'submission',
          JSON.stringify({ id: s.id, verdict: s.verdict, passed: s.passedTestCount ?? null, lang: s.programmingLanguage ?? null }));
        known.add(s.id);
        if (s.verdict === 'OK') {
          if (run) this.contests.markSolved(a.id, t);
          else this.sessions.finish(a.id, { outcome: 'solved', at: t });
        } else if (WRONG.has(s.verdict)) {
          this.db.run('UPDATE attempts SET wrong_subs = wrong_subs + 1 WHERE id = ?', a.id);
        }
        this.emit('submission', { attemptId: a.id, contestRunId: a.contest_run_id || null, id: s.id, verdict: s.verdict, passed: s.passedTestCount ?? null, t });
      }
      this.last = { ok: true, at: Date.now(), error: null, watching: targets.length };
    } catch (e) {
      this.last = { ok: false, at: Date.now(), error: e.message, watching: targets.length };
    } finally {
      this.busy = false;
    }
    this.emit('watch', this.last);
    return this.last;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { Watcher, WRONG };
