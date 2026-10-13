// FSRS-5 memory model plus an Anki-style step scheduler.
// Pure functions only: no DOM, no storage. Times are epoch milliseconds.

export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 };

export const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86400000;
const MIN = 60000;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays, s) {
  if (!s || s <= 0) return 0;
  return Math.pow(1 + FACTOR * Math.max(0, elapsedDays) / s, DECAY);
}

export function intervalFor(s, retention, maxIvl) {
  const ivl = (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, maxIvl);
}

const initStability = (w, g) => Math.max(w[g - 1], 0.1);
const initDifficulty = (w, g) => clamp(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10);

function nextDifficulty(w, d, g) {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  const reverted = w[7] * initDifficulty(w, 4) + (1 - w[7]) * damped;
  return clamp(reverted, 1, 10);
}

function recallStability(w, d, s, r, g) {
  const hard = g === Grade.Hard ? w[15] : 1;
  const easy = g === Grade.Easy ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy);
}

function forgetStability(w, d, s, r) {
  const f = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.min(f, s / Math.exp(w[17] * w[18]));
}

function shortTermStability(w, s, g) {
  const next = s * Math.exp(w[17] * (g - 3 + w[18]));
  return g >= Grade.Good ? Math.max(next, s) : next;
}

// Start of the "SRS day" containing t, honouring the reset hour (local time).
export function dayStart(t, resetHour) {
  const d = new Date(t);
  if (d.getHours() < resetHour) d.setDate(d.getDate() - 1);
  d.setHours(resetHour, 0, 0, 0);
  return d.getTime();
}

export function addDays(dayStartMs, n) {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function newCard(id) {
  return {
    id, state: State.New, due: 0, s: 0, d: 0, step: 0,
    reps: 0, lapses: 0, last: 0, ivl: 0,
    suspended: false, burned: false, leech: false, introduced: 0,
  };
}

// Deterministic per-card fuzz so previews match the applied result.
function fuzzFactor(id, reps) {
  let h = 2166136261;
  const str = `${id}:${reps}`;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function fuzzIvl(ivl, card, cfg) {
  if (!cfg.fuzz || ivl < 3) return ivl;
  const delta = Math.max(1, Math.round(ivl * (ivl < 7 ? 0.15 : ivl < 20 ? 0.1 : 0.05)));
  const f = fuzzFactor(card.id, card.reps);
  return clamp(Math.round(ivl - delta + f * (2 * delta + 1) - 0.5), 2, cfg.maxIvl);
}

/**
 * Apply a grade to a card. cfg: { w, retention, maxIvl, learnSteps (minutes[]),
 * relearnSteps (minutes[]), resetHour, fuzz }.
 * Returns { card, log } where card is a new object.
 */
export function grade(card, g, now, cfg) {
  const w = cfg.w || DEFAULT_W;
  const c = { ...card };
  const prev = { state: card.state, s: card.s, d: card.d, due: card.due, ivl: card.ivl };
  const elapsed = card.last ? (now - card.last) / DAY : 0;
  const today = dayStart(now, cfg.resetHour);
  const sameDay = card.last && dayStart(card.last, cfg.resetHour) === today;
  const r = card.state === State.New ? 1 : retrievability(elapsed, card.s);

  const graduate = (s) => {
    let ivl = fuzzIvl(intervalFor(s, cfg.retention, cfg.maxIvl), c, cfg);
    c.state = State.Review;
    c.step = 0;
    c.ivl = ivl;
    c.due = addDays(today, ivl);
  };
  const stepDue = (steps, i) => now + steps[Math.min(i, steps.length - 1)] * MIN;
  const hardStepDue = (steps, i) => {
    if (i === 0 && steps.length > 1) return now + ((steps[0] + steps[1]) / 2) * MIN;
    if (i === 0) return now + Math.min(steps[0] * 1.5, steps[0] + 1440) * MIN;
    return stepDue(steps, i);
  };

  if (card.state === State.New) {
    c.s = initStability(w, g);
    c.d = initDifficulty(w, g);
    c.introduced = card.introduced || now;
    const steps = cfg.learnSteps;
    if (g === Grade.Easy || steps.length === 0 || (g === Grade.Good && steps.length === 1)) {
      graduate(c.s);
    } else {
      c.state = State.Learning;
      c.step = g === Grade.Good ? 1 : 0;
      c.due = g === Grade.Hard ? hardStepDue(steps, 0) : stepDue(steps, c.step);
    }
  } else if (card.state === State.Learning || card.state === State.Relearning) {
    const steps = card.state === State.Learning ? cfg.learnSteps : cfg.relearnSteps;
    if (sameDay || elapsed < 1) c.s = shortTermStability(w, card.s, g);
    else c.s = g === Grade.Again ? forgetStability(w, card.d, card.s, r) : recallStability(w, card.d, card.s, r, g);
    c.d = nextDifficulty(w, card.d, g);
    if (g === Grade.Again) {
      c.step = 0;
      c.due = stepDue(steps, 0);
      if (steps.length === 0) graduate(c.s);
    } else if (g === Grade.Hard) {
      c.due = hardStepDue(steps, card.step);
      if (steps.length === 0) graduate(c.s);
    } else if (g === Grade.Good && card.step + 1 < steps.length) {
      c.step = card.step + 1;
      c.due = stepDue(steps, c.step);
    } else {
      graduate(c.s);
      if (g === Grade.Easy && c.ivl < 2) {
        c.ivl = Math.min(2, cfg.maxIvl);
        c.due = addDays(today, c.ivl);
      }
    }
  } else {
    // Review (also covers "known"/imported cards).
    c.d = nextDifficulty(w, card.d, g);
    if (g === Grade.Again) {
      c.s = sameDay ? shortTermStability(w, card.s, g) : forgetStability(w, card.d, card.s, r);
      c.lapses = card.lapses + 1;
      if (cfg.relearnSteps.length) {
        c.state = State.Relearning;
        c.step = 0;
        c.due = stepDue(cfg.relearnSteps, 0);
      } else graduate(c.s);
    } else {
      const sFor = (gg) => (sameDay ? shortTermStability(w, card.s, gg) : recallStability(w, card.d, card.s, r, gg));
      const ivlFor = (gg) => intervalFor(sFor(gg), cfg.retention, cfg.maxIvl);
      let hardI = ivlFor(Grade.Hard);
      let goodI = ivlFor(Grade.Good);
      let easyI = ivlFor(Grade.Easy);
      hardI = Math.min(hardI, goodI);
      goodI = Math.max(goodI, hardI + 1);
      easyI = Math.max(easyI, goodI + 1);
      const ivl = Math.min(cfg.maxIvl, g === Grade.Hard ? hardI : g === Grade.Good ? goodI : easyI);
      c.s = sFor(g);
      c.state = State.Review;
      c.step = 0;
      c.ivl = fuzzIvl(ivl, c, cfg);
      c.due = addDays(today, c.ivl);
    }
  }
  c.reps = card.reps + 1;
  c.last = now;
  const log = {
    card: card.id, ts: now, grade: g, prevState: prev.state, state: c.state,
    s: c.s, d: c.d, prevS: prev.s, elapsed, r, ivl: c.ivl,
  };
  return { card: c, log };
}

// Due times for each grade without mutating anything (for button labels).
export function preview(card, now, cfg) {
  const out = {};
  for (const g of [1, 2, 3, 4]) out[g] = grade(card, g, now, cfg).card.due;
  return out;
}

// Turn an approximate interval (days until due) into a card already in Review.
export function seedReviewCard(card, { stability, difficulty = 5, due, now }) {
  return {
    ...card,
    state: State.Review,
    s: Math.max(0.5, stability),
    d: clamp(difficulty, 1, 10),
    step: 0,
    due,
    last: now,
    ivl: Math.max(1, Math.round(stability)),
    reps: Math.max(card.reps, 1),
    introduced: card.introduced || now,
  };
}
