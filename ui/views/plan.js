// Plan: the week built from the time you have and what your log says, and how much of it you did.
import { h, mount, icon, button } from '../lib/dom.js';
import { gym, state, navigate, fail, toast, openExternal } from '../lib/gym.js';
import { columns, chartCard } from '../lib/charts.js';
import { day, hoursMinutes, percent, signed, dateTime } from '../lib/format.js';
import { markdown } from '../lib/md.js';

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS = {
  done: { label: 'Done', tone: 'green' }, partial: { label: 'Partly done', tone: 'yellow' }, missed: { label: 'Missed', tone: 'red' },
  today: { label: 'Today', tone: 'blue' }, upcoming: { label: 'Planned', tone: 'gray' }, rest: { label: 'Rest', tone: 'gray' }, none: { label: 'No plan', tone: 'gray' },
};

// Starts whatever a block asks for.
export async function runBlock(b) {
  const a = b.action || {};
  if (a.type === 'practice') return navigate('practice', { mode: a.mode, difficulty: a.difficulty, topic: a.topic });
  if (a.type === 'contest') return navigate('contest');
  if (a.type === 'round') return openExternal(`https://codeforces.com/contest/${a.contestId}`);
  if (a.type === 'queue') {
    const items = await gym.call('queue.list').catch(() => []);
    const q = items.find((x) => x.due && (a.kind === 'upsolve' ? x.kind === 'upsolve' : x.kind !== 'upsolve'));
    if (!q) {
      toast(a.kind === 'upsolve' ? 'Nothing in the upsolve queue: pick an unsolved problem from your past rounds.' : 'No re-solve is due yet.');
      return navigate('practice');
    }
    try { await gym.call('attempt.start', { queueId: q.id }); navigate('solve'); } catch (e) { fail(e); }
  }
}

// One block: a check circle (click to mark done by hand), title, detail, progress, start.
export function blockRow(d, b, { onChange, dark = false, blocked = false } = {}) {
  const canCheck = d.isToday || d.isPast;
  const toggle = h('button', {
    class: ['plan-check', b.complete && 'on'], type: 'button', disabled: !canCheck, title: b.complete ? (b.manual ? 'Marked done by hand. Click to undo.' : 'Done') : 'Mark as done',
    onClick: async () => {
      if (b.complete && !b.manual) return;
      try { onChange(await gym.call('plan.check', { day: d.key, index: b.index, done: !b.manual })); } catch (e) { fail(e); }
    },
  }, b.complete ? icon('check', 13) : null);
  const meta = [b.detail, b.why].filter(Boolean).join(' ');
  const when = b.kind === 'round' && b.startAt ? `${dateTime(b.startAt)}` : null;
  return h('div', { class: ['plan-block', b.complete && 'complete', b.optional && 'optional', dark && 'dark'] },
    toggle,
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'plan-block-title' }, b.title, b.optional ? h('span', { class: 'plan-opt' }, 'optional') : null),
      h('div', { class: 'plan-block-meta' }, when ? `${when}. ` : '', meta)),
    h('div', { class: 'plan-block-side' },
      b.n > 1 ? h('span', { class: 'plan-count' }, `${b.done}/${b.n}`) : null,
      d.isToday && !b.complete ? button(b.kind === 'round' ? 'Open' : 'Start', { small: true, kind: dark ? 'primary' : 'default', iconName: b.kind === 'round' ? 'external' : 'play', disabled: blocked && b.kind !== 'round', onClick: () => runBlock(b) }) : null));
}

// Seven small cells with the share of each day's plan that is done.
export function weekStrip(v, { onClick } = {}) {
  return h('div', { class: 'plan-strip' }, v.days.map((d, i) => h('button', {
    class: ['plan-cell', d.status, d.isToday && 'is-today'], type: 'button', onClick, title: `${d.weekday}: ${STATUS[d.status].label}${d.planned ? `, ${d.doneMinutes} of ${d.planned} planned minutes` : ''}`,
  },
  h('span', { class: 'plan-cell-day' }, SHORT[i]),
  h('span', { class: 'plan-cell-bar' }, h('span', { style: { height: `${Math.round((d.status === 'rest' || d.status === 'none' ? 0 : d.ratio) * 100)}%` } })),
  h('span', { class: 'plan-cell-min' }, d.planned ? `${d.planned}m` : d.status === 'rest' ? 'rest' : '-'))));
}

function noteCard(v) {
  const coachOk = state.boot.coach && state.boot.coach.found;
  const body = h('div', { class: 'review-body' });
  const btn = button(v.note ? 'Write a new note' : 'Ask the coach', { iconName: 'bolt', small: true, disabled: !coachOk });
  let job = null;
  let text = '';
  const render = (n) => mount(body, n
    ? [h('p', { class: 'card-sub', style: { marginBottom: '8px' } }, `Written ${day(n.createdAt)}`), markdown(n.content)]
    : h('p', { class: 'empty' }, coachOk ? 'The coach reads your log and this plan, and tells you what matters most this week.' : 'Claude Code was not found. Set it up in Settings to get a note.'));
  render(v.note);
  btn.addEventListener('click', async () => {
    try {
      job = (await gym.call('coach.planNote')).jobId;
      text = '';
      btn.disabled = true;
      mount(body, h('div', { class: 'msg-status' }, h('span', { class: 'pulse' }), h('span', null, 'Reading your week')));
    } catch (e) { fail(e); }
  });
  const offs = [
    gym.on('coach:delta', (p) => { if (p.jobId === job) { text += p.text; mount(body, markdown(text)); } }),
    gym.on('coach:done', (p) => { if (p.jobId === job) { job = null; btn.disabled = false; render(p.note); } }),
    gym.on('coach:error', (p) => { if (p.jobId === job) { job = null; btn.disabled = false; mount(body, h('div', { class: 'msg-error' }, p.error)); } }),
  ];
  const el = h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Coach note'), btn), body);
  return { el, destroy: () => offs.forEach((off) => off()) };
}

function availabilityCard(v, onChange) {
  const values = [...v.availability.minutes];
  let rounds = v.availability.rounds;
  const inputs = SHORT.map((label, i) => h('label', { class: 'plan-avail-day' }, h('span', null, label),
    h('input', { class: 'input num', type: 'number', min: 0, max: 480, step: 15, value: values[i], onChange: (e) => { values[i] = Number(e.target.value) || 0; } })));
  const save = button('Save and replan', { small: true, kind: 'primary', onClick: async (e) => {
    e.currentTarget.disabled = true;
    try { onChange(await gym.call('plan.availability', { minutes: values, rounds })); toast('Plan rebuilt from today.', { kind: 'good' }); } catch (err) { fail(err); }
  } });
  return h('section', { class: 'card' },
    h('header', { class: 'card-head' }, h('div', null, h('h3', { class: 'card-title' }, 'Your usual week'), h('p', { class: 'card-sub' }, 'Minutes you can train each day. 0 is a rest day.'))),
    h('div', { class: 'plan-avail' }, inputs),
    h('label', { class: 'check', style: { marginTop: '14px' } }, h('input', { type: 'checkbox', checked: rounds, onChange: (e) => { rounds = e.target.checked; } }), h('span', null, 'Plan around upcoming rated Codeforces rounds')),
    h('div', { class: 'row', style: { marginTop: '14px' } }, save));
}

export async function show(root) {
  let v = await gym.call('plan.get');
  let note = null;
  const blocked = !!(state.boot.active.attempt || state.boot.active.contest);

  const render = () => {
    if (note) note.destroy();
    note = noteCard(v);
    const m = v.metrics;
    const tiles = [
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Plan done'), h('div', { class: 'tile-value' }, percent(m.adherence)),
        h('div', { class: 'meter', style: { marginTop: '10px' } }, h('span', { style: { width: `${Math.round(m.adherence * 100)}%` } })),
        h('div', { class: 'tile-note' }, 'Of planned minutes up to today')),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Trained this week'), h('div', { class: 'tile-value' }, hoursMinutes(m.weekTrained)),
        h('div', { class: 'tile-note' }, `of ${hoursMinutes(m.weekPlanned)} planned${m.extra ? `, ${m.extra} extra` : ''}`)),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Streak'), h('div', { class: 'tile-value' }, m.streak, h('small', null, m.streak === 1 ? ' day' : ' days')),
        h('div', { class: 'tile-note' }, 'Planned days finished in a row')),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Solved at level'), h('div', { class: 'tile-value' }, m.solvedAtLevel),
        h('div', { class: 'tile-note' }, `This week. ${m.levelChange ? `Level ${signed(m.levelChange)}` : 'Level unchanged'}`)),
    ];

    const before = v.days.filter((d) => d.status === 'none');
    const shown = v.days.filter((d) => d.status !== 'none');
    const week = h('section', { class: 'card span-8 flush', style: { alignSelf: 'start' } },
      before.length ? h('div', { class: 'plan-day' }, h('p', { class: 'plan-started muted' }, `The plan started on ${shown.length ? shown[0].weekday : 'today'}. Earlier days this week had no plan.`)) : null,
      shown.map((d) => h('div', { class: ['plan-day', d.isToday && 'is-today'] },
      h('div', { class: 'plan-day-head' },
        h('div', null, h('span', { class: 'plan-day-name' }, d.weekday), h('span', { class: 'muted' }, ` ${day(d.date)}`)),
        h('div', { class: 'row' }, d.minutes ? h('span', { class: 'muted' }, `${d.minutes} min${d.override ? ' (today only)' : ''}`) : null,
          d.trained ? h('span', { class: 'muted' }, `trained ${hoursMinutes(d.trained)}`) : null,
          h('span', { class: ['badge', STATUS[d.status].tone] }, STATUS[d.status].label))),
      d.blocks.length ? d.blocks.map((b) => blockRow(d, b, { onChange: (nv) => { v = nv; render(); }, blocked }))
        : h('p', { class: 'empty' }, 'Rest.'))));

    const why = h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Why this plan')),
      h('ul', { class: 'plan-why' }, (v.profile.notes || []).map((n) => h('li', null, n))));

    const hist = v.history;
    const history = chartCard({
      title: 'Plan done by week', subtitle: 'Share of the planned minutes you covered.',
      empty: hist.length < 2 ? 'Shows up after your second planned week.' : null,
      body: columns({ data: hist.map((w) => ({ label: day(new Date(w.week.replace(/-/g, '/')).getTime()), value: Math.round(w.adherence * 100), tip: [{ value: `${Math.round(w.adherence * 100)}%`, label: 'done' }, { value: `${w.trained} min`, label: 'trained' }] })), format: (x) => `${x}%`, label: 'Plan done by week' }),
      table: { columns: [{ key: 'week', label: 'Week of' }, { key: 'planned', label: 'Planned min', align: 'right' }, { key: 'done', label: 'Done min', align: 'right' }, { key: 'trained', label: 'Trained min', align: 'right' }, { key: 'adherence', label: 'Done', align: 'right', format: percent }], rows: hist },
    });
    history.classList.add('span-12');

    mount(root, h('div', { class: 'page' },
      h('header', { class: 'page-head' },
        h('div', null, h('h1', { class: 'page-title' }, 'Plan'), h('p', { class: 'page-sub' }, `Week of ${day(v.week.start)}. Rebuilt every day from what you did; past days stay as they were.`)),
        button('Replan from today', { iconName: 'refresh', onClick: async () => { try { v = await gym.call('plan.replan'); render(); toast('Plan rebuilt from today.', { kind: 'good' }); } catch (e) { fail(e); } } })),
      h('div', { class: 'bento' }, tiles, week,
        h('div', { class: 'span-4 stack' }, note.el, why, availabilityCard(v, (nv) => { v = nv; render(); })),
        history)));
  };
  render();
  return () => { if (note) note.destroy(); };
}
