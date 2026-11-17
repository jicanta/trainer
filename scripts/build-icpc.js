'use strict';
// Builds data/icpc.json: every official ICPC contest in the Codeforces Gym with, per problem, how many official
// teams and how many virtual participants solved it.
// Uses only the public API (contest.list and contest.status), one call per contest. A full build takes hours (old,
// popular contests have huge submission lists); it saves as it goes, and contests already in the file are kept, so it
// can be stopped and resumed. Pass --all to count everything again.
//   node scripts/build-icpc.js [--all]
const fs = require('node:fs');
const path = require('node:path');
const { CF } = require('../src/cf');

const OUT = path.join(__dirname, '..', 'data', 'icpc.json');

// One contest's submissions -> { teams: [official, virtual], problems: [[index, name, solvedOfficial, solvedVirtual]] }.
// Official teams are the ones uploaded from the real scoreboard (ghosts). Virtual ones are Codeforces users who
// played the set later under contest rules. Practice submissions are left out: they are not a contest result.
function tally(subs) {
  const teams = [new Set(), new Set()];
  const problems = new Map();
  for (const s of subs) {
    const a = s.author || {};
    const p = s.problem || {};
    if (!p.index) continue;
    if (!problems.has(p.index)) problems.set(p.index, { name: p.name || p.index, solvers: [new Set(), new Set()] });
    if (a.participantType !== 'CONTESTANT' && a.participantType !== 'VIRTUAL') continue;
    const g = a.ghost ? 0 : 1;
    teams[g].add(a.participantId);
    if (s.verdict === 'OK') problems.get(p.index).solvers[g].add(a.participantId);
  }
  return {
    teams: teams.map((t) => t.size),
    problems: [...problems].sort((x, y) => x[0].localeCompare(y[0], 'en', { numeric: true }))
      .map(([idx, v]) => [idx, v.name, v.solvers[0].size, v.solvers[1].size]),
  };
}

async function main() {
  const all = process.argv.includes('--all');
  const cf = new CF();
  let prev = { contests: [] };
  if (!all) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first build */ } }
  const have = new Map(prev.contests.map((c) => [c.id, c]));
  const list = (await cf.call('contest.list', { gym: true }))
    .filter((c) => c.kind === 'Official ICPC Contest' && c.phase === 'FINISHED')
    .sort((a, b) => b.id - a.id); // newest first: an interrupted build still has the recent seasons
  const contests = [];
  const save = () => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const done = new Set(contests.map((c) => c.id));
    const kept = prev.contests.filter((c) => !done.has(c.id)); // not reached yet in this run
    const body = [...contests, ...kept].sort((a, b) => a.id - b.id).map((c) => JSON.stringify(c)).join(',\n');
    fs.writeFileSync(OUT, `{"builtAt":"${new Date().toISOString().slice(0, 10)}","contests":[\n${body}\n]}\n`);
  };
  let fetched = 0;
  for (const [i, c] of list.entries()) {
    const meta = { id: c.id, name: c.name, season: c.season || null, region: c.icpcRegion || null, stars: c.difficulty || null };
    const old = have.get(c.id);
    if (old) { contests.push({ ...meta, teams: old.teams, problems: old.problems }); continue; }
    try {
      const t = tally(await cf.call('contest.status', { contestId: c.id }, { timeoutMs: 180000 }));
      contests.push({ ...meta, ...t });
      console.log(`${i + 1}/${list.length} ${c.id} ${c.name}: ${t.teams[0]} official and ${t.teams[1]} virtual teams, ${t.problems.length} problems`);
    } catch (e) {
      console.log(`${i + 1}/${list.length} ${c.id} skipped: ${e.message}`);
    }
    if (++fetched % 10 === 0) save();
  }
  save();
  console.log(`Wrote ${contests.length} contests to ${OUT}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { tally };
