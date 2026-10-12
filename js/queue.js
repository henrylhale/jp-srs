// Lesson/review queues, unlock rules and level progress.
import { state } from './store.js';
import { State, dayStart, retrievability } from './fsrs.js';
import { shuffle, DAY } from './util.js';

const TYPE_ORDER = { radical: 0, kanji: 1, vocab: 2, kana_vocab: 3 };

export function grantedLevel() {
  return state.meta.user?.subscription?.max_level_granted ?? 0;
}

// Cards for content outside the current subscription are hidden, not deleted.
export function visible(subj) {
  if (!subj || subj.hidden) return false;
  if (subj.src === 'wk') {
    if (subj.level > grantedLevel()) return false;
    if (subj.type === 'radical' && !state.settings.includeRadicals) return false;
  }
  return true;
}

export function isPassed(card) {
  if (!card) return false;
  if (card.burned) return true;
  return (card.state === State.Review || card.state === State.Relearning) && card.s >= state.settings.passStability;
}

export function isMature(card) {
  if (!card) return false;
  return card.burned || (card.state === State.Review && card.ivl >= state.settings.matureIvl);
}

export function cardStatus(card) {
  if (!card) return 'none';
  if (card.burned) return 'burned';
  if (card.suspended) return 'suspended';
  if (card.state === State.New) return 'new';
  if (card.state === State.Learning || card.state === State.Relearning) return 'learning';
  return isMature(card) ? 'mature' : 'young';
}

function wkKanjiByLevel() {
  const m = new Map();
  for (const s of state.subjects.values()) {
    if (s.src !== 'wk' || s.type !== 'kanji' || s.hidden) continue;
    if (!m.has(s.level)) m.set(s.level, []);
    m.get(s.level).push(s);
  }
  return m;
}

// WK rule: a level is complete once 90% of its kanji are passed.
export function levelProgress() {
  const granted = grantedLevel();
  const byLevel = wkKanjiByLevel();
  let level = 1;
  const levels = [];
  for (let L = 1; L <= Math.max(granted, 1); L++) {
    const ks = byLevel.get(L) || [];
    const passed = ks.filter((s) => isPassed(state.cards.get(s.id))).length;
    levels.push({ level: L, total: ks.length, passed });
  }
  for (const l of levels) {
    if (l.total && l.passed / l.total >= 0.9 && l.level < granted) level = l.level + 1;
    else break;
  }
  if (state.settings.levelOverride) level = Math.min(Math.max(level, state.settings.levelOverride), Math.max(granted, 1));
  const cur = levels.find((l) => l.level === level) || { level, total: 0, passed: 0 };
  return { level, granted, current: cur, levels };
}

export function isUnlocked(subj, level) {
  if (subj.src !== 'wk') return true;
  if (state.settings.ignorePrereqs) return subj.level <= grantedLevel();
  if (subj.level > level) return false;
  if (subj.type === 'radical') return true;
  return (subj.comps || []).every((id) => {
    const cs = state.subjects.get(id);
    if (!cs || !visible(cs)) return true; // hidden radicals don't block
    return isPassed(state.cards.get(id));
  });
}

function lessonSort(a, b) {
  return (a.level ?? 999) - (b.level ?? 999)
    || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
    || (a.lessonPos ?? 0) - (b.lessonPos ?? 0)
    || String(a.id).localeCompare(String(b.id));
}

export function availableLessons() {
  const { level } = levelProgress();
  const wk = [], imported = [];
  for (const s of state.subjects.values()) {
    const c = state.cards.get(s.id);
    if (!c || c.state !== State.New || c.suspended || c.burned || !visible(s)) continue;
    if (!isUnlocked(s, level)) continue;
    (s.src === 'wk' ? wk : imported).push(s);
  }
  wk.sort(lessonSort);
  imported.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || lessonSort(a, b));
  const order = state.settings.lessonOrder;
  if (order === 'imported-first') return [...imported, ...wk];
  if (order === 'interleave') {
    const out = [];
    for (let i = 0; i < Math.max(wk.length, imported.length); i++) {
      if (i < wk.length) out.push(wk[i]);
      if (i < imported.length) out.push(imported[i]);
    }
    return out;
  }
  return [...wk, ...imported];
}

export function todayStart(now = Date.now()) {
  return dayStart(now, state.settings.resetHour);
}

export function newLeftToday(stats) {
  return Math.max(0, state.settings.newPerDay - stats.newToday);
}

export function dueCards(now = Date.now(), { learnAhead = true } = {}) {
  const ahead = learnAhead ? state.settings.learnAheadMin * 60000 : 0;
  const out = [];
  for (const c of state.cards.values()) {
    if (c.state === State.New || c.suspended || c.burned) continue;
    const learning = c.state === State.Learning || c.state === State.Relearning;
    if (c.due > now + (learning ? ahead : 0)) continue;
    if (!visible(state.subjects.get(c.id))) continue;
    out.push(c);
  }
  return out;
}

export function orderReviews(cards, now = Date.now()) {
  const order = state.settings.reviewOrder;
  const arr = [...cards];
  if (order === 'due') arr.sort((a, b) => a.due - b.due);
  else if (order === 'retrievability') arr.sort((a, b) => retrievability((now - a.last) / DAY, a.s) - retrievability((now - b.last) / DAY, b.s));
  else if (order === 'type') {
    shuffle(arr);
    arr.sort((a, b) => TYPE_ORDER[state.subjects.get(a.id)?.type] - TYPE_ORDER[state.subjects.get(b.id)?.type]);
  } else shuffle(arr);
  return arr;
}

export function reviewsLeftToday(stats) {
  const max = state.settings.maxReviewsPerDay;
  return max ? Math.max(0, max - stats.reviewsToday) : Infinity;
}

export function upcoming(now = Date.now(), hours = 24) {
  const buckets = new Array(hours).fill(0);
  for (const c of state.cards.values()) {
    if (c.state === State.New || c.suspended || c.burned || c.due <= now) continue;
    const h = Math.floor((c.due - now) / 3600000);
    if (h < hours && visible(state.subjects.get(c.id))) buckets[h]++;
  }
  return buckets;
}

export function counts() {
  const out = { new: 0, learning: 0, young: 0, mature: 0, burned: 0, suspended: 0 };
  for (const c of state.cards.values()) {
    if (!visible(state.subjects.get(c.id))) continue;
    out[cardStatus(c)]++;
  }
  return out;
}
