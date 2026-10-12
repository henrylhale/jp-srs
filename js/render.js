// Shared rendering for subjects: card faces, info blocks and the kanji breakdown panel.
import { html, raw, esc, kanjiIn, fmtDuration } from './util.js';
import { state, byChars } from './store.js';
import { cardStatus } from './queue.js';
import { kanjiInfo, componentMeaning, radicalName, phoneticSeries } from './kanji.js';

export const TYPE_LABEL = { radical: 'Radical', kanji: 'Kanji', vocab: 'Vocabulary', kana_vocab: 'Vocabulary' };
const STATUS_LABEL = { new: 'New', learning: 'Learning', young: 'Young', mature: 'Mature', burned: 'Burned', suspended: 'Suspended', none: '—' };

export function typeClass(s) {
  return s.src === 'custom' ? 'custom' : s.type === 'kana_vocab' ? 'vocab' : s.type;
}

export function primaryMeaning(s) {
  return (s.meanings.find((m) => m.primary) || s.meanings[0])?.m || '';
}

export function charsHtml(s, cls = '') {
  if (s.chars) return html`<span class="chars ${cls}" lang="ja">${s.chars}</span>`;
  if (s.img) return html`<img class="chars-img ${cls}" src="${s.img}" alt="${primaryMeaning(s)}">`;
  return html`<span class="chars ${cls}">?</span>`;
}

export function statusPill(card) {
  const st = cardStatus(card);
  return html`<span class="pill st-${st}">${STATUS_LABEL[st]}</span>`;
}

// WaniKani mnemonic markup -> highlighted spans (input is escaped first).
export function mnemonic(text) {
  if (!text) return raw('');
  let out = esc(text)
    .replace(/&lt;(radical|kanji|vocabulary|reading|meaning|ja)&gt;/g, '<span class="mk mk-$1">')
    .replace(/&lt;\/(radical|kanji|vocabulary|reading|meaning|ja)&gt;/g, '</span>')
    .replace(/\n/g, '<br>');
  return raw(out);
}

export function front(s) {
  return html`
    <div class="card-front type-${typeClass(s)}">
      <div class="type-label">${TYPE_LABEL[s.type]}${s.src === 'custom' ? html` · ${(s.tags || []).join(', ') || 'custom'}` : ''}${s.level ? html` · L${s.level}` : ''}</div>
      ${charsHtml(s, 'big')}
    </div>`;
}

function readingsBlock(s) {
  if (!s.readings.length) return '';
  if (s.type === 'kanji' && s.src === 'wk') {
    const group = (kind, label) => {
      const rs = s.readings.filter((r) => r.kind === kind);
      if (!rs.length) return '';
      return html`<div class="rgroup"><span class="rlabel">${label}</span> ${rs.map((r, i) => html`${i ? '、' : ''}<span class="${r.primary ? 'primary' : 'alt'}" lang="ja">${r.r}</span>`)}</div>`;
    };
    return html`<div class="readings">${group('onyomi', "On'yomi")}${group('kunyomi', "Kun'yomi")}${group('nanori', 'Nanori')}</div>`;
  }
  return html`<div class="readings">${s.readings.map((r, i) => html`${i ? '、' : ''}<span class="${r.primary ? 'primary' : 'alt'}" lang="ja">${r.r}</span>`)}</div>`;
}

function audioButton(s) {
  if (!s.audio?.length) return '';
  return html`<button class="icon-btn audio" data-audio="${s.audio[0].url}" aria-label="Play pronunciation">▶︎ audio</button>`;
}

export function meaningsBlock(s) {
  const [p, ...rest] = s.meanings;
  return html`
    <div class="meanings">
      <span class="primary">${p?.m || ''}</span>
      ${rest.length ? html`<span class="alt">${rest.map((m) => m.m).join(', ')}</span>` : ''}
    </div>`;
}

export function answer(s, { openMnemonics = false, link = true } = {}) {
  return html`
    <div class="answer">
      ${meaningsBlock(s)}
      ${readingsBlock(s)}
      ${s.pos?.length ? html`<div class="muted small">${s.pos.join(', ')}</div>` : ''}
      ${audioButton(s)}
      ${mnemonicsBlock(s, openMnemonics)}
      ${contextBlock(s)}
      ${breakdown(s)}
      ${link ? html`<a class="small" href="#/item/${encodeURIComponent(s.id)}">Item details →</a>` : ''}
    </div>`;
}

function mnemonicsBlock(s, open) {
  const parts = [];
  if (s.mm) parts.push(html`<h4>Meaning mnemonic</h4><p>${mnemonic(s.mm)}</p>${s.mh ? html`<p class="hint">${mnemonic(s.mh)}</p>` : ''}`);
  if (s.rm) parts.push(html`<h4>Reading mnemonic</h4><p>${mnemonic(s.rm)}</p>${s.rh ? html`<p class="hint">${mnemonic(s.rh)}</p>` : ''}`);
  if (!parts.length) return '';
  return html`<details class="mnemonics" ${open ? raw('open') : ''}><summary>Mnemonics</summary>${parts}</details>`;
}

function contextBlock(s) {
  if (!s.ctx?.length) return '';
  return html`<details class="context"><summary>Context sentences</summary>${s.ctx.slice(0, 3).map((c) => html`<p lang="ja" class="ja">${c.ja}</p><p class="muted small">${c.en}</p>`)}</details>`;
}

function wkKanjiFor(ch) {
  return byChars(ch, ['kanji']).find((x) => x.src === 'wk') || null;
}

function phoneticRow(comp, self) {
  const src = comp.o || comp.e;
  const info = kanjiInfo(src) || kanjiInfo(comp.e);
  const series = phoneticSeries(comp.e).concat(comp.o ? phoneticSeries(comp.o) : []).filter((c, i, a) => c !== self && a.indexOf(c) === i).slice(0, 10);
  return html`
    <div class="phon">
      <span class="badge phon-badge">phonetic${comp.inf ? ' (inferred)' : ''}</span>
      <span lang="ja" class="kchip">${comp.e}</span>
      ${info?.on?.length ? html`<span class="muted" lang="ja">${info.on.slice(0, 3).join('・')}</span>` : ''}
      ${series.length ? html`<div class="series">${series.map((c) => {
        const k = kanjiInfo(c);
        const wk = wkKanjiFor(c);
        const st = wk ? cardStatus(state.cards.get(wk.id)) : 'none';
        return html`<span class="series-item st-${st}" title="${k?.m?.[0] || ''}"><span lang="ja">${c}</span><small lang="ja">${k?.on?.[0] || ''}</small></span>`;
      })}</div>` : ''}
    </div>`;
}

function kanjiBreakdown(ch) {
  const info = kanjiInfo(ch);
  const wk = wkKanjiFor(ch);
  const meaning = wk ? primaryMeaning(wk) : info?.m?.[0] || '';
  const rad = info?.r ? radicalName(info.r) : null;
  const comps = info?.c || [];
  const wkRads = wk ? wk.comps.map((id) => state.subjects.get(id)).filter(Boolean) : [];
  return html`
    <div class="kb">
      <div class="kb-head">
        <a class="kb-char" lang="ja" href="${wk ? `#/item/${encodeURIComponent(wk.id)}` : `#/kanji/${encodeURIComponent(ch)}`}">${ch}</a>
        <div>
          <div><strong>${meaning}</strong> ${wk ? statusPill(state.cards.get(wk.id)) : ''}</div>
          ${info ? html`<div class="muted small" lang="ja">${(info.on || []).slice(0, 3).join('・')}${info.kun?.length ? html` / ${info.kun.slice(0, 3).join('・')}` : ''}</div>` : ''}
        </div>
      </div>
      ${wkRads.length ? html`<div class="kb-row"><span class="rlabel">WK radicals</span>${wkRads.map((r) => html`<a class="rchip" href="#/item/${encodeURIComponent(r.id)}">${charsHtml(r, 'tiny')}<span>${primaryMeaning(r)}</span></a>`)}</div>` : ''}
      ${rad ? html`<div class="kb-row"><span class="rlabel">Radical</span><span class="kchip" lang="ja">${rad[0]}</span><span class="muted">#${info.r} ${rad[1]}</span></div>` : ''}
      ${comps.length ? html`<div class="kb-row"><span class="rlabel">Parts</span>${comps.map((c) => html`<span class="comp ${c.rad ? 'is-rad' : ''} ${c.ph ? 'is-phon' : ''}"><span lang="ja">${c.e}</span><small>${componentMeaning(c.o || c.e) || ''}</small>${c.rad ? html`<em>radical</em>` : ''}${c.ph ? html`<em>phonetic</em>` : ''}</span>`)}</div>` : html`<div class="kb-row muted small">No smaller components.</div>`}
      ${comps.filter((c) => c.ph).map((c) => phoneticRow(c, ch))}
    </div>`;
}

export function breakdown(s) {
  if (s.type === 'radical') return '';
  const chars = s.type === 'kanji' ? [s.chars] : kanjiIn(s.chars);
  if (!chars.length) return '';
  return html`<section class="breakdown"><h4>Kanji breakdown</h4>${chars.map(kanjiBreakdown)}</section>`;
}

export function intervalLabel(due, now) {
  return fmtDuration(Math.max(0, due - now));
}

export function playAudio(url) {
  const a = new Audio(url);
  a.play().catch(() => {});
}
