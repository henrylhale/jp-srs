import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, preview, newCard, retrievability, intervalFor, dayStart, State, Grade, DEFAULT_W } from '../js/fsrs.js';

const cfg = { w: DEFAULT_W, retention: 0.9, maxIvl: 36500, learnSteps: [1, 10], relearnSteps: [10], resetHour: 4, fuzz: false };
const T0 = new Date(2026, 9, 12, 10, 0).getTime();
const MIN = 60000, DAY = 86400000;

test('retrievability is 0.9 after exactly S days', () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.equal(intervalFor(10, 0.9, 36500), 10);
  assert.ok(intervalFor(10, 0.8, 36500) > 10);
});

test('new card walks the learning steps then graduates', () => {
  let c = newCard('x');
  let r = grade(c, Grade.Good, T0, cfg);
  assert.equal(r.card.state, State.Learning);
  assert.equal(r.card.step, 1);
  assert.equal(r.card.due, T0 + 10 * MIN);
  assert.equal(r.log.prevState, State.New);
  r = grade(r.card, Grade.Good, T0 + 10 * MIN, cfg);
  assert.equal(r.card.state, State.Review);
  assert.ok(r.card.ivl >= 1);
  assert.equal(r.card.due, dayStart(T0, 4) + r.card.ivl * DAY);
});

test('Again on a new card restarts at the first step', () => {
  const r = grade(newCard('x'), Grade.Again, T0, cfg);
  assert.equal(r.card.state, State.Learning);
  assert.equal(r.card.due, T0 + MIN);
});

test('Easy on a new card graduates immediately', () => {
  const r = grade(newCard('x'), Grade.Easy, T0, cfg);
  assert.equal(r.card.state, State.Review);
  assert.ok(r.card.ivl >= 8);
});

test('review intervals are ordered Hard < Good < Easy and lapse relearns', () => {
  const c = { ...newCard('y'), state: State.Review, s: 10, d: 5, last: T0 - 10 * DAY, ivl: 10, reps: 3, due: T0 };
  const p = preview(c, T0, cfg);
  assert.ok(p[2] < p[3] && p[3] < p[4], 'hard<good<easy');
  const lapse = grade(c, Grade.Again, T0, cfg).card;
  assert.equal(lapse.state, State.Relearning);
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.s < c.s);
  const good = grade(c, Grade.Good, T0, cfg).card;
  assert.ok(good.s > c.s);
  assert.ok(good.ivl > 10);
});

test('day start respects reset hour', () => {
  const late = new Date(2026, 9, 12, 2, 30).getTime();
  assert.equal(new Date(dayStart(late, 4)).getDate(), 11);
  const morning = new Date(2026, 9, 12, 5, 0).getTime();
  assert.equal(new Date(dayStart(morning, 4)).getDate(), 12);
});

test('fuzz is deterministic and bounded', () => {
  const fz = { ...cfg, fuzz: true };
  const c = { ...newCard('z'), state: State.Review, s: 40, d: 5, last: T0 - 40 * DAY, ivl: 40, reps: 5, due: T0 };
  const a = grade(c, Grade.Good, T0, fz).card.ivl;
  const b = grade(c, Grade.Good, T0, fz).card.ivl;
  const base = grade(c, Grade.Good, T0, cfg).card.ivl;
  assert.equal(a, b);
  assert.ok(Math.abs(a - base) <= Math.ceil(base * 0.05) + 1);
});
