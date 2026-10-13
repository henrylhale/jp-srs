import { html, mount, $, toast, download, readFile, fmtDate } from '../util.js';
import { state, saveSettings, saveMeta, exportBackup, importBackup } from '../store.js';
import { syncSubjects } from '../wk.js';
import { mergeImportedIntoWk } from '../importApply.js';
import { newCard } from '../fsrs.js';
import * as db from '../db.js';

const field = (label, input, help = '') => html`<label class="field"><span>${label}${help ? html`<small>${help}</small>` : ''}</span>${input}</label>`;

export async function render(el) {
  const s = state.settings;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const sel = (name, opts) => html`<select name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${String(s[name]) === String(v) ? 'selected' : ''}>${l}</option>`)}</select>`;
  const num = (name, attrs = '') => html`<input type="number" name="${name}" value="${s[name]}" ${attrs}>`;
  const chk = (name) => html`<input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''}>`;

  mount(el, html`
    <header class="page-head"><h1>Settings</h1></header>

    <section class="panel">
      <h3>WaniKani</h3>
      ${field('API token', html`<input type="password" name="token" value="${s.token}" autocomplete="off" placeholder="read-only personal access token">`, 'Stored only on this device.')}
      <p class="muted small">${state.meta.user ? html`Signed in as <b>${state.meta.user.username}</b> · subscription: ${state.meta.user.subscription?.type} · content levels 1–${state.meta.user.subscription?.max_level_granted}` : 'Not synced yet.'}
        ${state.meta.lastSubjectSync ? html`<br>Last sync ${new Date(state.meta.lastSubjectSync).toLocaleString()}` : ''}</p>
      <div class="row gap"><button class="btn primary" id="sync">Sync content</button><a class="btn" href="#/import">Import progress…</a></div>
      <p class="muted small" id="syncmsg"></p>
    </section>

    <form class="panel" id="prefs">
      <h3>Daily limits</h3>
      ${field('New day starts at', sel('resetHour', Array.from({ length: 24 }, (_, h) => [h, `${String(h).padStart(2, '0')}:00`])))}
      ${field('New items per day', num('newPerDay', 'min="0" max="500"'))}
      ${field('Max reviews per day', num('maxReviewsPerDay', 'min="0"'), '0 = no limit')}
      ${field('Lesson batch size', num('lessonBatch', 'min="1" max="50"'))}

      <h3>Lessons</h3>
      ${field('Lesson order', sel('lessonOrder', [['wk-first', 'WaniKani first, then imported'], ['imported-first', 'Imported first'], ['interleave', 'Interleave']]))}
      ${field('Include radicals', chk('includeRadicals'))}
      ${field('Ignore unlock order', chk('ignorePrereqs'), 'Make every item in your granted levels available for lessons')}
      ${field('Minimum level', num('levelOverride', 'min="0" max="60"'), 'Unlock up to this level even if earlier levels aren’t passed (0 = off)')}
      ${field('“I know this” does', sel('knownMode', [['late', 'Late stage (keep occasional reviews)'], ['burn', 'Burn (never review)']]))}
      ${field('Late-stage interval (days)', num('knownStability', 'min="7" max="3650"'))}

      <h3>Scheduler (FSRS)</h3>
      ${field('Desired retention', num('retention', 'min="0.7" max="0.99" step="0.01"'), 'Higher = more reviews')}
      ${field('Learning steps (minutes)', html`<input name="learnSteps" value="${s.learnSteps.join(' ')}">`)}
      ${field('Relearning steps (minutes)', html`<input name="relearnSteps" value="${s.relearnSteps.join(' ')}">`)}
      ${field('Maximum interval (days)', num('maxIvl', 'min="1"'))}
      ${field('Interval fuzz', chk('fuzz'))}
      ${field('“Passed” at stability (days)', num('passStability', 'min="1" max="60"'), 'Counts like WK Guru: unlocks dependents and levels up')}
      ${field('Mature at interval (days)', num('matureIvl', 'min="1"'))}
      ${field('Leech after lapses', num('leechLapses', 'min="2"'))}
      ${field('Leech action', sel('leechAction', [['tag', 'Tag only'], ['suspend', 'Suspend']]))}
      ${field('FSRS weights', html`<input name="w" value="${(s.w || []).join(', ')}" placeholder="default FSRS-5 weights">`, '19 comma-separated values, e.g. from the Anki optimizer')}

      <h3>Reviews</h3>
      ${field('Review order', sel('reviewOrder', [['random', 'Random'], ['due', 'Oldest due first'], ['retrievability', 'Most forgotten first'], ['type', 'Radicals → kanji → vocab']]))}
      ${field('Show intervals on buttons', chk('showIntervals'))}
      ${field('Autoplay audio', chk('autoplayAudio'), 'Needs a connection unless the clip was played before')}
      ${field('Learn ahead (minutes)', num('learnAheadMin', 'min="0" max="120"'))}
      ${field('Theme', sel('theme', [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']]))}
    </form>

    <section class="panel">
      <h3>Data</h3>
      <p class="muted small">Storage: ${persisted ? 'persistent ✓' : 'best-effort (the browser may clear it under pressure)'}${est ? ` · ${(est.usage / 1048576).toFixed(1)} MB used` : ''}${state.meta.lastBackup ? ` · last backup ${fmtDate(state.meta.lastBackup)}` : ''}</p>
      <div class="row gap wrap">
        ${persisted === false ? html`<button class="btn" id="persist">Request persistent storage</button>` : ''}
        <button class="btn primary" id="export">Export backup</button>
        <label class="btn">Restore backup<input type="file" id="restore" accept=".json" hidden></label>
        <a class="btn" href="#/import">Import…</a>
      </div>
      <h3>Danger zone</h3>
      <div class="row gap wrap">
        <button class="btn danger" id="resetProgress">Reset all progress</button>
        <button class="btn danger" id="wipe">Delete everything</button>
      </div>
    </section>
    <p class="muted tiny center">Kanji data: KANJIDIC2 (EDRDG, CC BY-SA 4.0) and KanjiVG (Ulrich Apel, CC BY-SA 3.0). WaniKani content is fetched with your token and kept on this device only.</p>`);

  const parseSteps = (v) => v.split(/[\s,]+/).map(Number).filter((x) => x > 0);
  el.onchange = async (e) => {
    const t = e.target;
    if (!t.name || t.closest('#prefs') == null) {
      if (t.name === 'token') { await saveSettings({ token: t.value.trim() }); toast('Token saved'); }
      if (t.id === 'restore' && t.files[0]) {
        try {
          const data = JSON.parse(await readFile(t.files[0]));
          if (!confirm(`Replace all progress on this device with the backup from ${fmtDate(data.exported)}?`)) return;
          await importBackup(data);
          toast('Backup restored. Sync to re-download WaniKani content.');
          render(el);
        } catch (err) { toast(err.message); }
      }
      return;
    }
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.name === 'learnSteps' || t.name === 'relearnSteps') v = parseSteps(t.value);
    else if (t.name === 'w') {
      const arr = t.value.split(/[\s,]+/).map(Number).filter((x) => !Number.isNaN(x));
      if (t.value.trim() && arr.length !== 19 && arr.length !== 21) return toast('Need 19 weights');
      v = arr.length ? arr.slice(0, 19) : null;
    } else if (t.type === 'number' || t.name === 'resetHour') v = Number(t.value);
    else v = t.value;
    if (t.name === 'retention') v = Math.min(0.99, Math.max(0.7, v));
    await saveSettings({ [t.name]: v });
    window.dispatchEvent(new Event('jp-srs:settings'));
    toast('Saved');
  };

  el.onclick = async (e) => {
    if (e.target.closest('#sync')) {
      const msg = $('#syncmsg', el);
      const tok = $('input[name=token]', el).value.trim();
      if (tok !== state.settings.token) await saveSettings({ token: tok });
      try {
        const r = await syncSubjects((m) => { msg.textContent = m; });
        const m = await mergeImportedIntoWk();
        msg.textContent = `Synced ${r.fetched} updated subjects (levels 1–${r.granted}); seeded ${r.seeded} cards from your WaniKani progress.${m.removed ? ` Merged ${m.removed} imported cards into matching WaniKani items.` : ''}`;
        setTimeout(() => render(el), 4000);
      } catch (err) { msg.textContent = err.message; }
    }
    if (e.target.closest('#persist')) {
      const ok = await navigator.storage.persist();
      toast(ok ? 'Storage is now persistent' : 'Browser declined. Installing the app usually helps.');
      render(el);
    }
    if (e.target.closest('#export')) {
      const data = await exportBackup();
      download(`jp-srs-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
      await saveMeta({ lastBackup: Date.now() });
    }
    if (e.target.closest('#resetProgress')) {
      if (!confirm('Reset every card to new and clear review history? Export a backup first if unsure.')) return;
      const cards = [...state.cards.keys()].map((id) => newCard(id));
      await db.clear('cards', 'logs');
      await db.putMany('cards', cards);
      for (const c of cards) state.cards.set(c.id, c);
      toast('Progress reset');
    }
    if (e.target.closest('#wipe')) {
      if (!confirm('Delete ALL data on this device (content, progress, settings, token)?')) return;
      await db.clear('subjects', 'cards', 'logs', 'kv');
      location.hash = '#/';
      location.reload();
    }
  };
  return () => { el.onchange = null; el.onclick = null; };
}

