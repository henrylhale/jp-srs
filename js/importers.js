// Parsers for external SRS state. Pure functions (no DOM/storage) so they can be unit tested.
//
// Every parser yields ImportRow objects:
//   { chars, reading, meaning, kind, due, ivl, typeHint }
// kind: 'learned' (has a schedule) | 'new' | 'paused' | 'known' | 'burned'
// due: epoch ms (learned rows), ivl: estimated current interval in days (learned rows)

const DAY = 86400000;
const UNIT_MS = { minute: 60000, hour: 3600000, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

/** Parse relative times ("in 3 days", "22 days ago", "tomorrow"). */
export function parseRelative(text, now) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t === 'now' || t === 'today') return now;
  if (t === 'tomorrow') return now + DAY;
  if (t === 'yesterday') return now - DAY;
  const m = t.match(/^(in\s+)?(\d+|an?)\s+(minute|hour|day|week|month|year)s?(\s+ago)?$/);
  if (!m) return null;
  const n = /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : 1;
  const ms = n * UNIT_MS[m[3]];
  if (m[4]) return now - ms;
  return now + ms;
}

function parseDate(text) {
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
}

/**
 * Estimate the current interval of a card from its due date (and, if known, the date it
 * was added). A snapshot lands at a uniformly random point inside the current interval,
 * so on average half of it has elapsed: ivl ~= 2*(due-now), bounded by the card's age.
 * Overdue cards: assume the last review was halfway between being added and falling due.
 */
export function estimateInterval({ due, added, now }) {
  const age = added ? Math.max(1, (due - added) / DAY) : null;
  if (due > now) {
    const est = Math.max(1, (2 * (due - now)) / DAY);
    return age ? Math.max(1, Math.min(est, age)) : est;
  }
  return age ? Math.max(1, Math.min(60, age / 2)) : 1;
}

// Keep one row per (chars, reading): prefer learned, then the later due date.
function dedupe(rows) {
  const rank = { burned: 4, known: 3, learned: 2, new: 1, paused: 0 };
  const map = new Map();
  for (const r of rows) {
    const k = `${r.chars}\u0000${r.reading}`;
    const cur = map.get(k);
    if (!cur || rank[r.kind] > rank[cur.kind] || (r.kind === cur.kind && (r.due || 0) > (cur.due || 0))) map.set(k, r);
  }
  return [...map.values()];
}

const FIELD_ALIASES = {
  chars: ['word', 'characters', 'kanji', 'expression', 'front', 'vocab', 'term', 'item'],
  reading: ['reading', 'kana', 'furigana', 'pronunciation'],
  meaning: ['meaning', 'english', 'back', 'definition', 'gloss', 'translation'],
  due: ['due', 'due date', 'next review', 'next_review', 'recognition due'],
  ivl: ['interval', 'ivl', 'interval days', 'interval_days'],
  stability: ['stability'],
  stage: ['stage', 'srs stage', 'srs_stage', 'srs'],
  status: ['status', 'state'],
  type: ['type', 'kind'],
  tag: ['tag', 'tags', 'deck', 'source'],
};

const STAGES = { apprentice: 2, guru: 5, master: 7, enlightened: 8, burned: 9 };
const STAGE_IVL = { 1: 0.2, 2: 0.4, 3: 1, 4: 2, 5: 7, 6: 14, 7: 30, 8: 120 };

function splitDelimited(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((l) => (delim === '\t' ? l.split('\t') : parseCsvLine(l)).map((s) => s.trim()));
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function mapHeader(cells) {
  const idx = {};
  cells.forEach((c, i) => {
    const key = c.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key) && idx[field] == null) idx[field] = i;
    }
  });
  return idx.chars != null ? idx : null;
}

function rowFromRecord(rec, now, defaultKind) {
  const chars = (rec.chars || '').trim();
  if (!chars) return null;
  const row = { chars, reading: (rec.reading || '').trim(), meaning: (rec.meaning || '').trim(), typeHint: rec.type?.toLowerCase(), tag: (rec.tag || '').trim() || null };
  const status = (rec.status || '').toLowerCase();
  let stage = rec.stage != null && rec.stage !== '' ? String(rec.stage).toLowerCase() : null;
  if (stage && STAGES[stage]) stage = STAGES[stage];
  else if (stage) stage = parseInt(stage, 10) || null;
  if (status.includes('burn') || stage === 9) return { ...row, kind: 'burned' };
  if (status.includes('known')) return { ...row, kind: 'known' };
  if (status.includes('susp') || status.includes('pause')) return { ...row, kind: 'paused' };
  if (status === 'new') return { ...row, kind: 'new' };
  let due = null;
  if (rec.due) due = parseRelative(String(rec.due), now) ?? parseDate(String(rec.due));
  let ivl = rec.stability ? parseFloat(rec.stability) : rec.ivl ? parseFloat(rec.ivl) : null;
  if (!ivl && stage) ivl = STAGE_IVL[stage];
  if (!ivl && due && due > now) ivl = estimateInterval({ due, added: null, now });
  if (ivl) return { ...row, kind: 'learned', ivl, due: due ?? now + ivl * DAY };
  return { ...row, kind: defaultKind };
}

/**
 * Parse CSV/TSV (with or without a header row), a pasted list (one item per line,
 * "word<TAB>reading<TAB>meaning"), or JSON (array of objects using the same field names).
 * defaultKind applies to rows without schedule info ('new' | 'known' | 'burned').
 */
export function parseGeneric(text, now = Date.now(), defaultKind = 'new') {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let data = JSON.parse(trimmed);
    if (!Array.isArray(data)) data = data.items || data.cards || data.data || [];
    return dedupe(data.map((obj) => {
      const rec = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = k.toLowerCase();
        for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
          if ((aliases.includes(key) || key === field) && rec[field] == null) rec[field] = v;
        }
      }
      return rowFromRecord(rec, now, defaultKind);
    }).filter(Boolean));
  }
  const table = splitDelimited(trimmed);
  const header = mapHeader(table[0]);
  const body = header ? table.slice(1) : table;
  const idx = header || { chars: 0, reading: 1, meaning: 2, ivl: 3 };
  return dedupe(body.map((cells) => {
    const rec = {};
    for (const [field, i] of Object.entries(idx)) rec[field] = cells[i];
    if (!header && rec.ivl && !/^\d+(\.\d+)?$/.test(rec.ivl)) delete rec.ivl;
    return rowFromRecord(rec, now, defaultKind);
  }).filter(Boolean));
}

export function summarize(rows) {
  const s = { total: rows.length, learned: 0, new: 0, paused: 0, known: 0, burned: 0 };
  for (const r of rows) s[r.kind]++;
  return s;
}
