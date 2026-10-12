// Turns parsed ImportRows into card/subject changes.
import { state, byChars, saveCards, saveSubjects, deleteSubjects, invalidateIndex } from './store.js';
import { State, newCard, seedReviewCard, dayStart, addDays } from './fsrs.js';
import { visible } from './queue.js';
import { isKanji } from './util.js';

const DAY = 86400000;

export function customId(chars, reading) {
  return `c:${chars}|${reading || ''}`;
}

function splitMeanings(text) {
  return (text || '').split(/[;；]|,(?![^()]*\))/).map((m) => m.trim()).filter(Boolean);
}

export function makeCustomSubject(row, order, tag) {
  const chars = row.chars;
  const type = row.typeHint === 'kanji' && chars.length === 1 && isKanji(chars) ? 'kanji' : 'vocab';
  return {
    id: customId(chars, row.reading),
    src: 'custom',
    type,
    level: null,
    chars,
    meanings: splitMeanings(row.meaning).map((m, i) => ({ m, primary: i === 0 })),
    aux: [],
    readings: row.reading && row.reading !== chars ? [{ r: row.reading, primary: true }] : [],
    comps: [], amal: [], similar: [],
    mm: '', mh: '', rm: '', rh: '', ctx: [], pos: [], audio: [],
    tags: [tag],
    order,
  };
}

// Prefer a visible WK vocabulary item with the same characters (and reading, if given).
export function matchWk(row) {
  // Words never map onto kanji cards: a WK kanji card quizzes on'yomi/kun'yomi, not the word.
  const types = row.typeHint === 'kanji' ? ['kanji'] : row.typeHint === 'radical' ? ['radical'] : ['vocab', 'kana_vocab'];
  const cands = byChars(row.chars, types).filter((s) => s.src === 'wk' && visible(s));
  if (!cands.length) return null;
  const sameReading = cands.find((s) => !row.reading || s.readings.some((r) => r.r === row.reading) || s.type === 'kana_vocab');
  return sameReading || (row.reading ? null : cands[0]);
}

export function knownCard(card, now, mode, knownStability, resetHour) {
  if (mode === 'burn') return { ...card, burned: true, suspended: false, state: State.Review, s: Math.max(card.s || 0, 365), ivl: Math.max(card.ivl || 0, 365), last: now, introduced: card.introduced || now };
  // Spread due dates over the back half of the interval so known items don't all land on one day.
  const today = dayStart(now, resetHour);
  const spread = 0.5 + Math.random() * 0.5;
  const days = Math.max(1, Math.round(knownStability * spread));
  return seedReviewCard({ ...card, burned: false, suspended: false }, {
    stability: knownStability, difficulty: 3, due: addDays(today, days), now: now - (knownStability - days) * DAY,
  });
}

/**
 * opts: { paused: 'skip'|'suspend'|'known', newRows: 'new'|'skip', unmatched: 'custom'|'skip',
 *         overwrite: bool, confidence: number, tag: string, knownMode, knownStability }
 * Returns a plan; call commitPlan(plan) to persist.
 */
export function planImport(rows, opts, now = Date.now()) {
  const plan = { cards: new Map(), subjects: [], stats: { matched: 0, custom: 0, skipped: 0, unchanged: 0 }, examples: [] };
  const s = state.settings;
  let order = Date.now();
  for (const row of rows) {
    let kind = row.kind;
    if (kind === 'paused') {
      if (opts.paused === 'skip') { plan.stats.skipped++; continue; }
      if (opts.paused === 'known') kind = 'known';
    }
    if (kind === 'new' && opts.newRows === 'skip') { plan.stats.skipped++; continue; }

    let subj = matchWk(row);
    let card;
    if (subj) {
      card = plan.cards.get(subj.id) || state.cards.get(subj.id) || newCard(subj.id);
      if (!opts.overwrite && card.state !== State.New && !plan.cards.has(subj.id)) { plan.stats.unchanged++; continue; }
      plan.stats.matched++;
    } else {
      if (opts.unmatched === 'skip') { plan.stats.skipped++; continue; }
      const id = customId(row.chars, row.reading);
      subj = state.subjects.get(id) || makeCustomSubject(row, order++, opts.tag);
      if (!state.subjects.has(id)) plan.subjects.push(subj);
      card = plan.cards.get(id) || state.cards.get(id) || newCard(id);
      if (!opts.overwrite && card.state !== State.New && !plan.cards.has(id)) { plan.stats.unchanged++; continue; }
      plan.stats.custom++;
    }

    let next;
    if (kind === 'burned' || kind === 'known') {
      next = knownCard(card, now, kind === 'burned' ? 'burn' : opts.knownMode || s.knownMode, opts.knownStability || s.knownStability, s.resetHour);
    } else if (kind === 'learned') {
      const ivl = Math.max(0.2, row.ivl * (opts.confidence || 1));
      const due = row.due;
      next = seedReviewCard({ ...card, suspended: false, burned: false }, { stability: ivl, difficulty: 5, due, now: Math.min(now, due - ivl * DAY) });
    } else {
      next = { ...newCard(card.id), suspended: false };
    }
    if (row.kind === 'paused' && opts.paused === 'suspend') next = { ...next, suspended: true };
    plan.cards.set(card.id, next);
    if (plan.examples.length < 8) plan.examples.push({ row, subj, kind });
  }
  return plan;
}

export async function commitPlan(plan) {
  await saveSubjects(plan.subjects);
  await saveCards([...plan.cards.values()]);
  invalidateIndex();
}

/**
 * After a sync adds WK content, fold imported cards into matching WK items (same characters
 * and reading) so nothing is studied twice. The WK card takes over the imported schedule
 * when it hasn't been started yet; the imported duplicate is removed either way.
 */
export async function mergeImportedIntoWk() {
  invalidateIndex();
  const moved = [], dupes = [];
  for (const subj of [...state.subjects.values()]) {
    if (subj.src !== 'custom' || subj.type !== 'vocab') continue;
    const reading = subj.readings[0]?.r || '';
    const wk = matchWk({ chars: subj.chars, reading, typeHint: 'vocab' });
    if (!wk) continue;
    const mine = state.cards.get(subj.id);
    const theirs = state.cards.get(wk.id);
    if (mine && theirs && theirs.state === State.New && mine.state !== State.New) moved.push({ ...mine, id: wk.id });
    dupes.push(subj.id);
  }
  await saveCards(moved);
  await deleteSubjects(dupes);
  invalidateIndex();
  return { moved: moved.length, removed: dupes.length };
}

/** Mark WK items through a level as known/burned (only cards not already reviewed, unless overwrite). */
export function planKnownThroughLevel(level, types, mode, overwrite, now = Date.now()) {
  const s = state.settings;
  const out = [];
  for (const subj of state.subjects.values()) {
    if (subj.src !== 'wk' || subj.level > level || !types.includes(subj.type) || !visible(subj)) continue;
    const card = state.cards.get(subj.id);
    if (!card || (!overwrite && card.state !== State.New)) continue;
    out.push(knownCard(card, now, mode, s.knownStability, s.resetHour));
  }
  return out;
}
