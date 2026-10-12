// In-memory app state backed by IndexedDB. Everything fits comfortably in memory
// (WK tops out around 9k subjects), so views read from these Maps synchronously.
import * as db from './db.js';
import { DEFAULT_W, newCard } from './fsrs.js';

export const DEFAULT_SETTINGS = {
  token: '',
  apiBase: 'https://api.wanikani.com/v2',
  resetHour: 4,
  newPerDay: 10,
  maxReviewsPerDay: 0,
  lessonBatch: 5,
  lessonOrder: 'wk-first', // wk-first | imported-first | interleave
  includeRadicals: true,
  ignorePrereqs: false,
  levelOverride: 0,
  retention: 0.9,
  maxIvl: 36500,
  learnSteps: [1, 10],
  relearnSteps: [10],
  fuzz: true,
  passStability: 7,
  matureIvl: 21,
  knownMode: 'late', // late | burn
  knownStability: 120,
  reviewOrder: 'random', // random | due | retrievability | type
  showIntervals: true,
  autoplayAudio: false,
  leechLapses: 8,
  leechAction: 'tag', // tag | suspend
  learnAheadMin: 20,
  theme: 'auto',
  gridIncludeVocab: true,
  w: null,
};

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  meta: {},
  subjects: new Map(),
  cards: new Map(),
  ready: false,
};

export async function load() {
  const [subjects, cards, settings, meta] = await Promise.all([
    db.getAll('subjects'), db.getAll('cards'), db.get('kv', 'settings'), db.get('kv', 'meta'),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.meta = meta || {};
  state.subjects = new Map(subjects.map((s) => [s.id, s]));
  state.cards = new Map(cards.map((c) => [c.id, c]));
  // Every subject has a card; create missing ones lazily (e.g. after a sync).
  const missing = [];
  for (const s of subjects) if (!state.cards.has(s.id)) missing.push(newCard(s.id));
  if (missing.length) await saveCards(missing);
  state.ready = true;
}

export function fsrsConfig() {
  const s = state.settings;
  return {
    w: s.w || DEFAULT_W,
    retention: s.retention,
    maxIvl: s.maxIvl,
    learnSteps: s.learnSteps,
    relearnSteps: s.relearnSteps,
    resetHour: s.resetHour,
    fuzz: s.fuzz,
  };
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.put('kv', state.settings, 'settings');
}

export async function saveMeta(patch) {
  Object.assign(state.meta, patch);
  await db.put('kv', state.meta, 'meta');
}

export async function saveCard(card) {
  state.cards.set(card.id, card);
  await db.put('cards', card);
}

export async function saveCards(cards) {
  for (const c of cards) state.cards.set(c.id, c);
  await db.putMany('cards', cards);
}

export async function saveSubjects(subjects) {
  for (const s of subjects) state.subjects.set(s.id, s);
  await db.putMany('subjects', subjects);
  const missing = subjects.filter((s) => !state.cards.has(s.id)).map((s) => newCard(s.id));
  await saveCards(missing);
}

export async function deleteSubjects(ids) {
  for (const id of ids) { state.subjects.delete(id); state.cards.delete(id); }
  await db.delMany('subjects', ids);
  await db.delMany('cards', ids);
}

export const subject = (id) => state.subjects.get(id);
export const card = (id) => state.cards.get(id);

// Lookup WK subjects by characters (first match per type preference).
let charIndex = null;
export function invalidateIndex() { charIndex = null; }
export function byChars(chars, types) {
  if (!charIndex) {
    charIndex = new Map();
    for (const s of state.subjects.values()) {
      if (!s.chars) continue;
      if (!charIndex.has(s.chars)) charIndex.set(s.chars, []);
      charIndex.get(s.chars).push(s);
    }
  }
  const list = charIndex.get(chars) || [];
  return types ? list.filter((s) => types.includes(s.type)) : list;
}

export async function exportBackup() {
  const logs = await db.getAll('logs');
  return {
    app: 'jp-srs', version: 1, exported: Date.now(),
    settings: { ...state.settings, token: '' },
    meta: state.meta,
    // WK subjects are re-fetched on sync; only custom content is backed up.
    customSubjects: [...state.subjects.values()].filter((s) => s.src !== 'wk'),
    cards: [...state.cards.values()],
    logs,
  };
}

export async function importBackup(data) {
  if (data?.app !== 'jp-srs') throw new Error('Not a jp-srs backup file');
  const token = state.settings.token;
  await db.clear('cards', 'logs');
  await db.putMany('subjects', data.customSubjects || []);
  await db.putMany('cards', data.cards || []);
  await db.putMany('logs', (data.logs || []).map(({ n, ...l }) => l));
  await db.put('kv', { ...DEFAULT_SETTINGS, ...data.settings, token }, 'settings');
  await db.put('kv', { ...(data.meta || {}) }, 'meta');
  invalidateIndex();
  await load();
}
