import { html, mount, $, kanjiIn } from '../util.js';
import { state, saveSettings } from '../store.js';
import { cardStatus, isMature } from '../queue.js';
import { allKanji } from '../kanji.js';

const GRADE_GROUPS = [
  [1, 'Grade 1'], [2, 'Grade 2'], [3, 'Grade 3'], [4, 'Grade 4'], [5, 'Grade 5'], [6, 'Grade 6'],
  [8, 'Secondary school (jōyō)'], [9, 'Jinmeiyō'], [10, 'Jinmeiyō (variants)'],
];
let groupBy = 'grade';
let showJinmeiyo = false;

// Status per kanji: its own card first, then (optionally) the best vocab card containing it.
function statusMap() {
  const own = new Map();
  const viaVocab = new Map();
  const rank = { none: 0, new: 0, suspended: 0, learning: 1, young: 2, mature: 3, burned: 3 };
  for (const s of state.subjects.values()) {
    const c = state.cards.get(s.id);
    if (!c || !s.chars) continue;
    const st = cardStatus(c);
    if (s.type === 'kanji') {
      if (!own.has(s.chars) || rank[st] > rank[own.get(s.chars)]) own.set(s.chars, st);
    } else if (state.settings.gridIncludeVocab && c.state !== 0 && !c.suspended) {
      const level = isMature(c) ? 'mature' : st === 'learning' ? 'learning' : 'young';
      for (const k of kanjiIn(s.chars)) if (rank[level] > rank[viaVocab.get(k) || 'none']) viaVocab.set(k, level);
    }
  }
  return { own, viaVocab, rank };
}

export function render(el) {
  const draw = () => {
    const { own, viaVocab, rank } = statusMap();
    const kanji = allKanji();
    let groups;
    if (groupBy === 'grade') {
      groups = GRADE_GROUPS.filter(([g]) => showJinmeiyo || g < 9).map(([g, label]) => [label, kanji.filter(([, k]) => k.g === g)]);
    } else if (groupBy === 'jlpt') {
      groups = [4, 3, 2, 1].map((j) => [`Old JLPT ${j}`, kanji.filter(([, k]) => k.j === j)]);
    } else {
      const wk = [...state.subjects.values()].filter((s) => s.src === 'wk' && s.type === 'kanji');
      const levels = [...new Set(wk.map((s) => s.level))].sort((a, b) => a - b);
      const info = new Map(kanji);
      groups = levels.map((l) => [`WK level ${l}`, wk.filter((s) => s.level === l).sort((a, b) => a.lessonPos - b.lessonPos).map((s) => [s.chars, info.get(s.chars) || {}])]);
    }
    for (const [, list] of groups) list.sort((a, b) => (a[1].f || 9999) - (b[1].f || 9999));
    let totMature = 0, totAll = 0;
    const body = groups.map(([label, list]) => {
      let mature = 0, started = 0;
      const cells = list.map(([ch]) => {
        const o = own.get(ch);
        const v = viaVocab.get(ch);
        let cls = 'unseen';
        if (o && rank[o] >= (rank[v] || 0) && o !== 'new' && o !== 'none' && o !== 'suspended') cls = o === 'burned' ? 'mature' : o;
        else if (v) cls = `v-${v}`;
        else if (o === 'new') cls = 'locked';
        if (cls === 'mature' || cls === 'v-mature') mature++;
        if (cls !== 'unseen' && cls !== 'locked') started++;
        return html`<a class="kcell ${cls}" href="#/kanji/${encodeURIComponent(ch)}" lang="ja">${ch}</a>`;
      });
      totMature += mature;
      totAll += list.length;
      return html`<section class="grid-group">
        <div class="row-between"><h3>${label}</h3><span class="muted small">${mature} mature · ${started} started · ${list.length}</span></div>
        <div class="kgrid">${cells}</div>
      </section>`;
    });
    mount(el, html`
      <header class="page-head"><h1>Kanji grid</h1><span class="muted small">${totMature}/${totAll} mature</span></header>
      <div class="filters">
        <select id="groupBy">
          <option value="grade">By school grade</option>
          <option value="wk">By WaniKani level</option>
          <option value="jlpt">By old JLPT level</option>
        </select>
        <label class="check"><input type="checkbox" id="vocab" ${state.settings.gridIncludeVocab ? 'checked' : ''}> count kanji seen in vocab</label>
        ${groupBy === 'grade' ? html`<label class="check"><input type="checkbox" id="jin" ${showJinmeiyo ? 'checked' : ''}> jinmeiyō</label>` : ''}
      </div>
      <div class="legend">
        <span class="kcell mature">字</span>mature
        <span class="kcell young">字</span>young
        <span class="kcell learning">字</span>learning
        ${state.settings.gridIncludeVocab ? html`<span class="kcell v-mature">字</span>mature via vocab <span class="kcell v-young">字</span>in young vocab` : ''}
        <span class="kcell unseen">字</span>not started
      </div>
      ${body}`);
    $('#groupBy', el).value = groupBy;
  };
  el.onchange = async (e) => {
    if (e.target.id === 'groupBy') groupBy = e.target.value;
    if (e.target.id === 'jin') showJinmeiyo = e.target.checked;
    if (e.target.id === 'vocab') await saveSettings({ gridIncludeVocab: e.target.checked });
    draw();
  };
  draw();
  return () => { el.onchange = null; };
}
