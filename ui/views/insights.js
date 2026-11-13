// Insights: what the log says about your level, your topics, your time and your mistakes,
// plus the coach review that feeds back into problem selection.
import { h, mount, button } from '../lib/dom.js';
import { gym, state, navigate, fail, toast } from '../lib/gym.js';
import { columns, stackedColumns, lines, barList, legend, chartCard, dataTable } from '../lib/charts.js';
import { day, dayYear, dateTime, hoursMinutes, percent } from '../lib/format.js';
import { markdown } from '../lib/md.js';

const OUTCOME_SERIES = [
  { label: 'Clean solve', color: 'var(--good)' }, { label: 'Solved with hints', color: 'var(--warning)' },
  { label: 'Not solved', color: 'var(--critical)' }, { label: 'Parked', color: 'var(--neutral)' },
];
const TIME_SERIES = [{ label: 'Thinking', color: 'var(--series-1)' }, { label: 'Coding', color: 'var(--series-2)' }];

function reviewCard(reviews, rerender) {
  const body = h('div', { class: 'review-body' });
  const actions = h('div', { class: 'row wrap', style: { marginTop: '14px' } });
  const older = h('div');
  const writeBtn = button('Write a review', { iconName: 'bolt' });
  const coachOk = state.boot.coach && state.boot.coach.found;
  writeBtn.disabled = !coachOk;
  let job = null;
  let text = '';

  const render = (r) => {
    if (!r) {
      mount(body, h('p', { class: 'empty' }, coachOk
        ? 'No review yet. The coach reads your whole log and Codeforces history, says what is holding you back, and proposes a focus for the next two weeks.'
        : 'Claude Code was not found. Set its path in Settings to use the coach.'));
      return mount(actions);
    }
    mount(body, h('p', { class: 'card-sub', style: { marginBottom: '10px' } }, `Written ${dayYear(r.createdAt)}`), markdown(r.content));
    const f = r.focus;
    mount(actions,
      f && f.focusTags.length ? h('span', { class: 'muted' }, 'Focus:') : null,
      f ? f.focusTags.map((t) => h('span', { class: 'tag' }, t)) : null,
      f && f.difficulty ? h('span', { class: 'tag' }, `${f.difficulty} difficulty`) : null,
      h('span', { class: 'spacer' }),
      f && !r.applied ? button('Apply to my training', { kind: 'primary', onClick: async () => {
        try {
          state.boot.settings = await gym.call('coach.applyReview', { id: r.id });
          toast('Applied. Problem selection follows this focus for two weeks.', { kind: 'good' });
          rerender();
        } catch (e) { fail(e); }
      } }) : f ? h('span', { class: 'badge green' }, 'Applied') : null);
  };

  writeBtn.addEventListener('click', async () => {
    try {
      const r = await gym.call('coach.review');
      job = r.jobId;
      text = '';
      writeBtn.disabled = true;
      mount(body, h('div', { class: 'msg-status' }, h('span', { class: 'pulse' }), h('span', null, 'Reading your training log')));
      mount(actions);
    } catch (e) { fail(e); }
  });
  const offs = [
    gym.on('coach:delta', (p) => { if (p.jobId === job) { text += p.text; mount(body, markdown(text.replace(/```json[\s\S]*$/, ''))); } }),
    gym.on('coach:done', (p) => { if (p.jobId === job) { job = null; writeBtn.disabled = false; render(p.review); } }),
    gym.on('coach:error', (p) => { if (p.jobId === job) { job = null; writeBtn.disabled = false; mount(body, h('div', { class: 'msg-error' }, p.error)); } }),
  ];
  render(reviews[0]);
  if (reviews.length > 1) {
    let open = false;
    const toggle = h('button', { class: 'link-btn', type: 'button' }, `Earlier reviews (${reviews.length - 1})`);
    toggle.addEventListener('click', () => {
      open = !open;
      mount(older, open ? reviews.slice(1).map((r) => h('div', { class: 'section review-body' }, h('p', { class: 'card-sub', style: { marginBottom: '8px' } }, dayYear(r.createdAt)), markdown(r.content))) : null);
    });
    actions.after(h('div', { style: { marginTop: '14px' } }, toggle));
  }
  const el = h('section', { class: 'card span-12' },
    h('header', { class: 'card-head' },
      h('div', null, h('h3', { class: 'card-title' }, 'Coach review'), h('p', { class: 'card-sub' }, 'Your statistics, read by the coach and turned into a focus that steers which problems you get next.')),
      writeBtn),
    body, actions, older);
  return { el, destroy: () => offs.forEach((off) => off()) };
}

function topicsTable(topics) {
  const rows = topics.filter((t) => t.share >= 0.02 || t.attempts > 0).sort((a, b) => b.weakness - a.weakness || b.share - a.share);
  const top = Math.max(0.01, ...rows.map((t) => t.weakness));
  return dataTable([
    { key: 'tag', label: 'Topic', format: (v, t) => (t.focus ? h('span', null, v, ' ', h('span', { class: 'badge blue' }, 'focus')) : v) },
    { key: 'attempts', label: 'In the gym', align: 'right', format: (v) => v || '-' },
    { key: 'cleanRate', label: 'Clean', align: 'right', format: (v, t) => (t.attempts ? percent(v) : '-') },
    { key: 'level', label: 'Topic level', align: 'right', format: (v) => v ?? '-' },
    { key: 'thinkMin', label: 'Think (min)', align: 'right', format: (v) => v ?? '-' },
    { key: 'cfSolved', label: 'Solved on CF', align: 'right' },
    { key: 'cfAtLevel', label: 'At your level', align: 'right' },
    { key: 'weakness', label: 'Priority', format: (v) => h('div', { class: 'meter blue', style: { width: '110px' }, title: `Selection weight ${v.toFixed(2)}` }, h('span', { style: { width: `${(v / top) * 100}%` } })) },
  ], rows);
}

export async function show(root) {
  let review = null;
  const render = async () => {
    const [ins, reviews] = await Promise.all([gym.call('stats.insights'), gym.call('coach.reviews')]);
    if (review) review.destroy();
    review = reviewCard(reviews, render);
    const none = ins.attempts === 0;
    const need = 'Finish a few problems in the gym and this fills in.';
    const cf = ins.cf;
    const cleanAll = ins.byRating.reduce((s, b) => s + b.clean, 0);

    const yearAgo = Date.now() - 365 * 86400000;
    const levelSeries = [
      { label: 'Gym level', color: 'var(--series-1)', line: true, points: ins.levelSeries.map((p) => ({ x: p.t, y: p.level })) },
      { label: 'Codeforces rating', color: 'var(--series-2)', line: true, points: cf ? cf.ratingHistory.filter((p) => p.t >= yearAgo).map((p) => ({ x: p.t, y: p.rating })) : [] },
    ].filter((sr) => sr.points.length);

    const cards = [
      review.el,
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Gym level'), h('div', { class: 'tile-value' }, ins.level), h('div', { class: 'tile-note' }, `Goal ${ins.target}`)),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Counted attempts'), h('div', { class: 'tile-value' }, ins.attempts), h('div', { class: 'tile-note' }, none ? 'Nothing logged yet' : `${percent(cleanAll / ins.attempts)} clean solves`)),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Thinking time logged'), h('div', { class: 'tile-value' }, ins.focus.thinkHours, h('small', null, ' h')), h('div', { class: 'tile-note' }, 'Outside contests')),
      h('section', { class: 'card span-3' }, h('div', { class: 'tile-label' }, 'Drifts per thinking hour'), h('div', { class: 'tile-value' }, ins.focus.driftsPerHour ?? '-'), h('div', { class: 'tile-note' }, 'From your check-ins')),

      chartCard({
        title: 'Level over time', subtitle: 'Gym level from your counted attempts, next to your Codeforces rating over the last year.', wide: true,
        empty: levelSeries.length ? null : 'No history yet.',
        legendEl: levelSeries.length > 1 ? legend(levelSeries) : null,
        body: lines({ series: levelSeries, format: (v) => String(Math.round(v)), dateLabel: (t, span) => (span < 3 * 86400000 ? dateTime(t) : day(t)), label: 'Level over time' }),
        table: { columns: [{ key: 'when', label: 'Date' }, { key: 'series', label: 'Series' }, { key: 'value', label: 'Value', align: 'right' }],
          rows: levelSeries.flatMap((sr) => sr.points.map((p) => ({ when: dayYear(p.x), series: sr.label, value: p.y, x: p.x }))).sort((a, b) => b.x - a.x).slice(0, 60) },
      }),
      chartCard({
        title: 'Results by problem rating', subtitle: 'Where clean solves stop is your real level. Practice should sit just above it.',
        empty: none ? need : null, legendEl: legend(OUTCOME_SERIES),
        body: stackedColumns({ data: ins.byRating.map((b) => ({ label: String(b.rating), parts: [b.clean, b.assisted, b.failed, b.parked] })), series: OUTCOME_SERIES, label: 'Results by problem rating' }),
        table: { columns: [{ key: 'rating', label: 'Rating' }, { key: 'clean', label: 'Clean', align: 'right' }, { key: 'assisted', label: 'With hints', align: 'right' }, { key: 'failed', label: 'Not solved', align: 'right' }, { key: 'parked', label: 'Parked', align: 'right' }], rows: ins.byRating },
      }),
      chartCard({
        title: 'Time to solve by rating', subtitle: 'Median minutes on problems you solved in practice, split into thinking and coding.',
        empty: ins.timeByRating.length ? null : need, legendEl: legend(TIME_SERIES),
        body: stackedColumns({ data: ins.timeByRating.map((t) => ({ label: String(t.rating), parts: [t.think, t.code], tipTitle: `${t.rating}, ${t.n} solved` })), series: TIME_SERIES, format: (v) => `${v}`, label: 'Time to solve by rating' }),
        table: { columns: [{ key: 'rating', label: 'Rating' }, { key: 'n', label: 'Solved', align: 'right' }, { key: 'think', label: 'Think (min)', align: 'right' }, { key: 'code', label: 'Code (min)', align: 'right' }], rows: ins.timeByRating },
      }),
      chartCard({
        title: 'Training time per week', subtitle: 'Minutes on the clock, contests included. The last column is this week.',
        empty: ins.weekly.some((w) => w.minutes > 0) ? null : need,
        body: columns({ data: ins.weekly.map((w) => ({ label: day(w.weekStart), value: w.minutes, tipTitle: `Week of ${day(w.weekStart)}`, tip: [{ value: hoursMinutes(w.minutes), label: 'trained' }, { value: String(w.problems), label: 'problems' }] })), mark: ins.weekly.length - 1, label: 'Training minutes per week' }),
        table: { columns: [{ key: 'week', label: 'Week of' }, { key: 'minutes', label: 'Minutes', align: 'right' }, { key: 'problems', label: 'Problems', align: 'right' }], rows: ins.weekly.map((w) => ({ week: dayYear(w.weekStart), minutes: w.minutes, problems: w.problems })) },
      }),
      chartCard({
        title: 'What went wrong', subtitle: 'From your reflections. The top line is the habit to fix first.',
        empty: ins.mistakes.length ? null : 'Reflections after each problem fill this in.',
        body: barList({ rows: ins.mistakes.map((m) => ({ label: m.label, value: m.n, note: m.n === 1 ? 'problem' : 'problems' })) }),
        table: { columns: [{ key: 'label', label: 'Mistake' }, { key: 'n', label: 'Problems', align: 'right' }], rows: ins.mistakes },
      }),
      h('section', { class: 'card span-12' },
        h('header', { class: 'card-head' }, h('div', null, h('h3', { class: 'card-title' }, 'Topics'),
          h('p', { class: 'card-sub' }, 'Priority combines how you do on a topic in the gym with how little of it you have solved at your level on Codeforces, scaled by how often it appears at your level. Practice picks lean toward high priority, without ever showing you the tag.'))),
        topicsTable(ins.topics)),
    ];

    if (cf) {
      cards.push(
        h('h2', { class: 'section-title span-12', style: { margin: '20px 0 -4px' } }, 'From your Codeforces history'),
        chartCard({
          title: 'Solved by rating', subtitle: 'Distinct problems you have solved on Codeforces, all time.',
          body: columns({ data: cf.solvedByRating.map((d) => ({ label: String(d.rating), value: d.all, tip: [{ value: String(d.all), label: 'solved' }, { value: String(d.recent), label: 'in the last 6 months' }] })), label: 'Solved on Codeforces by rating' }),
          table: { columns: [{ key: 'rating', label: 'Rating' }, { key: 'all', label: 'Solved', align: 'right' }, { key: 'recent', label: 'Last 6 months', align: 'right' }], rows: cf.solvedByRating },
        }),
        chartCard({
          title: 'Where your rounds stop', subtitle: cf.contests
            ? `In your last ${cf.contests} rounds you solved ${cf.avgSolved} problems on average. The first one you did not solve has a median rating of ${cf.wallMedian ?? '-'}. Its tags:`
            : 'No rated rounds found.',
          empty: cf.wallTags.length ? null : 'No rounds to analyze yet.',
          body: barList({ rows: cf.wallTags.map((t) => ({ label: t.tag, value: t.n, note: 'rounds' })) }),
          table: { columns: [{ key: 'tag', label: 'Tag of the first unsolved problem' }, { key: 'n', label: 'Rounds', align: 'right' }], rows: cf.wallTags },
        }),
        chartCard({
          title: 'In-contest speed', subtitle: 'Median minutes between accepted solutions in your rounds, by problem rating. Speed on easy problems decides most contests.',
          empty: cf.speedByRating.length ? null : 'Not enough rounds yet.',
          body: columns({ data: cf.speedByRating.map((d) => ({ label: String(d.rating), value: d.minutes, tip: [{ value: `${d.minutes} min`, label: `median of ${d.n}` }] })), label: 'Minutes per solved problem by rating' }),
          table: { columns: [{ key: 'rating', label: 'Rating' }, { key: 'minutes', label: 'Median minutes', align: 'right' }, { key: 'n', label: 'Problems', align: 'right' }], rows: cf.speedByRating },
        }),
        chartCard({
          title: 'Tried and not solved in rounds', subtitle: 'Tags of problems you submitted during a round and never got accepted there.',
          empty: cf.failedTags.length ? null : 'Nothing here.',
          body: barList({ rows: cf.failedTags.map((t) => ({ label: t.tag, value: t.n, note: 'problems' })) }),
          table: { columns: [{ key: 'tag', label: 'Tag' }, { key: 'n', label: 'Problems', align: 'right' }], rows: cf.failedTags },
        }));
    }
    if (ins.contests.length) {
      cards.push(h('section', { class: 'card span-12' }, h('header', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Virtual contests')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Contest'), h('th', { class: 'num' }, 'Solved'), h('th', { class: 'num' }, 'Performance'))),
          h('tbody', null, [...ins.contests].reverse().map((c) => h('tr', { class: 'clickable', onClick: () => navigate('contest', { id: c.id }) },
            h('td', null, dayYear(c.startedAt)), h('td', null, c.title), h('td', { class: 'num' }, `${c.solved} of ${c.total}`), h('td', { class: 'num' }, c.perf ?? '-'))))))));
    }

    mount(root, h('div', { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', { class: 'page-title' }, 'Insights'),
        h('p', { class: 'page-sub' }, 'Every attempt, hint, reflection and contest ends up here, and from here back into what you are given next.'))),
      h('div', { class: 'bento' }, cards.map((c) => { if (c.classList.contains('viz-card')) c.classList.add(c.classList.contains('wide') ? 'span-12' : 'span-6'); return c; }))));
  };
  await render();
  return () => { if (review) review.destroy(); };
}
