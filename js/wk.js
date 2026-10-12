// WaniKani API v2 client. Content is cached on-device only (never committed anywhere),
// and only levels within the account's max_level_granted are fetched.
import { state, saveSubjects, saveMeta, saveCards, invalidateIndex } from './store.js';
import { State, dayStart, seedReviewCard } from './fsrs.js';

const REVISION = '20170710';

async function api(path, token) {
  const base = state.settings.apiBase.replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Wanikani-Revision': REVISION } });
  if (res.status === 401) throw new Error('WaniKani rejected the API token (401).');
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 10000));
    return api(path, token);
  }
  if (!res.ok) throw new Error(`WaniKani API error ${res.status}`);
  return res.json();
}

async function* pages(path, token) {
  let next = path;
  while (next) {
    const body = await api(next, token);
    yield body;
    next = body.pages?.next_url || null;
  }
}

const TYPE = { radical: 'radical', kanji: 'kanji', vocabulary: 'vocab', kana_vocabulary: 'kana_vocab' };

export function normalizeSubject(raw) {
  const d = raw.data;
  const svg = (d.character_images || []).find((i) => i.content_type === 'image/svg+xml' && !i.metadata?.inline_styles)
    || (d.character_images || []).find((i) => i.content_type === 'image/svg+xml')
    || (d.character_images || []).find((i) => i.content_type === 'image/png');
  const audio = (d.pronunciation_audios || [])
    .filter((a) => a.content_type === 'audio/mpeg')
    .map((a) => ({ url: a.url, voice: a.metadata?.voice_actor_name, reading: a.metadata?.pronunciation }));
  return {
    id: `wk:${raw.id}`,
    src: 'wk',
    wkId: raw.id,
    type: TYPE[raw.object],
    level: d.level,
    chars: d.characters || null,
    img: d.characters ? null : svg?.url || null,
    slug: d.slug,
    meanings: (d.meanings || []).map((m) => ({ m: m.meaning, primary: m.primary })),
    aux: (d.auxiliary_meanings || []).filter((a) => a.type === 'whitelist').map((a) => a.meaning),
    readings: (d.readings || []).map((r) => ({ r: r.reading, primary: r.primary, kind: r.type || null, ok: r.accepted_answer })),
    comps: (d.component_subject_ids || []).map((i) => `wk:${i}`),
    amal: (d.amalgamation_subject_ids || []).map((i) => `wk:${i}`),
    similar: (d.visually_similar_subject_ids || []).map((i) => `wk:${i}`),
    mm: d.meaning_mnemonic || '',
    mh: d.meaning_hint || '',
    rm: d.reading_mnemonic || '',
    rh: d.reading_hint || '',
    ctx: (d.context_sentences || []).map((c) => ({ ja: c.ja, en: c.en })),
    pos: d.parts_of_speech || [],
    audio,
    lessonPos: d.lesson_position ?? 0,
    hidden: !!d.hidden_at,
    updated: raw.data_updated_at,
  };
}

export async function fetchUser(token) {
  const body = await api('/user', token);
  return body.data;
}

/** Sync subjects for levels 1..max_level_granted. onProgress(msg). */
export async function syncSubjects(onProgress = () => {}) {
  const token = state.settings.token.trim();
  if (!token) throw new Error('Add your WaniKani API token in Settings first.');
  onProgress('Checking account…');
  const user = await fetchUser(token);
  const granted = user.subscription?.max_level_granted ?? 0;
  await saveMeta({ user: { username: user.username, level: user.level, subscription: user.subscription } });
  const prevGranted = state.meta.syncedLevels || 0;
  const levels = Array.from({ length: granted }, (_, i) => i + 1).join(',');
  if (!levels) throw new Error('This account has no levels granted.');
  const since = granted === prevGranted && state.meta.lastSubjectSync ? `&updated_after=${encodeURIComponent(state.meta.lastSubjectSync)}` : '';
  const started = new Date().toISOString();
  let n = 0;
  for await (const page of pages(`/subjects?levels=${levels}${since}`, token)) {
    const subjects = page.data.map(normalizeSubject);
    await saveSubjects(subjects);
    n += subjects.length;
    onProgress(`Fetched ${n} of ${page.total_count} subjects…`);
  }
  invalidateIndex();
  await saveMeta({ lastSubjectSync: started, syncedLevels: granted });
  return { fetched: n, granted, username: user.username };
}

// WK SRS stage -> approximate FSRS stability (days) for seeding.
const STAGE_STABILITY = { 1: 0.2, 2: 0.4, 3: 1, 4: 2, 5: 7, 6: 14, 7: 30, 8: 120 };

/**
 * Seed local cards from WK assignment progress. Only touches cards that are still New
 * locally unless overwrite is set. Burned assignments are burned or seeded per knownMode.
 */
export async function importAssignments({ overwrite = false } = {}, onProgress = () => {}) {
  const token = state.settings.token.trim();
  if (!token) throw new Error('Add your WaniKani API token in Settings first.');
  const now = Date.now();
  const updates = [];
  let seen = 0;
  for await (const page of pages('/assignments?started=true', token)) {
    for (const a of page.data) {
      seen++;
      const id = `wk:${a.data.subject_id}`;
      const card = state.cards.get(id);
      if (!card || (!overwrite && card.state !== State.New)) continue;
      const stage = a.data.srs_stage;
      if (stage === 0) continue;
      if (stage >= 9) {
        updates.push({ ...card, burned: true, state: State.Review, s: Math.max(card.s, 365), ivl: 365, last: now, introduced: card.introduced || now });
        continue;
      }
      const avail = a.data.available_at ? Date.parse(a.data.available_at) : now;
      const s = STAGE_STABILITY[stage];
      const due = s < 1 ? avail : Math.max(avail, dayStart(now, state.settings.resetHour));
      // Approximate when the last WK review happened so retrievability starts sensible.
      const last = Math.min(now, avail - s * 86400000);
      const seeded = seedReviewCard(card, { stability: s, difficulty: 5, due, now: last });
      updates.push(seeded);
    }
    onProgress(`Read ${seen} assignments…`);
  }
  await saveCards(updates);
  return { seen, updated: updates.length };
}
