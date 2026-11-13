'use strict';
// Live check against the real Codeforces API: node test/live/sync.js <data-dir> <public-handle>
// Syncs the problem set and a public profile into a throwaway database and prints what the gym derives from it.
const { openDb, allSettings } = require('../../src/db');
const { CF } = require('../../src/cf');
const { syncProblems, syncUser } = require('../../src/sync');
const recommend = require('../../src/recommend');
const stats = require('../../src/stats');

(async () => {
  const dir = process.argv[2];
  const handle = process.argv[3];
  if (!dir || !handle) { console.error('usage: node test/live/sync.js <data-dir> <handle>'); process.exit(2); }
  const db = openDb(dir);
  const cf = new CF();
  const log = (type, p) => console.log(`  [${type}] ${p.message}`);
  let t = Date.now();
  if (!db.getSetting('problemsSyncedAt')) console.log('problems:', await syncProblems(db, cf, log), `${Date.now() - t} ms`);
  t = Date.now();
  if (!db.getSetting('userSyncedAt')) console.log('user:', await syncUser(db, cf, handle, log), `${Date.now() - t} ms`);
  db.setSetting('handle', handle);
  const cfUser = db.getSetting('cfUser');
  db.setSetting('levelBase', cfUser.rating || 1500);
  const settings = allSettings(db);

  console.log('kinds:', db.all('SELECT kind, COUNT(*) AS n FROM cf_contests GROUP BY kind ORDER BY n DESC').map((r) => `${r.kind} ${r.n}`).join(', '));
  console.log('problems:', db.get('SELECT COUNT(*) AS n, SUM(rating IS NOT NULL) AS rated FROM problems'));
  console.log('submissions:', db.get(`SELECT COUNT(*) AS n, SUM(verdict = 'OK') AS ok, COUNT(DISTINCT pid) AS problems FROM cf_submissions`));

  for (const level of [1500, 1900]) {
    console.log(`\nshortlist at level ${level} (standard):`);
    for (const p of recommend.shortlist(db, settings, level)) console.log('  ', p.rating, p.pid.padEnd(7), p.name.slice(0, 40).padEnd(40), p.year, 'solved', p.solvedCount, Object.keys(p).includes('tags') ? 'TAGS LEAKED' : '');
    const mix = recommend.buildMix(db, settings, level, 5);
    console.log(`mix at ${level}:`, mix.problems.map((p) => `${p.label}:${p.pid}(${p.rating})`).join(' '));
    const round = recommend.buildRound(db, settings, level, 6);
    console.log(`round at ${level}:`, round ? `${round.title} -> ${round.problems.map((p) => `${p.label}(${p.rating})`).join(' ')}` : 'none');
  }
  console.log('\nlookup:', recommend.lookup(db, 'https://codeforces.com/contest/1920/problem/C'), recommend.lookup(db, '9999Z'));

  const ins = stats.insights(db, { ...settings, levelBase: 1500 });
  console.log('\ntopics (weakness at level 1500):');
  for (const tp of [...ins.topics].sort((a, b) => b.weakness - a.weakness).slice(0, 8)) console.log('  ', tp.tag.padEnd(24), 'weak', tp.weakness, 'share', tp.share.toFixed(3), 'cfAtLevel', tp.cfAtLevel, 'cfSolved', tp.cfSolved);
  const c = ins.cf;
  console.log('cf analysis:', { contests: c.contests, avgSolved: c.avgSolved, wallMedian: c.wallMedian, wallTags: c.wallTags.slice(0, 4), speed: c.speedByRating.slice(0, 6), upsolve: c.upsolve.slice(0, 3), ratingPoints: c.ratingHistory.length, solvedBuckets: c.solvedByRating.length });
  console.log('\ncoach context:\n' + stats.coachContext(db, settings));
  console.log('\noverview suggestion:', stats.overview(db, settings).suggestion);
  db.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
