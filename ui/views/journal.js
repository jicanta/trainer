// Journal: every attempt with its idea, what was missed and the full record of how it went.
import { h, mount, icon, button } from '../lib/dom.js';
import { gym, state, navigate, fail, toast, confirmDialog, openExternal } from '../lib/gym.js';
import { minutes, day, dayYear, clock, MODES, OUTCOMES } from '../lib/format.js';
import { chatPanel } from '../lib/chat.js';
import { ratingEl, outcomeBadge } from './home.js';

const VERDICT = { OK: 'Accepted', WRONG_ANSWER: 'Wrong answer', TIME_LIMIT_EXCEEDED: 'Time limit exceeded', MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded', RUNTIME_ERROR: 'Runtime error', COMPILATION_ERROR: 'Compilation error' };

function eventText(e, hintNames) {
  const d = e.data || {};
  switch (e.kind) {
    case 'start': return 'Started';
    case 'phase': return d.phase === 'code' ? 'Started coding' : 'Back to thinking';
    case 'pause': return d.reason ? `Paused (${d.reason})` : 'Paused';
    case 'resume': return 'Resumed';
    case 'idea': return `Idea: ${d.text}`;
    case 'stuck': return 'Check-in: nothing new';
    case 'drift': return 'Check-in: drifted';
    case 'hint': return `Hint: ${hintNames[d.level] || d.level}`;
    case 'submission': return `${VERDICT[d.verdict] || d.verdict}${d.verdict !== 'OK' && d.passed != null ? ` on test ${d.passed + 1}` : ''}`;
    case 'finish': return `Finished: ${d.outcome}${d.manual ? ' (marked by hand)' : ''}`;
    default: return e.kind;
  }
}

async function showDetail(root, id) {
  const a = await gym.call('attempt.get', { id });
  if (!a) { navigate('journal'); return null; }
  const b = state.boot;
  const panel = chatPanel({ scope: 'attempt', scopeId: id, readOnly: true, empty: () => h('div', { class: 'chat-empty' }, h('p', null, 'No conversation with the coach on this problem.')) });
  const correct = async (status) => {
    try { await gym.call('attempt.setResult', { id, status }); toast('Result corrected.'); navigate('journal', { id }); } catch (e) { fail(e); }
  };
  const reflection = a.reflected
    ? h('div', { class: 'stack' },
      a.keyIdea ? h('div', null, h('div', { class: 'field-label' }, 'Key idea'), h('p', null, a.keyIdea)) : null,
      a.missed ? h('div', null, h('div', { class: 'field-label' }, 'What I missed'), h('p', null, a.missed)) : null,
      a.mistake && a.mistake !== 'none' ? h('div', null, h('div', { class: 'field-label' }, 'What went wrong'), h('p', null, b.meta.mistakes[a.mistake] || a.mistake)) : null,
      a.takeaway ? h('div', null, h('div', { class: 'field-label' }, 'Takeaway'), h('p', { class: 'quote' }, a.takeaway)) : null)
    : h('p', { class: 'empty' }, 'No reflection yet.');

  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'row', style: { marginBottom: '10px' } }, outcomeBadge(a.outcome), h('span', { class: 'badge' }, MODES[a.mode]), h('span', { class: 'muted' }, dayYear(a.endedAt || a.startedAt))),
        h('h1', { class: 'page-title' }, a.name),
        h('div', { class: 'row wrap', style: { marginTop: '12px' } }, ratingEl(a.rating), (a.tags || []).map((t) => h('span', { class: 'tag' }, t)))),
      h('div', { class: 'row' }, button('Journal', { kind: 'ghost', iconName: 'back', onClick: () => navigate('journal') }),
        button('Problem', { kind: 'ghost', iconName: 'external', onClick: () => openExternal(a.url) }))),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' },
          h('div', { class: 'facts', style: { marginBottom: '18px' } },
            a.mode === 'contest' ? h('span', null, 'Time on problem ', h('strong', null, minutes(a.thinkMs))) : [h('span', null, 'Think ', h('strong', null, minutes(a.thinkMs))), h('span', null, 'Code ', h('strong', null, minutes(a.codeMs)))],
            h('span', null, 'Wrong submissions ', h('strong', null, a.wrongSubs)), h('span', null, 'Help ', h('strong', null, b.meta.hintNames[a.hintLevel])),
            a.drifts ? h('span', null, 'Drifts ', h('strong', null, a.drifts)) : null),
          h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Reflection'),
            button(a.reflected ? 'Edit' : 'Write it', { small: true, onClick: () => navigate('reflect', { id, back: 'journal' }) })),
          reflection),
        a.notes ? h('section', { class: 'card' }, h('h3', { class: 'card-title', style: { marginBottom: '10px' } }, 'Notes'), h('pre', { class: 'notes-view' }, a.notes)) : null,
        a.events.length ? h('section', { class: 'card' }, h('h3', { class: 'card-title', style: { marginBottom: '10px' } }, 'Timeline'),
          h('div', { class: 'timeline' }, a.events.map((e) => h('div', null, h('span', null, clock(Math.max(0, e.t - a.startedAt))), eventText(e, b.meta.hintNames))))) : null,
        h('section', { class: 'card' }, h('h3', { class: 'card-title', style: { marginBottom: '12px' } }, 'Actions'),
          h('div', { class: 'row wrap' },
            button('Re-solve it later', { onClick: async () => {
              try { const ok = await gym.call('queue.add', { pid: a.pid, kind: 'redo', days: 0, reason: 'You asked to solve it again.' }); toast(ok ? 'Added to your queue.' : 'Already in your queue.'); } catch (e) { fail(e); }
            } }),
            a.status !== 'solved' && a.mode !== 'contest' ? button('Correct: I solved it', { kind: 'ghost', onClick: () => correct('solved') }) : null,
            a.status === 'solved' && a.mode !== 'contest' ? button('Correct: not solved', { kind: 'ghost', onClick: () => correct('failed') }) : null,
            a.mode === 'contest' ? null : button('Delete', { kind: 'ghost', iconName: 'trash', onClick: async () => {
              if (!(await confirmDialog({ title: 'Delete this attempt?', body: 'It disappears from your history and your level is recomputed without it.', confirm: 'Delete', danger: true }))) return;
              try { await gym.call('attempt.remove', { id }); navigate('journal'); } catch (e) { fail(e); }
            } })))),
      h('section', { class: 'card chat-card' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Coach conversation')), panel.el))));
  panel.load().catch(() => {});
  return () => panel.destroy();
}

export async function show(root, params = {}) {
  if (params.id) return showDetail(root, params.id);
  const b = state.boot;
  const filters = { q: '', outcome: '', mode: '', tag: '' };
  const tableEl = h('div', { class: 'card flush' });
  const countEl = h('span', { class: 'muted' });

  async function load() {
    try {
      const r = await gym.call('attempt.list', { q: filters.q || undefined, outcome: filters.outcome || undefined, mode: filters.mode || undefined, tag: filters.tag || undefined, limit: 200 });
      countEl.textContent = `${r.total} ${r.total === 1 ? 'attempt' : 'attempts'}`;
      if (!r.items.length) return mount(tableEl, h('p', { class: 'empty', style: { padding: '20px' } }, 'Nothing here yet.'));
      mount(tableEl, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Date', 'Rating', 'Problem', 'Result', 'Time', 'Idea or lesson'].map((t) => h('th', null, t)))),
        h('tbody', null, r.items.map((a) => h('tr', { class: 'clickable', onClick: () => navigate('journal', { id: a.id }) },
          h('td', { style: { whiteSpace: 'nowrap' } }, day(a.endedAt || a.startedAt)),
          h('td', null, ratingEl(a.rating)),
          h('td', null, h('div', { style: { fontWeight: 500, color: 'var(--ink)' } }, a.name), h('div', { class: 'list-meta' }, `${MODES[a.mode]}${a.tags.length ? ` · ${a.tags.slice(0, 3).join(', ')}` : ''}`)),
          h('td', null, outcomeBadge(a.outcome)),
          h('td', { style: { whiteSpace: 'nowrap' } }, a.mode === 'contest' ? minutes(a.thinkMs) : minutes(a.thinkMs + a.codeMs)),
          h('td', { class: 'muted', style: { maxWidth: '340px' } }, (a.takeaway || a.keyIdea || (a.reflected ? '' : a.mode === 'contest' || a.outcome === 'parked' ? '' : 'Reflection pending')).slice(0, 110))))))));
    } catch (e) { fail(e); }
  }

  let timer = null;
  const search = h('input', { class: 'input', placeholder: 'Search problems, ideas, lessons, notes', style: { width: '300px' }, onInput: (e) => { filters.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(load, 250); } });
  const select = (key, options) => h('select', { class: 'select', style: { width: '170px' }, onChange: (e) => { filters[key] = e.target.value; load(); } }, options.map(([v, label]) => h('option', { value: v }, label)));

  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Journal'), countEl),
    h('div', { class: 'controls' }, search,
      select('outcome', [['', 'All results'], ...Object.entries(OUTCOMES).filter(([k]) => k !== 'active' && k !== 'abandoned').map(([k, v]) => [k, v.label])]),
      select('mode', [['', 'All modes'], ...Object.entries(MODES)]),
      select('tag', [['', 'All topics'], ...b.meta.tags.map((t) => [t, t])])),
    tableEl));
  await load();
  return () => clearTimeout(timer);
}
