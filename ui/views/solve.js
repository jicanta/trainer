// The solve workspace: statement on the left, clock, notes and coach on the right.
// Thinking and coding are timed separately; "stuck" is measured from your last new idea.
import { h, mount, icon, segmented, button } from '../lib/dom.js';
import { gym, state, navigate, fail, toast, confirmDialog, immersive, openExternal } from '../lib/gym.js';
import { clock, minutes, MODES } from '../lib/format.js';
import { chatPanel } from '../lib/chat.js';
import { attachCodeforces, problemUrl, submitUrl, submissionsUrl } from '../lib/cf-page.js';
import { ratingEl } from './home.js';

// Um_nik, "Pro Tips": questions to ask yourself at each stage.
const ASK = [
  ['Reading the statement', ['Why is this limitation here? How would the problem change without it?', 'What is unusual?', 'What exactly am I asked to do?', 'Can I restate it as a standard problem, a twist on one, or a special case of a hard one?']],
  ['While solving', ['How would I solve an easier version? Smaller limits, or a simpler object: graph, then tree, then array.', 'How do I answer one query?', 'How would I solve a small case on paper? Without time or memory limits?', 'Which observation from the easy version still holds in general?']],
  ['Before coding', ['What is the complexity?', 'Do I understand the problem correctly?', 'What functions do I need?', 'Which places are tricky, and what must I remember to get them right?', 'Which part is heaviest to implement? Can it be simpler?']],
  ['If it is not accepted', ['Did I handle the tricky places I listed?', 'Is the bug in the code or in the idea?', 'Do I understand the problem correctly?', 'Does a brute force agree on small random tests?']],
];

const HINTS = [
  { level: 1, label: 'Technique?', credit: '75% credit', ask: 'Ask whether a standard technique is needed?', cost: 'Credit for this problem drops to 75%.' },
  { level: 2, label: 'Nudge', credit: '50% credit', ask: 'Ask for a nudge in the right direction?', cost: 'Credit for this problem drops to 50%.' },
  { level: 3, label: 'Key idea', credit: '25% credit', ask: 'Reveal the key observation?', cost: 'Credit drops to 25%, and the problem comes back in two weeks for a cold re-solve.' },
  { level: 4, label: 'Solution', credit: 'no credit', ask: 'Show the full solution?', cost: 'This attempt will count as not solved. You implement it yourself afterwards.' },
];

const VERDICT = {
  OK: 'Accepted', WRONG_ANSWER: 'Wrong answer', TIME_LIMIT_EXCEEDED: 'Time limit', MEMORY_LIMIT_EXCEEDED: 'Memory limit', RUNTIME_ERROR: 'Runtime error',
  COMPILATION_ERROR: 'Compilation error', IDLENESS_LIMIT_EXCEEDED: 'Idleness limit', PRESENTATION_ERROR: 'Presentation error', CHALLENGED: 'Hacked',
};
export function verdictChip(v) {
  const name = VERDICT[v.verdict] || v.verdict;
  const where = v.verdict !== 'OK' && v.verdict !== 'COMPILATION_ERROR' && v.passed != null ? ` on test ${v.passed + 1}` : '';
  return h('span', { class: ['vchip', v.verdict === 'OK' && 'ok', v.verdict === 'COMPILATION_ERROR' && 'ce'] }, `${name}${where}`);
}

export async function show(root) {
  let a = await gym.call('attempt.active');
  if (!a) { navigate('practice'); return null; }
  immersive(true);
  const settings = state.boot.settings;
  const idea = a.mode === 'idea';
  let done = false;
  let tab = 'notes';
  let noticeKey = null;
  let stuckSnoozedAt = null;
  let budgetAck = false;
  let reminder = null;
  let reminderAck = false;
  let pageInfo = {};
  let watch = await gym.call('watch.status').catch(() => null);
  const detail = await gym.call('attempt.get', { id: a.id });
  const verdicts = (detail ? detail.events : []).filter((e) => e.kind === 'submission').map((e) => e.data);

  const times = () => {
    const live = a.phase === 'think' || a.phase === 'code' ? Math.max(0, Date.now() - a.phaseStartedAt) : 0;
    const think = a.thinkMs + (a.phase === 'think' ? live : 0);
    const code = a.codeMs + (a.phase === 'code' ? live : 0);
    return { think, code, active: think + code };
  };
  if (times().active < 90000) {
    reminder = await gym.call('attempt.reminder').catch(() => null);
    if (!reminder && settings.habit) reminder = { mistake: null, lessons: [] };
  }

  // Top bar
  const timerMain = h('span', { class: 'timer-main' });
  const timerSplit = h('span', { class: 'timer-split' });
  const timerEl = h('div', { class: 'timer' }, timerSplit, timerMain);
  const phaseSeg = segmented([{ value: 'think', label: 'Think' }, { value: 'code', label: 'Code' }], a.phase === 'code' || a.resumePhase === 'code' ? 'code' : 'think', async (v) => {
    try { setAttempt(await gym.call('attempt.phase', { id: a.id, phase: v })); } catch (e) { fail(e); }
  });
  const pauseBtn = button('Pause', { iconName: 'pause', small: true, onClick: togglePause });
  const watchEl = h('span', { class: 'watch' });

  // Stage
  const view = h('webview', { src: problemUrl(a.contestId, a.index), partition: 'persist:codeforces', class: 'on' });
  const stageNote = h('span', { class: 'stage-note' }, 'Loading Codeforces');
  const focusCheck = h('input', { type: 'checkbox', checked: settings.focusLayout });
  const cf = attachCodeforces(view, {
    pid: a.pid,
    getFocus: () => focusCheck.checked,
    onLoading: (on) => { if (on) stageNote.textContent = 'Loading'; else renderStageNote(); },
    onInfo: (info) => { pageInfo = { ...pageInfo, ...info }; renderStageNote(); renderCaptureNote(); },
  });
  focusCheck.addEventListener('change', () => cf.applyFocus());
  const cover = h('div', { class: 'stage-cover hidden' }, h('div', null,
    h('div', { class: 'stage-cover-title' }, 'Paused'),
    h('p', { class: 'muted', style: { margin: '8px 0 16px' } }, 'The statement is hidden while the clock is stopped.'),
    button('Resume', { kind: 'primary', iconName: 'play', onClick: togglePause })));

  function renderStageNote() {
    if (pageInfo.error) { stageNote.textContent = pageInfo.error; return; }
    if (pageInfo.challenge) { stageNote.textContent = 'Codeforces is running a browser check. Complete it in this panel and the statement will load.'; return; }
    const parts = [];
    if (a.mode === 'upsolve') parts.push('You have seen this solution. Implement it from memory.');
    if (a.mode === 'redo') parts.push('Cold re-solve: no notes, no hints if you can.');
    if (pageInfo.captured && pageInfo.loggedIn === false && !idea) parts.push('Not signed in to Codeforces in this panel: sign in to submit here, or submit from your browser.');
    stageNote.textContent = parts.join(' ');
  }

  // Side: gauges and the single notice slot
  const budgetText = h('strong');
  const budgetBar = h('span');
  const budgetMeter = h('div', { class: 'meter' }, budgetBar);
  const stuckText = h('strong');
  const stuckBar = h('span');
  const stuckMeter = h('div', { class: 'meter' }, stuckBar);
  const stuckGauge = h('div', { class: 'gauge' }, h('div', { class: 'gauge-head' }, h('span', null, 'Since your last new idea'), stuckText), stuckMeter);
  const noticeEl = h('div');
  const verdictEl = h('div', { class: 'verdicts' });
  const renderVerdicts = () => mount(verdictEl, verdicts.slice(-6).map(verdictChip));

  // Notes
  const notesArea = h('textarea', { class: 'textarea', spellcheck: false, placeholder: idea
    ? 'Write the full idea here: the key observation, the algorithm, the complexity. This is what the coach will judge.'
    : 'Scratchpad. Small cases, observations, what you tried and why it fails.' });
  notesArea.value = a.notes || '';
  let notesTimer = null;
  let notesDirty = false;
  const saveNotesNow = async () => {
    clearTimeout(notesTimer);
    if (!notesDirty) return;
    notesDirty = false;
    await gym.call('attempt.notes', { id: a.id, notes: notesArea.value }).catch(() => {});
  };
  notesArea.addEventListener('input', () => { notesDirty = true; clearTimeout(notesTimer); notesTimer = setTimeout(saveNotesNow, 600); });
  const ideaInput = h('input', { class: 'input', placeholder: 'New idea? Log it in one line (Enter)', spellcheck: false });
  const logIdea = async (text) => {
    text = String(text || '').trim();
    if (!text) return;
    await saveNotesNow();
    try {
      setAttempt(await gym.call('attempt.idea', { id: a.id, text }));
      notesArea.value = a.notes;
      notesArea.scrollTop = notesArea.scrollHeight;
    } catch (e) { fail(e); }
  };
  ideaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = ideaInput.value; ideaInput.value = ''; logIdea(v); } });
  const notesPane = h('div', { class: 'notes' }, h('div', { class: 'idea-row' }, ideaInput), notesArea);

  // Coach
  const coachOk = state.boot.coach && state.boot.coach.found;
  // Fallback for when the Codeforces panel cannot show the problem: the statement can be pasted for the coach.
  const captureNote = h('div', { class: 'pane-note hidden' });
  function pasteStatement() {
    const area = h('textarea', { class: 'textarea', rows: 14, placeholder: 'Paste the full statement here', spellcheck: false });
    const overlay = h('div', { class: 'overlay' });
    const saveIt = async () => {
      const text = area.value.trim();
      if (text.length < 40) return toast('That looks too short to be a statement.');
      try {
        await gym.call('statement.save', { pid: a.pid, text });
        pageInfo.captured = true;
        overlay.remove();
        renderCaptureNote();
        toast('Saved for the coach.', { kind: 'good' });
      } catch (e) { fail(e); }
    };
    overlay.appendChild(h('div', { class: 'dialog', style: { width: 'min(660px, calc(100vw - 48px))' } },
      h('h3', { class: 'dialog-title' }, 'Paste the statement for the coach'),
      h('p', { class: 'dialog-body' }, 'For when the Codeforces panel cannot show the problem. Open it in your browser, copy the statement, paste it here.'),
      h('div', { style: { marginTop: '12px' } }, area),
      h('div', { class: 'dialog-actions' }, button('Cancel', { kind: 'ghost', onClick: () => overlay.remove() }), button('Save', { kind: 'primary', onClick: saveIt }))));
    document.body.appendChild(overlay);
    area.focus();
  }
  function renderCaptureNote() {
    captureNote.classList.toggle('hidden', !!pageInfo.captured);
    if (!pageInfo.captured && !captureNote.firstChild) {
      mount(captureNote, 'The coach has not read the statement from the page yet. ',
        h('button', { class: 'link-btn', type: 'button', onClick: pasteStatement }, 'Paste it instead'));
    }
  }
  gym.call('statement.info', { pid: a.pid }).then((i) => { if (i.captured) pageInfo.captured = true; renderCaptureNote(); }).catch(() => {});
  const hintsEl = h('div', { class: 'hints' });
  const panel = chatPanel({
    scope: 'attempt', scopeId: a.id,
    placeholder: 'Ask the coach',
    empty: () => h('div', { class: 'chat-empty' }, icon('chat', 22),
      h('p', null, 'Chat is free: until you unlock a hint, the coach only clarifies the statement and asks questions. Hints cost credit and are tracked.')),
    send: async (text) => { await saveNotesNow(); return gym.call('coach.attempt', { attemptId: a.id, text }); },
    onDone: (p) => { if (p.attempt && !done) setAttempt(p.attempt); },
  });
  async function askHint(level) {
    if (panel.busy()) return toast('The coach is still answering.');
    const meta = HINTS[level - 1];
    if (level > a.hintLevel && !(await confirmDialog({ title: meta.ask, body: meta.cost, confirm: meta.label === 'Solution' ? 'Show solution' : 'Ask' }))) return;
    await saveNotesNow();
    setTab('coach');
    try { panel.begin(await gym.call('coach.attempt', { attemptId: a.id, hintLevel: level })); } catch (e) { fail(e); }
  }
  const renderHints = () => mount(hintsEl, HINTS.map((m) => h('button', {
    class: ['hint-btn', m.level <= a.hintLevel && 'used'], type: 'button', disabled: !coachOk, onClick: () => askHint(m.level),
    title: m.level <= a.hintLevel ? 'Already used: asking again costs nothing more' : m.cost,
  }, h('strong', null, m.label), h('span', null, m.level <= a.hintLevel ? 'used' : m.credit))));
  const coachPane = h('div', { class: 'coach-pane hidden' },
    coachOk ? null : h('div', { class: 'pane-note' }, 'Claude Code was not found on this machine. Set its path in Settings to use the coach.'),
    idea ? h('div', { class: 'pane-note' }, 'Idea drill: write your idea in Notes, then press "Check my idea".') : null,
    captureNote, hintsEl, panel.el);

  // Ask yourself
  const askPane = h('div', { class: 'ask hidden' },
    ASK.map(([title, items]) => [h('h4', null, title), h('ul', null, items.map((q) => h('li', null, q)))]),
    h('p', { class: 'ask-source' }, 'Questions from Um_nik, "Pro Tips".'));

  const tabsEl = h('div', { class: 'tabs' });
  const panes = { notes: notesPane, coach: coachPane, ask: askPane };
  function setTab(next) {
    tab = next;
    mount(tabsEl, [['notes', 'Notes'], ['coach', 'Coach'], ['ask', 'Ask yourself']].map(([k, label]) => h('button', { class: ['tab', tab === k && 'on'], type: 'button', onClick: () => setTab(k) }, label)));
    for (const [k, el] of Object.entries(panes)) el.classList.toggle('hidden', k !== tab);
    if (next === 'coach') panel.focus();
  }

  // Footer actions
  const footEl = h('div', { class: 'side-foot' });
  async function finish(outcome, confirmOpts) {
    if (confirmOpts && !(await confirmDialog(confirmOpts))) return;
    await saveNotesNow();
    try { await gym.call('attempt.finish', { id: a.id, outcome }); } catch (e) { fail(e); }
  }
  const park = () => finish('parked', { title: 'Park this problem?', body: 'No spoilers. It counts as not solved for now and returns to your queue in 30 days, when you have new ways to look at it.', confirm: 'Park it' });
  async function checkIdea() {
    if (panel.busy()) return toast('The coach is still answering.');
    if (!notesArea.value.trim()) { setTab('notes'); return toast('Write your idea in the notes first.'); }
    notesDirty = true;
    await saveNotesNow();
    setTab('coach');
    try { panel.begin(await gym.call('coach.checkIdea', { attemptId: a.id })); } catch (e) { fail(e); }
  }
  const renderFoot = () => mount(footEl,
    idea ? button('Check my idea', { kind: 'primary', iconName: 'check', disabled: !coachOk, onClick: checkIdea }) : null,
    a.hintLevel >= 4 && !idea ? button('Implement later', { onClick: () => finish('failed', { title: 'Stop here and implement it later?', body: 'The problem goes to your upsolve queue.', confirm: 'Stop here' }) }) : null,
    button('Park', { kind: 'ghost', iconName: 'park', onClick: park, title: 'Stop without spoilers and come back in a month' }),
    idea ? null : button('Mark solved', { kind: 'ghost', onClick: () => finish('solved', { title: 'Mark as solved by hand?', body: 'Verdicts normally arrive from Codeforces on their own. Use this only if they are not coming through.', confirm: 'Mark solved' }) }),
    button('Discard', { kind: 'ghost', onClick: () => finish('abandoned', { title: 'Discard this attempt?', body: 'It will not count for anything and the problem may be offered again.', confirm: 'Discard', danger: true }) }));

  // Notices: one at a time, most urgent first.
  function notice(key) {
    if (key === noticeKey) return;
    noticeKey = key;
    const t = times();
    if (key === 'stuck') {
      mount(noticeEl, h('div', { class: 'notice warm' },
        h('div', { class: 'notice-title' }, `No new idea for ${Math.round((t.active - a.progressMarkMs) / 60000)} minutes`),
        'That is what stuck means. Decide instead of drifting.',
        h('div', { class: 'notice-actions' },
          coachOk ? button('Technique check', { small: true, onClick: () => askHint(1) }) : null,
          coachOk ? button('Nudge', { small: true, onClick: () => askHint(2) }) : null,
          button('Park it', { small: true, onClick: park }),
          button('Keep thinking', { small: true, kind: 'ghost', onClick: async () => { stuckSnoozedAt = times().active; setAttempt(await gym.call('attempt.checkin', { id: a.id, type: 'stuck' }).catch(() => a)); notice(null); } }))));
    } else if (key === 'checkin') {
      const input = h('input', { class: 'input', placeholder: 'One line', spellcheck: false });
      const log = async () => { const v = input.value.trim(); if (!v) return input.focus(); await logIdea(v); notice(null); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); log(); } });
      const mark = async (type) => { try { setAttempt(await gym.call('attempt.checkin', { id: a.id, type })); } catch (e) { fail(e); } notice(null); };
      mount(noticeEl, h('div', { class: 'notice calm' },
        h('div', { class: 'notice-title' }, `${Math.floor(t.active / 60000)} minutes in. What are you trying right now?`),
        input,
        h('div', { class: 'notice-actions' }, button('Log it', { small: true, onClick: log }), button('Nothing new', { small: true, kind: 'ghost', onClick: () => mark('stuck') }), button('I drifted', { small: true, kind: 'ghost', onClick: () => mark('drift') }))));
    } else if (key === 'budget') {
      mount(noticeEl, h('div', { class: 'notice' },
        h('div', { class: 'notice-title' }, 'Past your time budget'),
        `You planned about ${minutes(a.budgetMs)} for this one. Finish it, park it, or read the solution: your call, but make it a decision.`,
        h('div', { class: 'notice-actions' }, button('Got it', { small: true, onClick: () => { budgetAck = true; notice(null); } }))));
    } else if (key === 'reminder') {
      mount(noticeEl, h('div', { class: 'notice' },
        h('div', { class: 'notice-title' }, 'Before you start'),
        h('div', { class: 'stack', style: { gap: '4px' } },
          reminder.mistake ? h('div', null, `Your most common slip lately: ${reminder.mistake.label.toLowerCase()} (${reminder.mistake.n} of your last ${reminder.mistake.of} reflections).`) : null,
          (reminder.lessons || []).map((l) => h('div', { class: 'quote' }, l)),
          settings.habit ? h('div', null, `Habit this week: ${settings.habit}`) : null),
        h('div', { class: 'notice-actions' }, button('Got it', { small: true, onClick: () => { reminderAck = true; notice(null); } }))));
    } else if (key === 'solution') {
      mount(noticeEl, h('div', { class: 'notice' }, h('div', { class: 'notice-title' }, 'Solution revealed'), 'Close the coach tab and implement it from your own understanding. The clock keeps running.'));
    } else mount(noticeEl);
  }

  function setAttempt(next) {
    if (!next) return;
    a = next;
    phaseSeg.set(a.phase === 'paused' ? (a.resumePhase || 'think') : a.phase === 'code' ? 'code' : 'think');
    mount(pauseBtn, icon(a.phase === 'paused' ? 'play' : 'pause', 15), h('span', null, a.phase === 'paused' ? 'Resume' : 'Pause'));
    cover.classList.toggle('hidden', a.phase !== 'paused');
    timerEl.classList.toggle('paused', a.phase === 'paused');
    renderHints();
    renderFoot();
    tick();
  }

  async function togglePause() {
    try { setAttempt(await gym.call(a.phase === 'paused' ? 'attempt.resume' : 'attempt.pause', { id: a.id })); } catch (e) { fail(e); }
  }

  function renderWatch() {
    if (idea) return mount(watchEl);
    const handle = settings.handle;
    watchEl.className = `watch${!handle ? ' off' : watch && watch.ok === false ? ' bad' : ''}`;
    watchEl.title = watch && watch.error ? watch.error : 'Verdicts for this problem are read from your Codeforces submissions.';
    mount(watchEl, h('span', { class: 'watch-dot' }), !handle ? 'No handle set' : watch && watch.ok === false ? 'Codeforces unreachable' : 'Watching your submissions');
  }

  function tick() {
    if (done) return;
    const t = times();
    timerMain.textContent = a.phase === 'paused' ? `${clock(t.active)} paused` : clock(t.active);
    timerSplit.textContent = idea ? '' : `think ${clock(t.think)} · code ${clock(t.code)}`;
    const b = a.budgetMs || 1;
    budgetText.textContent = `${clock(t.active)} of ${minutes(b)}`;
    budgetBar.style.width = `${Math.min(100, (t.active / b) * 100)}%`;
    budgetMeter.className = `meter${t.active >= b ? ' over' : t.active >= 0.8 * b ? ' warn' : ''}`;
    const since = Math.max(0, t.active - a.progressMarkMs);
    const st = a.stuckMs || 1;
    stuckGauge.classList.toggle('hidden', a.phase === 'code' || (a.phase === 'paused' && a.resumePhase === 'code'));
    stuckText.textContent = `${clock(since)} of ${minutes(st)}`;
    stuckBar.style.width = `${Math.min(100, (since / st) * 100)}%`;
    stuckMeter.className = `meter${since >= st ? ' over' : since >= 0.8 * st ? ' warn' : ''}`;

    // An open notice the user is typing into must not be replaced under their hands.
    if (noticeKey === 'checkin' && noticeEl.contains(document.activeElement)) return;
    let want = null;
    const thinking = a.phase === 'think';
    const checkEvery = (settings.checkinMinutes || 0) * 60000;
    if (thinking && since >= st && (stuckSnoozedAt === null || t.active - stuckSnoozedAt >= 10 * 60000)) want = 'stuck';
    else if (thinking && checkEvery > 0 && t.active - Math.max(a.checkinMarkMs, a.progressMarkMs) >= checkEvery) want = 'checkin';
    else if (!budgetAck && t.active >= b && a.phase !== 'paused') want = 'budget';
    else if (reminder && !reminderAck && t.active < 4 * 60000) want = 'reminder';
    else if (a.hintLevel >= 4 && !idea) want = 'solution';
    notice(want);
  }

  const offs = [
    gym.on('submission', (p) => { if (p.attemptId === a.id) { verdicts.push(p); renderVerdicts(); } }),
    gym.on('watch', (w) => { watch = w; renderWatch(); }),
    gym.on('attempt', (p) => {
      if (p.id !== a.id || done) return;
      done = true;
      if (p.status === 'solved') toast(idea ? 'Idea accepted.' : 'Accepted. Well done.', { kind: 'good' });
      else if (p.status === 'parked') toast('Parked. It returns to your queue in 30 days.');
      if (p.status === 'solved' || p.status === 'failed') navigate('reflect', { id: a.id });
      else navigate('home');
    }),
  ];

  mount(root, h('div', { class: 'work' },
    h('header', { class: 'work-bar' },
      h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Back to Today (the clock keeps running)', onClick: () => navigate('home') }, icon('back', 16)),
      h('div', { class: 'work-title' }, ratingEl(a.rating), h('span', { class: 'work-name' }, a.name), h('span', { class: 'badge' }, MODES[a.mode])),
      idea ? null : phaseSeg, pauseBtn, watchEl, timerEl),
    h('div', { class: 'work-body' },
      h('section', { class: 'stage' },
        h('div', { class: 'stage-bar' },
          button('Statement', { small: true, kind: 'ghost', onClick: () => cf.go(problemUrl(a.contestId, a.index)) }),
          idea ? null : button('Submit', { small: true, kind: 'ghost', onClick: () => cf.go(submitUrl(a.contestId, a.index)) }),
          idea || !settings.handle ? null : button('My submissions', { small: true, kind: 'ghost', onClick: () => cf.go(submissionsUrl(settings.handle)) }),
          h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Reload', onClick: () => cf.reload() }, icon('refresh', 14)),
          h('label', { class: 'check', style: { marginLeft: '6px', fontSize: '12.5px' } }, focusCheck, h('span', null, 'Statement only')),
          stageNote, h('span', { class: 'spacer' }),
          h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Open in your browser', onClick: () => openExternal(a.url) }, icon('external', 14))),
        h('div', { class: 'stage-views' }, view, cover)),
      h('aside', { class: 'side' },
        h('div', { class: 'side-top' },
          h('div', { class: 'gauge' }, h('div', { class: 'gauge-head' }, h('span', null, 'Time on this problem'), budgetText), budgetMeter),
          stuckGauge, verdictEl, noticeEl),
        tabsEl,
        h('div', { class: 'tab-body' }, notesPane, coachPane, askPane),
        footEl))));

  setTab('notes');
  setAttempt(a);
  renderVerdicts();
  renderWatch();
  panel.load().catch(() => {});
  const timer = setInterval(tick, 500);

  return () => {
    done = true;
    clearInterval(timer);
    offs.forEach((off) => off());
    panel.destroy();
    if (notesDirty) gym.call('attempt.notes', { id: a.id, notes: notesArea.value }).catch(() => {});
    immersive(false);
  };
}
