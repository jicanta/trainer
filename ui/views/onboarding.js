// First run: connect a Codeforces handle, set an honest starting level, download the problem set.
import { h, mount, icon, field } from '../lib/dom.js';
import { gym, state, saveSettings, navigate, fail, refreshBoot } from '../lib/gym.js';

export async function show(root) {
  const b = state.boot;
  let user = b.user;
  let problemsReady = b.problems > 0;
  let busy = false;

  const handle = h('input', { class: 'input', placeholder: 'your handle', value: b.settings.handle || '', autocomplete: 'off', spellcheck: false });
  const level = h('input', { class: 'input', type: 'number', min: 800, max: 3500, step: 50, value: b.settings.levelBase });
  const target = h('input', { class: 'input', type: 'number', min: 800, max: 4000, step: 100, value: b.settings.targetRating });
  const sitting = h('select', { class: 'select' }, [30, 45, 60, 90, 120, 180].map((m) => h('option', { value: m, selected: m === b.settings.sessionMinutes }, `${m} minutes`)));
  const status = h('div', { class: 'progress-line' });
  const found = h('div');
  const details = h('div', { class: 'stack', style: { display: 'none', marginTop: '22px' } });
  const connectBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Connect');
  const startBtn = h('button', { class: 'btn primary large', type: 'button', disabled: true }, 'Start training');

  const setStatus = (text, spin = true) => mount(status, text ? [spin ? h('span', { class: 'pulse' }) : icon('check', 15), h('span', null, text)] : null);
  const off = gym.on('sync', (p) => setStatus(p.message));

  function refreshStart() {
    startBtn.disabled = !(user && problemsReady) || busy;
  }

  async function loadProblems() {
    if (problemsReady) return;
    try {
      await gym.call('sync.problems');
      problemsReady = true;
      setStatus('Problem set downloaded.', false);
    } catch (e) {
      setStatus('', false);
      fail(e);
    }
    refreshStart();
  }

  async function connect(e) {
    e.preventDefault();
    const value = handle.value.trim();
    if (!value || busy) return;
    busy = true;
    connectBtn.disabled = true;
    setStatus(`Looking up ${value} on Codeforces`);
    try {
      user = await gym.call('sync.user', { handle: value });
      mount(found, h('div', { class: 'found' }, icon('check', 16),
        h('span', null, `${user.handle}: rating ${user.rating ?? 'unrated'}${user.maxRating ? `, max ${user.maxRating}` : ''}, ${user.submissions} submissions imported.`)));
      level.value = user.rating ? Math.round(user.rating / 50) * 50 : 1200;
      details.style.display = '';
      await refreshBoot(); // the problem set may have been downloaded in the background meanwhile
      problemsReady = state.boot.problems > 0;
      setStatus(problemsReady ? 'Problem set downloaded.' : 'Downloading the Codeforces problem set', !problemsReady);
      busy = false;
      refreshStart();
      await loadProblems();
    } catch (err) {
      setStatus('', false);
      fail(err);
    } finally {
      busy = false;
      connectBtn.disabled = false;
      refreshStart();
    }
  }

  startBtn.addEventListener('click', async () => {
    try {
      await saveSettings({ levelBase: Number(level.value), targetRating: Number(target.value), sessionMinutes: Number(sitting.value), onboarded: true });
      await refreshBoot();
      navigate('home');
    } catch (e) { fail(e); }
  });

  details.append(
    h('div', { class: 'onboard-grid' },
      field('Your real level today', level, 'Be honest. The gym moves it as you train.'),
      field('Goal', target),
      field('A usual sitting', sitting)),
    h('div', { class: 'row', style: { marginTop: '8px' } }, startBtn));

  if (user) {
    mount(found, h('div', { class: 'found' }, icon('check', 16), h('span', null, `${user.handle}: rating ${user.rating ?? 'unrated'}.`)));
    details.style.display = '';
    loadProblems();
  }
  refreshStart();

  mount(root, h('div', { class: 'onboard' }, h('div', { class: 'onboard-card' },
    h('h1', { class: 'onboard-title' }, 'CP Gym'),
    h('p', { class: 'onboard-lead' }, 'Connect your Codeforces handle to start.'),
    h('form', { class: 'row', onSubmit: connect, style: { alignItems: 'flex-end' } }, h('div', { style: { flex: 1 } }, field('Codeforces handle', handle)), connectBtn),
    h('div', { style: { marginTop: '14px' } }, found),
    h('div', { style: { marginTop: '8px' } }, status),
    details)));
  handle.focus();
  return off;
}
