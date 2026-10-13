// Lessons are read-once: each action is saved the moment it happens. "Learned" sends the
// card to reviews (its first grade sets up FSRS); "I know this" skips it as known. Either
// way it leaves the lesson queue for good. Only learned lessons count toward the daily limit.
import { html, mount, toast } from '../util.js';
import { state } from '../store.js';
import * as db from '../db.js';
import { availableLessons, newLeftToday, todayStart } from '../queue.js';
import { todayStats } from '../stats.js';
import { knownCard } from '../importApply.js';
import { front, answer, charsHtml, primaryMeaning, typeClass, statusPill } from '../render.js';
import { startLessonQuiz } from './review.js';

function knownLabel() {
  const s = state.settings;
  return s.knownMode === 'burn' ? 'burn it' : `review in ~${s.knownStability}d`;
}

function knownVersion(card, now) {
  const s = state.settings;
  return knownCard(card, now, s.knownMode, s.knownStability, s.resetHour);
}

// Persist one lesson action as card + log entry so it can be undone and counted.
async function commit(next, kind, now) {
  const key = await db.commitReview(next, { card: next.id, ts: now, kind });
  state.cards.set(next.id, next);
  return key;
}

export async function render(el, params) {
  if (params.manage) return manage(el);
  const stats = await todayStats();
  const s = {
    learned: [],          // ids learned this session (for the optional quiz)
    knownCount: 0,
    history: [],          // { before, key, kind }
    newToday: stats.newToday,
    extra: params.extra === '1',
    current: null,
  };
  const limit = () => (s.extra ? Infinity : newLeftToday({ newToday: s.newToday }));

  function draw() {
    const avail = availableLessons();
    if (!avail.length || limit() <= 0) return finish(avail.length);
    const subj = avail[0];
    s.current = subj.id;
    const per = state.settings.newPerDay;
    mount(el, html`
      <div class="lesson type-${typeClass(subj)}">
        <div class="session-bar">
          <a href="#/" class="icon-btn" aria-label="Exit">✕</a>
          <span class="muted small">${s.newToday}/${per} learned today${s.extra ? ' (extra)' : ''} · ${avail.length} unlocked</span>
          <span class="spacer"></span>
          <button class="icon-btn" id="undo" ${s.history.length ? '' : 'disabled'} title="Undo (Z)">↶</button>
          <a class="icon-btn" href="#/lessons?manage=1">queue</a>
        </div>
        <div class="card-area">
          ${front(subj)}
          ${answer(subj, { openMnemonics: true })}
        </div>
        <div class="grade-bar lesson-bar">
          <button class="btn known-btn" id="known">I know this<small>${knownLabel()}</small></button>
          <button class="btn primary" id="learn">Learned →<small>to reviews</small></button>
        </div>
      </div>`);
    el.querySelector('.card-area')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }

  function finish(remaining) {
    const total = s.learned.length;
    mount(el, html`
      <div class="panel done">
        <h2>${remaining ? 'Done for today' : 'No more lessons unlocked'}</h2>
        <p>${s.newToday}/${state.settings.newPerDay} lessons learned today${s.knownCount ? ` · ${s.knownCount} marked known this session` : ''}.</p>
        ${remaining ? '' : html`<p class="muted small">Pass more radicals/kanji to unlock new items, or sync/import content.</p>`}
        <p>
          ${total ? html`<button class="btn primary" id="quiz">Review the ${total} just learned</button> ` : ''}
          ${s.history.length ? html`<button class="btn" id="undo">Undo last</button> ` : ''}
          <a class="btn" href="#/">Home</a>
        </p>
        ${remaining && !s.extra ? html`<p><a class="btn" href="#/lessons?extra=1">Learn more anyway</a> <a class="btn" href="#/lessons?manage=1">Lesson queue</a></p>` : ''}
        <p class="muted small">Learned lessons are already waiting in Reviews, so the quiz is optional.</p>
      </div>`);
  }

  async function act(kind) {
    const id = s.current;
    if (!id) return;
    const before = state.cards.get(id);
    const now = Date.now();
    const next = kind === 'lesson' ? { ...before, introduced: now } : knownVersion(before, now);
    const key = await commit(next, kind, now);
    s.history.push({ before, key, kind });
    if (kind === 'lesson') { s.newToday++; s.learned.push(id); } else s.knownCount++;
    draw();
  }

  async function undo() {
    const h = s.history.pop();
    if (!h) return;
    await db.undoReview(h.before, h.key);
    state.cards.set(h.before.id, h.before);
    if (h.kind === 'lesson') { s.newToday--; s.learned = s.learned.filter((x) => x !== h.before.id); } else s.knownCount--;
    toast('Undone');
    draw();
  }

  el.onclick = (e) => {
    if (e.target.closest('#learn')) act('lesson');
    else if (e.target.closest('#known')) act('known');
    else if (e.target.closest('#undo')) undo();
    else if (e.target.closest('#quiz')) startLessonQuiz(s.learned.slice());
  };
  const onKey = (e) => {
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); act('lesson'); }
    else if (e.key === 'k') { e.preventDefault(); act('known'); }
    else if (e.key === 'z' || e.key === 'u') { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);
  draw();
  return () => { document.removeEventListener('keydown', onKey); el.onclick = null; };
}

// Upcoming lessons as a checklist for skipping known content in bulk, plus what's been
// taken today so it's clear what has already left the queue.
async function manage(el) {
  const avail = availableLessons();
  const shown = avail.slice(0, 300);
  const start = todayStart();
  const today = (await db.logsSince(start)).filter((l) => l.kind).sort((a, b) => b.ts - a.ts);
  const learnedToday = today.filter((l) => l.kind === 'lesson').length;
  const subjOf = (id) => state.subjects.get(id);
  mount(el, html`
    <header class="page-head"><a href="#/lessons" class="icon-btn">←</a><h1>Lesson queue</h1></header>
    <div class="panel">
      <p class="muted small">${avail.length} unlocked lessons, in order. Tick the ones you already know and mark them all at once (${knownLabel()}; change this in Settings). To mark whole levels known, use <a href="#/import">Import → Mark known by level</a>.</p>
      <div class="row gap wrap">
        <button class="btn" id="all">Select all shown</button>
        <button class="btn" id="none">Clear</button>
        <button class="btn primary" id="mark">Mark selected known</button>
      </div>
    </div>
    ${today.length ? html`
      <details class="panel" ${today.length <= 20 ? 'open' : ''}>
        <summary>Today: ${learnedToday}/${state.settings.newPerDay} learned · ${today.length - learnedToday} marked known</summary>
        <ul class="item-list">${today.map((l) => {
          const subj = subjOf(l.card);
          if (!subj) return '';
          return html`<li><a href="#/item/${encodeURIComponent(subj.id)}" class="type-${typeClass(subj)}">${charsHtml(subj, 'small')}<span class="grow">${primaryMeaning(subj)}</span><span class="muted tiny">${l.kind === 'known' ? 'known' : 'learned'}</span>${statusPill(state.cards.get(subj.id))}</a></li>`;
        })}</ul>
      </details>` : ''}
    <ul class="item-list selectable">
      ${shown.map((s) => html`<li><label class="type-${typeClass(s)}"><input type="checkbox" value="${s.id}"> ${charsHtml(s, 'small')}<span class="grow">${primaryMeaning(s)}</span><span class="muted tiny">${s.level ? `L${s.level}` : (s.tags || []).join(',')} ${s.type}</span></label></li>`)}
    </ul>`);
  el.onclick = async (e) => {
    const boxes = [...el.querySelectorAll('input[type=checkbox]')];
    if (e.target.closest('#all')) boxes.forEach((b) => { b.checked = true; });
    if (e.target.closest('#none')) boxes.forEach((b) => { b.checked = false; });
    if (e.target.closest('#mark')) {
      const ids = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!ids.length) return toast('Nothing selected');
      const now = Date.now();
      for (const id of ids) await commit(knownVersion(state.cards.get(id), now), 'known', now);
      toast(`Marked ${ids.length} known`);
      manage(el);
    }
  };
  return () => { el.onclick = null; };
}
