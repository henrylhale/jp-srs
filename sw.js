// Offline support: precache the app shell + kanji data; cache WK radical images on
// first use. WK API calls are never cached here; that data lives in IndexedDB.
const VERSION = 'v4';
const SHELL = `shell-${VERSION}`;
const MEDIA = 'wk-media';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'data/kanji.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/app.js',
  'js/db.js',
  'js/fsrs.js',
  'js/forecast.js',
  'js/importApply.js',
  'js/importers.js',
  'js/kanji.js',
  'js/queue.js',
  'js/render.js',
  'js/stats.js',
  'js/store.js',
  'js/util.js',
  'js/wk.js',
  'js/views/browse.js',
  'js/views/dashboard.js',
  'js/views/forecast.js',
  'js/views/grid.js',
  'js/views/import.js',
  'js/views/item.js',
  'js/views/lessons.js',
  'js/views/review.js',
  'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.wanikani.com') return;
  if (url.hostname === 'files.wanikani.com') {
    // Audio uses range requests and the host sends no CORS headers, so only images are cached.
    if (e.request.headers.has('range') || e.request.destination === 'audio') return;
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(e.request, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // App shell: network first (so deploys show up immediately), cache when offline or slow.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
    try {
      const res = await Promise.race([
        fetch(e.request, { cache: 'no-cache' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      if (res.ok) c.put(key, res.clone());
      return res;
    } catch {
      const hit = await c.match(key, { ignoreSearch: true });
      return hit || Response.error();
    }
  }));
});
