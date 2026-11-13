// Minimal Markdown renderer for coach messages. Builds DOM nodes directly, so model output can never inject markup.
import { h } from './dom.js';

function inline(text) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(h('code', null, tok.slice(1, -1)));
    else if (m[2]) out.push(h('strong', null, inline(tok.slice(2, -2))));
    else if (m[3]) out.push(h('em', null, inline(tok.slice(1, -1))));
    else {
      const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(tok);
      out.push(h('a', { href: mm[2], class: 'md-link', dataset: { external: '1' } }, mm[1]));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function markdown(src) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) { root.appendChild(h('p', null, inline(para.join(' ')))); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      root.appendChild(h('pre', null, h('code', null, code.join('\n'))));
      continue;
    }
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      flush();
      root.appendChild(h(`h${Math.min(6, head[1].length + 2)}`, null, inline(head[2])));
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const list = h(ordered ? 'ol' : 'ul');
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        list.appendChild(h('li', null, inline(item)));
      }
      root.appendChild(list);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return root;
}
