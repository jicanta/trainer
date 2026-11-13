// Pick the next problem. Mixed topics by default, tags hidden: recognizing what a problem needs is the skill.
import { h, mount, icon, segmented, button, field } from '../lib/dom.js';
import { gym, state, navigate, fail, toast } from '../lib/gym.js';
import { compact } from '../lib/format.js';
import { ratingEl } from './home.js';

export async function show(root, params = {}) {
  const b = state.boot;
  const s = b.settings;
  let mode = params.mode === 'idea' ? 'idea' : 'practice';
  let difficulty = s.difficulty;
  let topic = '';
  let weak = s.weakFocus;
  const blocked = b.active.attempt || b.active.contest;

  const listEl = h('div', { class: 'card flush' });
  const levelNote = h('span', { class: 'muted' });

  async function start(pid, origin) {
    try {
      await gym.call('attempt.start', { pid, mode, origin });
      navigate('solve');
    } catch (e) { fail(e); }
  }

  function rows(items, origin) {
    return items.map((p) => h('div', { class: 'problem-row' },
      ratingEl(p.rating),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'problem-name' }, p.name),
        h('div', { class: 'list-meta' }, [p.contestName, p.year && !String(p.contestName || '').includes(String(p.year)) ? p.year : null, p.solvedCount != null ? `solved by ${compact(p.solvedCount)}` : null].filter(Boolean).join(' · '))),
      button('Start', { kind: 'primary', small: true, iconName: 'play', disabled: !!blocked, onClick: () => start(p.pid, origin) })));
  }

  async function load() {
    listEl.style.opacity = '0.55';
    try {
      const r = await gym.call('practice.shortlist', { difficulty, topic: topic || null, weakFocus: weak });
      levelNote.textContent = `Your level: ${r.level}`;
      mount(listEl, r.items.length ? rows(r.items, 'recommended')
        : h('p', { class: 'empty', style: { padding: '20px' } }, b.problems ? 'No unseen problems match.' : 'The problem set is not downloaded yet. Open Settings and sync.'));
    } catch (e) { fail(e); }
    listEl.style.opacity = '';
  }

  const topicSelect = h('select', { class: 'select', style: { width: '210px' }, onChange: (e) => { topic = e.target.value; load(); } },
    h('option', { value: '' }, 'Mixed'), b.meta.tags.map((t) => h('option', { value: t }, t)));
  const weakCheck = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: weak, onChange: (e) => { weak = e.target.checked; load(); } }), h('span', null, 'Lean toward my weak topics'));

  const refInput = h('input', { class: 'input', placeholder: '1920C or a Codeforces problem link', spellcheck: false });
  const openRef = async (e) => {
    e.preventDefault();
    const text = refInput.value.trim();
    if (!text) return;
    try {
      const p = await gym.call('practice.lookup', { text });
      if (!p) return fail(new Error('That does not look like a Codeforces problem. Use an id like 1920C or paste the problem link.'));
      if (!p.known) toast('Not in the local problem set, opening it anyway.');
      start(p.pid, 'manual');
    } catch (err) { fail(err); }
  };

  const fromRounds = h('div');
  gym.call('practice.fromRounds').then((items) => {
    if (!items.length) return;
    mount(fromRounds, h('div', { class: 'section' },
      h('h2', { class: 'section-title' }, 'Unsolved from past rounds'),
      h('div', { class: 'card flush' }, rows(items.map((p) => ({ ...p, contestName: p.contestName, year: null, solvedCount: null })), 'cf-round'))));
  }).catch(() => {});

  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Practice'),
      levelNote),
    blocked ? h('div', { class: 'notice warm', style: { marginBottom: '18px' } }, h('div', { class: 'notice-title' }, b.active.contest ? 'A contest is running' : `You already have a problem open: ${b.active.attempt.name}`),
      'Finish it before starting another one.',
      h('div', { class: 'notice-actions' }, button('Resume', { small: true, onClick: () => navigate(b.active.contest ? 'contest' : 'solve') }))) : null,
    h('div', { class: 'controls' },
      h('div', null, h('div', { class: 'field-label', style: { marginBottom: '5px' } }, 'Mode'),
        segmented([{ value: 'practice', label: 'Solve and code' }, { value: 'idea', label: 'Idea only' }], mode, (v) => { mode = v; })),
      h('div', null, h('div', { class: 'field-label', style: { marginBottom: '5px' } }, 'Difficulty'),
        segmented([{ value: 'comfortable', label: 'Comfortable', title: 'From 100 below to 200 above your level' }, { value: 'standard', label: 'Standard', title: 'From your level to 300 above' }, { value: 'stretch', label: 'Stretch', title: 'From 100 to 400 above your level' }], difficulty, (v) => { difficulty = v; load(); })),
      field('Topic', topicSelect),
      weakCheck, h('div', { style: { marginLeft: 'auto' } }, button('Shuffle', { iconName: 'shuffle', onClick: load }))),
    listEl,
    fromRounds,
    h('div', { class: 'section' },
      h('h2', { class: 'section-title' }, 'Open a specific problem'),
      h('form', { class: 'row', onSubmit: openRef, style: { maxWidth: '520px' } }, refInput, button('Open', { type: 'submit', disabled: !!blocked })))));
  await load();
}
