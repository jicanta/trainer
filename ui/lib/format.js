// Formatting helpers shared by every screen.

export function clock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

export function minutes(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function hoursMinutes(totalMin) {
  const m = Math.round(totalMin || 0);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function day(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function dayYear(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export function dateTime(ts) {
  const d = new Date(ts);
  return `${day(ts)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function relative(ts, now = Date.now()) {
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

// Codeforces rank colors, used only as a small dot next to a rating (text stays in ink).
export function ratingColor(r) {
  if (r == null) return '#B8B7B1';
  if (r < 1200) return '#9A9A9A';
  if (r < 1400) return '#3E9B3E';
  if (r < 1600) return '#2BA3A3';
  if (r < 1900) return '#3465D9';
  if (r < 2100) return '#9B3FB5';
  if (r < 2400) return '#E08A1E';
  return '#D03B3B';
}

export const OUTCOMES = {
  clean: { label: 'Clean solve', tone: 'green' },
  assisted: { label: 'Solved with hints', tone: 'yellow' },
  upsolved: { label: 'Upsolved', tone: 'blue' },
  failed: { label: 'Not solved', tone: 'red' },
  parked: { label: 'Parked', tone: 'gray' },
  abandoned: { label: 'Discarded', tone: 'gray' },
  active: { label: 'In progress', tone: 'blue' },
};

export const MODES = { practice: 'Practice', idea: 'Idea drill', contest: 'Contest', upsolve: 'Upsolve', redo: 'Re-solve' };
export const QUEUE_KINDS = { upsolve: 'Upsolve', redo: 'Re-solve', parked: 'Parked' };

export const signed = (n) => (n > 0 ? `+${n}` : String(n));
export const percent = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
export const compact = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : String(n));
