'use strict';
// Pulls the Codeforces problem set, contest list and the user's own history into the local database.

const EXCLUDE_RE = /april fools|kotlin heroes|testing round|unknown language|surprise language|\bq#|microsoft q|code game challenge|marathon|wild-?card|crowdsource|practice round/i;

function contestKind(name) {
  const n = String(name || '').toLowerCase();
  if (EXCLUDE_RE.test(n)) return 'excluded';
  if (/educational/.test(n)) return 'edu';
  if (/div\.? ?1 ?\+ ?(div\.? ?)?2|global round|good bye|hello 20|codeton/.test(n)) return 'div1+2';
  if (/div\.? ?4/.test(n)) return 'div4';
  if (/div\.? ?3/.test(n)) return 'div3';
  if (/div\.? ?2/.test(n)) return 'div2';
  if (/div\.? ?1/.test(n)) return 'div1';
  return 'other';
}

const pidOf = (contestId, index) => `${contestId}${index}`;

async function syncProblems(db, cf, emit = () => {}) {
  emit('sync', { step: 'problems', message: 'Downloading the Codeforces problem set' });
  const ps = await cf.problemset();
  emit('sync', { step: 'contests', message: 'Downloading the contest list' });
  const contests = await cf.contestList();
  emit('sync', { step: 'store', message: 'Saving problems' });
  const solved = new Map();
  for (const s of ps.problemStatistics || []) solved.set(pidOf(s.contestId, s.index), s.solvedCount || 0);
  let n = 0;
  db.tx(() => {
    for (const c of contests) {
      db.run(
        `INSERT INTO cf_contests(id, name, start, duration, kind) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, start=excluded.start, duration=excluded.duration, kind=excluded.kind`,
        c.id, c.name, c.startTimeSeconds ?? null, c.durationSeconds ?? null, contestKind(c.name));
    }
    for (const p of ps.problems || []) {
      if (p.contestId == null || !p.index) continue;
      const pid = pidOf(p.contestId, p.index);
      db.run(
        `INSERT INTO problems(pid, contest_id, idx, name, rating, tags, solved_count) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(pid) DO UPDATE SET name=excluded.name, rating=excluded.rating, tags=excluded.tags, solved_count=excluded.solved_count`,
        pid, p.contestId, p.index, p.name, p.rating ?? null, JSON.stringify(p.tags || []), solved.get(pid) || 0);
      n++;
    }
  });
  db.setSetting('problemsSyncedAt', Date.now());
  return { problems: n, contests: contests.length };
}

function upsertSubmission(db, s) {
  const p = s.problem || {};
  if (p.contestId == null || !p.index) return false;
  db.run(
    `INSERT INTO cf_submissions(id, pid, contest_id, idx, name, rating, tags, verdict, created, rel_time, participant, lang, passed)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET verdict=excluded.verdict, passed=excluded.passed, rating=excluded.rating, tags=excluded.tags`,
    s.id, pidOf(p.contestId, p.index), p.contestId, p.index, p.name ?? null, p.rating ?? null, JSON.stringify(p.tags || []),
    s.verdict ?? null, s.creationTimeSeconds, s.relativeTimeSeconds ?? null, s.author?.participantType ?? null,
    s.programmingLanguage ?? null, s.passedTestCount ?? null);
  return true;
}

async function syncUser(db, cf, handle, emit = () => {}) {
  handle = String(handle || '').trim();
  if (!handle) throw new Error('Set your Codeforces handle first.');
  emit('sync', { step: 'user', message: `Loading ${handle} from Codeforces` });
  const info = await cf.userInfo(handle);
  const history = await cf.userRating(info.handle);
  emit('sync', { step: 'submissions', message: 'Loading your submissions' });
  const subs = await cf.userStatus(info.handle);
  const prev = db.getSetting('cfUser', null);
  db.tx(() => {
    if (prev && String(prev.handle).toLowerCase() !== info.handle.toLowerCase()) {
      db.run('DELETE FROM cf_submissions');
      db.run('DELETE FROM cf_rating_history');
    }
    for (const h of history) {
      db.run(
        `INSERT INTO cf_rating_history(contest_id, contest_name, rank, t, old_rating, new_rating) VALUES(?,?,?,?,?,?)
         ON CONFLICT(contest_id) DO UPDATE SET rank=excluded.rank, t=excluded.t, old_rating=excluded.old_rating, new_rating=excluded.new_rating`,
        h.contestId, h.contestName, h.rank, h.ratingUpdateTimeSeconds, h.oldRating, h.newRating);
    }
    for (const s of subs) upsertSubmission(db, s);
  });
  const user = {
    handle: info.handle, rating: info.rating ?? null, maxRating: info.maxRating ?? null,
    rank: info.rank ?? null, maxRank: info.maxRank ?? null, contests: history.length, submissions: subs.length,
  };
  db.setSetting('cfUser', user);
  db.setSetting('userSyncedAt', Date.now());
  return user;
}

module.exports = { syncProblems, syncUser, upsertSubmission, contestKind, pidOf };
