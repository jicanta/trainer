// Chat with the coach: history, streaming answers, stop button. Used in the solve view,
// the reflection view, contest debriefs and the general coach screen.
import { h, mount, icon } from './dom.js';
import { gym, fail } from './gym.js';
import { markdown } from './md.js';

const STATUS = { starting: 'Starting', analyzing: 'Studying the problem (first time only)', thinking: 'Thinking', writing: 'Writing' };
const VERDICTS = { correct: ['Idea is correct', 'green'], partial: ['Partly there', 'yellow'], wrong: ['Idea does not hold', 'red'] };

// opts: { scope, scopeId, send(text) -> { jobId, userMessage }, placeholder, empty, onDone, onError, readOnly }
export function chatPanel(opts) {
  const scopeId = opts.scopeId || 0;
  const list = h('div', { class: 'chat-list' });
  const input = h('textarea', { class: 'chat-input', rows: 1, placeholder: opts.placeholder || 'Message the coach', 'aria-label': 'Message the coach' });
  const sendBtn = h('button', { class: 'btn primary icon-only', type: 'button', title: 'Send (Enter)' }, icon('send', 16));
  const stopBtn = h('button', { class: 'btn icon-only', type: 'button', title: 'Stop', style: { display: 'none' } }, icon('stop', 15));
  const composer = opts.readOnly ? null : h('div', { class: 'chat-composer' }, input, sendBtn, stopBtn);
  const el = h('div', { class: 'chat' }, list, composer);

  let job = null;
  let pending = null;
  let statusEl = null;
  let text = '';
  let raf = 0;

  const scroll = () => { list.scrollTop = list.scrollHeight; };

  function messageEl(m) {
    if (m.role === 'user') {
      const label = m.kind && (m.kind.startsWith('hint') || m.kind === 'ideacheck' || m.kind === 'debrief');
      return h('div', { class: ['msg', 'user', label && 'request'] }, m.content);
    }
    const verdict = m.kind && m.kind.startsWith('verdict:') ? VERDICTS[m.kind.slice(8)] : null;
    return h('div', { class: 'msg coach' },
      verdict ? h('span', { class: ['badge', verdict[1]] }, verdict[0]) : null,
      markdown(m.content));
  }

  async function load() {
    const msgs = await gym.call('coach.history', { scope: opts.scope, scopeId });
    mount(list, msgs.length ? msgs.map(messageEl) : (opts.empty ? opts.empty() : null));
    scroll();
  }

  function setBusy(on) {
    if (!composer) return;
    sendBtn.style.display = on ? 'none' : '';
    stopBtn.style.display = on ? '' : 'none';
    el.classList.toggle('busy', on);
  }

  // Attaches the panel to a job the backend just started.
  function begin(r) {
    if (list.querySelector('.chat-empty')) mount(list);
    job = r.jobId;
    text = '';
    if (r.userMessage) list.appendChild(messageEl(r.userMessage));
    statusEl = h('div', { class: 'msg-status' }, h('span', { class: 'pulse' }), h('span', null, STATUS.starting));
    pending = h('div', { class: 'msg coach pending' }, statusEl);
    list.appendChild(pending);
    setBusy(true);
    scroll();
  }

  async function submit() {
    const value = input.value.trim();
    if (!value || job !== null) return;
    input.value = '';
    input.style.height = '';
    try { begin(await opts.send(value)); } catch (e) { input.value = value; fail(e); }
  }

  if (composer) {
    sendBtn.addEventListener('click', submit);
    stopBtn.addEventListener('click', () => { if (job !== null) gym.call('coach.cancel', { jobId: job }).catch(() => {}); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; });
  }

  const mine = (p) => p.jobId === job;
  const sameScope = (p) => p.scope === opts.scope && (p.scopeId || 0) === scopeId;
  const offs = [
    gym.on('coach:status', (p) => { if (mine(p) && statusEl && !text) statusEl.lastChild.textContent = STATUS[p.status] || 'Working'; }),
    gym.on('coach:delta', (p) => {
      if (!mine(p)) return;
      text += p.text;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (pending && job !== null) { mount(pending, markdown(text)); scroll(); } });
    }),
    gym.on('coach:done', (p) => {
      if (!mine(p)) { if (sameScope(p) && job === null) load(); return; }
      if (pending && p.message) pending.replaceWith(messageEl(p.message)); else if (pending) pending.remove();
      job = null; pending = null;
      setBusy(false);
      scroll();
      if (opts.onDone) opts.onDone(p);
    }),
    gym.on('coach:error', (p) => {
      if (!mine(p)) return;
      if (pending) {
        if (p.cancelled && text) { pending.classList.remove('pending'); pending.appendChild(h('div', { class: 'msg-note' }, 'Stopped.')); }
        else if (p.cancelled) pending.remove();
        else mount(pending, h('div', { class: 'msg-error' }, p.error));
      }
      job = null; pending = null;
      setBusy(false);
      if (opts.onError) opts.onError(p);
    }),
  ];

  return {
    el, load, begin,
    busy: () => job !== null,
    focus: () => input.focus(),
    destroy: () => { offs.forEach((off) => off()); if (raf) cancelAnimationFrame(raf); },
  };
}
