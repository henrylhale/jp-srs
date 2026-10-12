import { html, mount, toast } from '../util.js';
import { state, saveCards } from '../store.js';
import { availableLessons, newLeftToday } from '../queue.js';
import { todayStats } from '../stats.js';
import { knownCard } from '../importApply.js';
import { front, answer, charsHtml, primaryMeaning, typeClass } from '../render.js';
import { startLessonQuiz } from './review.js';

function knownLabel() {
  const s = state.settings;
  return s.knownMode === 'burn' ? 'burn it' : `review in ~${s.knownStability}d`;
}

async function markKnown(ids) {
  const s = state.settings;
  const now = Date.now();
  await saveCards(ids.map((id) => knownCard(state.cards.get(id), now, s.knownMode, s.knownStability, s.resetHour)));
}

export async function render(el, params) {
  if (params.manage) return manage(el);
  const stats = await todayStats();
  const left = newLeftToday(stats);
  const avail = availableLessons();
  const extra = params.extra === '1';
  const size = Math.min(state.settings.lessonBatch, extra ? avail.length : left);
  const batch = avail.slice(0, size).map((s) => s.id);
  if (!batch.length) {
    mount(el, html`
      <div class="panel done">
        <h2>No lessons ${avail.length ? 'left today' : 'available'}</h2>
        ${avail.length
          ? html`<p class="muted">You've hit your ${state.settings.newPerDay}/day limit. ${avail.length} more are unlocked.</p>
                 <p><a class="btn" href="#/lessons?extra=1">Do one more batch anyway</a></p>`
          : html`<p class="muted">Pass more radicals/kanji to unlock new items, or sync/import content.</p>`}
        <p><a class="btn" href="#/lessons?manage=1">Manage lesson queue</a> <a class="btn primary" href="#/">Home</a></p>
      </div>`);
    return;
  }

  const known = new Set();
  let i = 0;

  function draw() {
    if (i >= batch.length) return summary();
    const subj = state.subjects.get(batch[i]);
    mount(el, html`
      <div class="lesson type-${typeClass(subj)}">
        <div class="session-bar">
          <a href="#/" class="icon-btn" aria-label="Exit">✕</a>
          <span class="muted small">Lesson ${i + 1} of ${batch.length}</span>
          <span class="spacer"></span>
          <a class="icon-btn" href="#/lessons?manage=1">queue</a>
        </div>
        <div class="dots">${batch.map((id, j) => html`<span class="${j === i ? 'cur' : ''} ${known.has(id) ? 'known' : ''}"></span>`)}</div>
        <div class="card-area">
          ${front(subj)}
          ${answer(subj, { openMnemonics: true })}
        </div>
        <div class="grade-bar lesson-bar">
          <button class="btn" id="prev" ${i === 0 ? 'disabled' : ''}>← Back</button>
          <button class="btn known-btn ${known.has(subj.id) ? 'on' : ''}" id="known">${known.has(subj.id) ? '✓ Known' : 'I know this'}<small>${knownLabel()}</small></button>
          <button class="btn primary" id="next">${i === batch.length - 1 ? 'Finish' : 'Next →'}</button>
        </div>
      </div>`);
  }

  function summary() {
    const toLearn = batch.filter((id) => !known.has(id));
    mount(el, html`
      <div class="panel">
        <h2>Batch ready</h2>
        <div class="chip-list">${batch.map((id) => {
          const s = state.subjects.get(id);
          return html`<span class="chip type-${typeClass(s)} ${known.has(id) ? 'struck' : ''}">${charsHtml(s, 'tiny')} ${primaryMeaning(s)}</span>`;
        })}</div>
        <p class="muted small">${known.size ? `${known.size} marked known (${knownLabel()}). ` : ''}${toLearn.length} to quiz.</p>
        <p>
          <button class="btn" id="again">← Review lessons</button>
          <button class="btn primary" id="quiz">${toLearn.length ? 'Start quiz' : 'Done'}</button>
        </p>
      </div>`);
  }

  el.onclick = async (e) => {
    if (e.target.closest('#next')) { i++; draw(); }
    else if (e.target.closest('#prev')) { i = Math.max(0, i - 1); draw(); }
    else if (e.target.closest('#known')) {
      const id = batch[i];
      known.has(id) ? known.delete(id) : known.add(id);
      if (known.has(id)) { i++; }
      draw();
    } else if (e.target.closest('#again')) { i = 0; draw(); }
    else if (e.target.closest('#quiz')) {
      if (known.size) await markKnown([...known]);
      const toLearn = batch.filter((id) => !known.has(id));
      if (toLearn.length) startLessonQuiz(toLearn);
      else { toast('Marked known'); location.hash = '#/'; }
    }
  };
  const onKey = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') { i = Math.min(batch.length, i + 1); draw(); }
    if (e.key === 'ArrowLeft') { i = Math.max(0, i - 1); draw(); }
  };
  document.addEventListener('keydown', onKey);
  draw();
  return () => { document.removeEventListener('keydown', onKey); el.onclick = null; };
}

// Upcoming lessons as a checklist, for skipping known content in bulk.
function manage(el) {
  const avail = availableLessons();
  const shown = avail.slice(0, 300);
  mount(el, html`
    <header class="page-head"><a href="#/lessons" class="icon-btn">←</a><h1>Lesson queue</h1></header>
    <div class="panel">
      <p class="muted small">${avail.length} unlocked lessons, in order. Tick the ones you already know and mark them all at once (${knownLabel()}; change this in Settings). To mark whole levels known, use <a href="#/import">Import → Mark known by level</a>.</p>
      <div class="row gap">
        <button class="btn" id="all">Select all shown</button>
        <button class="btn" id="none">Clear</button>
        <button class="btn primary" id="mark">Mark selected known</button>
      </div>
    </div>
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
      await markKnown(ids);
      toast(`Marked ${ids.length} known`);
      manage(el);
    }
  };
  return () => { el.onclick = null; };
}
