// Today: where you stand, what to do next, what is waiting in the queue.
import { h, mount, icon, segmented, button } from '../lib/dom.js';
import { gym, state, saveSettings, navigate, fail, confirmDialog } from '../lib/gym.js';
import { hoursMinutes, minutes, relative, ratingColor, OUTCOMES, MODES, QUEUE_KINDS, signed, day } from '../lib/format.js';

export const ratingEl = (r) => h('span', { class: 'rating' }, h('span', { class: 'rating-dot', style: { background: ratingColor(r) } }), r ?? 'unrated');

export function outcomeBadge(outcome) {
  const o = OUTCOMES[outcome] || OUTCOMES.active;
  return h('span', { class: ['badge', o.tone] }, o.label);
}

async function startQueue(queueId) {
  try {
    await gym.call('attempt.start', { queueId });
    navigate('solve');
  } catch (e) { fail(e); }
}

export async function show(root) {
  const o = await gym.call('stats.overview');
  const b = state.boot;
  const s = b.settings;
  const active = b.active;
  const today = new Date();

  const lo = Math.floor((Math.min(o.level.base, o.level.value) - 100) / 100) * 100;
  const pct = Math.max(0, Math.min(1, (o.level.value - lo) / Math.max(1, o.level.target - lo)));
  const change = o.level.change30;

  const levelCard = h('section', { class: 'card span-7' },
    h('div', { class: 'tile-label' }, 'Gym level'),
    h('div', { class: 'row', style: { alignItems: 'baseline', gap: '14px', marginTop: '8px' } },
      h('div', { class: 'hero-value' }, o.level.value),
      o.level.n ? h('span', { class: ['delta', change >= 0 ? 'up' : 'down'] }, `${signed(change)} in 30 days`) : h('span', { class: 'muted' }, 'starting estimate')),
    h('div', { class: 'goal-row' }, h('div', { class: 'meter' }, h('span', { style: { width: `${pct * 100}%` } }))),
    h('div', { class: 'goal-ends' }, h('span', null, lo), h('span', null, `goal ${o.level.target}`)),
    h('p', { class: 'tile-note', style: { marginTop: '14px' } },
      o.cf ? `Codeforces rating ${o.cf.rating ?? 'unrated'}${o.cf.maxRating ? `, max ${o.cf.maxRating}` : ''}. ` : '',
      o.level.n ? `Based on ${o.level.n} counted attempts.` : ''));

  let next;
  if (active.contest) {
    next = { label: 'Running now', title: active.contest.title, detail: 'Your contest clock is running.', actions: [button('Back to the contest', { kind: 'primary', iconName: 'flag', onClick: () => navigate('contest') })] };
  } else if (active.attempt) {
    next = { label: 'In progress', title: active.attempt.name, detail: `${MODES[active.attempt.mode]} problem, ${active.attempt.phase === 'paused' ? 'paused' : 'clock running'}.`, actions: [button('Resume', { kind: 'primary', iconName: 'play', onClick: () => navigate('solve') })] };
  } else {
    const sg = o.suggestion;
    const run = sg.kind === 'queue' ? () => startQueue(sg.queueId) : sg.kind === 'contest' ? () => navigate('contest') : sg.kind === 'idea' ? () => navigate('practice', { mode: 'idea' }) : () => navigate('practice');
    next = {
      label: 'Suggested now', title: sg.title, detail: sg.detail,
      actions: [button('Start', { kind: 'primary', iconName: 'play', onClick: run }),
        sg.kind !== 'practice' ? button('Practice', { kind: 'ghost', onClick: () => navigate('practice') }) : null,
        sg.kind !== 'idea' ? button('Idea drill', { kind: 'ghost', onClick: () => navigate('practice', { mode: 'idea' }) }) : null,
        sg.kind !== 'contest' ? button('Contest', { kind: 'ghost', onClick: () => navigate('contest') }) : null],
    };
  }
  const nextCard = h('section', { class: 'card next-card span-5' },
    h('div', { class: 'tile-label' }, next.label), h('div', { class: 'next-title' }, next.title), h('p', { class: 'next-detail' }, next.detail),
    h('div', { class: 'next-actions' }, next.actions));

  const goalPct = Math.min(1, o.month.notEasy / Math.max(1, o.month.goal));
  const tiles = [
    h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Trained this week'), h('div', { class: 'tile-value' }, hoursMinutes(o.week.minutes)),
      h('div', { class: 'tile-note' }, `${o.week.problems} problems on ${o.week.days} ${o.week.days === 1 ? 'day' : 'days'}`)),
    h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Clean solves this week'), h('div', { class: 'tile-value' }, o.week.clean, h('small', null, ` of ${o.week.problems}`)),
      h('div', { class: 'tile-note' }, 'No hints, no editorial')),
    h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Not-easy problems this month'), h('div', { class: 'tile-value' }, o.month.notEasy, h('small', null, ` of ${o.month.goal}`)),
      h('div', { class: 'meter', style: { marginTop: '10px' } }, h('span', { style: { width: `${goalPct * 100}%` } }))),
    h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Last virtual contest'),
      h('div', { class: 'tile-value' }, o.lastContest ? relative(o.lastContest.endedAt) : 'None yet'),
      h('div', { class: 'tile-note' }, o.lastContest ? `Solved ${o.lastContest.solved}, performance ${o.lastContest.perf ?? '-'}` : null)),
  ];

  const queueList = h('div', { class: 'list' });
  const renderQueue = (items) => {
    if (!items.length) return mount(queueList, h('p', { class: 'empty' }, 'Nothing waiting.'));
    mount(queueList, items.slice(0, 8).map((q) => h('div', { class: 'list-row' },
      h('span', { class: ['badge', q.kind === 'upsolve' ? 'blue' : q.kind === 'redo' ? 'yellow' : 'gray'] }, QUEUE_KINDS[q.kind]),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'list-title' }, q.name), h('div', { class: 'list-meta wrap' }, q.reason || '')),
      h('div', { class: 'list-side' }, ratingEl(q.rating), q.due ? null : h('span', null, `due ${relative(q.dueAt)}`),
        button(q.due ? 'Start' : 'Start early', { small: true, kind: q.due ? 'default' : 'ghost', onClick: () => startQueue(q.id) }),
        h('button', { class: 'btn ghost small icon-only', type: 'button', title: 'Remove from queue', onClick: async () => {
          if (!(await confirmDialog({ title: `Remove ${q.name} from the queue?`, body: 'It will not come back on its own.', confirm: 'Remove' }))) return;
          await gym.call('queue.remove', { id: q.id }).catch(fail);
          renderQueue((await gym.call('queue.list')));
        } }, icon('x', 14))))));
  };
  renderQueue(o.queue.items);

  const recent = o.recent.length
    ? h('div', { class: 'list' }, o.recent.map((a) => h('button', { class: 'list-row', type: 'button', onClick: () => navigate(a.reflected || a.mode === 'contest' ? 'journal' : 'reflect', { id: a.id }) },
      ratingEl(a.rating),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'list-title' }, a.name),
        h('div', { class: 'list-meta' }, `${MODES[a.mode]}, ${a.mode === 'contest' ? minutes(a.thinkMs) : `think ${minutes(a.thinkMs)}, code ${minutes(a.codeMs)}`}${a.reflected || a.mode === 'contest' ? '' : '. Reflection pending'}`)),
      h('div', { class: 'list-side' }, outcomeBadge(a.outcome), h('span', null, day(a.endedAt))))))
    : h('p', { class: 'empty' }, 'Nothing yet.');

  const notices = [];
  if (!b.problems) notices.push(h('div', { class: 'notice warm' }, h('div', { class: 'notice-title' }, 'The problem set is not downloaded yet'), 'Practice and contests need it.',
    h('div', { class: 'notice-actions' }, button('Download now', { small: true, onClick: async (e) => { e.currentTarget.disabled = true; try { await gym.call('sync.all'); navigate('home'); } catch (err) { fail(err); } } }))));
  if (o.unreflected > 0) notices.push(h('div', { class: 'notice' }, h('div', { class: 'notice-title' }, `${o.unreflected} finished ${o.unreflected === 1 ? 'problem has' : 'problems have'} no reflection yet`),
    h('div', { class: 'notice-actions' }, button('Open the journal', { small: true, onClick: () => navigate('journal') }))));
  if (o.focus.length || s.habit) notices.push(h('div', { class: 'notice calm' }, h('div', { class: 'notice-title' }, 'From your last coach review'),
    o.focus.length ? `Extra weight on ${o.focus.join(', ')} for two weeks. ` : '', s.habit ? `Habit: ${s.habit}` : ''));

  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null, h('h1', { class: 'page-title' }, 'Today'), h('p', { class: 'page-sub' }, today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'I have'), segmented([30, 60, 90, 120].map((m) => ({ value: m, label: m === 120 ? '2 h or more' : `${m} min` })),
        [30, 60, 90, 120].includes(s.sessionMinutes) ? s.sessionMinutes : s.sessionMinutes > 105 ? 120 : s.sessionMinutes > 75 ? 90 : s.sessionMinutes > 45 ? 60 : 30,
        async (v) => { await saveSettings({ sessionMinutes: v }).catch(fail); navigate('home'); }))),
    notices.length ? h('div', { class: 'stack', style: { marginBottom: '16px' } }, notices) : null,
    h('div', { class: 'bento' }, levelCard, nextCard, tiles,
      h('section', { class: 'card span-7' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Queue')), queueList),
      h('section', { class: 'card span-5' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Recent'), h('button', { class: 'link-btn', type: 'button', onClick: () => navigate('journal') }, 'Journal')), recent))));
}
