import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduled, simulate } from '../js/forecast.js';
import { newCard, State, DEFAULT_W } from '../js/fsrs.js';

const cfg = { w: DEFAULT_W, retention: 0.9, maxIvl: 36500, learnSteps: [1, 10], relearnSteps: [10], resetHour: 4, fuzz: false };
const NOW = new Date(2026, 9, 12, 10).getTime();
const DAY = 86400000;
const rev = (id, dueDays, s = 10) => ({ ...newCard(id), state: State.Review, s, d: 5, ivl: s, last: NOW - s * DAY, due: NOW + dueDays * DAY });

test('scheduled buckets overdue into today', () => {
  const out = scheduled([rev('a', -3), rev('b', 0), rev('c', 2), newCard('n')], NOW, 7, 4);
  assert.equal(out[0], 2);
  assert.equal(out[2], 1);
  assert.equal(out.reduce((a, b) => a + b), 3);
});

test('simulation adds load from new cards and reports backlog under a cap', () => {
  const cards = Array.from({ length: 50 }, (_, i) => rev(`c${i}`, 0));
  const res = simulate({ cards, now: NOW, days: 14, cfg, newPerDay: 10, newPool: 100, maxPerDay: 20, runs: 2 });
  assert.ok(res.backlog[0] >= 30, 'capped day leaves a backlog');
  assert.ok(res.fresh.slice(1).some((x) => x > 0), 'new cards come back for review');
  assert.equal(Math.round(res.learned.reduce((a, b) => a + b)), 100);
});
