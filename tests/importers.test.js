import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneric, parseRelative, estimateInterval, summarize } from '../js/importers.js';

const NOW = Date.parse('2026-10-12T18:00:00');
const DAY = 86400000;

test('relative times', () => {
  assert.equal(parseRelative('in 3 days', NOW), NOW + 3 * DAY);
  assert.equal(parseRelative('22 days ago', NOW), NOW - 22 * DAY);
  assert.equal(parseRelative('tomorrow', NOW), NOW + DAY);
  assert.equal(parseRelative('in 5 hours', NOW), NOW + 5 * 3600000);
  assert.equal(parseRelative('an hour ago', NOW), NOW - 3600000);
  assert.equal(parseRelative('⏸', NOW), null);
});

test('interval estimate is bounded by card age', () => {
  const added = NOW - 54 * DAY;
  assert.equal(estimateInterval({ due: NOW + 2 * DAY, added, now: NOW }), 4);
  const long = estimateInterval({ due: NOW + 122 * DAY, added, now: NOW });
  assert.ok(long > 122 && long <= 176);
});

test('CSV with absolute due dates, intervals, status and tag', () => {
  const csv = [
    'word,reading,meaning,due,interval,status,tag',
    '学校,がっこう,school,2026-10-14T18:00+00:00,4,,mine',
    '知らせる,しらせる,"to inform, to notify",,,new,mine',
    'わけだ,わけだ,that\'s why,,,suspended,mine',
  ].join('\n');
  const rows = parseGeneric(csv, NOW);
  assert.deepEqual(summarize(rows), { total: 3, learned: 1, new: 1, paused: 1, known: 0, burned: 0 });
  const school = rows.find((r) => r.chars === '学校');
  assert.equal(school.due, Date.parse('2026-10-14T18:00+00:00'));
  assert.equal(school.ivl, 4);
  assert.equal(school.tag, 'mine');
  assert.equal(rows.find((r) => r.chars === '知らせる').meaning, 'to inform, to notify');
});

test('generic CSV with header and stages', () => {
  const rows = parseGeneric('word,reading,meaning,stage\n学校,がっこう,school,guru\n一,いち,one,burned\n山,やま,mountain,', NOW);
  assert.equal(rows.find((r) => r.chars === '学校').kind, 'learned');
  assert.equal(rows.find((r) => r.chars === '学校').ivl, 7);
  assert.equal(rows.find((r) => r.chars === '一').kind, 'burned');
  assert.equal(rows.find((r) => r.chars === '山').kind, 'new');
});

test('headerless pasted list uses default kind and optional interval', () => {
  const rows = parseGeneric('水\tみず\twater\n火\tひ\tfire\t30', NOW, 'known');
  assert.equal(rows.find((r) => r.chars === '水').kind, 'known');
  const fire = rows.find((r) => r.chars === '火');
  assert.equal(fire.kind, 'learned');
  assert.equal(fire.ivl, 30);
});

test('JSON array input', () => {
  const rows = parseGeneric(JSON.stringify([{ characters: '木', reading: 'き', meaning: 'tree', interval: 12 }]), NOW);
  assert.equal(rows[0].kind, 'learned');
  assert.equal(rows[0].ivl, 12);
});
