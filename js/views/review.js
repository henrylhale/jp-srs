import { html, mount, $, toast, fmtDuration } from '../util.js';
import { state, fsrsConfig } from '../store.js';
import { grade, preview, State } from '../fsrs.js';
import * as db from '../db.js';
import { dueCards, orderReviews, reviewsLeftToday, lessonDone } from '../queue.js';
import { todayStats } from '../stats.js';
import { front, answer, playAudio, typeClass } from '../render.js';

let pendingQuiz = null;
export function startLessonQuiz(ids) {
  pendingQuiz = ids;
  location.hash = '#/review?quiz=1';
}

const GRADES = [
  { g: 1, label: 'Again', key: '1' },
  { g: 2, label: 'Hard', key: '2' },
  { g: 3, label: 'Good', key: '3' },
  { g: 4, label: 'Easy', key: '4' },
];

export async function render(el, params) {
  const now = Date.now();
  const isQuiz = params.quiz && pendingQuiz;
  let queue;
  if (isQuiz) {
    queue = pendingQuiz.slice();
    pendingQuiz = null;
  } else {
    const stats = await todayStats(now);
    const left = reviewsLeftToday(stats);
    const due = dueCards(now);
    const learning = due.filter((c) => c.state === State.Learning || c.state === State.Relearning || lessonDone(c));
    const reviews = orderReviews(due.filter((c) => c.state === State.Review), now);
    const at = (c) => c.due || c.introduced;
    queue = [...learning.sort((a, b) => at(a) - at(b)), ...reviews.slice(0, left === Infinity ? undefined : left)].map((c) => c.id);
  }

  const s = {
    queue,          // card ids still to show (first pass)
    learning: [],   // ids re-queued by learning steps, shown once due
    current: null,
    revealed: false,
    done: 0,
    again: 0,
    history: [],
    wrapUp: false,
    total: queue.length,
    timer: null,
  };

  function pickNext() {
    const t = Date.now();
    const aheadMs = state.settings.learnAheadMin * 60000;
    s.learning.sort((a, b) => state.cards.get(a).due - state.cards.get(b).due);
    const ready = s.learning.find((id) => state.cards.get(id).due <= t);
    if (ready) { s.learning.splice(s.learning.indexOf(ready), 1); return ready; }
    if (s.queue.length && !s.wrapUp) return s.queue.shift();
    // Nothing else to do: pull learning cards forward within the learn-ahead window.
    const soon = s.learning.find((id) => state.cards.get(id).due <= t + aheadMs);
    if (soon) { s.learning.splice(s.learning.indexOf(soon), 1); return soon; }
    return null;
  }

  function show() {
    clearTimeout(s.timer);
    s.current = pickNext();
    s.revealed = false;
    if (!s.current) return finish();
    draw();
  }

  function remaining() {
    return (s.wrapUp ? 0 : s.queue.length) + s.learning.length + (s.current ? 1 : 0);
  }

  function draw() {
    const subj = state.subjects.get(s.current);
    const card = state.cards.get(s.current);
    const t = Date.now();
    const pv = s.revealed && state.settings.showIntervals ? preview(card, t, fsrsConfig()) : null;
    mount(el, html`
      <div class="session type-${typeClass(subj)}">
        <div class="session-bar">
          <a href="#/" class="icon-btn" aria-label="Exit">✕</a>
          <span class="muted small">${s.done} done · ${remaining()} left${isQuiz ? ' · lesson quiz' : ''}</span>
          <span class="spacer"></span>
          <button class="icon-btn" id="undo" ${s.history.length ? '' : 'disabled'} title="Undo (Z)">↶</button>
          ${isQuiz ? '' : html`<button class="icon-btn ${s.wrapUp ? 'on' : ''}" id="wrap" title="Wrap up: finish learning cards, skip the rest">wrap up</button>`}
        </div>
        <div class="progress"><span style="width:${s.total ? Math.round((s.done / (s.done + remaining())) * 100) : 0}%"></span></div>
        <div class="card-area" id="cardarea">
          ${front(subj)}
          ${card.state === State.New ? html`<div class="muted tiny center">first review</div>` : ''}
          ${s.revealed ? answer(subj) : ''}
        </div>
        <div class="grade-bar">
          ${s.revealed
            ? GRADES.map((x) => html`<button class="grade g${x.g}" data-g="${x.g}"><span>${x.label}</span>${pv ? html`<small>${fmtDuration(pv[x.g] - t)}</small>` : ''}</button>`)
            : html`<button class="reveal" id="reveal">Show answer <small>space</small></button>`}
        </div>
      </div>`);
    if (s.revealed && state.settings.autoplayAudio && subj.audio?.length) playAudio(subj.audio[0].url);
    if (!s.revealed) $('#cardarea', el).scrollTop = 0;
  }

  async function doGrade(g) {
    const id = s.current;
    const before = state.cards.get(id);
    const t = Date.now();
    const { card, log } = grade(before, g, t, fsrsConfig());
    let next = card;
    if (g === 1 && before.state === State.Review) {
      if (next.lapses >= state.settings.leechLapses && !next.leech) {
        next = { ...next, leech: true, suspended: state.settings.leechAction === 'suspend' };
        toast(state.settings.leechAction === 'suspend' ? 'Leech suspended' : 'Leech tagged');
      }
    }
    const key = await db.commitReview(next, log);
    state.cards.set(id, next);
    s.history.push({ id, before, key });
    s.done++;
    if (g === 1) s.again++;
    const learning = next.state === State.Learning || next.state === State.Relearning;
    if (learning && !next.suspended) s.learning.push(id);
    s.current = null;
    show();
  }

  async function undo() {
    const h = s.history.pop();
    if (!h) return;
    await db.undoReview(h.before, h.key);
    state.cards.set(h.id, h.before);
    s.learning = s.learning.filter((x) => x !== h.id);
    s.queue = s.queue.filter((x) => x !== h.id);
    if (s.current) s.queue.unshift(s.current);
    s.done--;
    s.current = h.id;
    s.revealed = true;
    draw();
  }

  function finish() {
    const t = Date.now();
    const nextLearning = s.learning.map((id) => state.cards.get(id).due).sort((a, b) => a - b)[0];
    mount(el, html`
      <div class="panel done">
        <h2>${s.done ? 'Session complete' : 'Nothing due'}</h2>
        ${s.done ? html`<p>${s.done} reviews · ${s.done ? Math.round(((s.done - s.again) / s.done) * 100) : 0}% not-again</p>` : ''}
        ${nextLearning ? html`<p class="muted">${s.learning.length} learning card(s) due in ${fmtDuration(nextLearning - t)}.</p>
          <button class="btn" id="ahead">Study them now</button>` : ''}
        <p><a class="btn primary" href="#/">Home</a> ${s.history.length ? html`<button class="btn" id="undo">Undo last</button>` : ''}</p>
      </div>`);
    if (nextLearning) {
      s.timer = setTimeout(() => { if (!s.current) show(); }, Math.max(1000, nextLearning - t + 500));
    }
  }

  el.onclick = (e) => {
    const t = e.target.closest('button, a, summary, details');
    if (e.target.closest('#reveal') || (!t && !s.revealed && s.current && e.target.closest('#cardarea'))) { s.revealed = true; draw(); return; }
    const g = e.target.closest('[data-g]');
    if (g) { doGrade(+g.dataset.g); return; }
    if (e.target.closest('#undo')) { undo(); return; }
    if (e.target.closest('#wrap')) { s.wrapUp = !s.wrapUp; toast(s.wrapUp ? 'Wrapping up: finishing learning cards only' : 'Wrap up cancelled'); draw(); return; }
    if (e.target.closest('#ahead')) {
      const id = s.learning.sort((a, b) => state.cards.get(a).due - state.cards.get(b).due).shift();
      if (id) { s.current = id; s.revealed = false; draw(); }
    }
  };

  const onKey = (e) => {
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!s.current) return;
    if (!s.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); s.revealed = true; draw(); return; }
    if (s.revealed && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); doGrade(+e.key); return; }
    if (s.revealed && e.key === ' ') { e.preventDefault(); doGrade(3); return; }
    if (e.key === 'z' || e.key === 'u') { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', onKey);

  show();
  return () => { document.removeEventListener('keydown', onKey); clearTimeout(s.timer); el.onclick = null; };
}
