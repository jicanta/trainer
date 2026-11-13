// App-wide plumbing for the UI: backend calls, backend events, shared state, navigation, toasts.
import { h, icon } from './dom.js';

const bridge = window.gymBridge;
const listeners = new Map();

if (bridge) {
  bridge.on(({ type, payload }) => {
    for (const fn of [...(listeners.get(type) || [])]) {
      try { fn(payload); } catch (e) { console.error(e); }
    }
  });
}

export const gym = {
  async call(method, params) {
    const r = await bridge.call(method, params);
    if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
    return r.data;
  },
  // Subscribes to a backend event; returns the unsubscribe function.
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
};

// Boot data: settings, Codeforces user, active session, coach status, static metadata.
export const state = { boot: null };

export async function refreshBoot() {
  state.boot = await gym.call('boot');
  return state.boot;
}

export async function saveSettings(patch) {
  state.boot.settings = await gym.call('settings.set', patch);
  return state.boot.settings;
}

let navigator = null;
export function setNavigator(fn) { navigator = fn; }
export function navigate(route, params = {}) { if (navigator) navigator(route, params); }

let toastRoot = null;
export function toast(message, { kind = 'info', action, timeout = 4200 } = {}) {
  if (!toastRoot) { toastRoot = h('div', { class: 'toasts' }); document.body.appendChild(toastRoot); }
  const el = h('div', { class: ['toast', kind], role: 'status' },
    h('span', { class: 'toast-icon' }, icon(kind === 'error' ? 'x' : kind === 'good' ? 'check' : 'dot', 15)),
    h('span', { class: 'toast-text' }, message),
    action ? h('button', { class: 'toast-action', type: 'button', onClick: () => { action.run(); el.remove(); } }, action.label) : null);
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? Math.max(timeout, 7000) : timeout);
}

export const fail = (e) => toast(e && e.message ? e.message : String(e), { kind: 'error' });

// Confirmation dialog. Resolves true when confirmed.
export function confirmDialog({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    const overlay = h('div', { class: 'overlay', onClick: (e) => { if (e.target === overlay) close(false); } },
      h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'dialog-title' }, title),
        body ? h('p', { class: 'dialog-body' }, body) : null,
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn ghost', type: 'button', onClick: () => close(false) }, cancel),
          h('button', { class: ['btn', danger ? 'danger' : 'primary'], type: 'button', onClick: () => close(true) }, confirm))));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('.btn.primary, .btn.danger').focus();
  });
}

export function openExternal(url) {
  gym.call('app.openExternal', { url }).catch(fail);
}

// Links rendered from coach messages open in the system browser.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-external]');
  if (a) { e.preventDefault(); openExternal(a.getAttribute('href')); }
});

// Views that need the whole window (the solve workspace, a running contest) hide the sidebar.
let immersiveSetter = null;
export function setImmersiveHandler(fn) { immersiveSetter = fn; }
export function immersive(on) { if (immersiveSetter) immersiveSetter(on); }
