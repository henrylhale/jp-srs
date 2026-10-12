// Open kanji data (KANJIDIC2 + KanjiVG, see data/ATTRIBUTION.md): readings, school grade,
// visual components with radical / phonetic flags, and phonetic-series lookup.
let data = null;
let loading = null;
let phoneticIndex = null;

export function loadKanjiData() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch('data/kanji.json').then((r) => r.json()).then((d) => { data = d; return d; });
  }
  return loading;
}

export const kanjiInfo = (ch) => data?.k[ch] || null;

export function componentMeaning(ch) {
  if (!data) return null;
  const k = data.k[ch];
  if (k) return k.m?.[0] || null;
  return data.x[ch]?.[0] || null;
}

export function radicalName(num) {
  return data?.rad[num] || null;
}

// phonetic component -> kanji that use it as their phonetic, most frequent first.
export function phoneticSeries(comp) {
  if (!data) return [];
  if (!phoneticIndex) {
    phoneticIndex = new Map();
    for (const [ch, k] of Object.entries(data.k)) {
      for (const c of k.c || []) {
        if (!c.ph) continue;
        for (const key of new Set([c.e, c.o].filter(Boolean))) {
          if (!phoneticIndex.has(key)) phoneticIndex.set(key, []);
          phoneticIndex.get(key).push(ch);
        }
      }
    }
    for (const list of phoneticIndex.values()) {
      list.sort((a, b) => (data.k[a].f || 9999) - (data.k[b].f || 9999));
    }
  }
  return phoneticIndex.get(comp) || [];
}

export function allKanji() {
  return data ? Object.entries(data.k) : [];
}
