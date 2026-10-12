import { html, mount, fmtDuration, fmtDate } from '../util.js';
import { state } from '../store.js';
import { availableLessons, dueCards, levelProgress, counts, upcoming, newLeftToday, reviewsLeftToday, grantedLevel } from '../queue.js';
import { todayStats } from '../stats.js';

export async function render(el) {
  const now = Date.now();
  const stats = await todayStats(now);
  const lessons = availableLessons();
  const newLeft = newLeftToday(stats);
  const due = dueCards(now);
  const dueNow = due.filter((c) => c.due <= now).length;
  const revLeft = reviewsLeftToday(stats);
  const lp = levelProgress();
  const c = counts();
  const hours = upcoming(now, 24);
  const next24 = hours.reduce((a, b) => a + b, 0);
  const nextDue = [...state.cards.values()].filter((x) => x.state !== 0 && !x.suspended && !x.burned && x.due > now).reduce((m, x) => Math.min(m, x.due), Infinity);
  const empty = state.subjects.size === 0;
  const maxH = Math.max(1, ...hours);
  const pct = lp.current.total ? Math.round((lp.current.passed / lp.current.total) * 100) : 0;
  const lastBackup = state.meta.lastBackup;
  const backupStale = !lastBackup || now - lastBackup > 14 * 86400000;

  mount(el, html`
    <header class="page-head">
      <h1>jp-srs</h1>
      <span class="muted small">${state.meta.user ? html`${state.meta.user.username} · WK levels 1–${grantedLevel()}` : ''}</span>
    </header>

    ${empty ? html`
      <div class="panel onboard">
        <h2>Get started</h2>
        <ol>
          <li>Add your WaniKani API token in <a href="#/settings">Settings</a> and tap <b>Sync</b>.</li>
          <li>Bring over your progress: <a href="#/import">Import</a> from Sottaku, WaniKani or a CSV.</li>
          <li>Install it: browser menu → <b>Add to Home screen</b>. Everything works offline after the first sync.</li>
        </ol>
      </div>` : ''}

    <div class="big-actions">
      <a class="big-btn lessons ${lessons.length && newLeft ? '' : 'dim'}" href="#/lessons">
        <span class="label">Lessons</span>
        <span class="count">${Math.min(lessons.length, newLeft)}</span>
        <span class="sub">${lessons.length} unlocked · ${newLeft}/${state.settings.newPerDay} left today</span>
      </a>
      <a class="big-btn reviews ${due.length ? '' : 'dim'}" href="#/review">
        <span class="label">Reviews</span>
        <span class="count">${revLeft === Infinity ? dueNow : Math.min(dueNow, revLeft)}</span>
        <span class="sub">${due.length - dueNow ? html`+${due.length - dueNow} learning soon · ` : ''}${nextDue < Infinity ? html`next in ${fmtDuration(nextDue - now)}` : 'nothing scheduled'}</span>
      </a>
    </div>

    <section class="panel">
      <div class="row-between">
        <h3>Level ${lp.level}</h3>
        <span class="muted small">${lp.current.passed}/${lp.current.total} kanji passed · 90% to level up</span>
      </div>
      <div class="bar"><span style="width:${pct}%"></span><i style="left:90%"></i></div>
    </section>

    <section class="panel">
      <div class="row-between"><h3>Next 24 hours</h3><span class="muted small">${next24} reviews</span></div>
      <div class="hourbars">${hours.map((n, i) => html`<span title="+${i}h: ${n}" style="height:${Math.round((n / maxH) * 100)}%"></span>`)}</div>
      <div class="row-between muted tiny"><span>now</span><span>+12h</span><span>+24h</span></div>
    </section>

    <section class="panel stats-grid">
      <div><b>${stats.reviewsToday}</b><span>reviews today</span></div>
      <div><b>${stats.newToday}</b><span>new today</span></div>
      <div><b>${stats.retention30 == null ? '—' : `${Math.round(stats.retention30 * 100)}%`}</b><span>retention (30d)</span></div>
      <div><b>${c.learning}</b><span>learning</span></div>
      <div><b>${c.young}</b><span>young</span></div>
      <div><b>${c.mature}</b><span>mature</span></div>
      <div><b>${c.burned}</b><span>burned</span></div>
      <div><b>${c.new}</b><span>not started</span></div>
      <div><b>${c.suspended}</b><span>suspended</span></div>
    </section>

    ${backupStale && !empty ? html`<div class="panel note">${lastBackup ? html`Last backup ${fmtDate(lastBackup)}.` : 'No backup yet.'} Your progress only lives on this device. <a href="#/settings">Export a backup</a>.</div>` : ''}
  `);
}
