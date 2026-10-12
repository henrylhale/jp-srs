import { html, mount, $, kataToHira, fmtDuration } from '../util.js';
import { state } from '../store.js';
import { cardStatus, visible } from '../queue.js';
import { charsHtml, primaryMeaning, statusPill, typeClass } from '../render.js';

let last = { q: '', type: '', status: '', src: '', level: '' };

export function render(el) {
  const levels = [...new Set([...state.subjects.values()].map((s) => s.level).filter(Boolean))].sort((a, b) => a - b);
  mount(el, html`
    <header class="page-head"><h1>Browse</h1><span class="muted small">${state.subjects.size} items</span></header>
    <div class="filters">
      <input type="search" id="q" placeholder="Search kanji, kana or meaning" value="${last.q}" autocomplete="off">
      <select id="type">
        <option value="">All types</option><option value="radical">Radicals</option><option value="kanji">Kanji</option><option value="vocab">Vocab</option>
      </select>
      <select id="status">
        <option value="">Any status</option>
        ${['new', 'learning', 'young', 'mature', 'burned', 'suspended'].map((x) => html`<option value="${x}">${x}</option>`)}
        <option value="leech">leeches</option>
      </select>
      <select id="src"><option value="">All sources</option><option value="wk">WaniKani</option><option value="custom">Imported</option></select>
      <select id="level"><option value="">All levels</option>${levels.map((l) => html`<option value="${l}">Level ${l}</option>`)}</select>
    </div>
    <ul class="item-list" id="results"></ul>`);
  for (const k of ['type', 'status', 'src', 'level']) $(`#${k}`, el).value = last[k];

  const draw = () => {
    for (const k of Object.keys(last)) last[k] = $(`#${k}`, el).value;
    const q = kataToHira(last.q.trim().toLowerCase());
    const now = Date.now();
    const out = [];
    for (const s of state.subjects.values()) {
      if (s.src === 'wk' && !visible(s)) continue;
      if (last.type && (last.type === 'vocab' ? !['vocab', 'kana_vocab'].includes(s.type) : s.type !== last.type)) continue;
      if (last.src && s.src !== last.src) continue;
      if (last.level && String(s.level) !== last.level) continue;
      const c = state.cards.get(s.id);
      if (last.status === 'leech' ? !c?.leech : last.status && cardStatus(c) !== last.status) continue;
      if (q) {
        const hay = [s.chars || '', ...s.meanings.map((m) => m.m.toLowerCase()), ...s.aux.map((a) => a.toLowerCase()), ...s.readings.map((r) => kataToHira(r.r))];
        if (!hay.some((h) => h.includes(q))) continue;
      }
      out.push(s);
      if (out.length >= 300) break;
    }
    out.sort((a, b) => (a.level ?? 999) - (b.level ?? 999));
    mount($('#results', el), html`${out.map((s) => {
      const c = state.cards.get(s.id);
      return html`<li><a href="#/item/${encodeURIComponent(s.id)}" class="type-${typeClass(s)}">
        ${charsHtml(s, 'small')}
        <span class="grow"><span>${primaryMeaning(s)}</span><span class="muted small" lang="ja">${s.readings.find((r) => r.primary)?.r || ''}</span></span>
        <span class="right">${statusPill(c)}<span class="muted tiny">${c && c.state && !c.burned ? (c.due > now ? `due ${fmtDuration(c.due - now)}` : 'due now') : ''}</span></span>
      </a></li>`;
    })}${out.length === 0 ? html`<li class="muted center">No matches</li>` : ''}${out.length >= 300 ? html`<li class="muted center small">Showing first 300, so refine your search</li>` : ''}`);
  };
  el.oninput = draw;
  draw();
  return () => { el.oninput = null; };
}
