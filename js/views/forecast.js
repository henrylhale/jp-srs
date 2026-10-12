import { html, mount, $ } from '../util.js';
import { state, fsrsConfig } from '../store.js';
import { scheduled, simulate } from '../forecast.js';
import { visible } from '../queue.js';
import { State, addDays, dayStart } from '../fsrs.js';

let days = 30;
let mode = 'sim';
let newPerDay = null;

export function render(el) {
  const draw = () => {
    const now = Date.now();
    const s = state.settings;
    const cards = [...state.cards.values()].filter((c) => visible(state.subjects.get(c.id)));
    const npd = newPerDay ?? s.newPerDay;
    // All not-yet-started visible items, ignoring unlock order, approximate the lesson pool.
    const pool = cards.filter((c) => c.state === State.New && !c.suspended && !c.burned).length;
    let series, legend;
    if (mode === 'sched') {
      const sch = scheduled(cards, now, days, s.resetHour);
      series = sch.map((n) => [n, 0, 0]);
      legend = html`<span class="sw existing"></span>scheduled reviews`;
    } else {
      const sim = simulate({ cards, now, days, cfg: fsrsConfig(), newPerDay: npd, newPool: pool, maxPerDay: s.maxReviewsPerDay, runs: 6 });
      series = sim.existing.map((n, i) => [n, sim.fresh[i], sim.backlog[i]]);
      legend = html`<span class="sw existing"></span>current cards <span class="sw fresh"></span>from new lessons ${s.maxReviewsPerDay ? html`<span class="sw backlog"></span>carried-over backlog` : ''}`;
    }
    const totals = series.map(([a, b]) => a + b);
    const max = Math.max(1, ...series.map(([a, b, c]) => a + b + c));
    const avg = totals.reduce((a, b) => a + b, 0) / days;
    const peak = Math.max(...totals);
    const today0 = dayStart(now, s.resetHour);
    const overdue = cards.filter((c) => c.state !== State.New && !c.suspended && !c.burned && c.due < today0).length;
    const label = (i) => new Date(addDays(today0, i)).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

    mount(el, html`
      <header class="page-head"><h1>Forecast</h1></header>
      <div class="filters">
        <select id="days"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select>
        <select id="mode"><option value="sim">Simulated (with new lessons)</option><option value="sched">Scheduled only</option></select>
        ${mode === 'sim' ? html`<label class="check">new/day <input type="number" id="npd" min="0" max="200" value="${npd}" style="width:4.5em"></label>` : ''}
      </div>
      <div class="panel stats-grid">
        <div><b>${Math.round(totals[0])}</b><span>today${overdue ? ` (${overdue} overdue)` : ''}</span></div>
        <div><b>${Math.round(avg)}</b><span>avg / day</span></div>
        <div><b>${Math.round(peak)}</b><span>peak day</span></div>
        <div><b>${pool}</b><span>items not started</span></div>
      </div>
      <div class="panel">
        <div class="chart" style="--n:${days}">
          ${series.map(([a, b, c], i) => html`<div class="col" title="${label(i)}: ${Math.round(a + b)} reviews${c ? `, ${Math.round(c)} carried over` : ''}">
            <span class="seg backlog" style="height:${(c / max) * 100}%"></span>
            <span class="seg fresh" style="height:${(b / max) * 100}%"></span>
            <span class="seg existing" style="height:${(a / max) * 100}%"></span>
          </div>`)}
        </div>
        <div class="row-between muted tiny"><span>${label(0)}</span><span>${label(Math.floor(days / 2))}</span><span>${label(days - 1)}</span></div>
        <div class="legend small">${legend}</div>
        <p class="muted small">${mode === 'sim'
          ? `Monte Carlo over 6 runs: each review is recalled with its FSRS probability (target ${Math.round(s.retention * 100)}%), and ${npd} new items are added per day until the pool runs out${s.maxReviewsPerDay ? `, capped at ${s.maxReviewsPerDay} reviews/day` : ''}.`
          : 'Reviews already on the calendar, with no new lessons and no failures.'}</p>
      </div>`);
    $('#days', el).value = String(days);
    $('#mode', el).value = mode;
  };
  el.onchange = (e) => {
    if (e.target.id === 'days') days = +e.target.value;
    if (e.target.id === 'mode') mode = e.target.value;
    if (e.target.id === 'npd') newPerDay = Math.max(0, +e.target.value || 0);
    draw();
  };
  draw();
  return () => { el.onchange = null; };
}
