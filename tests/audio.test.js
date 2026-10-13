import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioPlan } from '../js/audio.js';

const subj = (o) => ({ meanings: [], readings: [], audio: [], ...o });

test('radicals speak their English name', () => {
  assert.deepEqual(audioPlan(subj({ type: 'radical', meanings: [{ m: 'Ground', primary: true }] })), { text: 'Ground', lang: 'en-US' });
});

test("kanji speak all on'yomi, falling back to the primary reading", () => {
  const k = subj({ type: 'kanji', readings: [
    { r: 'いち', primary: true, kind: 'onyomi' }, { r: 'いつ', kind: 'onyomi' }, { r: 'ひと', kind: 'kunyomi' }] });
  assert.deepEqual(audioPlan(k), { text: 'いち、いつ', lang: 'ja-JP' });
  const kunOnly = subj({ type: 'kanji', readings: [{ r: 'こ', primary: true, kind: 'kunyomi' }] });
  assert.equal(audioPlan(kunOnly).text, 'こ');
});

test('vocab prefers the WK recording online, TTS of the reading otherwise', () => {
  const v = subj({ type: 'vocab', chars: '一つ', readings: [{ r: 'ひとつ', primary: true }], audio: [{ url: 'https://files.wanikani.com/x' }] });
  assert.equal(audioPlan(v, { online: true }).url, 'https://files.wanikani.com/x');
  assert.equal(audioPlan(v, { online: false }).url, null);
  assert.equal(audioPlan(v, { online: false }).text, 'ひとつ');
});

test('imported words and kana-only vocab use TTS', () => {
  const custom = subj({ type: 'vocab', src: 'custom', chars: '学校', readings: [{ r: 'がっこう', primary: true }] });
  assert.deepEqual(audioPlan(custom), { url: null, text: 'がっこう', lang: 'ja-JP' });
  const kana = subj({ type: 'kana_vocab', chars: 'ここ' });
  assert.equal(audioPlan(kana).text, 'ここ');
});
