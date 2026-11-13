// Small SVG chart kit: columns, stacked columns, lines, ranked bars. Thin marks, hairline grid,
// hover tooltips on every mark, and a table twin for every chart.
import { h, s, mount } from './dom.js';

let tipEl = null;
export function showTip(evt, title, rows) {
  if (!tipEl) { tipEl = h('div', { class: 'viz-tip', role: 'tooltip' }); document.body.appendChild(tipEl); }
  mount(tipEl,
    title ? h('div', { class: 'viz-tip-title' }, title) : null,
    rows.map((r) => h('div', { class: 'viz-tip-row' },
      r.color ? h('span', { class: 'viz-tip-key', style: { background: r.color } }) : null,
      h('strong', null, r.value), r.label ? h('span', null, r.label) : null)));
  tipEl.style.display = 'block';
  const w = tipEl.offsetWidth;
  const hh = tipEl.offsetHeight;
  let x = evt.clientX + 14;
  let y = evt.clientY + 14;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - 14;
  if (y + hh > window.innerHeight - 8) y = evt.clientY - hh - 14;
  tipEl.style.left = `${Math.max(8, x)}px`;
  tipEl.style.top = `${Math.max(8, y)}px`;
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

function axis(max, integer = true) {
  const raw = Math.max(max, 1e-9) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((st) => st >= raw) || 10 * p;
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return { top, ticks };
}

function responsive(height, draw) {
  const box = h('div', { class: 'viz-box', style: { height: `${height}px` } });
  let last = 0;
  const render = () => {
    const w = Math.floor(box.clientWidth);
    if (!w || w === last) return;
    last = w;
    mount(box, draw(w, height));
  };
  new ResizeObserver(render).observe(box);
  requestAnimationFrame(render);
  return box;
}

// A column that is square at the baseline and rounded at the data end.
function roundedTop(x, y, w, hgt) {
  const r = Math.min(4, w / 2, hgt);
  return `M${x},${y + hgt} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + hgt} Z`;
}

function grid(svg, ax, y, m, W, format) {
  for (const t of ax.ticks) {
    svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'viz-axis' : 'viz-grid' }));
    svg.appendChild(s('text', { x: m.l - 8, y: y(t) + 4, class: 'viz-tick', 'text-anchor': 'end' }, format(t)));
  }
}

function hover(el, getTip) {
  el.addEventListener('pointermove', (e) => { const t = getTip(); showTip(e, t.title, t.rows); el.parentNode.classList.add('hot'); });
  el.addEventListener('pointerleave', () => { hideTip(); el.parentNode.classList.remove('hot'); });
  el.addEventListener('focus', () => { const t = getTip(); const r = el.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.top + 8 }, t.title, t.rows); });
  el.addEventListener('blur', hideTip);
}

function xLabels(svg, labels, m, band, H) {
  const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor((band * labels.length) / 46))));
  labels.forEach((label, i) => {
    if (i % every) return;
    svg.appendChild(s('text', { x: m.l + band * i + band / 2, y: H - 7, class: 'viz-tick', 'text-anchor': 'middle' }, label));
  });
}

// data: [{ label, value, tipTitle?, tip? }]
export function columns({ data, height = 210, color = 'var(--series-1)', format = String, integer = true, unit = '', label = 'Chart', mark = null }) {
  return responsive(height, (W, H) => {
    const m = { l: 42, r: 10, t: 18, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const ax = axis(Math.max(1, ...data.map((d) => d.value)), integer);
    const y = (v) => m.t + ih - (v / ax.top) * ih;
    const band = iw / Math.max(1, data.length);
    const bw = Math.min(24, Math.max(3, band - 6));
    const svg = s('svg', { width: W, height: H, class: 'viz', role: 'img', 'aria-label': label });
    grid(svg, ax, y, m, W, format);
    data.forEach((d, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      const top = y(d.value);
      const g = s('g', { class: 'viz-mark' });
      if (d.value > 0) g.appendChild(s('path', { d: roundedTop(x, top, bw, m.t + ih - top), fill: d.color || color }));
      const hit = s('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent', tabindex: 0 });
      hover(hit, () => ({ title: d.tipTitle || d.label, rows: d.tip || [{ value: format(d.value), label: unit }] }));
      g.appendChild(hit);
      svg.appendChild(g);
      if (mark === i && d.value > 0) svg.appendChild(s('text', { x: x + bw / 2, y: top - 6, class: 'viz-value', 'text-anchor': 'middle' }, format(d.value)));
    });
    xLabels(svg, data.map((d) => d.label), m, band, H);
    return svg;
  });
}

// data: [{ label, parts: [n, n, ...] }], series: [{ label, color }]
export function stackedColumns({ data, series, height = 210, format = String, label = 'Chart' }) {
  return responsive(height, (W, H) => {
    const m = { l: 42, r: 10, t: 18, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const totals = data.map((d) => d.parts.reduce((a, b) => a + b, 0));
    const ax = axis(Math.max(1, ...totals), true);
    const band = iw / Math.max(1, data.length);
    const bw = Math.min(24, Math.max(3, band - 6));
    const svg = s('svg', { width: W, height: H, class: 'viz', role: 'img', 'aria-label': label });
    grid(svg, ax, (v) => m.t + ih - (v / ax.top) * ih, m, W, format);
    data.forEach((d, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      const g = s('g', { class: 'viz-mark' });
      let base = m.t + ih;
      const live = d.parts.map((v, k) => ({ v, k })).filter((p) => p.v > 0);
      live.forEach((p, j) => {
        const full = (p.v / ax.top) * ih;
        const gap = j === 0 ? 0 : 2; // surface gap between touching segments
        const hgt = Math.max(1, full - gap);
        const top = base - full;
        if (j === live.length - 1) g.appendChild(s('path', { d: roundedTop(x, top, bw, hgt), fill: series[p.k].color }));
        else g.appendChild(s('rect', { x, y: top, width: bw, height: hgt, fill: series[p.k].color }));
        base = top;
      });
      const hit = s('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent', tabindex: 0 });
      hover(hit, () => ({ title: d.tipTitle || d.label, rows: series.map((sr, k) => ({ color: sr.color, value: format(d.parts[k]), label: sr.label })) }));
      g.appendChild(hit);
      svg.appendChild(g);
    });
    xLabels(svg, data.map((d) => d.label), m, band, H);
    return svg;
  });
}

// series: [{ label, color, points: [{ x: timestamp, y }] }]
export function lines({ series, height = 230, format = String, label = 'Chart', dateLabel }) {
  return responsive(height, (W, H) => {
    const m = { l: 46, r: 46, t: 16, b: 26 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const all = series.flatMap((sr) => sr.points);
    const svg = s('svg', { width: W, height: H, class: 'viz', role: 'img', 'aria-label': label });
    if (!all.length) return svg;
    let x0 = Math.min(...all.map((p) => p.x));
    let x1 = Math.max(...all.map((p) => p.x));
    if (x1 - x0 < 86400000) { x0 -= 43200000; x1 += 43200000; }
    let lo = Math.min(...all.map((p) => p.y));
    let hi = Math.max(...all.map((p) => p.y));
    const step = hi - lo > 700 ? 200 : hi - lo > 250 ? 100 : 50;
    lo = Math.floor((lo - step / 2) / step) * step;
    hi = Math.ceil((hi + step / 2) / step) * step;
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * iw;
    const Y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    for (let v = lo; v <= hi; v += step) {
      svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === lo ? 'viz-axis' : 'viz-grid' }));
      svg.appendChild(s('text', { x: m.l - 8, y: Y(v) + 4, class: 'viz-tick', 'text-anchor': 'end' }, format(v)));
    }
    const n = Math.max(2, Math.min(5, Math.floor(iw / 110)));
    for (let i = 0; i < n; i++) {
      const v = x0 + ((x1 - x0) * i) / (n - 1);
      svg.appendChild(s('text', { x: X(v), y: H - 7, class: 'viz-tick', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, dateLabel(v, x1 - x0)));
    }
    const ends = [];
    for (const sr of series) {
      if (!sr.points.length) continue;
      const pts = [...sr.points].sort((a, b) => a.x - b.x);
      if (pts.length > 1) svg.appendChild(s('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' '), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const end = pts[pts.length - 1];
      svg.appendChild(s('circle', { cx: X(end.x), cy: Y(end.y), r: 4, fill: sr.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      ends.push({ y: Y(end.y), x: X(end.x), value: end.y });
    }
    // End labels only when they do not collide; the legend and the tooltip carry the rest.
    ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => {
      if (i > 0 && e.y - arr[i - 1].y < 14) return;
      svg.appendChild(s('text', { x: Math.min(W - 4, e.x + 9), y: e.y + 4, class: 'viz-value', 'text-anchor': 'start' }, format(e.value)));
    });
    const cross = s('line', { y1: m.t, y2: m.t + ih, class: 'viz-cross', style: 'display:none' });
    svg.appendChild(cross);
    const hit = s('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
    const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
    hit.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const t = x0 + ((e.clientX - rect.left - m.l) / iw) * (x1 - x0);
      const near = xs.reduce((best, v) => (Math.abs(v - t) < Math.abs(best - t) ? v : best), xs[0]);
      cross.setAttribute('x1', X(near));
      cross.setAttribute('x2', X(near));
      cross.style.display = '';
      const rows = [];
      for (const sr of series) {
        const before = sr.points.filter((p) => p.x <= near).sort((a, b) => b.x - a.x)[0];
        if (before) rows.push({ color: sr.color, value: format(before.y), label: sr.label });
      }
      showTip(e, dateLabel(near, 0), rows);
    });
    hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; hideTip(); });
    svg.appendChild(hit);
    return svg;
  });
}

// Ranked horizontal bars. rows: [{ label, value, note? }]
export function barList({ rows, format = String, color = 'var(--series-1)', max }) {
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'barlist' }, rows.map((r) => {
    const row = h('div', { class: 'barlist-row', tabindex: 0 },
      h('span', { class: 'barlist-label', title: r.label }, r.label),
      h('span', { class: 'barlist-track' }, h('span', { class: 'barlist-bar', style: { width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100)}%`, background: r.color || color } })),
      h('span', { class: 'barlist-value' }, format(r.value)));
    const tipRows = [{ value: format(r.value), label: r.note || '' }];
    row.addEventListener('pointermove', (e) => showTip(e, r.label, tipRows));
    row.addEventListener('pointerleave', hideTip);
    return row;
  }));
}

export function legend(series) {
  return h('div', { class: 'viz-legend' }, series.map((sr) => h('span', { class: 'viz-legend-item' },
    h('span', { class: ['viz-swatch', sr.line && 'line'], style: { background: sr.color } }), sr.label)));
}

// columns: [{ key, label, align?, format? }]
export function dataTable(cols, rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.align === 'right' ? 'num' : null }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', null, cols.map((c) => {
      const v = c.format ? c.format(r[c.key], r) : r[c.key];
      return h('td', { class: c.align === 'right' ? 'num' : null }, v instanceof Node ? v : v == null ? '-' : String(v));
    }))))));
}

// A titled card with a chart and its table twin.
export function chartCard({ title, subtitle, body, legendEl, table, empty, wide }) {
  let asTable = false;
  const content = h('div', { class: 'viz-content' });
  const toggle = table && !empty ? h('button', { class: 'link-btn', type: 'button' }, 'Table') : null;
  const render = () => {
    if (empty) mount(content, h('p', { class: 'empty' }, empty));
    else if (asTable) mount(content, dataTable(table.columns, table.rows));
    else mount(content, legendEl || null, body);
    if (toggle) toggle.textContent = asTable ? 'Chart' : 'Table';
  };
  if (toggle) toggle.addEventListener('click', () => { asTable = !asTable; render(); });
  render();
  return h('section', { class: ['card', 'viz-card', wide && 'wide'] },
    h('header', { class: 'card-head' },
      h('div', null, h('h3', { class: 'card-title' }, title), subtitle ? h('p', { class: 'card-sub' }, subtitle) : null),
      toggle),
    content);
}
