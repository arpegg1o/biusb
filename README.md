# Paste + Search experiment

This is a standalone, framework-free variant of the collaborator's schedule
site (`index.html`), with one change: **the top-level paste box was replaced
with real course search** (the exact fuzzy-search logic from the main
Schedule Maker app), and the paste flow was **moved into the "+" manual-add
dialog** as a secondary option, alongside filling the fields in by hand.

Everything else — the calendar, the alternatives/drag system, the electives
sidebar, undo, import/export, dev mode, colors — is the collaborator's
original code, completely untouched. Only the *input* mechanism changed.

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

- **Header**: the paste `<textarea>` + "הוסף" button were replaced with a
  search input (`#courseSearchInput`) backed by real, scraped course data
  (`data/`) and the same Hebrew-normalization + uFuzzy fuzzy-matching used
  by the main app (ported inline, no build step — see the script's
  "Course search" section for the full port).
- **Manual-add dialog** (the "+" icon, `openManualAdd()`): now leads with
  the moved paste box + "הוסף מטקסט" button, then "או מלאו את הפרטים ידנית"
  and the original structured form. Hidden when editing an existing entry.
- **New group-picker dialog** (`#searchAddDialog`): selecting a search
  result opens this, listing the course's real groups by type
  (lecture → unlocks exercise → lab/seminar → reinforcement, same guided
  flow as the main app's CourseDetailPanel). Clicking "הוספה"/"הסרה"
  constructs entries in the *exact* shape the original site's own
  `rawCourses` array expects (down to reusing the real group id as
  `courseGroupId`, so the site's own alternatives/dedup/deletion logic
  works on real courses with zero changes to that logic).
- **קיץ (summer)** added as a third semester alongside א'/ב' — the real
  catalog has summer courses and the original site only modeled two
  semesters. **תגבור (reinforcement)** added as a type option for the same
  reason. Friday-only meetings are silently excluded, matching the
  original file's own text-parser behavior (its calendar only has 5 day
  columns, Sun–Thu).

## Refreshing the data

`data/` is a copy of the main app's `apps/web/public/data/`. To update it,
regenerate that in the main project (`pnpm run collect` → `refresh-data`)
and copy it here again:

```bash
rm -rf data
cp -R "../apps/web/public/data" data
```
