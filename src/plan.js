'use strict';
// The weekly plan. A rule-based planner turns the time you have each day into concrete blocks
// (practice, idea drills, upsolves, re-solves, contests, real Codeforces rounds), using what the log
// says about you. Progress is never typed in: it is read back from the attempts and contests you finish.
// Past days are frozen; today and the rest of the week are rebuilt once a day, so the plan follows you.
const stats = require('./stats');
const { clamp } = require('./model');
const { contestKind } = require('./sync');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LADDER = ['comfortable', 'standard', 'stretch'];
const IDEA_MISTAKES = new Set(['no_idea', 'not_recognized', 'wrong_path']);
const CODE_MISTAKES = new Set(['bug', 'edge_case', 'complexity', 'slow']);

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const keyStart = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }; // DST-safe
const weekdayIdx = (ts) => (new Date(ts).getDay() + 6) % 7; // Monday = 0
const stepDifficulty = (d, by) => LADDER[clamp(LADDER.indexOf(d) + by, 0, LADDER.length - 1)];

// Which Codeforces divisions are rated for someone at this rating.
function ratedFor(kind, rating) {
  if (kind === 'div4') return rating < 1400;
  if (kind === 'div3') return rating < 1600;
  if (kind === 'div2' || kind === 'edu') return rating < 2100;
  if (kind === 'div1+2') return true;
  if (kind === 'div1') return rating >= 1900;
  return false;
}

const BAND_TEXT = {
  comfortable: 'from 100 below to 200 above your level',
  standard: 'from your level to 300 above',
  stretch: 'from 100 to 400 above your level',
};

class Plan {
  constructor({ db, getSettings, cf = null, now = () => Date.now() }) {
    Object.assign(this, { db, getSettings, cf, now });
  }

  // Upcoming rounds come from contest.list (the API, never the website). At most twice a day.
  async refreshRounds({ force = false } = {}) {
    const s = this.getSettings();
    if (!this.cf || !s.planRounds) return false;
    if (!force && this.now() - this.db.getSetting('roundsCheckedAt', 0) < 12 * HOUR) return false;
    try {
      const list = await this.cf.contestList();
      this.db.tx(() => {
        for (const c of list) {
          if (c.phase !== 'BEFORE') continue;
          this.db.run(
            `INSERT INTO cf_contests(id, name, start, duration, kind) VALUES(?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, start=excluded.start, duration=excluded.duration, kind=excluded.kind`,
            c.id, c.name, c.startTimeSeconds ?? null, c.durationSeconds ?? null, contestKind(c.name));
        }
      });
      this.db.setSetting('roundsCheckedAt', this.now());
      return true;
    } catch { return false; } // offline: plan without rounds
  }

  // ---------- what the log says ----------

  profile() {
    const s = this.getSettings();
    const now = this.now();
    const sk = stats.skill(this.db, s);
    const level = Math.round(sk.level);
    const times = this.db.all(
      `SELECT think_ms + code_ms AS ms FROM attempts WHERE status = 'solved' AND mode = 'practice' AND contest_run_id IS NULL
       AND hint_level < 4 AND ended_at >= ? AND rating IS NOT NULL AND rating >= ?`, now - 60 * DAY, level - 100)
      .map((r) => r.ms / 60000).filter((m) => m >= 3);
    const measured = times.length >= 3;
    const perProblem = clamp(Math.round((measured ? stats.median(times) : s.budgetMinutes) + 5), 25, 80);
    const perIdea = clamp(Math.round(perProblem * 0.45), 15, 35);

    const recent = this.db.all(
      `SELECT status, hint_level FROM attempts WHERE mode = 'practice' AND contest_run_id IS NULL AND status IN ('solved','failed','parked')
       AND ended_at >= ? AND rating IS NOT NULL AND rating >= COALESCE(level_at_start, ?) - 50`, now - 14 * DAY, level);
    const cleanRate = recent.length >= 4 ? recent.filter((r) => r.status === 'solved' && r.hint_level === 0).length / recent.length : null;

    const rem = stats.reminder(this.db);
    const mistake = rem && rem.mistake ? rem.mistake : null;

    const focusRows = this.db.get(
      `SELECT COALESCE(SUM(think_ms), 0) AS ms, COALESCE(SUM(drifts), 0) AS d FROM attempts
       WHERE mode != 'contest' AND status NOT IN ('active','abandoned') AND ended_at >= ?`, now - 30 * DAY);
    const thinkHours = focusRows.ms / HOUR;
    const driftsPerHour = thinkHours >= 1 ? focusRows.d / thinkHours : null;

    let topic = null;
    if (s.focusUntil > now && (s.focusTags || []).length) topic = { tag: s.focusTags[0], why: 'your last coach review put weight on it' };
    else {
      const weakest = stats.topicProfile(this.db, s, sk).sort((a, b) => b.weakness - a.weakness)[0];
      if (weakest && weakest.weakness >= 0.45) topic = { tag: weakest.tag, why: 'it is your weakest topic for your level' };
    }

    const cf = this.db.getSetting('cfUser', null);
    return { level, cfRating: cf && cf.rating != null ? cf.rating : level, perProblem, perIdea, measured, cleanRate, attempts14: recent.length, mistake, driftsPerHour, topic };
  }

  // ---------- building ----------

  weekOf(ts) {
    const start = stats.startOfWeek(ts);
    return { key: dayKey(start), start, days: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i)) };
  }

  storedDays(weekKey) {
    const out = new Map();
    for (const r of this.db.all('SELECT * FROM plan_days WHERE week = ?', weekKey)) out.set(r.day, { ...r, blocks: JSON.parse(r.blocks || '[]') });
    return out;
  }

  upcomingRounds(from, to, rating) {
    return this.db.all('SELECT id, name, start, duration, kind FROM cf_contests WHERE start >= ? AND start < ? ORDER BY start', Math.floor(from / 1000), Math.floor(to / 1000))
      .filter((c) => ratedFor(c.kind, rating));
  }

  // Builds today and every later day of this week. Earlier days keep what they had.
  build({ reason = 'auto' } = {}) {
    const s = this.getSettings();
    const now = this.now();
    const today = dayStart(now);
    const week = this.weekOf(now);
    const stored = this.storedDays(week.key);
    const p = this.profile();
    const notes = [];
    const days = week.days.filter((d) => d >= today);
    const minutesOf = (d) => {
      const row = stored.get(dayKey(d));
      return row && row.override ? row.minutes : clamp(Math.round(Number((s.planMinutes || [])[weekdayIdx(d)]) || 0), 0, 480);
    };

    // Last week decides how much of the available time to fill.
    const last = this.weekMetrics(this.weekOf(addDays(week.start, -3)).key);
    let scale = 1;
    if (last && last.planned >= 30) {
      if (last.adherence < 0.5) scale = 0.75;
      else if (last.adherence < 0.75) scale = 0.9;
      if (scale < 1) notes.push(`Last week you finished ${Math.round(last.adherence * 100)}% of the plan, so this one fills ${Math.round(scale * 100)}% of your time. A plan you finish beats a plan you skip.`);
      else notes.push(`Last week you finished ${Math.round(last.adherence * 100)}% of the plan. Same load this week.`);
    }

    // Difficulty follows the clean-solve rate at your level (the "interesting interval" is narrow).
    let difficulty = LADDER.includes(s.difficulty) ? s.difficulty : 'standard';
    if (p.cleanRate != null && p.cleanRate >= 0.6 && difficulty !== 'stretch') {
      difficulty = stepDifficulty(difficulty, 1);
      notes.push(`You solved ${Math.round(p.cleanRate * 100)}% of your last ${p.attempts14} problems at your level without hints: practice moves up to ${difficulty}.`);
    } else if (p.cleanRate != null && p.cleanRate <= 0.25 && difficulty !== 'comfortable') {
      difficulty = stepDifficulty(difficulty, -1);
      notes.push(`Only ${Math.round(p.cleanRate * 100)}% of your last ${p.attempts14} problems at your level were clean solves: practice steps down to ${difficulty} until that rises.`);
    }
    notes.push(p.measured
      ? `A practice problem takes you about ${p.perProblem} minutes including the reflection, measured from your recent solves.`
      : `Planned at about ${p.perProblem} minutes per problem until the gym has measured your own pace.`);

    const ideaHeavy = p.mistake && IDEA_MISTAKES.has(p.mistake.id);
    const codeHeavy = p.mistake && CODE_MISTAKES.has(p.mistake.id);
    if (ideaHeavy) notes.push(`Your most frequent miss lately is "${p.mistake.label.toLowerCase()}", so a few days start with an idea drill: the observation step, without the coding.`);
    if (codeHeavy) notes.push(`Your most frequent miss lately is "${p.mistake.label.toLowerCase()}", so the plan favors full solves with coding over idea drills.`);
    if ((p.mistake && p.mistake.id === 'focus') || (p.driftsPerHour != null && p.driftsPerHour >= 3)) notes.push('Focus is a recurring issue: one problem per sitting, phone in another room, and a short break between blocks.');

    // Contests. Solving fast is its own skill (Um_nik); real rounds count first.
    const C = s.contestMinutes;
    const totalMin = days.reduce((a, d) => a + minutesOf(d), 0);
    const weekFrom = week.start;
    const doneBefore = this.db.get(`SELECT COUNT(*) AS n FROM contest_runs WHERE status = 'finished' AND started_at >= ? AND started_at < ?`, weekFrom, today).n
      + this.db.get(`SELECT COUNT(DISTINCT contest_id) AS n FROM cf_submissions WHERE participant = 'CONTESTANT' AND created >= ? AND created < ?`, Math.floor(weekFrom / 1000), Math.floor(today / 1000)).n;
    let wanted = totalMin >= 5 * C || (codeHeavy && p.mistake.id === 'slow' && totalMin >= 3.5 * C) ? 2 : totalMin >= 2 * C ? 1 : 0;
    wanted = Math.max(0, wanted - doneBefore);

    const plan = new Map(days.map((d) => [d, { minutes: minutesOf(d), blocks: [], left: minutesOf(d) }]));
    const contestDays = [];
    if (s.planRounds) {
      for (const d of days) {
        const r = this.upcomingRounds(Math.max(d, now - 2 * HOUR), addDays(d, 1), p.cfRating)[0];
        if (!r) continue;
        const day = plan.get(d);
        const dur = Math.round((r.duration || 7200) / 60);
        const fits = day.minutes >= dur * 0.9 && wanted > 0;
        day.blocks.push({ kind: 'round', n: 1, minutes: dur, contestId: r.id, name: r.name, startAt: r.start * 1000, optional: !fits,
          why: fits ? 'A rated round: the real thing beats a virtual one.' : 'Rated for you, but longer than the time you set for this day. Optional.' });
        if (fits) { day.left -= dur; wanted--; contestDays.push(d); }
      }
    }
    if (wanted > 0) {
      const far = (d) => contestDays.every((c) => Math.abs(Math.round((c - d) / DAY)) >= 2);
      const cands = days.filter((d) => plan.get(d).left >= C && !plan.get(d).blocks.length).sort((a, b) => plan.get(b).left - plan.get(a).left || b - a);
      for (const d of cands) {
        if (wanted <= 0) break;
        if (!far(d)) continue;
        const day = plan.get(d);
        day.blocks.push({ kind: 'contest', n: 1, minutes: C, why: 'Speed and pacing under a clock. Choose a ladder you are not sure to sweep.' });
        day.left -= C;
        contestDays.push(d);
        wanted--;
      }
    }

    // Upsolves: the day after a contest, and whatever is waiting in the queue.
    const queue = stats.queueItems(this.db, now);
    const ups = queue.filter((q) => q.kind === 'upsolve');
    const res = queue.filter((q) => q.kind !== 'upsolve');
    let upIdx = 0;
    let resIdx = 0;
    const days2 = [...plan.keys()];
    for (const d of days2) {
      const day = plan.get(d);
      if (!day.minutes) continue;
      const cost = Math.round(p.perProblem * 0.75);
      const eff = () => day.left - day.minutes * (1 - scale); // the part of the day the plan may fill
      const after = contestDays.includes(addDays(d, -1));
      let n = 0;
      if (after) n = 2;
      else {
        while (upIdx < ups.length && ups[upIdx].dueAt < addDays(d, 1) && n < 2 && eff() >= cost * (n + 1) * 0.9) { n++; upIdx++; }
      }
      n = Math.min(n, Math.max(after ? 1 : 0, Math.floor(eff() / cost + 0.2)));
      if (n > 0) {
        day.blocks.push({ kind: 'upsolve', n, minutes: n * cost, why: after ? 'The day after a contest: upsolve one or two problems you missed, not the hardest ones.' : 'You have seen how these are solved. Implement them yourself before anything new.' });
        day.left -= n * cost;
      }
      const rcost = Math.round(p.perProblem * 0.8);
      if (resIdx < res.length && res[resIdx].dueAt < addDays(d, 1) && eff() >= rcost * 0.9) {
        const q = res[resIdx++];
        day.blocks.push({ kind: 'resolve', n: 1, minutes: rcost, why: q.kind === 'redo' ? 'A cold re-solve: check that the idea stuck.' : 'A parked problem is due: fresh eyes.' });
        day.left -= rcost;
      }
    }

    // One deliberate topic block a week, on the longest free day.
    if (p.topic) {
      const d = days2.filter((x) => !contestDays.includes(x) && plan.get(x).left - plan.get(x).minutes * (1 - scale) >= p.perProblem * 1.8).sort((a, b) => plan.get(b).left - plan.get(a).left)[0];
      if (d) {
        const day = plan.get(d);
        day.blocks.push({ kind: 'topic', n: 2, minutes: 2 * p.perProblem, topic: p.topic.tag, why: `A short deliberate block on ${p.topic.tag}, because ${p.topic.why}. The rest of the week stays mixed.` });
        day.left -= 2 * p.perProblem;
      }
    }

    // Fill the rest. The longest practice day reaches higher: a challenge, not routine (Radewoosh).
    let ideaDays = 0;
    for (const d of days2) {
      const day = plan.get(d);
      let left = day.left - day.minutes * (1 - scale);
      if (!day.minutes || left < p.perIdea * 0.8) continue;
      if (day.minutes <= 35 && !day.blocks.length) {
        const n = Math.max(1, Math.floor(left / p.perIdea));
        day.blocks.push({ kind: 'idea', n, minutes: n * p.perIdea, why: 'Short on time: think a problem through to a full solution, skip the coding.' });
        continue;
      }
      if (ideaHeavy && ideaDays < 3 && left >= p.perProblem + p.perIdea) {
        day.blocks.push({ kind: 'idea', n: 1, minutes: p.perIdea, why: 'Warm-up for the observation step that has been costing you problems.' });
        left -= p.perIdea;
        ideaDays++;
      }
      const n = Math.min(6, Math.floor(left / p.perProblem + 0.1));
      if (n >= 1) {
        day.blocks.push({ kind: 'practice', n, minutes: n * p.perProblem, difficulty });
        const rest = left - n * p.perProblem;
        if (!codeHeavy && rest >= p.perIdea * 0.8) day.blocks.push({ kind: 'idea', n: 1, minutes: p.perIdea, last: true, why: 'For the time left over.' });
      } else if (!codeHeavy || !day.blocks.length) {
        const k = Math.floor(left / p.perIdea);
        if (k >= 1) day.blocks.push({ kind: 'idea', n: k, minutes: k * p.perIdea, why: 'Not enough time for a full solve: an idea drill instead.' });
      }
    }
    const practiceDays = days2.filter((d) => plan.get(d).blocks.some((b) => b.kind === 'practice') && !contestDays.includes(d));
    const longest = practiceDays.sort((a, b) => plan.get(b).minutes - plan.get(a).minutes)[0];
    if (longest && difficulty !== 'stretch') {
      const b = plan.get(longest).blocks.find((x) => x.kind === 'practice');
      b.difficulty = stepDifficulty(difficulty, 1);
      b.why = 'Challenge day: one step above your usual band.';
    }

    // Keep manual check marks on today's blocks when today is rebuilt.
    const oldToday = stored.get(dayKey(today));
    const ORDER = { round: 0, contest: 1, upsolve: 2, resolve: 3, idea: 4, topic: 5, practice: 6 };
    this.db.tx(() => {
      for (const [d, day] of plan) {
        const rank = (b) => (b.last ? 9 : ORDER[b.kind]);
        const blocks = day.blocks.sort((a, b) => (rank(a) - rank(b)) || (a.startAt || 0) - (b.startAt || 0));
        if (d === today && oldToday) {
          for (const b of blocks) {
            const o = oldToday.blocks.find((x) => x.kind === b.kind && (x.contestId || null) === (b.contestId || null) && x.manual);
            if (o) b.manual = true;
          }
        }
        const k = dayKey(d);
        const row = stored.get(k);
        this.db.run(
          `INSERT INTO plan_days(day, week, minutes, override, blocks) VALUES(?,?,?,?,?)
           ON CONFLICT(day) DO UPDATE SET minutes = excluded.minutes, override = excluded.override, blocks = excluded.blocks`,
          k, week.key, day.minutes, row && row.override ? 1 : 0, JSON.stringify(blocks));
      }
      const prof = { ...p, difficulty, scale, notes, reason, builtAt: now, seenQueue: queue.map((q) => q.id) };
      this.db.run(
        `INSERT INTO plan_weeks(week, created_at, built_day, profile) VALUES(?,?,?,?)
         ON CONFLICT(week) DO UPDATE SET built_day = excluded.built_day, profile = excluded.profile`,
        week.key, now, dayKey(today), JSON.stringify(prof));
    });
  }

  // Builds when the week has no plan yet, when it was last built on an earlier day, or when something
  // new landed in the queue (a fresh upsolve belongs in today's plan, not tomorrow's).
  ensure() {
    const week = this.weekOf(this.now());
    const w = this.db.get('SELECT built_day, profile FROM plan_weeks WHERE week = ?', week.key);
    if (!w) return this.build({ reason: 'new week' });
    if (w.built_day !== dayKey(this.now())) return this.build({ reason: 'new day' });
    const seen = new Set(JSON.parse(w.profile || '{}').seenQueue || []);
    if (stats.queueItems(this.db, this.now()).some((q) => q.due && !seen.has(q.id))) this.build({ reason: 'queue changed' });
  }

  // ---------- progress ----------

  // Matches what you did on one day to that day's blocks.
  dayProgress(key, blocks) {
    const from = keyStart(key);
    const to = addDays(from, 1);
    const rows = this.db.all(
      `SELECT mode, origin, tags, status, hint_level, rating, level_at_start FROM attempts WHERE contest_run_id IS NULL
       AND status IN ('solved','failed','parked') AND ended_at >= ? AND ended_at < ?`, from, to)
      .map((a) => ({ ...a, tags: stats.parseTags(a.tags) }));
    const pools = {
      upsolve: rows.filter((a) => a.mode === 'upsolve' || a.origin === 'cf-round'),
      resolve: rows.filter((a) => a.mode === 'redo' || (a.mode === 'practice' && a.origin === 'queue')),
      idea: rows.filter((a) => a.mode === 'idea'),
      practice: rows.filter((a) => a.mode === 'practice' && a.origin !== 'queue' && a.origin !== 'cf-round'),
    };
    let contests = this.db.get(`SELECT COUNT(*) AS n FROM contest_runs WHERE status = 'finished' AND started_at >= ? AND started_at < ?`, from, to).n;
    const take = (pool, n, pred = () => true) => {
      let got = 0;
      for (let i = 0; i < pool.length && got < n;) { if (pred(pool[i])) { pool.splice(i, 1); got++; } else i++; }
      return got;
    };
    // Topic blocks take their matching problems first, then plain practice takes the rest.
    const done = blocks.map(() => 0);
    blocks.forEach((b, i) => { if (b.kind === 'topic') done[i] = take(pools.practice, b.n, (a) => a.tags.includes(b.topic)); });
    blocks.forEach((b, i) => {
      if (b.kind === 'topic') return;
      if (b.kind === 'practice') done[i] = take(pools.practice, b.n);
      else if (b.kind === 'upsolve' || b.kind === 'resolve' || b.kind === 'idea') done[i] = take(pools[b.kind], b.n);
      else if (b.kind === 'contest') { done[i] = Math.min(b.n, contests); contests -= done[i]; }
      else if (b.kind === 'round') done[i] = this.db.get(`SELECT COUNT(*) AS n FROM cf_submissions WHERE contest_id = ? AND participant = 'CONTESTANT'`, b.contestId).n ? 1 : 0;
      if (b.manual) done[i] = b.n;
    });
    const extra = pools.practice.length + pools.idea.length + pools.upsolve.length + pools.resolve.length + Math.max(0, contests);
    const counted = rows.filter((a) => a.status === 'solved' && a.hint_level < 4 && a.mode !== 'upsolve' && a.rating != null && a.rating >= (a.level_at_start ?? 0) - 100).length;
    return { done, extra, solvedAtLevel: counted, trained: stats.activeMinutes(this.db, from, to) };
  }

  dayView(key, row, todayKey) {
    const blocks = row ? row.blocks : [];
    const pr = this.dayProgress(key, blocks);
    let planned = 0;
    let doneMin = 0;
    const out = blocks.map((b, i) => {
      const d = Math.min(b.n, pr.done[i]);
      if (!b.optional) { planned += b.minutes; doneMin += b.minutes * (d / b.n); }
      return { ...b, index: i, done: d, complete: d >= b.n, ...describe(b) };
    });
    const ratio = planned ? doneMin / planned : 0;
    const past = key < todayKey;
    let status;
    if (!row) status = past ? 'none' : 'upcoming';
    else if (!planned) status = 'rest';
    else if (ratio >= 0.999) status = 'done';
    else if (key === todayKey) status = 'today';
    else if (past) status = ratio > 0 ? 'partial' : 'missed';
    else status = 'upcoming';
    const ts = keyStart(key);
    return {
      key, date: ts, weekday: WEEKDAYS[weekdayIdx(ts)], minutes: row ? row.minutes : 0, override: !!(row && row.override),
      blocks: out, planned, doneMinutes: Math.round(doneMin), ratio, status, extra: pr.extra, trained: pr.trained, solvedAtLevel: pr.solvedAtLevel,
      isToday: key === todayKey, isPast: past,
    };
  }

  // Adherence: planned minutes you actually covered, over planned minutes, for days up to today.
  weekMetrics(weekKey) {
    const stored = this.storedDays(weekKey);
    if (!stored.size) return null;
    const todayKey = dayKey(this.now());
    let planned = 0;
    let done = 0;
    let trained = 0;
    for (const [k, row] of stored) {
      if (k > todayKey) continue;
      const v = this.dayView(k, row, todayKey);
      if (k === todayKey && v.status !== 'done') { done += v.doneMinutes; planned += v.doneMinutes; trained += v.trained; continue; }
      planned += v.planned;
      done += v.doneMinutes;
      trained += v.trained;
    }
    return { week: weekKey, planned, done, trained, adherence: planned ? done / planned : 0 };
  }

  streak() {
    const todayKey = dayKey(this.now());
    let n = 0;
    let d = dayStart(this.now());
    for (let i = 0; i < 120; i++, d = addDays(d, -1)) {
      const k = dayKey(d);
      const row = this.db.get('SELECT * FROM plan_days WHERE day = ?', k);
      if (!row) break;
      const v = this.dayView(k, { ...row, blocks: JSON.parse(row.blocks || '[]') }, todayKey);
      if (v.status === 'rest') continue;
      if (v.status === 'done') { n++; continue; }
      if (k === todayKey) continue; // today is not over yet
      break;
    }
    return n;
  }

  view() {
    this.ensure();
    const now = this.now();
    const week = this.weekOf(now);
    const todayKey = dayKey(now);
    const stored = this.storedDays(week.key);
    const days = week.days.map((d) => this.dayView(dayKey(d), stored.get(dayKey(d)) || null, todayKey));
    const w = this.db.get('SELECT * FROM plan_weeks WHERE week = ?', week.key);
    const m = this.weekMetrics(week.key) || { planned: 0, done: 0, trained: 0, adherence: 0 };
    const weekPlanned = days.reduce((a, d) => a + d.planned, 0);

    const history = this.db.all('SELECT week FROM plan_weeks WHERE week <= ? ORDER BY week DESC LIMIT 8', week.key)
      .map((r) => this.weekMetrics(r.week)).filter(Boolean).reverse();

    const s = this.getSettings();
    const sk = stats.skill(this.db, s);
    const before = sk.history.filter((h) => h.t < week.start).pop();
    return {
      week: { key: week.key, start: week.start, end: addDays(week.start, 7) },
      today: todayKey, days, todayView: days.find((d) => d.isToday) || null,
      metrics: {
        adherence: m.adherence, planned: m.planned, done: m.done, trained: m.trained, weekPlanned,
        weekTrained: days.reduce((a, d) => a + d.trained, 0), streak: this.streak(),
        solvedAtLevel: days.reduce((a, d) => a + d.solvedAtLevel, 0), extra: days.reduce((a, d) => a + d.extra, 0),
        levelChange: sk.n ? Math.round(sk.level - (before ? before.level : s.levelBase)) : 0,
      },
      profile: w ? JSON.parse(w.profile) : {},
      note: w && w.note ? { content: w.note, createdAt: w.note_at } : null,
      history, availability: { minutes: s.planMinutes, rounds: s.planRounds },
    };
  }

  // ---------- changes ----------

  setToday(minutes) {
    const k = dayKey(this.now());
    const week = this.weekOf(this.now()).key;
    const m = clamp(Math.round(Number(minutes) || 0), 0, 480);
    this.db.run(
      `INSERT INTO plan_days(day, week, minutes, override, blocks) VALUES(?,?,?,1,'[]')
       ON CONFLICT(day) DO UPDATE SET minutes = excluded.minutes, override = 1`, k, week, m);
    this.build({ reason: 'today changed' });
    return this.view();
  }

  check(day, index, done) {
    if (day > dayKey(this.now())) throw new Error('That day has not come yet.');
    const row = this.db.get('SELECT blocks FROM plan_days WHERE day = ?', day);
    if (!row) throw new Error('That day has no plan.');
    const blocks = JSON.parse(row.blocks);
    if (!blocks[index]) throw new Error('That block is gone.');
    blocks[index].manual = !!done;
    this.db.run('UPDATE plan_days SET blocks = ? WHERE day = ?', JSON.stringify(blocks), day);
    return this.view();
  }

  // Changing the usual week drops today's one-off override and rebuilds from today.
  replan() {
    this.db.run('UPDATE plan_days SET override = 0 WHERE day >= ?', dayKey(this.now()));
    this.build({ reason: 'replanned' });
    return this.view();
  }

  saveNote(weekKey, content) {
    this.db.run('UPDATE plan_weeks SET note = ?, note_at = ? WHERE week = ?', content, this.now(), weekKey);
  }

  // Plain-text plan for the coach.
  summaryText(v) {
    const lines = [];
    const last = v.history.length >= 2 ? v.history[v.history.length - 2] : null;
    if (last) lines.push(`Last week: covered ${Math.round(last.adherence * 100)}% of the planned minutes (${last.done} of ${last.planned}), trained ${last.trained} min.`);
    lines.push(`This week so far: ${Math.round(v.metrics.adherence * 100)}% of the plan up to today, ${v.metrics.weekTrained} min trained of ${v.metrics.weekPlanned} planned, streak ${v.metrics.streak} days, ${v.metrics.solvedAtLevel} problems solved at level.`);
    lines.push('Plan for this week (day: blocks, done/planned):');
    for (const d of v.days) {
      const b = d.blocks.map((x) => `${x.title} ${x.done}/${x.n}${x.optional ? ' (optional)' : ''}`).join('; ') || (d.status === 'none' ? 'no plan' : 'rest');
      lines.push(`- ${d.weekday} ${d.key} (${d.minutes} min, ${d.status}): ${b}`);
    }
    if (v.profile.notes && v.profile.notes.length) lines.push(`Planner reasoning: ${v.profile.notes.join(' ')}`);
    return lines.join('\n');
  }
}

// Title, one-line detail and the action that starts a block.
function describe(b) {
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  switch (b.kind) {
    case 'practice': return { title: pl(b.n, 'practice problem', 'practice problems'), detail: `${b.difficulty[0].toUpperCase()}${b.difficulty.slice(1)}: ${BAND_TEXT[b.difficulty]}. Mixed topics, tags hidden.`, action: { type: 'practice', mode: 'practice', difficulty: b.difficulty } };
    case 'idea': return { title: pl(b.n, 'idea drill', 'idea drills'), detail: 'Think it through to a full solution, then check the idea with the coach.', action: { type: 'practice', mode: 'idea' } };
    case 'topic': return { title: pl(b.n, `${b.topic} problem`, `${b.topic} problems`), detail: 'A deliberate topic block.', action: { type: 'practice', mode: 'practice', topic: b.topic } };
    case 'upsolve': return { title: pl(b.n, 'upsolve', 'upsolves'), detail: 'From your queue or your last rounds.', action: { type: 'queue', kind: 'upsolve' } };
    case 'resolve': return { title: 'Re-solve from the queue', detail: 'Without notes.', action: { type: 'queue', kind: 'resolve' } };
    case 'contest': return { title: 'Virtual contest', detail: `${b.minutes} minutes, a ladder around your level.`, action: { type: 'contest' } };
    case 'round': return { title: b.name, detail: `Codeforces round, ${b.minutes} minutes.`, action: { type: 'round', contestId: b.contestId } };
    default: return { title: b.kind, detail: '', action: null };
  }
}

module.exports = { Plan, dayKey, ratedFor, describe, WEEKDAYS };
