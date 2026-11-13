// After a problem: write down the idea and what you missed. This is the raw material for every insight.
import { h, mount, icon, button, field } from '../lib/dom.js';
import { gym, state, navigate, fail, toast, openExternal } from '../lib/gym.js';
import { minutes, MODES, signed } from '../lib/format.js';
import { chatPanel } from '../lib/chat.js';
import { ratingEl, outcomeBadge } from './home.js';

export async function show(root, params = {}) {
  const a = params.id ? await gym.call('attempt.get', { id: params.id }) : null;
  if (!a) { navigate('journal'); return null; }
  const b = state.boot;
  const coachOk = b.coach && b.coach.found;
  const info = await gym.call('statement.info', { pid: a.pid }).catch(() => ({}));
  const open = a.status === 'solved' || a.status === 'failed';
  const solvedClean = a.outcome === 'clean';

  const keyIdea = h('textarea', { class: 'textarea', rows: 2, placeholder: 'The idea that solves it, in your own words.' });
  const missed = h('textarea', { class: 'textarea', rows: 2, placeholder: solvedClean ? 'What could have been faster? What took longer than it should have?' : 'What kept you from the idea? What would have led you there?' });
  const mistake = h('select', { class: 'select' }, Object.entries(b.meta.mistakes).map(([k, label]) => h('option', { value: k }, label)));
  const takeaway = h('input', { class: 'input', placeholder: 'One reusable lesson for future problems.' });
  keyIdea.value = a.keyIdea || '';
  missed.value = a.missed || '';
  mistake.value = a.mistake || 'none';
  takeaway.value = a.takeaway || '';

  const draftBtn = button('Draft with coach', { iconName: 'bolt', disabled: !coachOk || !open, title: open ? 'The coach drafts it from your notes and the intended solution. Edit before saving.' : 'Not available for parked problems: it would spoil them.' });
  draftBtn.addEventListener('click', async () => {
    draftBtn.disabled = true;
    const label = draftBtn.querySelector('span');
    label.textContent = 'Drafting';
    try {
      const d = await gym.call('coach.draftReflection', { attemptId: a.id });
      if (!keyIdea.value.trim()) keyIdea.value = d.keyIdea;
      if (!missed.value.trim()) missed.value = d.missed;
      if (!takeaway.value.trim()) takeaway.value = d.takeaway;
      if (mistake.value === 'none') mistake.value = d.mistake;
    } catch (e) { fail(e); }
    label.textContent = 'Draft with coach';
    draftBtn.disabled = false;
  });

  const save = async () => {
    try {
      await gym.call('attempt.reflect', { id: a.id, keyIdea: keyIdea.value, missed: missed.value, mistake: mistake.value, takeaway: takeaway.value });
      toast('Reflection saved.', { kind: 'good' });
      navigate(params.back || 'home');
    } catch (e) { fail(e); }
  };

  const panel = chatPanel({
    scope: 'attempt', scopeId: a.id,
    placeholder: open ? 'Discuss the problem with the coach' : 'Ask the coach (no spoilers while parked)',
    empty: () => h('div', { class: 'chat-empty' }, icon('chat', 22), open ? null : h('p', null, 'This problem is parked. The coach will not spoil it.')),
    send: (text) => gym.call('coach.attempt', { attemptId: a.id, text }),
  });

  const levelDelta = a.levelAtStart != null && a.score != null ? a.levelNow - Math.round(a.levelAtStart) : null;
  mount(root, h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'row', style: { marginBottom: '10px' } }, outcomeBadge(a.outcome), h('span', { class: 'badge' }, MODES[a.mode])),
        h('h1', { class: 'page-title' }, a.name),
        h('div', { class: 'row wrap', style: { marginTop: '12px' } }, ratingEl(a.rating), (a.tags || []).map((t) => h('span', { class: 'tag' }, t)))),
      h('div', { class: 'row' },
        button('Problem', { iconName: 'external', kind: 'ghost', onClick: () => openExternal(a.url) }),
        info.tutorialUrl && open ? button('Editorial', { iconName: 'external', kind: 'ghost', onClick: () => openExternal(info.tutorialUrl) }) : null)),
    h('div', { class: 'split' },
      h('section', { class: 'card' },
        h('div', { class: 'facts', style: { marginBottom: '20px' } },
          a.mode === 'contest' ? h('span', null, 'Time on problem ', h('strong', null, minutes(a.thinkMs))) : [h('span', null, 'Think ', h('strong', null, minutes(a.thinkMs))), a.mode === 'idea' ? null : h('span', null, 'Code ', h('strong', null, minutes(a.codeMs)))],
          h('span', null, 'Wrong submissions ', h('strong', null, a.wrongSubs)),
          h('span', null, 'Help ', h('strong', null, b.meta.hintNames[a.hintLevel])),
          levelDelta !== null ? h('span', null, 'Level ', h('strong', null, `${a.levelNow} (${signed(levelDelta)} since this started)`)) : null),
        h('div', { class: 'stack' },
          field('Key idea', keyIdea),
          field(solvedClean ? 'What could have gone better' : 'What I missed', missed),
          field('Takeaway', takeaway),
          h('div', { style: { maxWidth: '360px' } }, field('What went wrong', mistake)),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            button('Save reflection', { kind: 'primary', onClick: save }), draftBtn, h('span', { class: 'spacer' }),
            button('Later', { kind: 'ghost', onClick: () => navigate(params.back || 'home') }))),
        a.notes ? h('div', { class: 'section' }, h('h2', { class: 'section-title' }, 'Your notes'), h('pre', { class: 'notes-view' }, a.notes)) : null),
      h('section', { class: 'card chat-card' },
        h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Coach')),
        coachOk ? panel.el : h('p', { class: 'empty', style: { padding: '16px' } }, 'Claude Code was not found. Set its path in Settings to use the coach.')))));
  panel.load().catch(() => {});
  return () => panel.destroy();
}
