// ============================================================================
// Settings & view modes
//
// Theme, mobile calendar view mode, dev mode, the Friday column, exercise-without-lecture,
// the department filter, and the settings dialog.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

// --- Theme: "light" / "dark" / "system" (system = no data-theme attribute
// at all, letting the @media (prefers-color-scheme) rules in styles.css
// decide — see that file's comment on the system-theme block). ---
function getThemeMode() {
    return localStorage.getItem('myScheduleTheme') || 'system';
}

function effectiveTheme(mode) {
    if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return mode;
}

function applyThemeMode(mode) {
    if (mode === 'system') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', mode);
    }
    updateThemeIcon(effectiveTheme(mode));
    const radio = document.querySelector(`input[name="settingsTheme"][value="${mode}"]`);
    if (radio) radio.checked = true;
}

/** Sets an explicit mode — called from the settings dialog's radio group. */
function setTheme(mode) {
    localStorage.setItem('myScheduleTheme', mode);
    applyThemeMode(mode);
}

/** Quick top-corner button: flips between light/dark based on the
 * CURRENTLY VISIBLE appearance, leaving "system" mode (a click always
 * picks one explicitly, same as toggling a plain 2-way switch would). */
function toggleTheme() {
    const next = effectiveTheme(getThemeMode()) === 'dark' ? 'light' : 'dark';
    setTheme(next);
}

function updateThemeIcon(effective) {
    document.getElementById('themeToggleBtn').innerHTML = effective === 'dark' ? sunSVG : moonSVG;
}

// --- Mobile calendar view mode: "stack" (default, one day per card) vs
// "table" (the real grid, same as desktop — scroll or pinch-zoom to
// read it on a narrow screen). Only relevant under the 900px breakpoint;
// see the button's own CSS and the body:not(.force-table-view) guards
// in styles.css. ---
function getCalendarViewMode() {
    return localStorage.getItem('myCalendarViewMode') || 'stack';
}

function applyCalendarViewMode(mode) {
    document.body.classList.toggle('force-table-view', mode === 'table');
    const btn = document.getElementById('viewModeToggleBtn');
    if (btn) {
        btn.innerHTML = mode === 'table' ? stackViewSVG : tableViewSVG;
        btn.title = mode === 'table' ? 'חזרה לתצוגת רשימה' : 'החלף לתצוגת טבלה';
    }

    // Handle Zoom Cleanup/Restore
    const content = document.getElementById('calendarTableContent');
    if (content) {
        if (mode === 'table') {
            // Re-apply the zoom level when entering table mode
            if (typeof setTableZoom === 'function') {
                setTableZoom(typeof currentTableZoom !== 'undefined' ? currentTableZoom : 1.0);
            }
        } else {
            // Clear inline zoom and transform styles so they don't scale the list view
            content.style.zoom = '';
            content.style.transform = '';
        }
    }
}

function toggleCalendarViewMode() {
    const next = getCalendarViewMode() === 'table' ? 'stack' : 'table';
    localStorage.setItem('myCalendarViewMode', next);
    applyCalendarViewMode(next);
}

// --- Dev mode (allow overlaps) — reachable from two places: the quick
// switch next to the ⚙️ button (#quickOverlapsToggle, so it isn't buried
// in a dialog) and the Settings dialog itself. setDevMode() is the single
// entry point for both, and keeps them showing the same state. ---
function syncOverlapsToggles() {
    const quick = document.getElementById('quickOverlapsToggle');
    if (quick) quick.checked = devModeAllowOverlaps;
    const inSettings = document.getElementById('settingsOverlapsToggle');
    if (inSettings) inSettings.checked = devModeAllowOverlaps;
}

function setDevMode(checked) {
    devModeAllowOverlaps = checked;
    localStorage.setItem('myScheduleDevMode', devModeAllowOverlaps);
    syncOverlapsToggles();
    updateUI(false);
}

// --- Settings: allow choosing a תרגיל before/without a lecture ---
let allowExerciseWithoutLecture = false;

function setAllowExerciseWithoutLecture(checked) {
    allowExerciseWithoutLecture = checked;
    localStorage.setItem('myScheduleAllowExerciseWithoutLecture', checked);
    if (currentSearchAddCourse) renderSearchAddDialog(currentSearchAddCourse);
}

// --- Settings: force-show the (by default auto-hidden) Friday column ---
let showFridayAlways = false;

function setShowFridayAlways(checked) {
    showFridayAlways = checked;
    localStorage.setItem('myScheduleShowFridayAlways', checked);
    renderCalendar();
}

/** שישי is hidden by default (most courses never use it) and reveals
 * itself the moment it's actually needed: `hasContent` is whether
 * anything is currently drawn there (a real scheduled class, a
 * preview ghost, or a shown alternative — renderCalendar() passes in
 * elementsByDay['ו'].length > 0). The settings toggle forces it visible
 * even when empty, the same way א'-ה' always show regardless of content. */
function updateFridayVisibility(hasContent) {
    const wrapper = document.querySelector('.calendar-wrapper');
    if (wrapper) wrapper.classList.toggle('hide-friday', !showFridayAlways && !hasContent);
}

// --- Settings: restrict the course search to chosen departments ---
// Toggling this on/off only changes whether the filter is APPLIED —
// the chosen department ids are saved (and stay selectable/removable)
// regardless of the toggle state.
let departmentFilterEnabled = false;
let departmentFilterIds = new Set(); // department id strings
let deptFilterResultsCache = [];

function setDepartmentFilterEnabled(checked) {
    departmentFilterEnabled = checked;
    localStorage.setItem('myScheduleDeptFilterEnabled', checked);
    refreshCoursePickers(); // re-run the course search if it's open, so the effect is immediate
}

function saveDeptFilterIds() {
    localStorage.setItem('myScheduleDeptFilterIds', JSON.stringify(Array.from(departmentFilterIds)));
}

/** The department picker in Settings — same smart (fuzzy) search as the
 * main course search box, just over department names instead of
 * courses. Already-selected departments are excluded from results. */
function onDeptFilterSearchInput() {
    const input = document.getElementById('deptFilterSearchInput');
    const dropdown = document.getElementById('deptFilterResultsDropdown');
    if (!input || !dropdown) return;

    const pool = departmentsList.filter((d) => !departmentFilterIds.has(d.id));
    const query = input.value.trim();
    let results;
    if (!query) {
        results = pool.slice(0, 20);
    } else {
        const needle = normalizeForFuzzyMatch(query);
        const haystack = pool.map((d) => d.norm);
        const [idxs, info, order] = fuzzy.search(haystack, needle, undefined, 1000);
        results = (!idxs || !info || !order) ? [] : order.slice(0, 20).map((i) => pool[info.idx[i]]);
    }

    deptFilterResultsCache = results;
    dropdown.style.display = 'block';
    if (results.length === 0) {
        dropdown.innerHTML = '<div class="search-empty">לא נמצאו מחלקות תואמות.</div>';
        return;
    }
    dropdown.innerHTML = results.map((d, i) =>
        `<div class="search-result-item" onclick="selectDeptFilterResult(${i})">
                <div class="search-result-name">${d.nameHe}</div>
            </div>`).join('');
}

function selectDeptFilterResult(i) {
    const d = deptFilterResultsCache[i];
    if (!d) return;
    departmentFilterIds.add(d.id);
    saveDeptFilterIds();
    const input = document.getElementById('deptFilterSearchInput');
    if (input) input.value = '';
    const dropdown = document.getElementById('deptFilterResultsDropdown');
    if (dropdown) dropdown.style.display = 'none';
    renderDeptFilterChips();
    refreshCoursePickers();
}

function removeDeptFilterChip(id) {
    departmentFilterIds.delete(id);
    saveDeptFilterIds();
    renderDeptFilterChips();
    refreshCoursePickers();
}

function renderDeptFilterChips() {
    const el = document.getElementById('deptFilterChips');
    if (!el) return;
    if (departmentFilterIds.size === 0) {
        el.innerHTML = '<p style="color:var(--text-muted); font-size:12px; margin:8px 0 0;">לא נבחרו מחלקות — הסינון לא יגביל דבר כל עוד הרשימה ריקה.</p>';
        return;
    }
    el.innerHTML = Array.from(departmentFilterIds).map((id) => {
        const name = departmentNameById.get(id) || id;
        return `<span class="dept-filter-chip">${name}<button type="button" onclick="removeDeptFilterChip('${id}')" title="הסרה">×</button></span>`;
    }).join('');
}

function resetAllCustomColors() {
    if (!confirm('לאפס את כל הצבעים המותאמים אישית שנשמרו לקורסים?')) return;
    rawCourses.forEach((c) => { c.color = null; });
    updateUI(true);
}

function openSettingsDialog() {
    syncOverlapsToggles();
    document.getElementById('settingsExerciseWithoutLectureToggle').checked = allowExerciseWithoutLecture;
    document.getElementById('settingsShowFridayToggle').checked = showFridayAlways;
    document.getElementById('settingsDeptFilterToggle').checked = departmentFilterEnabled;
    renderDeptFilterChips();
    const radio = document.querySelector(`input[name="settingsTheme"][value="${getThemeMode()}"]`);
    if (radio) radio.checked = true;
    document.getElementById('settingsDialog').showModal();
}
