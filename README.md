# Schedule builder

A static site: `index.html` + `styles.css` + the scripts in `js/` (+ `vendor/uFuzzy.iife.min.js`, and the `data/` catalog files).
There is no build step.

## Where things live

The scripts are plain (non-module) files that share one global scope, loaded by the `<script>` tags at the bottom of
`index.html` **in this order**. When you're hunting a bug, start with the file that owns the feature:

| File | What's in it |
|---|---|
| `js/state.js` | Shared data (`rawCourses`, undo history…), lookup tables, `saveState` / `undoAction` |
| `js/utils.js` | Time formatting, `escapeHtml`, colour helpers, the toast |
| `js/search.js` | Course search box: Hebrew normalisation, fuzzy search, dropdown |
| `js/catalog.js` | Loading catalog data, **group merging**, **catalog re-sync** (toast + undo), legacy-course linking |
| `js/exams.js` · `js/exams-export.js` | Exam store, exams dialog, editing · PNG/PDF/ICS/JSON export |
| `js/course-dialog.js` | The list-view "add course" dialog, add/remove groups |
| `js/preview.js` | Calendar-preview picker (pick a group on the calendar) |
| `js/solver.js` | Web-worker solver, `updateUI()`, status, moving between schedules, semester selector |
| `js/alternatives.js` | Alternatives for a course, pinning |
| `js/sidebar.js` | Course list, electives, clear all |
| `js/calendar.js` | **Calendar rendering**, tap/keyboard expand, table zoom |
| `js/editor.js` | Manual add / edit dialogs |
| `js/parser.js` | **Paste parser** (groups with no readable day are reported, never saved) |
| `js/saved-schedules.js` | Named saved schedules |
| `js/import-export.js` | Schedule export (JSON / image / clipboard / PDF) and import |
| `js/settings.js` | Theme, view modes, dev mode, department filter, settings dialog |
| `js/main.js` | `window.onload` start-up and global keyboard shortcuts |

Because everything shares one scope, a function defined in any file can be called from any other, and from the inline
`onclick="…"` handlers in `index.html`. Don't declare the same name in two files (the tests check this).

## Deploying

1. `./stamp-version.sh` — stamps a fresh `?v=` into `index.html` for `styles.css` and **every** script, so browsers
   don't keep old copies.
2. Upload `index.html`, `styles.css` and the whole `js/` folder. (`app.js` no longer exists — delete the old one from the
   server if it's still there.)

## Tests

`npm test` (Node 18+, no dependencies). `tests/harness.js` cuts real functions out of `js/*.js` by name, so you don't
say which file a function is in. `tests/structure.test.js` guards the multi-file layout (every file loaded, `?v=` on
every tag, no duplicate names, inline handlers resolve, scripts load in order).
