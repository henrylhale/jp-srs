// Pronunciation for every card type:
//   vocab   -> WaniKani recording, falling back to Japanese TTS of the reading
//   kanji   -> Japanese TTS of the on'yomi (WK has no kanji recordings)
//   radical -> English TTS of the radical's name
// TTS uses the device's speech engine, which works offline once its voice data is installed.

const primaryMeaning = (s) => (s.meanings.find((m) => m.primary) || s.meanings[0])?.m || '';

/** What to play for a subject: { url?, text, lang } or null. Pure, so it can be unit tested. */
export function audioPlan(s, { online = true } = {}) {
  if (!s) return null;
  if (s.type === 'radical') {
    const name = primaryMeaning(s);
    return name ? { text: name, lang: 'en-US' } : null;
  }
  if (s.type === 'kanji') {
    const on = s.readings.filter((r) => r.kind === 'onyomi').map((r) => r.r);
    const said = on.length ? on : s.readings.filter((r) => r.primary).map((r) => r.r);
    return said.length ? { text: said.join('、'), lang: 'ja-JP' } : null;
  }
  const reading = (s.readings.find((r) => r.primary) || s.readings[0])?.r || s.chars;
  if (!reading) return null;
  const url = online && s.audio?.length ? s.audio[0].url : null;
  return { url, text: reading, lang: 'ja-JP' };
}

let current = null;
let voices = [];
function loadVoices() {
  try { voices = speechSynthesis.getVoices(); } catch { voices = []; }
}
if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function stopAudio() {
  if (current) { current.pause(); current = null; }
  try { speechSynthesis.cancel(); } catch { /* no TTS */ }
}

function speak(text, lang) {
  if (typeof speechSynthesis === 'undefined' || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = lang.startsWith('ja') ? 0.9 : 1;
  const prefix = lang.slice(0, 2);
  const voice = voices.find((v) => v.lang?.replace('_', '-') === lang) || voices.find((v) => v.lang?.startsWith(prefix));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

export function playPlan(plan) {
  if (!plan) return;
  stopAudio();
  if (plan.url) {
    const a = new Audio(plan.url);
    current = a;
    a.play().catch(() => { if (current === a) { current = null; speak(plan.text, plan.lang); } });
    a.onerror = () => { if (current === a) { current = null; speak(plan.text, plan.lang); } };
    return;
  }
  speak(plan.text, plan.lang);
}

export function playSubject(s) {
  playPlan(audioPlan(s, { online: navigator.onLine }));
}
