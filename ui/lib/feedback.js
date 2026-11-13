// The feedback dialog. What is written here is filed as an issue on the app's GitHub repository.
import { h, segmented } from './dom.js';
import { gym, fail, toast, openExternal } from './gym.js';

export function feedbackDialog(view) {
  let kind = 'bug';
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const text = h('textarea', { class: 'textarea', placeholder: 'What happened, or what would you change?', maxLength: 5000 });
  const sendBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Send');
  const submit = async (e) => {
    e.preventDefault();
    if (!text.value.trim()) return text.focus();
    sendBtn.disabled = true;
    try {
      const r = await gym.call('feedback.send', { kind, text: text.value, view });
      close();
      if (r.url) toast('Feedback sent.', { kind: 'good', timeout: 8000, action: { label: 'Open issue', run: () => openExternal(r.url) } });
      else { openExternal(r.fallback); toast('Finish sending it in your browser.'); }
    } catch (err) { sendBtn.disabled = false; fail(err); }
  };
  const overlay = h('div', { class: 'overlay', onMouseDown: (e) => { if (e.target === overlay) close(); } },
    h('form', { class: 'dialog wide', role: 'dialog', 'aria-modal': 'true', onSubmit: submit },
      h('h3', { class: 'dialog-title' }, 'Feedback'),
      h('div', { class: 'dialog-form' },
        h('div', null, segmented([{ value: 'bug', label: 'Bug' }, { value: 'idea', label: 'Suggestion' }], kind, (v) => { kind = v; })),
        text,
        h('span', { class: 'field-hint' }, 'Filed as a public GitHub issue.')),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn ghost', type: 'button', onClick: close }, 'Cancel'), sendBtn)));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  text.focus();
}
