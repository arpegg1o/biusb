# Paste + Search experiment

This is a standalone, framework-free variant of the collaborator's schedule
site, with one core change: **the top-level paste box was replaced with real
course search** (the exact fuzzy-search logic from the main Schedule Maker
app), and the paste flow was **moved into the "+" manual-add dialog** as a
secondary option, alongside filling the fields in by hand.

The calendar, the alternatives/drag system, the electives sidebar, undo,
import/export, dev mode, colors — the collaborator's original engine — are
untouched. Everything added here works *with* that engine, not around it:
selecting a real course constructs entries in the exact shape its own
`rawCourses` array already expects, so its solver/rendering/alternatives
logic runs unmodified on real data.

## Files

```
index.html    Markup + all <dialog>s. No inline <style>/<script> — see below.
styles.css    All CSS (originally inline in <style>, split out unchanged).
app.js        All JS (originally inline in <script>, split out unchanged).
vendor/       Vendored uFuzzy build (no CDN/build step).
data/         Real scraped catalog data — see "Refreshing the data" below.
```

Split into these three files (from one ~2400-line HTML file) purely for
editability — GitHub Pages serves them identically either way; nothing here
changes behavior.

## Why this needs a local server

The page fetches `data/search-index.json` and `data/courses/<id>.json` —
opening `index.html` directly (`file://`) will fail those fetches in most
browsers. Serve the folder instead:

```bash
cd "paste-search-site"
python3 -m http.server 8123
# then open http://localhost:8123/index.html
```

(Any static server works — `npx serve`, VS Code's Live Server, etc.)

## What changed vs. the original file

- **Search bar** (`#courseSearchInput`) replaces the paste textarea as the
  primary way to add a course — backed by the real scraped catalog (`data/`)
  and the same Hebrew-normalization + uFuzzy fuzzy-matching as the main app
  (ported inline, no build step). Each result also shows its department.
- **Calendar-preview picker**: selecting a search result (or pressing ✏️ on
  an existing entry) doesn't open a plain list — it dims the real calendar
  and overlays the candidate groups of the active type (lecture, then
  exercise once a lecture is chosen, etc.) as clickable dashed "ghost"
  blocks positioned at their real times, via a small floating bar
  (`#previewControlBar`, not a blocking `<dialog>`, so the calendar stays
  clickable underneath). Groups with no fixed hours can't be drawn on a
  calendar, so they list in that same floating bar instead. A "תצוגת רשימה"
  button falls back to the plain list (`#searchAddDialog`) at any time.
- **Manual-add dialog** (the "+" icon, `openManualAdd()`): leads with the
  moved paste box + "הוסף מטקסט" button, then "או מלאו את הפרטים ידנית" and
  the original structured form. The ✏️ edit button on a search-added entry
  reopens the calendar-preview picker instead (with an "עריכה ידנית" escape
  hatch back to this structured form for that one entry) — only entries
  that were never search-based (pasted/manually typed) go straight here.
- **Settings** (⚙️ button): allow overlaps, allow choosing a תרגיל without a
  lecture first, theme (light/dark/system — "system" follows the OS, not
  captured by the original 2-way toggle), and resetting all custom
  per-course colors. The header's quick theme toggle and overlaps checkbox
  still work and stay in sync with these.
- **קיץ (summer)** added as a third semester alongside א'/ב' — the real
  catalog has summer courses and the original site only modeled two.
  **תגבור (reinforcement)** added as a type for the same reason. Friday-only
  meetings are silently excluded, matching the original file's own
  text-parser behavior (its calendar only has 5 day columns, Sun–Thu).
- **Fixed**: marking a course "בחירה" (elective) via search only took effect
  for groups added *after* the checkbox was toggled — flipping it for an
  already-added course silently did nothing. Electives are tracked per
  course name (see `updateUI()`'s `nameStatusMap`), so toggling it now
  updates every one of that course's entries immediately.

## Refreshing the data

`data/` is a copy of the main app's `apps/web/public/data/`. To update it,
regenerate that in the main project (`pnpm run collect` → `refresh-data`)
and copy it here again:

```bash
rm -rf data
cp -R "../apps/web/public/data" data
```
