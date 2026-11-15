// App shell: sidebar, routing, and reactions to backend events that matter on every screen.
import { h, mount, icon } from './lib/dom.js';
import { gym, state, refreshBoot, setNavigator, setImmersiveHandler, toast } from './lib/gym.js';
import { clock } from './lib/format.js';
import { feedbackDialog } from './lib/feedback.js';

const VIEWS = {
  home: () => import('./views/home.js'),
  plan: () => import('./views/plan.js'),
  practice: () => import('./views/practice.js'),
  solve: () => import('./views/solve.js'),
  reflect: () => import('./views/reflect.js'),
  contest: () => import('./views/contest.js'),
  insights: () => import('./views/insights.js'),
  journal: () => import('./views/journal.js'),
  coach: () => import('./views/coach.js'),
  settings: () => import('./views/settings.js'),
  onboarding: () => import('./views/onboarding.js'),
};

const NAV = [
  ['home', 'Today', 'home'], ['plan', 'Plan', 'calendar'], ['practice', 'Practice', 'target'], ['contest', 'Contest', 'flag'], ['insights', 'Insights', 'chart'],
  ['journal', 'Journal', 'book'], ['coach', 'Coach', 'chat'], ['settings', 'Settings', 'sliders'],
];

const sidebar = h('aside', { class: 'sidebar' });
const main = h('main', { class: 'main' });
const shell = h('div', { class: 'shell' }, sidebar, main);
document.getElementById('app').appendChild(shell);

let current = { route: null, params: {}, cleanup: null };
let token = 0;
let runningEl = null;

function runningClock() {
  const a = state.boot && state.boot.active;
  if (!runningEl || !a) return;
  if (a.contest) runningEl.textContent = clock(Math.max(0, a.contest.endsAt - Date.now()));
  else if (a.attempt) {
    const t = a.attempt;
    const live = t.phase === 'think' || t.phase === 'code' ? Date.now() - t.phaseStartedAt : 0;
    runningEl.textContent = t.phase === 'paused' ? 'paused' : clock(t.thinkMs + t.codeMs + live);
  }
}
setInterval(runningClock, 1000);

function renderSidebar() {
  const b = state.boot;
  const a = b.active;
  let running = null;
  runningEl = null;
  if (a.contest || a.attempt) {
    runningEl = h('span', { class: 'running-time' });
    running = h('button', { class: 'running', type: 'button', onClick: () => go(a.contest ? 'contest' : 'solve') },
      icon(a.contest ? 'flag' : 'clock', 16),
      h('span', { style: { minWidth: 0, flex: 1 } }, h('span', { class: 'running-title', style: { display: 'block' } }, a.contest ? 'Contest running' : a.attempt.name), runningEl));
  }
  mount(sidebar,
    h('div', { class: 'brand' }, h('span', { class: 'brand-name' }, 'CP Gym')),
    h('nav', { class: 'nav' }, NAV.map(([route, label, ic]) => h('button', {
      class: ['nav-item', current.route === route && 'on'], type: 'button', onClick: () => go(route),
    }, icon(ic, 17), h('span', null, label)))),
    h('div', { class: 'sidebar-foot' }, running,
      h('button', { class: 'foot-link', type: 'button', onClick: () => feedbackDialog(current.route) }, icon('pencil', 17), h('span', null, 'Feedback')),
      h('div', { class: 'who' }, h('span', null, b.user ? b.user.handle : 'No handle'), h('strong', null, `Level ${b.level}`))));
  runningClock();
}

async function go(route, params = {}) {
  if (!VIEWS[route]) route = 'home';
  if (!state.boot.settings.onboarded) route = 'onboarding';
  if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  const mine = ++token;
  current = { route, params, cleanup: null };
  try { await refreshBoot(); } catch (e) { console.error(e); }
  if (mine !== token) return;
  shell.classList.toggle('immersive', route === 'onboarding');
  renderSidebar();
  mount(main);
  main.scrollTop = 0;
  if (location.hash !== `#/${route}`) history.replaceState(null, '', `#/${route}`);
  try {
    const mod = await VIEWS[route]();
    const cleanup = await mod.show(main, params);
    if (mine !== token) { if (cleanup) cleanup(); return; }
    current.cleanup = cleanup || null;
  } catch (e) {
    console.error(e);
    if (mine !== token) return;
    mount(main, h('div', { class: 'page narrow' }, h('h1', { class: 'page-title' }, 'Something went wrong'), h('p', { class: 'page-sub' }, e.message || String(e)),
      h('div', { class: 'section' }, h('button', { class: 'btn', type: 'button', onClick: () => go('home') }, 'Back to Today'))));
  }
}

setNavigator(go);
setImmersiveHandler((on) => shell.classList.toggle('immersive', !!on));

gym.on('attempt', async (p) => {
  const route = current.route; // read before awaiting: the workspace navigates away on its own finish
  await refreshBoot();
  renderSidebar();
  if (route === 'solve') return;
  if (p.status === 'solved') toast('Accepted on Codeforces.', { kind: 'good', action: { label: 'Reflect', run: () => go('reflect', { id: p.id }) } });
});
gym.on('contest', async (p) => {
  const route = current.route;
  await refreshBoot();
  renderSidebar();
  if (route !== 'contest' && p.event === 'finished') toast('Contest finished.', { action: { label: 'Results', run: () => go('contest', { id: p.id }) } });
});
gym.on('synced', async () => { await refreshBoot(); renderSidebar(); });

(async () => {
  await refreshBoot();
  const b = state.boot;
  const hash = location.hash.replace(/^#\//, '');
  let route = 'home';
  if (b.active.contest) route = 'contest';
  else if (b.active.attempt) route = 'solve';
  else if (VIEWS[hash] && !['solve', 'reflect', 'onboarding'].includes(hash)) route = hash;
  go(route);
})();
