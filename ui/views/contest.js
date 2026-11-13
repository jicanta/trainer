// Virtual contests: setup, the running contest (no hints, no pause, ratings hidden), and results with a debrief.
import { h, mount, icon, segmented, button } from '../lib/dom.js';
import { gym, state, navigate, fail, toast, confirmDialog, immersive, openExternal } from '../lib/gym.js';
import { clock, minutes, dayYear, signed } from '../lib/format.js';
import { chatPanel } from '../lib/chat.js';
import { attachCodeforces, problemUrl, submitUrl, submissionsUrl } from '../lib/cf-page.js';
import { dataTable } from '../lib/charts.js';
import { ratingEl } from './home.js';
import { verdictChip } from './solve.js';

async function showSetup(root) {
  const b = state.boot;
  const s = b.settings;
  let kind = 'mix';
  let count = s.contestProblems;
  let mins = [90, 120, 150].includes(s.contestMinutes) ? s.contestMinutes : 120;
  const ladder = h('div');
  const blocked = !!b.active.attempt;

  async function renderLadder() {
    if (kind === 'round') {
      return mount(ladder, h('p', { class: 'muted', style: { maxWidth: '64ch' } }, `A past round you have not touched, first ${count} problems in their original order.`));
    }
    try {
      const plan = await gym.call('contest.plan', { count });
      mount(ladder, h('div', { class: 'ladder' }, plan.ratings.map((r, i) => h('div', { class: 'ladder-step' }, h('strong', null, r), h('span', null, String.fromCharCode(65 + i))))));
    } catch (e) { fail(e); }
  }

  async function start() {
    if (!(await confirmDialog({ title: `Start a ${mins}-minute contest?`, body: 'No hints, no coach, tags and ratings hidden. The clock does not pause, even if you close the app.', confirm: 'Start contest' }))) return;
    try {
      await gym.call('contest.start', { kind, count, minutes: mins });
      navigate('contest');
    } catch (e) { fail(e); }
  }

  const past = await gym.call('contest.list');
  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Virtual contest')),
    blocked ? h('div', { class: 'notice warm', style: { marginBottom: '18px' } }, h('div', { class: 'notice-title' }, `You have a problem open: ${b.active.attempt.name}`), 'Finish or park it before starting a contest.',
      h('div', { class: 'notice-actions' }, button('Resume', { small: true, onClick: () => navigate('solve') }))) : null,
    h('section', { class: 'card' },
      h('div', { class: 'controls' },
        h('div', null, h('div', { class: 'field-label', style: { marginBottom: '5px' } }, 'Problems from'),
          segmented([{ value: 'mix', label: 'Mixed ladder' }, { value: 'round', label: 'A real past round' }], kind, (v) => { kind = v; renderLadder(); })),
        h('div', null, h('div', { class: 'field-label', style: { marginBottom: '5px' } }, 'Problems'),
          segmented([4, 5, 6].map((n) => ({ value: n, label: String(n) })), count, (v) => { count = v; renderLadder(); })),
        h('div', null, h('div', { class: 'field-label', style: { marginBottom: '5px' } }, 'Duration'),
          segmented([90, 120, 150].map((n) => ({ value: n, label: `${n} min` })), mins, (v) => { mins = v; }))),
      ladder,
      h('div', { class: 'row', style: { marginTop: '22px' } }, button('Start contest', { kind: 'primary', iconName: 'flag', disabled: blocked || !b.problems, onClick: start }))),
    h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'Past contests'),
      past.length ? h('div', { class: 'card flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Date', 'Contest', 'Solved', 'Penalty', 'Performance', ''].map((t, i) => h('th', { class: i >= 2 && i <= 4 ? 'num' : null }, t)))),
        h('tbody', null, past.map((r) => h('tr', { class: 'clickable', onClick: () => navigate('contest', { id: r.id }) },
          h('td', null, dayYear(r.startedAt)), h('td', null, r.title),
          h('td', { class: 'num' }, r.status === 'aborted' ? 'discarded' : `${r.solved} of ${r.problems.length}`),
          h('td', { class: 'num' }, r.status === 'aborted' ? '-' : r.penalty), h('td', { class: 'num' }, r.perf ?? '-'),
          h('td', { class: 'num' }, icon('external', 14))))))))
        : h('p', { class: 'empty' }, 'No contests yet.'))));
  await renderLadder();
  return null;
}

async function showRun(root, initial) {
  immersive(true);
  const settings = state.boot.settings;
  let run = initial;
  let finished = false;
  let current = (run.problems.find((p) => p.phase === 'think' && p.status === 'active') || run.problems.find((p) => p.status === 'active') || run.problems[0]).attemptId;
  let watch = await gym.call('watch.status').catch(() => null);
  const views = new Map();
  const chips = new Map();

  const tabsEl = h('div', { class: 'ctabs' });
  const countMain = h('span', { class: 'timer-main' });
  const countEl = h('div', { class: 'timer countdown' }, countMain);
  const watchEl = h('span', { class: 'watch' });
  const stageViews = h('div', { class: 'stage-views' });
  const stageNote = h('span', { class: 'stage-note' });
  const focusCheck = h('input', { type: 'checkbox', checked: settings.focusLayout });
  const sideTitle = h('div', { class: 'card-title' });
  const sideTime = h('strong');
  const chipEl = h('div', { class: 'verdicts' });
  const notes = h('textarea', { class: 'textarea', spellcheck: false, placeholder: 'Contest scratchpad. Stays with the contest.' });
  notes.value = run.notes || '';
  let notesTimer = null;
  notes.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(() => gym.call('contest.notes', { id: run.id, notes: notes.value }).catch(() => {}), 600); });

  const problem = (id) => run.problems.find((p) => p.attemptId === id);

  function ensureView(p) {
    if (views.has(p.attemptId)) return views.get(p.attemptId);
    const view = h('webview', { src: problemUrl(p.contestId, p.index), partition: 'persist:codeforces' });
    const cf = attachCodeforces(view, {
      pid: p.pid, getFocus: () => focusCheck.checked,
      onInfo: (info) => {
        if (p.attemptId !== current) return;
        if (info.error) stageNote.textContent = info.error;
        else if (info.challenge) stageNote.textContent = 'Codeforces is running a browser check. Complete it in this panel.';
      },
    });
    stageViews.appendChild(view);
    const entry = { view, cf };
    views.set(p.attemptId, entry);
    return entry;
  }

  function renderTabs() {
    mount(tabsEl, run.problems.map((p) => h('button', {
      class: ['ctab', p.attemptId === current && 'on', p.status === 'solved' && 'solved'], type: 'button', title: p.name, onClick: () => select(p.attemptId),
    }, p.status === 'solved' ? icon('check', 13) : null, p.label, p.wrongSubs ? h('small', null, `-${p.wrongSubs}`) : null)));
  }

  function renderSide() {
    const p = problem(current);
    sideTitle.textContent = `${p.label}. ${p.name}`;
    mount(chipEl, (chips.get(current) || []).slice(-6).map(verdictChip));
    stageNote.textContent = p.status === 'solved' ? `Solved at minute ${p.solvedMinute}.` : '';
  }

  async function select(id) {
    current = id;
    const entry = ensureView(problem(id));
    for (const [k, v] of views) v.view.classList.toggle('on', k === id);
    entry.cf.applyFocus();
    renderTabs();
    renderSide();
    try { run = (await gym.call('contest.focus', { id: run.id, attemptId: id })) || run; renderTabs(); } catch (e) { fail(e); }
    if (!chips.has(id)) {
      const d = await gym.call('attempt.get', { id }).catch(() => null);
      chips.set(id, d ? d.events.filter((e) => e.kind === 'submission').map((e) => e.data) : []);
      if (current === id) renderSide();
    }
  }

  function renderWatch() {
    const handle = settings.handle;
    watchEl.className = `watch${!handle ? ' off' : watch && watch.ok === false ? ' bad' : ''}`;
    watchEl.title = watch && watch.error ? watch.error : 'Verdicts are read from your Codeforces submissions.';
    mount(watchEl, h('span', { class: 'watch-dot' }), !handle ? 'No handle set' : watch && watch.ok === false ? 'Codeforces unreachable' : 'Watching your submissions');
  }

  function toResults() {
    if (finished) return;
    finished = true;
    navigate('contest', { id: run.id });
  }

  async function end() {
    if (!(await confirmDialog({ title: 'End the contest now?', body: 'Unsolved problems count as not solved. You cannot resume.', confirm: 'End contest' }))) return;
    try { await gym.call('contest.finish', { id: run.id }); toResults(); } catch (e) { fail(e); }
  }
  async function discard() {
    if (!(await confirmDialog({ title: 'Discard this contest?', body: 'Nothing from it will count, and its problems may be offered again.', confirm: 'Discard', danger: true }))) return;
    try { await gym.call('contest.abort', { id: run.id }); finished = true; navigate('contest'); } catch (e) { fail(e); }
  }
  async function markSolved() {
    const p = problem(current);
    if (p.status === 'solved') return;
    if (!(await confirmDialog({ title: `Mark ${p.label} as solved by hand?`, body: 'Verdicts normally arrive from Codeforces on their own. Use this only if they are not coming through.', confirm: 'Mark solved' }))) return;
    try { await gym.call('contest.solved', { attemptId: p.attemptId }); await refresh(); } catch (e) { fail(e); }
  }

  async function refresh() {
    const next = await gym.call('contest.active').catch(() => null);
    if (!next || next.id !== run.id) return toResults();
    run = next;
    renderTabs();
    renderSide();
  }

  function tick() {
    if (finished) return;
    const left = run.endsAt - Date.now();
    countMain.textContent = clock(left);
    countEl.classList.toggle('low', left < 10 * 60000);
    const p = problem(current);
    sideTime.textContent = clock(p.thinkMs + (p.phase === 'think' && p.status === 'active' ? Math.max(0, Date.now() - p.phaseStartedAt) : 0));
    if (left <= 0) gym.call('contest.finish', { id: run.id }).then(toResults).catch(toResults);
  }

  const offs = [
    gym.on('submission', (p) => {
      if (p.contestRunId !== run.id) return;
      if (!chips.has(p.attemptId)) chips.set(p.attemptId, []);
      chips.get(p.attemptId).push(p);
      if (p.verdict === 'OK') toast(`${(problem(p.attemptId) || {}).label || ''} accepted.`, { kind: 'good' });
      refresh();
    }),
    gym.on('contest', (p) => { if (p.id === run.id && (p.event === 'finished' || p.event === 'aborted')) toResults(); }),
    gym.on('watch', (w) => { watch = w; renderWatch(); }),
  ];

  const nav = (make) => { const p = problem(current); ensureView(p).cf.go(make(p)); };
  mount(root, h('div', { class: 'work' },
    h('header', { class: 'work-bar' },
      h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Back to Today (the contest keeps running)', onClick: () => navigate('home') }, icon('back', 16)),
      tabsEl, h('span', { class: 'spacer' }), watchEl, countEl, button('End contest', { small: true, onClick: end })),
    h('div', { class: 'work-body' },
      h('section', { class: 'stage' },
        h('div', { class: 'stage-bar' },
          button('Statement', { small: true, kind: 'ghost', onClick: () => nav((p) => problemUrl(p.contestId, p.index)) }),
          button('Submit', { small: true, kind: 'ghost', onClick: () => nav((p) => submitUrl(p.contestId, p.index)) }),
          settings.handle ? button('My submissions', { small: true, kind: 'ghost', onClick: () => nav(() => submissionsUrl(settings.handle)) }) : null,
          h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Reload', onClick: () => ensureView(problem(current)).cf.reload() }, icon('refresh', 14)),
          h('label', { class: 'check', style: { marginLeft: '6px', fontSize: '12.5px' } }, focusCheck, h('span', null, 'Statement only')),
          stageNote, h('span', { class: 'spacer' }),
          h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Open in your browser', onClick: () => openExternal(problem(current).url) }, icon('external', 14))),
        stageViews),
      h('aside', { class: 'side' },
        h('div', { class: 'side-top' }, sideTitle,
          h('div', { class: 'gauge-head' }, h('span', null, 'Time on this problem'), sideTime), chipEl,
          h('div', { class: 'notice' }, h('div', { class: 'notice-title' }, 'Contest rules'), 'No hints, no coach, no tags. Submit on Codeforces: verdicts arrive on their own. Hard problem? Move on and come back.')),
        h('div', { class: 'notes', style: { paddingTop: '6px' } }, notes),
        h('div', { class: 'side-foot' }, button('Mark solved', { kind: 'ghost', onClick: markSolved }), button('Discard contest', { kind: 'ghost', onClick: discard }))))));
  focusCheck.addEventListener('change', () => { const e = views.get(current); if (e) e.cf.applyFocus(); });
  renderWatch();
  await select(current);
  tick();
  const timer = setInterval(tick, 500);
  return () => { finished = true; clearInterval(timer); clearTimeout(notesTimer); offs.forEach((off) => off()); immersive(false); };
}

async function showResults(root, id) {
  const run = await gym.call('contest.get', { id });
  if (!run) return showSetup(root);
  const b = state.boot;
  const coachOk = b.coach && b.coach.found;
  const queue = await gym.call('queue.list').catch(() => []);
  const queued = run.problems.filter((p) => queue.some((q) => q.pid === p.pid && q.kind === 'upsolve'));
  const aborted = run.status === 'aborted';

  const panel = chatPanel({
    scope: 'contest', scopeId: id, placeholder: 'Ask about this contest',
    empty: () => h('div', { class: 'chat-empty' }, icon('chat', 22),
      button('Debrief with coach', { kind: 'primary', onClick: async () => { try { panel.begin(await gym.call('coach.contest', { runId: id, text: '' })); } catch (e) { fail(e); } } })),
    send: (text) => gym.call('coach.contest', { runId: id, text }),
  });

  const table = dataTable([
    { key: 'label', label: '' },
    { key: 'name', label: 'Problem', format: (v, p) => h('button', { class: 'link-btn', type: 'button', style: { fontSize: '13px', color: 'var(--ink)' }, onClick: () => openExternal(p.url) }, v) },
    { key: 'rating', label: 'Rating', format: (v) => ratingEl(v) },
    { key: 'tags', label: 'Tags', format: (v) => (v || []).join(', ') },
    { key: 'status', label: 'Result', format: (v, p) => h('span', { class: ['badge', v === 'solved' ? 'green' : aborted ? 'gray' : 'red'] }, v === 'solved' ? `Solved at ${p.solvedMinute}'` : aborted ? 'Discarded' : 'Not solved') },
    { key: 'wrongSubs', label: 'Wrong', align: 'right' },
    { key: 'thinkMs', label: 'Time on it', align: 'right', format: (v) => minutes(v) },
    { key: 'attemptId', label: '', format: (v, p) => (aborted ? '' : h('button', { class: 'link-btn', type: 'button', onClick: () => navigate('reflect', { id: v, back: 'contest' }) }, p.reflected ? 'Reflection' : 'Reflect')) },
  ], run.problems);

  const delta = run.levelAtStart != null ? run.levelNow - Math.round(run.levelAtStart) : null;
  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, run.title), h('p', { class: 'page-sub' }, `${dayYear(run.startedAt)}, ${minutes(run.durationMs)}${aborted ? '. Discarded: it does not count.' : ''}`)),
      h('div', { class: 'row' }, button('All contests', { kind: 'ghost', iconName: 'back', onClick: () => navigate('contest') }),
        button('Delete', { kind: 'ghost', iconName: 'trash', onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete this contest?', body: 'Its problems and results are removed from your history.', confirm: 'Delete', danger: true }))) return;
          try { await gym.call('contest.remove', { id }); navigate('contest'); } catch (e) { fail(e); }
        } }))),
    aborted ? null : h('div', { class: 'bento', style: { marginBottom: '16px' } },
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Solved'), h('div', { class: 'tile-value' }, run.solved, h('small', null, ` of ${run.problems.length}`))),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Performance'), h('div', { class: 'tile-value' }, run.perf ?? '-'), h('div', { class: 'tile-note' }, `Level at the start: ${Math.round(run.levelAtStart || 0)}`)),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Penalty'), h('div', { class: 'tile-value' }, run.penalty ?? 0, h('small', null, ' min'))),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Gym level now'), h('div', { class: 'tile-value' }, run.levelNow), delta !== null ? h('div', { class: 'tile-note' }, `${signed(delta)} since this contest started`) : null)),
    h('div', { class: 'stack' },
      h('section', { class: 'card flush' }, table),
      queued.length ? h('div', { class: 'notice calm' }, h('div', { class: 'notice-title' }, 'Queued for upsolving'), `${queued.map((p) => `${p.label}. ${p.name}`).join(', ')}. One or two is enough: the ones just out of reach.`) : null,
      run.notes ? h('section', { class: 'card' }, h('h3', { class: 'card-title', style: { marginBottom: '10px' } }, 'Your contest notes'), h('pre', { class: 'notes-view' }, run.notes)) : null,
      aborted ? null : h('section', { class: 'card chat-card results-chat' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Debrief')),
        coachOk ? panel.el : h('p', { class: 'empty', style: { padding: '16px' } }, 'Claude Code was not found. Set its path in Settings to use the coach.')))));
  panel.load().catch(() => {});
  return () => panel.destroy();
}

export async function show(root, params = {}) {
  if (params.id) return showResults(root, params.id);
  const active = await gym.call('contest.active');
  if (active) return showRun(root, active);
  return showSetup(root);
}
