// Projected review load. Pure: takes plain card objects + config.
import { State, grade, Grade, retrievability, dayStart, addDays } from './fsrs.js';
import { mulberry32 } from './util.js';

const DAY = 86400000;

/** Count of reviews due per day from the current schedule only (index 0 includes overdue). */
export function scheduled(cards, now, days, resetHour) {
  const today = dayStart(now, resetHour);
  const out = new Array(days).fill(0);
  for (const c of cards) {
    if (c.state === State.New || c.suspended || c.burned) continue;
    const idx = Math.max(0, Math.floor((dayStart(c.due, resetHour) - today) / DAY + 0.01));
    if (idx < days) out[idx]++;
  }
  return out;
}

/**
 * Monte Carlo simulation of daily load: reviews of existing cards, reviews of cards
 * introduced during the window (newPerDay while the pool lasts), and the backlog that
 * carries over when maxPerDay caps the day. Returns per-day averages over `runs`.
 */
export function simulate({ cards, now, days, cfg, newPerDay, newPool, maxPerDay = 0, runs = 8, seed = 1 }) {
  const res = { existing: new Array(days).fill(0), fresh: new Array(days).fill(0), backlog: new Array(days).fill(0), learned: new Array(days).fill(0) };
  const live = cards.filter((c) => c.state !== State.New && !c.suspended && !c.burned);
  const today0 = dayStart(now, cfg.resetHour);
  for (let run = 0; run < runs; run++) {
    const rng = mulberry32(seed + run * 7919);
    // Each sim card: { c, fresh }
    let deck = live.map((c) => ({ c: { ...c }, fresh: false }));
    let pool = newPool;
    for (let d = 0; d < days; d++) {
      const dayT = addDays(today0, d);
      const dayEnd = addDays(today0, d + 1);
      // New cards: learn at the start of the day, graded Good through the steps.
      const n = Math.min(newPerDay, pool);
      pool -= n;
      for (let i = 0; i < n; i++) {
        let c = { id: `sim${run}:${d}:${i}`, state: State.New, due: dayT, s: 0, d: 0, step: 0, reps: 0, lapses: 0, last: 0, ivl: 0 };
        let t = dayT + 9 * 3600000;
        let guard = 0;
        while (c.state !== State.Review && guard++ < 10) {
          c = grade(c, Grade.Good, t, cfg).card;
          t = Math.max(t + 60000, c.due);
        }
        deck.push({ c, fresh: true });
        res.learned[d] += 1 / runs;
      }
      let due = deck.filter((x) => x.c.due < dayEnd);
      const cap = maxPerDay || Infinity;
      if (due.length > cap) {
        due.sort((a, b) => a.c.due - b.c.due);
        res.backlog[d] += (due.length - cap) / runs;
        due = due.slice(0, cap);
      }
      for (const x of due) {
        const t = Math.max(x.c.due, dayT + 12 * 3600000);
        const r = retrievability((t - x.c.last) / DAY, x.c.s);
        const g = rng() < r ? (rng() < 0.85 ? Grade.Good : rng() < 0.6 ? Grade.Hard : Grade.Easy) : Grade.Again;
        x.fresh ? (res.fresh[d] += 1 / runs) : (res.existing[d] += 1 / runs);
        let c = grade(x.c, g, t, cfg).card;
        // Same-day relearning steps: count them, then settle with Good.
        let tt = t;
        let guard = 0;
        while ((c.state === State.Relearning || c.state === State.Learning) && guard++ < 6) {
          tt = Math.max(tt + 60000, c.due);
          x.fresh ? (res.fresh[d] += 1 / runs) : (res.existing[d] += 1 / runs);
          c = grade(c, Grade.Good, tt, cfg).card;
        }
        x.c = c;
      }
    }
  }
  return res;
}
