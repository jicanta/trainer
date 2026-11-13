// Coach: a free conversation with your local Claude, which sees your training data on every message.
import { h, mount, icon, button } from '../lib/dom.js';
import { gym, state, fail, confirmDialog, navigate } from '../lib/gym.js';
import { chatPanel } from '../lib/chat.js';

const STARTERS = [
  'What should I work on this week?',
  'Where do I lose the most time?',
  'Plan my next five sittings.',
  'What does my Codeforces history say about my weak spots?',
];

export async function show(root) {
  const b = state.boot;
  const coachOk = b.coach && b.coach.found;
  let panel;
  const starter = async (text) => { try { panel.begin(await gym.call('coach.general', { text })); } catch (e) { fail(e); } };
  panel = chatPanel({
    scope: 'general', scopeId: 0, placeholder: 'Ask your coach',
    empty: () => h('div', { class: 'chat-empty' }, icon('chat', 24),
      h('p', null, 'The coach reads your level, topics, mistakes, times and Codeforces history with every message. Ask it anything about your training.'),
      h('div', { class: 'chips' }, STARTERS.map((t) => h('button', { class: 'chip', type: 'button', onClick: () => starter(t) }, t)))),
    send: (text) => gym.call('coach.general', { text }),
  });
  mount(root, h('div', { class: 'coach-page' },
    h('header', { class: 'page-head', style: { marginBottom: '20px' } },
      h('div', null, h('h1', { class: 'page-title' }, 'Coach'),
        h('p', { class: 'page-sub' }, coachOk ? `Your local Claude Code (${b.coach.model === 'default' ? 'default model' : b.coach.model}). Hints on a problem live in the solve view, where they are tracked.` : 'Claude Code was not found on this machine.')),
      h('div', { class: 'row' },
        coachOk ? null : button('Open Settings', { onClick: () => navigate('settings') }),
        button('New conversation', { kind: 'ghost', iconName: 'plus', onClick: async () => {
          if (!(await confirmDialog({ title: 'Start a new conversation?', body: 'The current one is cleared. Your training data is not affected.', confirm: 'Clear' }))) return;
          try { await gym.call('coach.clear', { scope: 'general', scopeId: 0 }); await panel.load(); } catch (e) { fail(e); }
        } }))),
    panel.el));
  panel.load().catch(() => {});
  if (coachOk) panel.focus();
  return () => panel.destroy();
}
