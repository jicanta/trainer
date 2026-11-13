'use strict';
// A local stand-in for Codeforces: the API endpoints the app uses, and problem pages with the same DOM shape
// (header, sidebar with spoiler tags, MathJax-style formulas, samples, tutorial endpoint).
// The UI checks run against this, so they never touch the real site.
const http = require('node:http');

const TAGS = ['greedy', 'math', 'constructive algorithms', 'implementation', 'brute force', 'dp', 'sortings', 'binary search', 'graphs', 'dfs and similar',
  'trees', 'number theory', 'data structures', 'combinatorics', 'two pointers', 'strings', 'bitmasks', 'dsu'];
const RATINGS = [900, 1100, 1300, 1500, 1600, 1700, 1800, 1900, 2100, 2300];

function dataset() {
  const problems = [];
  const stats = [];
  const contests = [];
  let k = 0;
  for (let c = 0; c < 90; c++) {
    const id = 1500 + c;
    const start = Math.floor(Date.UTC(2021, 0, 1) / 1000) + c * 12 * 86400;
    contests.push({ id, name: `Codeforces Round ${id} (Div. 2)`, type: 'CF', phase: 'FINISHED', durationSeconds: 7200, startTimeSeconds: start });
    RATINGS.forEach((rating, i) => {
      const index = String.fromCharCode(65 + i);
      const tags = [TAGS[k % TAGS.length], TAGS[(k * 7 + 3) % TAGS.length]];
      k++;
      problems.push({ contestId: id, index, name: `Sample ${id}${index}`, type: 'PROGRAMMING', rating, tags });
      stats.push({ contestId: id, index, solvedCount: 6000 - i * 400 });
    });
  }
  // The test user played the first twelve rounds: A-C solved, D attempted and failed.
  const history = [];
  const ratingChanges = [];
  let sid = 1000;
  let rating = 1500;
  for (let c = 0; c < 12; c++) {
    const id = 1500 + c;
    const start = contests[c].startTimeSeconds;
    const ps = problems.filter((p) => p.contestId === id);
    [600, 1500, 3300].forEach((t, i) => history.push({ id: sid++, creationTimeSeconds: start + t, relativeTimeSeconds: t, verdict: 'OK', passedTestCount: 20, programmingLanguage: 'C++20', problem: ps[i], author: { participantType: 'CONTESTANT' } }));
    history.push({ id: sid++, creationTimeSeconds: start + 6000, relativeTimeSeconds: 6000, verdict: 'WRONG_ANSWER', passedTestCount: 3, programmingLanguage: 'C++20', problem: ps[3], author: { participantType: 'CONTESTANT' } });
    const next = rating + (c % 3 === 0 ? -14 : 21);
    ratingChanges.push({ contestId: id, contestName: contests[c].name, handle: 'tester', rank: 2000 - c * 40, ratingUpdateTimeSeconds: start + 7300, oldRating: rating, newRating: next });
    rating = next;
  }
  return { problems, stats, contests, history, ratingChanges, user: { handle: 'tester', rating, maxRating: rating + 30, rank: 'expert', maxRank: 'expert' } };
}

function problemPage(p) {
  const title = p ? `${p.index}. ${p.name}` : 'A. Unknown problem';
  const pid = p ? `${p.contestId}${p.index}` : '0A';
  const tags = p ? [...p.tags, `*${p.rating}`] : [];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Problem - ${pid} - Codeforces</title><meta name="X-Csrf-Token" content="test-token">
<style>body{font-family:Verdana,Arial,sans-serif;font-size:13px;margin:0}#body{min-width:1000px;margin:0 2em}#header{height:60px;background:#eef}#sidebar{float:right;width:20em}
.content-with-sidebar{margin-right:22em}.menu-box{background:#ddd;padding:8px}.tag-box{background:#f0f0f0;padding:2px 6px}.problem-statement .title{font-size:150%;margin:1em 0 .3em}
.section-title{font-weight:bold;margin:1em 0 .3em}pre{border:1px solid #888;padding:6px}#footer{margin-top:3em;color:#888}</style></head>
<body><div id="body">
<div id="header"><a href="/">Codeforces (local stand-in)</a> <a href="/enter">Enter</a></div>
<div class="roundbox menu-box">Home | Top | Catalog | Contests | Gym | Problemset</div>
<div style="position:relative">
<div id="sidebar">
  <div class="roundbox sidebox"><div class="caption titled">&rarr; Problem tags</div><div style="padding:0.5em">${tags.map((t) => `<div class="roundbox" style="margin:2px"><span class="tag-box" title="tag">${t}</span></div>`).join('')}</div></div>
  <div class="roundbox sidebox sidebar-menu"><div class="caption titled">&rarr; Contest materials</div><ul><li><a href="/blog/entry/100">Announcement (en)</a></li><li><a href="/blog/entry/101">Tutorial (en)</a></li></ul></div>
</div>
<div id="pageContent" class="content-with-sidebar">
<div class="second-level-menu">Problems | Submit | Status | Standings</div>
<div class="problemindexholder"><div class="ttypography"><div class="problem-statement">
<div class="header"><div class="title">${title}</div><div class="time-limit"><div class="property-title">time limit per test</div>3 seconds</div><div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div></div>
<div><p>You are given an array <span class="MathJax_Preview" style="display:none"></span><span class="MathJax" id="MathJax-Element-1-Frame">a1,a2,…,an<span class="MJX_Assistive_MathML">a1</span></span><script type="math/tex" id="MathJax-Element-1">a_1, a_2, \\ldots, a_n</script>. For every divisor $$$k$$$ of $$$n$$$, split the array into $$$\\frac{n}{k}$$$ blocks of length $$$k$$$. You earn one point for $$$k$$$ if there is an integer $$$m \\ge 2$$$ such that after replacing every element by its remainder modulo $$$m$$$ all blocks become identical.</p><p>Count the points you earn.</p></div>
<div class="input-specification"><div class="section-title">Input</div><p>The first line contains $$$t$$$ ($$$1 \\le t \\le 10^4$$$). Each test has $$$n$$$ ($$$1 \\le n \\le 2 \\cdot 10^5$$$) and then $$$a_1, \\ldots, a_n$$$ ($$$1 \\le a_i \\le n$$$). The sum of $$$n$$$ does not exceed $$$2 \\cdot 10^5$$$.</p></div>
<div class="output-specification"><div class="section-title">Output</div><p>For each test print the number of points.</p></div>
<div class="sample-tests"><div class="section-title">Example</div><div class="sample-test"><div class="input"><div class="title">Input<div class="input-output-copier">Copy</div></div><pre><div class="test-example-line">2</div><div class="test-example-line">4</div><div class="test-example-line">1 2 1 4</div><div class="test-example-line">3</div><div class="test-example-line">1 2 3</div></pre></div><div class="output"><div class="title">Output<div class="input-output-copier">Copy</div></div><pre>2<br>1</pre></div></div></div>
<div class="note"><div class="section-title">Note</div><p>In the first test, $$$k = 2$$$ works with $$$m = 2$$$ and $$$k = 4$$$ always works.</p></div>
</div></div></div>
</div></div>
<div id="footer">Codeforces stand-in for automated checks</div>
</div></body></html>`;
}

const TUTORIAL = `<h3>Tutorial</h3><div class="ttypography"><p>Fix a divisor $$$k$$$. Two numbers are equal modulo $$$m$$$ exactly when $$$m$$$ divides their difference. So all blocks coincide modulo $$$m$$$ if and only if $$$m$$$ divides $$$|a_i - a_{i+k}|$$$ for every $$$i$$$. Take $$$g$$$ as the gcd of all these differences: a valid $$$m \\ge 2$$$ exists if and only if $$$g \\ne 1$$$ (with $$$g = 0$$$ meaning the blocks are already identical). The number of divisors is small, so checking each one in $$$O(n \\log n)$$$ is fast enough.</p></div>`;

function simplePage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><div id="body"><div id="header">Codeforces (local stand-in)</div><div id="pageContent"><h2>${title}</h2>${body}</div></div></body></html>`;
}

async function start() {
  const data = dataset();
  let extra = [];
  const byPid = new Map(data.problems.map((p) => [`${p.contestId}${p.index}`, p]));
  const requests = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push(`${req.method} ${url.pathname}`);
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    const json = (obj, code = 200) => send(code, 'application/json', JSON.stringify(obj));
    const ok = (result) => json({ status: 'OK', result });

    if (url.pathname.startsWith('/api/')) {
      const method = url.pathname.slice(5);
      const handle = (url.searchParams.get('handle') || url.searchParams.get('handles') || '').toLowerCase();
      if (method === 'problemset.problems') return ok({ problems: data.problems, problemStatistics: data.stats });
      if (method === 'contest.list') return ok(data.contests);
      if (['user.info', 'user.rating', 'user.status'].includes(method) && handle !== 'tester') return json({ status: 'FAILED', comment: `handles: User with handle ${handle} not found` }, 400);
      if (method === 'user.info') return ok([data.user]);
      if (method === 'user.rating') return ok(data.ratingChanges);
      if (method === 'user.status') {
        const all = [...data.history, ...extra].sort((a, b) => b.id - a.id);
        const count = Number(url.searchParams.get('count')) || all.length;
        return ok(all.slice(0, count));
      }
      return json({ status: 'FAILED', comment: 'No such method' }, 400);
    }
    if (url.pathname === '/data/problemTutorial') return json({ success: 'true', html: TUTORIAL });
    let m = /^\/problemset\/problem\/(\d+)\/([A-Za-z]\d*)$/.exec(url.pathname);
    if (m) {
      const p = byPid.get(`${m[1]}${m[2].toUpperCase()}`);
      // Unknown problems answer like a Cloudflare browser check: no statement on the page.
      if (!p) return send(403, 'text/html; charset=utf-8', '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-form">Checking your browser before accessing the site.</div></body></html>');
      return send(200, 'text/html; charset=utf-8', problemPage(p));
    }
    m = /^\/contest\/(\d+)\/submit\/([A-Za-z]\d*)$/.exec(url.pathname);
    if (m) return send(200, 'text/html; charset=utf-8', simplePage(`Submit ${m[1]}${m[2]}`, '<p>Submit form (stand-in).</p>'));
    if (url.pathname.startsWith('/submissions/')) return send(200, 'text/html; charset=utf-8', simplePage('Submissions', '<p>Submission list (stand-in).</p>'));
    return send(404, 'text/html; charset=utf-8', simplePage('Not found', ''));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let nextId = 900000;
  return {
    origin, api: `${origin}/api/`, data, requests,
    // Simulates the user submitting to Codeforces.
    submit(pid, verdict, at = Date.now()) {
      const p = byPid.get(pid);
      extra.push({ id: nextId++, creationTimeSeconds: Math.floor(at / 1000), relativeTimeSeconds: 2147483647, verdict, passedTestCount: verdict === 'OK' ? 30 : 4, programmingLanguage: 'C++20', problem: p, author: { participantType: 'PRACTICE' } });
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { start };
