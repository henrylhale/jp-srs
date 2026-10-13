import { html, mount, toast, fmtDate, fmtDuration, DAY } from '../util.js';
import { state, saveCard, saveSubjects, deleteSubjects, byChars } from '../store.js';
import { State, newCard, retrievability } from '../fsrs.js';
import { lessonDone } from '../queue.js';
import * as db from '../db.js';
import { knownCard } from '../importApply.js';
import { front, answer, statusPill, charsHtml, primaryMeaning, typeClass, breakdown, audioButton } from '../render.js';
import { kanjiInfo } from '../kanji.js';

const STATE_NAME = ['New', 'Learning', 'Review', 'Relearning'];
const GRADE_NAME = ['', 'Again', 'Hard', 'Good', 'Easy'];

export async function render(el, params) {
  if (params.kind === 'kanji') return renderKanji(el, params.match[0]);
  const id = params.match[0];
  const subj = state.subjects.get(id);
  if (!subj) { mount(el, html`<div class="panel">Item not found. <a href="#/browse">Browse</a></div>`); return; }
  const card = state.cards.get(id);
  const logs = (await db.logsForCard(id)).sort((a, b) => b.ts - a.ts);
  const now = Date.now();
  const r = card && card.state !== State.New && card.last ? retrievability((now - card.last) / DAY, card.s) : null;
  const related = (ids) => ids.map((x) => state.subjects.get(x)).filter(Boolean);
  const amal = related(subj.amal || []);
  const similar = related(subj.similar || []);
  const importedVocab = subj.type === 'kanji' ? [...state.subjects.values()].filter((v) => v.src === 'custom' && v.id !== id && v.chars?.includes(subj.chars)) : [];

  mount(el, html`
    <header class="page-head"><a href="javascript:history.back()" class="icon-btn">←</a><h1>${subj.chars || primaryMeaning(subj)}</h1>${statusPill(card)}</header>
    <div class="item-page type-${typeClass(subj)}">
      ${front(subj)}
      ${answer(subj, { openMnemonics: true, link: false })}
      ${amal.length ? html`<section class="panel"><h4>${subj.type === 'radical' ? 'Used in kanji' : 'Used in vocabulary'}</h4><div class="chip-list">${amal.map((a) => html`<a class="chip type-${typeClass(a)}" href="#/item/${encodeURIComponent(a.id)}">${charsHtml(a, 'tiny')} ${primaryMeaning(a)}</a>`)}</div></section>` : ''}
      ${similar.length ? html`<section class="panel"><h4>Visually similar</h4><div class="chip-list">${similar.map((a) => html`<a class="chip type-${typeClass(a)}" href="#/item/${encodeURIComponent(a.id)}">${charsHtml(a, 'tiny')} ${primaryMeaning(a)}</a>`)}</div></section>` : ''}
      ${importedVocab.length ? html`<section class="panel"><h4>Imported vocabulary</h4><div class="chip-list">${importedVocab.map((a) => html`<a class="chip type-${typeClass(a)}" href="#/item/${encodeURIComponent(a.id)}">${charsHtml(a, 'tiny')} ${primaryMeaning(a)} ${statusPill(state.cards.get(a.id))}</a>`)}</div></section>` : ''}
      <section class="panel">
        <h4>Schedule</h4>
        ${card ? html`<dl class="kv">
          <dt>State</dt><dd>${card.burned ? 'Burned' : lessonDone(card) ? 'Lesson done, awaiting first review' : STATE_NAME[card.state]}${card.suspended ? ' (suspended)' : ''}${card.leech ? ' · leech' : ''}</dd>
          ${card.state !== State.New ? html`
            <dt>Due</dt><dd>${card.burned ? '—' : card.due <= now ? 'now' : `${fmtDate(card.due)} (in ${fmtDuration(card.due - now)})`}</dd>
            <dt>Stability</dt><dd>${card.s.toFixed(1)} days</dd>
            <dt>Difficulty</dt><dd>${card.d.toFixed(1)} / 10</dd>
            <dt>Recall now</dt><dd>${r == null ? '—' : `${Math.round(r * 100)}%`}</dd>
            <dt>Interval</dt><dd>${card.ivl} d</dd>
            <dt>Reviews</dt><dd>${card.reps} · ${card.lapses} lapses</dd>
            <dt>Started</dt><dd>${card.introduced ? fmtDate(card.introduced) : '—'}</dd>` : ''}
        </dl>` : ''}
        <div class="row gap wrap">
          ${card?.state === State.New || card?.burned ? '' : html`<button class="btn" data-act="due">Review now</button>`}
          <button class="btn" data-act="known">Mark known (late stage)</button>
          ${card?.burned ? html`<button class="btn" data-act="unburn">Unburn</button>` : html`<button class="btn" data-act="burn">Burn</button>`}
          <button class="btn" data-act="suspend">${card?.suspended ? 'Unsuspend' : 'Suspend'}</button>
          <button class="btn danger" data-act="reset">Reset to new</button>
          ${subj.src === 'custom' ? html`<button class="btn" data-act="edit">Edit</button><button class="btn danger" data-act="delete">Delete</button>` : ''}
          ${subj.src === 'wk' ? html`<a class="btn" href="https://www.wanikani.com/${subj.type === 'kana_vocab' ? 'vocabulary' : subj.type === 'vocab' ? 'vocabulary' : subj.type}/${encodeURIComponent(subj.slug)}" target="_blank" rel="noopener">WaniKani ↗</a>` : ''}
        </div>
      </section>
      <section class="panel" id="editor" hidden>
        <h4>Edit</h4>
        <label>Characters <input id="e-chars" value="${subj.chars || ''}"></label>
        <label>Reading(s), comma-separated <input id="e-read" value="${subj.readings.map((x) => x.r).join(', ')}"></label>
        <label>Meaning(s), semicolon-separated <input id="e-mean" value="${subj.meanings.map((x) => x.m).join('; ')}"></label>
        <label>Notes / mnemonic <textarea id="e-mm">${subj.mm || ''}</textarea></label>
        <button class="btn primary" data-act="save">Save</button>
      </section>
      ${logs.length ? html`<section class="panel"><h4>History</h4><table class="log"><tr><th>When</th><th>Grade</th><th>State</th><th>Stability</th></tr>
        ${logs.slice(0, 50).map((l) => l.kind
          ? html`<tr><td>${new Date(l.ts).toLocaleString()}</td><td colspan="3">${l.kind === 'known' ? 'Marked known in lessons' : 'Lesson'}</td></tr>`
          : html`<tr><td>${new Date(l.ts).toLocaleString()}</td><td class="g${l.grade}">${GRADE_NAME[l.grade]}</td><td>${STATE_NAME[l.prevState]}→${STATE_NAME[l.state]}</td><td>${l.s.toFixed(1)}d</td></tr>`)}
      </table></section>` : ''}
    </div>`);

  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const c = state.cards.get(id) || newCard(id);
    const s = state.settings;
    const t = Date.now();
    if (act === 'due') await saveCard({ ...c, due: t });
    if (act === 'known') await saveCard(knownCard(c, t, 'late', s.knownStability, s.resetHour));
    if (act === 'burn') await saveCard(knownCard(c, t, 'burn', s.knownStability, s.resetHour));
    if (act === 'unburn') await saveCard(knownCard({ ...c, burned: false }, t, 'late', s.knownStability, s.resetHour));
    if (act === 'suspend') await saveCard({ ...c, suspended: !c.suspended });
    if (act === 'reset') { if (!confirm('Reset this item to new? Its review history stays in the log.')) return; await saveCard({ ...newCard(id) }); }
    if (act === 'edit') { el.querySelector('#editor').hidden = false; el.querySelector('#editor').scrollIntoView({ behavior: 'smooth' }); return; }
    if (act === 'save') {
      const v = (sel) => el.querySelector(sel).value.trim();
      await saveSubjects([{
        ...subj,
        chars: v('#e-chars') || subj.chars,
        readings: v('#e-read').split(/[,、]/).map((x) => x.trim()).filter(Boolean).map((r, i) => ({ r, primary: i === 0 })),
        meanings: v('#e-mean').split(/[;；]/).map((x) => x.trim()).filter(Boolean).map((m, i) => ({ m, primary: i === 0 })),
        mm: v('#e-mm'),
      }]);
    }
    if (act === 'delete') {
      if (!confirm('Delete this imported item and its schedule?')) return;
      await deleteSubjects([id]);
      toast('Deleted');
      location.hash = '#/browse';
      return;
    }
    toast('Saved');
    render(el, params);
  };
  return () => { el.onclick = null; };
}

// Kanji without a WK subject (beyond granted levels, or not in WK at all).
function renderKanji(el, ch) {
  const wk = byChars(ch, ['kanji']).find((s) => s.src === 'wk');
  if (wk) { location.replace(`#/item/${encodeURIComponent(wk.id)}`); return; }
  const info = kanjiInfo(ch);
  const pseudo = {
    id: `k:${ch}`, type: 'kanji', src: 'open', chars: ch, aux: [],
    meanings: (info?.m || []).map((m, i) => ({ m, primary: i === 0 })),
    readings: (info?.on || []).map((r, i) => ({ r, primary: i === 0, kind: 'onyomi' })),
  };
  const vocab = [...state.subjects.values()].filter((s) => s.type !== 'kanji' && s.chars?.includes(ch));
  mount(el, html`
    <header class="page-head"><a href="javascript:history.back()" class="icon-btn">←</a><h1 lang="ja">${ch}</h1></header>
    <div class="item-page type-kanji">
      <div class="card-front type-kanji"><div class="type-label">Kanji${info?.g ? html` · grade ${info.g === 8 ? 'S' : info.g}` : ''}</div><span class="chars big" lang="ja">${ch}</span></div>
      <div class="answer">
        <div class="meanings"><span class="primary">${info?.m?.[0] || ''}</span><span class="alt">${(info?.m || []).slice(1).join(', ')}</span></div>
        ${info ? html`<div class="readings"><div class="rgroup"><span class="rlabel">On'yomi</span> <span lang="ja">${(info.on || []).join('、')}</span></div><div class="rgroup"><span class="rlabel">Kun'yomi</span> <span lang="ja">${(info.kun || []).join('、')}</span></div></div>
          ${audioButton(pseudo)}
          <p class="muted small">${info.s} strokes${info.f ? ` · frequency #${info.f}` : ''}${info.j ? ` · old JLPT ${info.j}` : ''}</p>` : ''}
        ${breakdown(pseudo)}
        <p class="muted small">Not in your WaniKani content (levels 1–${state.meta.user?.subscription?.max_level_granted ?? '?'}), so there is no kanji card for it.</p>
      </div>
      ${vocab.length ? html`<section class="panel"><h4>Your vocabulary with ${ch}</h4><div class="chip-list">${vocab.map((a) => html`<a class="chip type-${typeClass(a)}" href="#/item/${encodeURIComponent(a.id)}">${charsHtml(a, 'tiny')} ${primaryMeaning(a)} ${statusPill(state.cards.get(a.id))}</a>`)}</div></section>` : ''}
    </div>`);
}
