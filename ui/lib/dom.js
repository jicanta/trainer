// Tiny DOM helpers. Everything is built with createElement and textContent: no innerHTML anywhere.
const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function setAttrs(el, attrs, isSvg) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (!isSvg && k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs, false);
  append(el, children);
  return el;
}

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs, true);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

const ICONS = {
  home: ['M4 11.2 12 4l8 7.2V20H14.5v-5.5h-5V20H4z'],
  target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M12 12.6a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2z'],
  flag: ['M6 21V4', 'M6 4.5h11.5l-2.4 4 2.4 4H6'],
  chart: ['M5 20v-8', 'M12 20V5', 'M19 20v-5', 'M3 20h18'],
  book: ['M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14.5H7.5A2.5 2.5 0 0 0 5 20z', 'M5 20a2.5 2.5 0 0 0 2.5 1H19v-3.5'],
  chat: ['M20 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.2A8 8 0 1 1 20 11.5z'],
  sliders: ['M4 7h9', 'M17 7h3', 'M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M4 17h3', 'M11 17h9', 'M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  play: ['M8 5.5v13l10.5-6.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  stop: ['M7 7h10v10H7z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3 2'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  back: ['M10 6l-6 6 6 6', 'M4 12h16'],
  refresh: ['M20 11a8 8 0 0 0-14.3-4.3L4 8.5', 'M4 4v4.5h4.5', 'M4 13a8 8 0 0 0 14.3 4.3L20 15.5', 'M20 20v-4.5h-4.5'],
  external: ['M13 5h6v6', 'M19 5l-8.5 8.5', 'M17 14v5H5V7h5'],
  plus: ['M12 5v14', 'M5 12h14'],
  send: ['M12 19V5', 'M6 11l6-6 6 6'],
  shuffle: ['M4 7h3.5c2.5 0 4 1.5 5.5 4.5S16 17 18.5 17H20', 'M17.5 14.5 20 17l-2.5 2.5', 'M4 17h3.5c1.2 0 2.2-.4 3-1.1', 'M14.5 8.2c.9-.8 1.9-1.2 3.2-1.2H20', 'M17.5 4.5 20 7l-2.5 2.5'],
  bulb: ['M9 17.5h6', 'M10 20.5h4', 'M12 3.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2h5c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3.5z'],
  code: ['M8.5 7 3.5 12l5 5', 'M15.5 7l5 5-5 5'],
  park: ['M6 20V4h7a5 5 0 0 1 0 10H6'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  trash: ['M5 7h14', 'M9.5 7V4.5h5V7', 'M7 7l.8 12.5h8.4L17 7'],
  bolt: ['M13 3 5 13.5h6L10 21l8-10.5h-6z'],
  dot: ['M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
};

export function icon(name, size = 18) {
  const paths = ICONS[name] || ICONS.dot;
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon', 'aria-hidden': 'true' },
    paths.map((d) => s('path', { d })));
}

export function button(label, { kind = 'default', iconName, onClick, title, small, disabled, type = 'button' } = {}) {
  return h('button', { type, class: ['btn', kind !== 'default' && kind, small && 'small'], onClick, title, disabled },
    iconName ? icon(iconName, small ? 15 : 17) : null, label ? h('span', null, label) : null);
}

// Segmented control. options: [{ value, label }]
export function segmented(options, value, onChange) {
  const root = h('div', { class: 'seg', role: 'radiogroup' });
  const render = (current) => {
    mount(root, options.map((o) => h('button', {
      type: 'button', class: ['seg-item', o.value === current && 'on'], role: 'radio', 'aria-checked': o.value === current ? 'true' : 'false', title: o.title,
      onClick: () => { if (o.value !== current) { render(o.value); onChange(o.value); } },
    }, o.label)));
  };
  render(value);
  root.set = render;
  return root;
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}
