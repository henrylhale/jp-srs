import { load, state } from './store.js';
import { loadKanjiData } from './kanji.js';
import { $, toast } from './util.js';
import { playPlan } from './audio.js';
import * as dashboard from './views/dashboard.js';
import * as lessons from './views/lessons.js';
import * as review from './views/review.js';
import * as browse from './views/browse.js';
import * as item from './views/item.js';
import * as grid from './views/grid.js';
import * as forecast from './views/forecast.js';
import * as importer from './views/import.js';
import * as settings from './views/settings.js';

const routes = [
  [/^$/, dashboard, 'home'],
  [/^lessons$/, lessons, 'home'],
  [/^review$/, review, 'home'],
  [/^browse$/, browse, 'browse'],
  [/^item\/(.+)$/, item, 'browse'],
  [/^kanji\/(.+)$/, item, 'grid'],
  [/^grid$/, grid, 'grid'],
  [/^forecast$/, forecast, 'forecast'],
  [/^import$/, importer, 'settings'],
  [/^settings$/, settings, 'settings'],
];

let cleanup = null;

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  const main = $('#main');
  if (cleanup) { try { cleanup(); } catch { /* view already gone */ } cleanup = null; }
  for (const [re, view, tab] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.body.dataset.view = path.split('/')[0] || 'home';
    for (const a of document.querySelectorAll('nav.tabs a')) a.classList.toggle('active', a.dataset.tab === tab);
    params.match = m.slice(1).map(decodeURIComponent);
    params.kind = path.startsWith('kanji/') ? 'kanji' : 'item';
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    try {
      cleanup = (await view.render(main, params)) || null;
    } catch (err) {
      console.error(err);
      main.innerHTML = `<div class="panel error">Something went wrong: ${String(err.message || err)}</div>`;
    }
    return;
  }
  location.hash = '#/';
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function updateOnline() {
  document.body.classList.toggle('offline', !navigator.onLine);
}

async function init() {
  updateOnline();
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tts]');
    if (btn) {
      e.preventDefault();
      const d = btn.dataset;
      playPlan({ url: navigator.onLine ? d.audioUrl || null : null, text: d.tts, lang: d.lang });
    }
  });
  await Promise.all([load(), loadKanjiData().catch(() => toast('Kanji data failed to load'))]);
  applyTheme();
  window.addEventListener('hashchange', route);
  window.addEventListener('jp-srs:settings', applyTheme);
  await route();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            const bar = document.createElement('button');
            bar.className = 'update-bar';
            bar.textContent = 'Update available. Tap to reload.';
            bar.onclick = () => location.reload();
            document.body.appendChild(bar);
          }
        });
      });
    }).catch((err) => console.warn('SW registration failed', err));
  }
}

init();
