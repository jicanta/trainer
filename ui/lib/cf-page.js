// Everything that touches the embedded Codeforces page: spoiler-hiding CSS, the distraction-free layout,
// and the script that reads the statement (and the official tutorial, when there is one) for the coach.
import { gym, state } from './gym.js';

// Tags and the rating badge are spoilers. They are hidden on every Codeforces page shown inside the app.
export const TAGS_CSS = `
  .tag-box, .sidebox:has(.tag-box), .roundbox:has(> div > .roundbox > .tag-box) { display: none !important; }
`;

// Statement-only layout: no header, menus, sidebar or footer.
export const FOCUS_CSS = `
  #header, .menu-box, #sidebar, #footer, .second-level-menu, .lang-chooser, #notice-wrapper, .footer-logo-div, .button-up { display: none !important; }
  #body { margin: 0 auto !important; max-width: 920px !important; min-width: 0 !important; padding: 6px 22px 48px !important; }
  #pageContent, .content-with-sidebar { margin: 0 !important; padding: 0 !important; }
  html, body { background: #fff !important; }
  .problem-statement { font-size: 1.02em; }
`;

// The page is inverted as a whole in the dark theme (see styles.css); pictures are turned back.
export const DARK_CSS = `
  img, video, canvas, svg image { filter: invert(1) hue-rotate(180deg) !important; }
`;

const origin = () => (state.boot && state.boot.meta && state.boot.meta.cfOrigin) || 'https://codeforces.com';
// Gym contests (ids from 100000) are not in the problem set and have their own addresses.
const isGym = (contestId) => contestId >= 100000;
export const problemUrl = (contestId, index) => `${origin()}/${isGym(contestId) ? `gym/${contestId}/problem` : `problemset/problem/${contestId}`}/${index}?locale=en`;
export const submitUrl = (contestId, index) => `${origin()}/${isGym(contestId) ? 'gym' : 'contest'}/${contestId}/submit/${index}?locale=en`;
export const submissionsUrl = (handle) => `${origin()}/submissions/${encodeURIComponent(handle)}?locale=en`;
export const isProblemPage = (url) => /\/(problemset\/problem|(contest|gym)\/\d+\/problem)\//.test(url || '');

// Runs inside the Codeforces page and reads the statement from the DOM that is already on screen.
// (Refetching the page is not an option: Cloudflare may challenge a scripted request even when the page itself loaded.)
// Formulas come back as TeX: from the raw $$$...$$$ delimiters before MathJax runs, or from its math/tex scripts after.
export function extractSource(pid) {
  return `(async () => {
    const out = { ok: false, loggedIn: !!document.querySelector('a[href*="/logout"]') };
    out.challenge = /just a moment|attention required|checking your browser/i.test(document.title) || !!document.querySelector('#challenge-form, #challenge-running, .cf-turnstile, #cf-wrapper');
    const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'TR', 'TABLE', 'CENTER', 'BLOCKQUOTE']);
    const toText = (root) => {
      let s = '';
      const walk = (n) => {
        if (n.nodeType === 3) { s += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (tag === 'SCRIPT') {
          const type = n.getAttribute('type') || '';
          if (type.indexOf('math/tex') === 0) s += '$' + n.textContent + '$';
          return;
        }
        if (tag === 'STYLE') return;
        const c = n.classList;
        if (c && (c.contains('MathJax') || c.contains('MathJax_Preview') || c.contains('MathJax_Display') || c.contains('MJX_Assistive_MathML') || c.contains('input-output-copier'))) return;
        if (tag === 'BR') { s += '\\n'; return; }
        if (tag === 'IMG') { s += '[image]'; return; }
        if (tag === 'LI') s += '\\n- ';
        else if (BLOCK.has(tag)) s += '\\n';
        if (tag === 'SUP') s += '^';
        if (tag === 'SUB') s += '_';
        for (const k of n.childNodes) walk(k);
        if (BLOCK.has(tag)) s += '\\n';
      };
      walk(root);
      return s.replace(/\\u00a0/g, ' ').replace(/\\$\\$\\$/g, '$').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    };
    const ps = document.querySelector('.problem-statement');
    if (!ps) return out;
    const title = (ps.querySelector('.header .title') || {}).textContent || '';
    out.title = title.replace(/^\\s*[A-Za-z]\\d*\\.\\s*/, '').trim();
    out.text = toText(ps);
    out.ok = out.text.length > 40;
    try {
      const csrf = (document.querySelector('meta[name="X-Csrf-Token"]') || {}).content;
      if (csrf) {
        const r = await fetch('/data/problemTutorial?locale=en', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Csrf-Token': csrf, 'X-Requested-With': 'XMLHttpRequest' },
          body: 'problemCode=' + encodeURIComponent(${JSON.stringify(pid)}) + '&csrf_token=' + encodeURIComponent(csrf),
        });
        if (r.ok) {
          const j = await r.json();
          if (j && j.success === 'true' && j.html) {
            const t = toText(new DOMParser().parseFromString(j.html, 'text/html').body);
            if (t.length > 80) out.tutorial = t;
          }
        }
      }
    } catch (e) { /* no tutorial through this endpoint */ }
    const link = [...document.querySelectorAll('#sidebar a')].find((a) => /tutorial|editorial/i.test(a.textContent));
    out.tutorialUrl = link ? link.href : null;
    return out;
  })()`;
}

// Wires a <webview> showing a Codeforces problem. Returns controls for the toolbar.
export function attachCodeforces(view, { pid, getFocus, onInfo, onLoading }) {
  let focusKey = null;
  let captured = false;
  let ready = false; // webview methods throw until the first dom-ready

  async function applyFocus() {
    if (!ready) return;
    try {
      if (focusKey) { const key = focusKey; focusKey = null; await view.removeInsertedCSS(key); }
      if (getFocus() && isProblemPage(view.getURL())) focusKey = await view.insertCSS(FOCUS_CSS);
    } catch { /* the page changed underneath: the next dom-ready applies it again */ }
  }

  view.addEventListener('did-start-loading', () => onLoading && onLoading(true));
  view.addEventListener('did-stop-loading', () => onLoading && onLoading(false));
  view.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3 && onInfo) onInfo({ error: `Codeforces did not load (${e.errorDescription || e.errorCode}).` });
  });
  view.addEventListener('dom-ready', async () => {
    ready = true;
    focusKey = null;
    try {
      await view.insertCSS(TAGS_CSS);
      if (document.documentElement.dataset.theme === 'dark') await view.insertCSS(DARK_CSS);
    } catch { /* not ready */ }
    await applyFocus();
    if (!isProblemPage(view.getURL())) return;
    try {
      const r = await view.executeJavaScript(extractSource(pid));
      if (r && r.ok && !captured) {
        captured = true;
        await gym.call('statement.save', { pid, text: r.text, tutorial: r.tutorial || null, tutorialUrl: r.tutorialUrl || null, title: r.title || null });
      }
      if (onInfo) onInfo({ error: null, challenge: !!(r && r.challenge && !r.ok), captured: captured || !!(r && r.ok), loggedIn: !!(r && r.loggedIn), hasTutorial: !!(r && r.tutorial), tutorialUrl: r ? r.tutorialUrl : null, title: r ? r.title : null });
    } catch (e) {
      if (onInfo) onInfo({ error: 'Could not read the statement from the page.' });
    }
  });

  return {
    applyFocus,
    go: (url) => { if (ready) view.loadURL(url).catch(() => {}); else view.setAttribute('src', url); },
    reload: () => { if (ready) view.reload(); },
  };
}
