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
  **תגבור (reinforcement)** added as a type for the same reason.
- **שישי (Friday)** is a real sixth calendar column. It's hidden by default
  (most courses never use it) and appears automatically the moment a course
  lands there — via search, the "+" add-more button, or the manual edit
  form's day dropdown — the same way א'-ה' always show. "הצג תמיד את יום
  שישי" in Settings forces it visible even when empty. See
  `updateFridayVisibility()`.
- **Fixed**: the "paste a course" box's day-matching regexes were both
  `[א-ה]` — a leftover from when Friday was unsupported — so a pasted
  Friday meeting either silently failed to parse (new format) or, worse,
  silently landed on יום ראשון instead (old format's fallback default).
  Both now recognize `[א-ו]`. If you pasted a Friday course before this fix,
  check your course list for an entry that landed on the wrong day and
  remove it — nothing removes it automatically, since there's no reliable
  way to tell it apart from a course you actually meant to put on Sunday.
- **"+" button** next to the minus on every calendar box, and next to the
  🗑️ in the course list, opens the same calendar-preview bar search does,
  scoped to that course and defaulting to a part (הרצאה/תרגיל/…) it doesn't
  have yet — so adding "the rest" of a course you started from search
  doesn't mean going back through search. The bar's new "הוסף הכל" button
  adds every remaining group of the course (every type, current semester)
  in one click. See `openAddMoreForCourse()` / `addAllGroupsForCourse()`.
  **Only works for courses added via search** — a pasted course's id is a
  random local string, not a real catalog id, so there's no course to fetch
  more parts of; the "+" simply doesn't render on those boxes.
  The pencil (✏️) is the "+" button's counterpart: it now always opens the
  plain structured edit form (עריכה ידנית — day/time/type/name, no catalog
  lookup) for that one entry, for search-added and pasted courses alike.
  Previously it reopened the calendar-preview bar (scoped to the box's own
  type) for search-added courses specifically, which overlapped with what
  "+" does and blocked the direct field-editing form. See `openEdit()`.
- `index.html` now loads `styles.css` and `app.js` with a `?v=` query string
  (bump it on every deploy). Without it, a browser or CDN that caches static
  files aggressively can keep serving a stale copy after you update the
  site — if a change doesn't seem to show up, hard-refresh
  (Ctrl/Cmd+Shift+R) before assuming the code is wrong.
- **Fixed**: marking a course "בחירה" (elective) via search only took effect
  for groups added *after* the checkbox was toggled — flipping it for an
  already-added course silently did nothing. Electives are tracked per
  course name (see `updateUI()`'s `nameStatusMap`), so toggling it now
  updates every one of that course's entries immediately.
- **No cap on how many groups of a type you may pick**: any number of
  הרצאה/תרגיל/… groups of a course can be chosen; they become alternatives,
  and the solver still places exactly one of them in a schedule at a time.
  Previously a second group whose hours matched an already-chosen one was
  silently dropped by an over-broad duplicate check in
  `toggleGroupInSchedule()` — that check now only stops the *same* group
  being added twice.
- **Identical groups are merged** (`getMergedGroups()`): groups of a course
  that share a type, a semester and exactly the same meetings, and differ
  only by lecturer, are offered as ONE option reading "קבוצה 01/02 —
  name1/name2". The merged option keeps the first group's real id and
  remembers the others (`mergedIds`), so add/remove/"already added" still
  work for entries saved under any of them.
- **Fixed**: changing the semester while a course picker was open left that
  picker showing the old semester's groups — and the list dialog never
  filtered by semester at all, so a course could be added to a semester it
  isn't offered in. `onSemesterChange()` now calls `refreshCoursePickers()`
  (re-renders the search dropdown, the list dialog and the preview bar, and
  moves off a type the new semester doesn't have), the list dialog applies
  the same semester rule as everything else, and `toggleGroupInSchedule()`
  refuses an out-of-semester group as a last line of defence.
- **Quick "אפשר חפיפות" switch** (`#overlapsQuickToggle`) next to the ⚙️
  button, so overlaps can be turned on without opening Settings. It and the
  settings switch both go through `setDevMode()` and stay in sync.

- **Saved schedules** (panel above the "נבנה על ידי…" credit line): "+ שמור
  מערכת נוכחית" stores a named snapshot of **one semester**: that semester's
  courses (with each course's elective flag and colour; annual "שנתי" courses
  count for every semester they run in), which of its electives are switched
  on in the sidebar (`activeElectives`), and which alternative you were
  viewing (`semesterIndices[sem]`). **Each semester has its own, completely
  separate list**: the panel shows only the saves of the semester selected in
  the picker, and loading one replaces only that semester's courses — the
  other semesters are left alone. Names start as "טיוטה 1", "טיוטה 2", … and
  the new card drops straight into rename mode (Enter/blur saves the name, Esc
  keeps the default). Click a card to load it; the save icon overwrites it
  with what's on screen, the pencil renames, the bin deletes (icons are inline
  SVGs using `currentColor`, so they're black on the light theme and white on
  the dark one). Stored in `localStorage` (`mySavedSchedules`). See "Saved
  schedules" in `app.js`.
  - A card gets a frame only while what's on screen is **exactly** that save:
    same courses, same electives, same alternative number. Change any of
    those (including flipping to another alternative with הקודם/הבא) and no
    card is framed; get back to the identical state (e.g. by undoing) or press
    the card's save icon and the frame returns. There is deliberately no text
    label ("פעילה"/"שונתה") and no "modified" marker anywhere. Internally the
    page still remembers which save you last loaded or saved into
    (`myActiveSavedScheduleIds`), but only to skip the confirmation when you
    save back into it and to name it in the "unsaved changes" prompt.
  - Loading another save asks first only if the *courses or electives* match
    none of the saves (just browsing alternatives doesn't trigger the prompt).
    Loading also pushes the previous course list onto the undo history.
    Note the existing undo is off by one — the first press re-applies the
    current state and the second actually steps back — that's how it worked
    before, and it's unchanged.
  - "נקה הכל" and JSON import replace the working state wholesale, so they
    detach every semester from its loaded save (no stale "modified" marker).
  - Saves made with the first version of this feature (one snapshot covering
    every semester) are split automatically into one save per semester that
    has courses, under the same name.
- **Phones / touch** (checked on emulated Pixel 7, 360px-wide and 320px-wide
  Android screens): below 900px the calendar becomes a stacked list of day
  cards. There, each block's action buttons (alternatives / edit / add parts /
  remove elective) sit in their own row above the title — they used to be
  drawn *under* the text layer (`.class-content` is `z-index: 2`), so taps hit
  the title instead of the button — and are 38×38px. `.box-actions` also has
  `z-index: 3` as a safeguard. The export menu opens on **tap** for
  touch devices (`toggleExportMenu()`); with a mouse it still opens on hover.
  Other phone-only layout fixes live in the `@media (max-width: 700px)` block
  at the end of `styles.css`: the prev/status/next + semester controls are a
  grid, the course-list headers and rows wrap instead of clipping, the sticky
  top bar is slimmer, and `text-size-adjust: 100%` stops Android Chrome from
  inflating some text.
- **Keyboard shortcuts** (`handleGlobalShortcuts()` in `app.js`): `←` / `→`
  switch semester (the UI is RTL, so `←` = next, `→` = previous; it stops at
  the first/last semester). `Ctrl`/`⌘`+`C` copies the schedule image to the
  clipboard (see below) — but only when no text is selected, so normal copying
  is never hijacked, and it matches `e.code === 'KeyC'` so it also works on a
  Hebrew keyboard layout. Both are ignored while typing in a field, while a
  dialog is open, and (arrows) while the semester `<select>` itself has focus.
- **Sticky top bar**: the theme / settings / "אפשר חפיפות" controls live in
  `#topBar`, a `position: sticky` bar that stays at the top of the screen
  while you scroll, with a soft shadow once content slides under it.
- **Copy to clipboard** (ייצא ▼ → "העתק ללוח", or `Ctrl+C`): the same picture as
  the PNG export, but put on the clipboard instead of downloaded. PNG only
  (that's all the clipboard reliably accepts). Needs a secure context —
  https (GitHub Pages) or `localhost` — and a browser with `ClipboardItem`
  (Chrome/Edge/Safari, Firefox 127+); otherwise it explains that and points
  at the PNG export. The `ClipboardItem` is created inside the click with a
  *promise* of the image, because Safari refuses `clipboard.write()` once the
  click's user-gesture window has passed while the image renders. The
  capture code (`captureCalendarCanvas()`) is now shared with the PNG/JPG
  export; a small `showToast()` shows "copied ✓".

## Refreshing the data

`data/` is a copy of the main app's `apps/web/public/data/`. To update it,
regenerate that in the main project (`pnpm run collect` → `refresh-data`)
and copy it here again:

```bash
rm -rf data
cp -R "../apps/web/public/data" data
```
