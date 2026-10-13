import { html, mount, $, toast, readFile } from '../util.js';
import { state, saveCards } from '../store.js';
import { parseSottaku, parseGeneric, summarize } from '../importers.js';
import { planImport, commitPlan, planKnownThroughLevel } from '../importApply.js';
import { importAssignments } from '../wk.js';
import { grantedLevel } from '../queue.js';
import { charsHtml, primaryMeaning } from '../render.js';

function localInput(t) {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

const OPTIONS = html`
  <div class="opts">
    <label>Paused / suspended items
      <select name="paused"><option value="suspend">import as suspended</option><option value="known">treat as known</option><option value="skip">skip</option></select></label>
    <label>Never-studied items
      <select name="newRows"><option value="new">add to lesson queue</option><option value="skip">skip</option></select></label>
    <label>Items not in your WaniKani content
      <select name="unmatched"><option value="custom">create imported cards</option><option value="skip">skip</option></select></label>
    <label>Interval confidence
      <select name="confidence"><option value="1">as estimated</option><option value="0.7">a bit shorter (safer)</option><option value="0.5">half</option><option value="1.3">a bit longer</option></select></label>
    <label class="check"><input type="checkbox" name="overwrite"> overwrite items I've already started here</label>
  </div>`;

function readOpts(form) {
  const f = new FormData(form);
  return {
    paused: f.get('paused'), newRows: f.get('newRows'), unmatched: f.get('unmatched'),
    confidence: parseFloat(f.get('confidence')), overwrite: f.get('overwrite') === 'on',
  };
}

export function render(el) {
  const granted = grantedLevel();
  mount(el, html`
    <header class="page-head"><a href="#/settings" class="icon-btn">←</a><h1>Import</h1></header>

    ${state.meta.syncedLevels ? '' : html`<div class="panel note">Sync WaniKani content first (Settings → Sync) so imported words can be matched to WK items. Anything imported before a sync is merged into matching WK items afterwards.</div>`}

    <form class="panel" id="sottaku">
      <h3>Sottaku</h3>
      <p class="muted small">On sottaku.app open <b>Flashcards → Flashcard Management</b>, select the whole page, copy it, and paste it here (or save it as a .txt file). Due dates on that page are relative ("in 3 days"), so set when the copy was taken.</p>
      <textarea name="text" rows="5" placeholder="Paste the flashcard overview page…"></textarea>
      <div class="row gap wrap">
        <input type="file" name="file" accept=".txt,text/plain">
        <label class="small">Copied at <input type="datetime-local" name="when" value="${localInput(Date.now())}"></label>
      </div>
      ${OPTIONS}
      <div class="row gap"><button class="btn" name="go" value="preview">Preview</button><button class="btn primary" name="go" value="apply">Import</button></div>
      <div class="result"></div>
    </form>

    <form class="panel" id="generic">
      <h3>CSV / TSV / JSON / pasted list</h3>
      <p class="muted small">Columns are matched by header name: <code>word</code>, <code>reading</code>, <code>meaning</code>, plus optionally <code>due</code>, <code>interval</code> (days), <code>stability</code>, <code>stage</code> (1–9 or apprentice…burned), <code>status</code> (new/known/burned/suspended), <code>type</code>. Without a header, each line is read as <code>word⇥reading⇥meaning⇥interval</code>.</p>
      <textarea name="text" rows="5" placeholder="word,reading,meaning,interval&#10;学校,がっこう,school,30"></textarea>
      <div class="row gap wrap">
        <input type="file" name="file" accept=".csv,.tsv,.txt,.json">
        <label class="small">Rows without schedule info are
          <select name="defaultKind"><option value="new">new</option><option value="known">known</option><option value="burned">burned</option></select></label>
      </div>
      ${OPTIONS}
      <div class="row gap"><button class="btn" name="go" value="preview">Preview</button><button class="btn primary" name="go" value="apply">Import</button></div>
      <div class="result"></div>
    </form>

    <form class="panel" id="bulk">
      <h3>Mark known by level</h3>
      <p class="muted small">Skip WaniKani content you already know. Applies to items you haven't started here yet.</p>
      <div class="row gap wrap">
        <label>Through level <input type="number" name="level" min="1" max="${granted || 60}" value="${Math.min(granted || 1, 3)}" style="width:4.5em"></label>
        <label class="check"><input type="checkbox" name="radical" checked> radicals</label>
        <label class="check"><input type="checkbox" name="kanji" checked> kanji</label>
        <label class="check"><input type="checkbox" name="vocab" checked> vocab</label>
        <select name="mode"><option value="late">late stage (~${state.settings.knownStability}d)</option><option value="burn">burn</option></select>
        <label class="check"><input type="checkbox" name="overwrite"> include started items</label>
      </div>
      <div class="row gap"><button class="btn" name="go" value="preview">Count</button><button class="btn primary" name="go" value="apply">Apply</button></div>
      <div class="result"></div>
    </form>

    <form class="panel" id="wkprog">
      <h3>WaniKani progress</h3>
      <p class="muted small">Sync content does this automatically for items you haven't started here. Use this to re-import, e.g. with overwrite. Seeds schedules from your WaniKani SRS stages (Apprentice → hours/days, Guru ≈ 1–2 weeks, Master ≈ 1 month, Enlightened ≈ 4 months, Burned → burned). Needs a connection.</p>
      <label class="check"><input type="checkbox" name="overwrite"> overwrite items I've already started here</label>
      <div class="row gap"><button class="btn primary" name="go" value="apply">Import WK progress</button></div>
      <div class="result"></div>
    </form>`);

  async function rowsFor(form) {
    const f = new FormData(form);
    let text = f.get('text');
    const file = f.get('file');
    if (file && file.size) text = await readFile(file);
    if (!text?.trim()) throw new Error('Paste something or choose a file first.');
    if (form.id === 'sottaku') {
      const when = f.get('when') ? new Date(f.get('when')).getTime() : Date.now();
      return parseSottaku(text, when);
    }
    return parseGeneric(text, Date.now(), f.get('defaultKind'));
  }

  el.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const go = e.submitter?.value || 'preview';
    const out = form.querySelector('.result');
    try {
      if (form.id === 'bulk') {
        const f = new FormData(form);
        const types = ['radical', 'kanji', 'vocab'].filter((t) => f.get(t)).flatMap((t) => (t === 'vocab' ? ['vocab', 'kana_vocab'] : [t]));
        const cards = planKnownThroughLevel(+f.get('level'), types, f.get('mode'), f.get('overwrite') === 'on');
        if (go === 'apply') { await saveCards(cards); toast(`Marked ${cards.length} items`); }
        mount(out, html`<p>${go === 'apply' ? 'Updated' : 'Would update'} <b>${cards.length}</b> items.</p>`);
        return;
      }
      if (form.id === 'wkprog') {
        mount(out, html`<p class="muted">Working…</p>`);
        const r = await importAssignments({ overwrite: new FormData(form).get('overwrite') === 'on' }, (m) => mount(out, html`<p class="muted">${m}</p>`));
        mount(out, html`<p>Read ${r.seen} assignments, updated <b>${r.updated}</b> cards.${r.missing ? html` ${r.missing} belong to content not synced yet. Run Sync content, then try again.` : ''}</p>`);
        return;
      }
      const rows = await rowsFor(form);
      const sum = summarize(rows);
      const opts = { ...readOpts(form), tag: form.id === 'sottaku' ? 'sottaku' : 'import' };
      const plan = planImport(rows, opts);
      if (go === 'apply') await commitPlan(plan);
      mount(out, html`
        <div class="import-summary">
          <p>Parsed <b>${sum.total}</b> items: ${sum.learned} with a schedule, ${sum.new} never studied, ${sum.paused} paused${sum.known ? `, ${sum.known} known` : ''}${sum.burned ? `, ${sum.burned} burned` : ''}.</p>
          <p>${go === 'apply' ? 'Imported' : 'Will import'}: <b>${plan.stats.matched}</b> matched to WaniKani items, <b>${plan.stats.custom}</b> as imported cards${plan.subjects.length ? ` (${plan.subjects.length} new)` : ''}; ${plan.stats.skipped} skipped${plan.stats.unchanged ? `, ${plan.stats.unchanged} left alone (already started)` : ''}.</p>
          <ul class="item-list compact">${plan.examples.map((x) => html`<li>${charsHtml(x.subj, 'tiny')} <span class="grow">${primaryMeaning(x.subj)}</span><span class="muted tiny">${x.subj.src === 'wk' ? `WK L${x.subj.level}` : 'imported'} · ${x.kind}${x.row.ivl ? ` · ~${Math.round(x.row.ivl * opts.confidence)}d` : ''}</span></li>`)}</ul>
          ${go === 'apply' ? html`<p><a class="btn" href="#/">Home</a> <a class="btn" href="#/browse">Browse</a></p>` : ''}
        </div>`);
      if (go === 'apply') toast('Import complete');
    } catch (err) {
      mount(out, html`<p class="error">${err.message}</p>`);
    }
  };
  return () => { el.onsubmit = null; };
}
