// Settings. Every control saves as soon as it changes.
import { h, mount, icon, segmented, button, field } from '../lib/dom.js';
import { gym, state, saveSettings, refreshBoot, navigate, fail, toast } from '../lib/gym.js';
import { relative, dayYear } from '../lib/format.js';

export async function show(root) {
  const b = state.boot;
  let s = b.settings;
  const saved = h('span', { class: 'muted' });
  let savedTimer = null;
  const save = async (patch) => {
    try {
      s = await saveSettings(patch);
      saved.textContent = 'Saved';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { saved.textContent = ''; }, 1800);
    } catch (e) { fail(e); }
  };
  const num = (key, { min, max, step = 1, width = '110px' } = {}) => h('input', {
    class: 'input num', type: 'number', min, max, step, value: s[key], style: { width },
    onChange: (e) => { if (e.target.value !== '') save({ [key]: Number(e.target.value) }); },
  });
  const check = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s[key], onChange: (e) => save({ [key]: e.target.checked }) }), h('span', null, label));

  // Codeforces
  const handle = h('input', { class: 'input', value: s.handle || '', spellcheck: false, style: { width: '220px' } });
  const syncNote = h('div', { class: 'progress-line' });
  const syncInfo = () => {
    const u = state.boot.user;
    mount(syncNote, h('span', null, u
      ? `${u.handle}: rating ${u.rating ?? 'unrated'}, ${u.submissions} submissions. History synced ${state.boot.userSyncedAt ? relative(state.boot.userSyncedAt) : 'never'}, problem set ${state.boot.problemsSyncedAt ? relative(state.boot.problemsSyncedAt) : 'never'} (${state.boot.problems} problems).`
      : 'No Codeforces account connected.'));
  };
  const off = gym.on('sync', (p) => mount(syncNote, h('span', { class: 'pulse' }), h('span', null, p.message)));
  const runSync = async (method, params, btn) => {
    btn.disabled = true;
    try { await gym.call(method, params); await refreshBoot(); toast('Synced with Codeforces.', { kind: 'good' }); } catch (e) { fail(e); }
    btn.disabled = false;
    syncInfo();
  };
  const connectBtn = button('Connect', { onClick: (e) => { const v = handle.value.trim(); if (v) runSync('sync.user', { handle: v }, e.currentTarget); } });
  const syncBtn = button('Sync now', { iconName: 'refresh', onClick: (e) => runSync('sync.all', {}, e.currentTarget) });
  syncInfo();

  // Coach
  const coach = b.coach || {};
  const usage = coach.rateLimit && coach.rateLimit.unifiedWindows;
  const claudePath = h('input', { class: 'input', value: s.claudePath || '', placeholder: coach.path || 'auto-detect', spellcheck: false, onChange: async (e) => { await save({ claudePath: e.target.value.trim() }); await refreshBoot(); navigate('settings'); } });
  const model = h('select', { class: 'select', style: { width: '220px' }, onChange: (e) => save({ coachModel: e.target.value }) },
    [['opus', 'Opus (recommended)'], ['fable', 'Fable (strongest, uses more of your plan)'], ['sonnet', 'Sonnet (faster)'], ['haiku', 'Haiku (fastest)'], ['default', 'Whatever Claude Code defaults to']]
      .map(([v, label]) => h('option', { value: v, selected: s.coachModel === v }, label)));

  const local = s.coachBackend === 'local';
  const rerender = async (patch) => { await save(patch); await refreshBoot(); navigate('settings'); };
  const text = (key, placeholder, type = 'text') => h('input', { class: 'input', type, value: s[key] || '', placeholder, spellcheck: false, onChange: (e) => save({ [key]: e.target.value.trim() }) });
  const localUrl = text('localUrl', 'http://localhost:8080/v1');
  const localModel = text('localModel', 'whatever the server has loaded');
  const localKey = text('localApiKey', 'none', 'password');
  const testNote = h('span', { class: 'muted', style: { fontSize: '12.5px' } });
  const testBtn = button('Test connection', { onClick: async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    testNote.textContent = 'Connecting...';
    try {
      const r = await gym.call('coach.testLocal', { url: localUrl.value.trim(), apiKey: localKey.value.trim() });
      testNote.textContent = r.models.length ? `Connected to ${r.url}. Models: ${r.models.slice(0, 6).join(', ')}${r.models.length > 6 ? ', ...' : ''}` : `Connected to ${r.url}, but it lists no models.`;
    } catch (err) { testNote.textContent = err.message; }
    btn.disabled = false;
  } });

  const focusActive = s.focusUntil > Date.now() && (s.focusTags || []).length;
  const card = (title, sub, ...children) => h('section', { class: 'card' }, h('header', { class: 'card-head' }, h('div', null, h('h3', { class: 'card-title' }, title), sub ? h('p', { class: 'card-sub' }, sub) : null)), children);

  mount(root, h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Settings')), saved),
    h('div', { class: 'stack' },
      card('Codeforces', null,
        h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Handle', handle), connectBtn, syncBtn),
        h('div', { style: { marginTop: '10px' } }, syncNote)),
      card('Level and goal', null,
        h('div', { class: 'settings-grid' },
          field('Starting level', num('levelBase', { min: 800, max: 3500, step: 50 }), 'Changing it shifts the whole history.'),
          field('Goal', num('targetRating', { min: 800, max: 4000, step: 100 })),
          field('Monthly goal', num('monthlyGoal', { min: 1, max: 300 }), 'Solves at your level or above.'))),
      card('Practice', null,
        h('div', { class: 'settings-grid' },
          h('div', { class: 'field full' }, h('span', { class: 'field-label' }, 'Difficulty'),
            h('div', null, segmented([{ value: 'comfortable', label: 'Comfortable' }, { value: 'standard', label: 'Standard' }, { value: 'stretch', label: 'Stretch' }], s.difficulty, (v) => save({ difficulty: v })))),
          h('div', { class: 'full' }, check('weakFocus', 'Lean toward my weak topics')),
          field('A usual sitting (minutes)', num('sessionMinutes', { min: 15, max: 480, step: 5 })),
          field('Time budget at your level (minutes)', num('budgetMinutes', { min: 10, max: 240, step: 5 }), 'Scaled up for harder problems.'),
          field('Stuck after (minutes without a new idea)', num('stuckMinutes', { min: 5, max: 120 })),
          field('Focus check-in every (minutes)', num('checkinMinutes', { min: 0, max: 60 }), '0 turns it off.'))),
      card('Contests', null,
        h('div', { class: 'settings-grid' },
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Problems'), h('div', null, segmented([4, 5, 6].map((n) => ({ value: n, label: String(n) })), s.contestProblems, (v) => save({ contestProblems: v })))),
          field('Duration (minutes)', num('contestMinutes', { min: 20, max: 300, step: 5 })))),
      card('Problem pool', null,
        h('div', { class: 'settings-grid' },
          field('From contests since', num('minYear', { min: 2010, max: 2100 })),
          field('Solved by at least', num('minSolved', { min: 0, max: 100000, step: 100 })))),
      card('Coach', null,
        h('div', { class: 'settings-grid' },
          h('div', { class: 'field full' }, h('span', { class: 'field-label' }, 'Runs on'),
            h('div', null, segmented([{ value: 'claude', label: 'Claude Code' }, { value: 'local', label: 'Local model' }], s.coachBackend, (v) => rerender({ coachBackend: v })))),
          local ? field('Server address', localUrl, 'llama-server uses port 8080, LM Studio 1234, Ollama 11434.') : field('Model', model),
          local ? field('Model name', localModel, 'Leave empty for llama-server. LM Studio and Ollama need the name they list.')
            : field('Claude Code path', claudePath, coach.found ? `Using ${coach.path}` : 'Not found. Install Claude Code or enter the full path to its "claude" binary.'),
          local ? field('API key', localKey, 'Only if your server asks for one.') : null,
          local ? h('div', { class: 'full row wrap' }, testBtn, testNote) : null,
          local ? h('div', { class: 'full muted', style: { fontSize: '12.5px' } }, 'Give the server a context of 16k tokens or more.') : null,
          !local && usage ? h('div', { class: 'full muted', style: { fontSize: '12.5px' } }, `Plan usage at the last coach call: ${Math.round((usage.five_hour ? usage.five_hour.utilization : 0) * 100)}% of the 5-hour window, ${Math.round((usage.seven_day ? usage.seven_day.utilization : 0) * 100)}% of the week.`) : null,
          focusActive || s.habit ? h('div', { class: 'full notice calm' }, h('div', { class: 'notice-title' }, 'Active coach focus'),
            focusActive ? `${s.focusTags.join(', ')} until ${dayYear(s.focusUntil)}. ` : '', s.habit ? `Habit: ${s.habit}` : '',
            h('div', { class: 'notice-actions' }, button('Clear', { small: true, onClick: async () => { await save({ focusTags: [], focusUntil: 0, habit: '' }); navigate('settings'); } }))) : null)),
      card('App', null,
        h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Theme'),
            h('div', null, segmented([{ value: 'light', label: 'Light' }, { value: 'cream', label: 'Cream' }, { value: 'dark', label: 'Dark' }], s.theme, (v) => save({ theme: v })))),
          check('focusLayout', 'Show only the statement in the Codeforces panel by default'),
          h('div', { class: 'muted', style: { fontSize: '12.5px' } }, b.meta.sandbox
            ? 'Chromium sandbox: on.'
            : 'Chromium sandbox: off (Ubuntu blocks it for apps without an AppArmor profile). To turn it on, run "npm run enable-sandbox" once in the app folder.'),
          h('div', { class: 'row wrap' },
            button('Open data folder', { onClick: () => gym.call('app.openDataDir').catch(fail) }),
            button('Export my data', { onClick: async () => { try { const r = await gym.call('data.export'); toast(`Exported to ${r.file}`, { kind: 'good', timeout: 9000 }); } catch (e) { fail(e); } } }),
            h('span', { class: 'muted', style: { fontSize: '12.5px' } }, `Version ${b.meta.version}. Data in ${b.meta.dataDir}`)))))));
  return () => { off(); clearTimeout(savedTimer); };
}
