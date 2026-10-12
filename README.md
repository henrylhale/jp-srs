# jp-srs

A personal WaniKani-style kanji/vocab reviewer. It installs as a PWA on Android and works fully offline.

- **WaniKani content, FSRS scheduling.** Subjects (radicals, kanji, vocab, mnemonics, context sentences) come from the WaniKani API v2 with your own token. They are cached in IndexedDB and gated by your subscription's `max_level_granted`. Unlock order and level-ups follow WK rules: an item counts as "passed" once its FSRS stability reaches a threshold.
- **Anki-style self-grading.** You see the prompt, reveal the answer, and grade Again / Hard / Good / Easy. FSRS-5 schedules the next review. You get learning and relearning steps, interval previews on the buttons, undo, leech handling and wrap-up.
- **Skip what you know.** Every lesson has an "I know this" button, and the lesson queue has a bulk checklist. Import can mark everything known through level N. Known items are either burned or seeded into a late stage (about 120 days by default).
- **Imports.** Sottaku (paste the Flashcard Management page), WaniKani SRS progress, and generic CSV/TSV/JSON or pasted lists. Imported words that match WK vocab take over that item's schedule. Anything else becomes an "imported" card.
- **Kanji breakdown on the answer side.** For every kanji in a card it shows the classical radical, the KanjiVG components, and which component is the phonetic. It also shows that phonetic's series (other kanji sharing it, with their on'yomi), coloured by how well you know them.
- **Kanji grid** by school grade, WK level or old JLPT level, with mature items highlighted. Kanji that are mature only through vocab can optionally count too.
- **Forecast.** Shows scheduled load, or a Monte Carlo projection that includes new lessons per day and backlog under a daily review cap.
- **QoL.** Day reset hour, new cards per day, max reviews per day, lesson batch size, desired retention, custom FSRS weights, review order, theme, and JSON backup/restore.

## Use it

1. Open https://henrylhale.github.io/jp-srs/ in Chrome on Android, then use the menu to **Add to Home screen**.
2. Go to Settings, paste a read-only WaniKani API token, and tap **Sync content**.
3. Go to Import and bring in WaniKani progress, Sottaku, or a CSV.

All progress lives on the device. Export a backup from Settings now and then.

## Develop

No build step. It's plain ES modules.

```bash
npm run serve        # http://localhost:8787
npm test             # node --test: FSRS, importers, forecast
```

Rebuild the open kanji data, using inputs from the KanjiVG releases and EDRDG:

```bash
python3 -I tools/build_kanji_data.py kanjivg-YYYYMMDD.xml.gz kanjidic2.xml.gz data/kanji.json
```

When you add or rename a file, add it to `ASSETS` in `sw.js` and bump `VERSION`.

## Data and privacy

The repo contains no WaniKani content and no personal SRS data. The API token is stored only on the device, and backups strip it out. See [data/ATTRIBUTION.md](data/ATTRIBUTION.md) for the KANJIDIC2 and KanjiVG licences.
