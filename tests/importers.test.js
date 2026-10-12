import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSottaku, parseGeneric, parseRelative, estimateInterval, summarize } from '../js/importers.js';

const NOW = Date.parse('2026-10-12T18:00:00');
const DAY = 86400000;

// Synthetic sample in the shape of Sottaku's flashcard overview page.
const SAMPLE = [
  'Select All (4 flashcards)', 'Kanji', '', 'Reading', '', 'English', '',
  '\t', '学校', 'がっこう', 'school', 'in 2 days\t54 days ago\tAug 19, 2026\t', '👁', '', '',
  '\t', '見る', 'みる', 'to see', 'in 122 days\t54 days ago\tAug 19, 2026\t', '👁', '', '',
  '\t', '切手', 'きって', 'postage stamp', '22 days ago\t22 days ago\tSep 20, 2026\t', '👁', '', '',
  '\t', 'わけだ', 'わけだ', "that's why", '⏸\t48 days ago\tAug 25, 2026\t', '👁', '', '',
  '\t', '雨', 'あめ', 'rain', '3 hours ago\t40 days ago\tAug 19, 2026\t', '👁', '',
  '© 2025-2026 Sottaku Inc',
].join('\n');

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

test('parses the Sottaku overview page', () => {
  const rows = parseSottaku(SAMPLE, NOW);
  assert.deepEqual(summarize(rows), { total: 5, learned: 3, new: 1, paused: 1, known: 0, burned: 0 });
  const school = rows.find((r) => r.chars === '学校');
  assert.equal(school.reading, 'がっこう');
  assert.equal(school.meaning, 'school');
  assert.equal(school.due, NOW + 2 * DAY);
  assert.equal(rows.find((r) => r.chars === '切手').kind, 'new');
  assert.equal(rows.find((r) => r.chars === 'わけだ').kind, 'paused');
  assert.equal(rows.find((r) => r.chars === '雨').kind, 'learned');
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
