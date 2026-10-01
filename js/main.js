// ============================================================================
// Start-up & global keyboard shortcuts
//
// window.onload wiring (loads saved data, starts the worker and catalog, schedules the
// background syncs) and the global keyboard shortcuts. Loaded last.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

window.onload = () => {
    initWorker();
    loadCatalogIndex();

    applyThemeMode(getThemeMode());
    applyCalendarViewMode(getCalendarViewMode());

    devModeAllowOverlaps = localStorage.getItem('myScheduleDevMode') === 'true';
    syncOverlapsToggles();

    allowExerciseWithoutLecture = localStorage.getItem('myScheduleAllowExerciseWithoutLecture') === 'true';
    showFridayAlways = localStorage.getItem('myScheduleShowFridayAlways') === 'true';
    const fridaySettingToggle = document.getElementById('settingsShowFridayToggle');
    if (fridaySettingToggle) fridaySettingToggle.checked = showFridayAlways;

    departmentFilterEnabled = localStorage.getItem('myScheduleDeptFilterEnabled') === 'true';
    try {
        const savedDeptIds = localStorage.getItem('myScheduleDeptFilterIds');
        if (savedDeptIds) departmentFilterIds = new Set(JSON.parse(savedDeptIds));
    } catch (err) {
        console.error('Failed to parse saved department filter — ignoring it.', err);
    }

    const saved = localStorage.getItem('mySchedulesData');
    if (saved) rawCourses = JSON.parse(saved);
    
    const savedHistory = localStorage.getItem('mySchedulesHistory');
    if (savedHistory) historyStack = JSON.parse(savedHistory);
    
    const savedIndices = localStorage.getItem('mySchedulesIndices');
    if (savedIndices) semesterIndices = JSON.parse(savedIndices);

    try {
        const savedChoices = localStorage.getItem('mySchedulesChoices');
        if (savedChoices) semesterChoices = JSON.parse(savedChoices) || {};
    } catch (e) { semesterChoices = {}; }

    const savedElectives = localStorage.getItem('myActiveElectives');
    if (savedElectives) activeElectives = new Set(JSON.parse(savedElectives));

    loadSavedSchedulesFromStorage();
    loadCourseExamsFromStorage();
    // Back-fill exam data for courses whose stored entry is an empty-exam
    // stale seed from an older version of the app. Done here (on load) so
    // data is ready before the user opens the exam dialog, not only after.
    // Uses a short delay so the catalog index (loadCatalogIndex, above) has
    // time to settle before we kick off individual course fetches.
    setTimeout(_seedMissingCourseExams, 1500);
    // Link manually-added / imported courses that match a catalog course
    // by name — gives them the "+" button and exam data.  Runs after the
    // catalog index has had time to load (2 s is intentionally > 1.5 s so
    // _seedMissingCourseExams runs first for already-linked courses).
    setTimeout(_linkLegacyCourses, 2000);
    setTimeout(_syncCatalogEntries, 2500);

    // Restore the semester the user was last looking at. Without this the
    // selector always snaps back to א' on every reload, hiding all semester-ב
    // courses and their exams / "+" buttons.
    const savedSelectedSem = localStorage.getItem('myScheduleSelectedSemester');
    if (savedSelectedSem) {
        const sel = document.getElementById('semesterSelect');
        if (sel && [...sel.options].some(o => o.value === savedSelectedSem)) {
            sel.value = savedSelectedSem;
        }
    }

    // The top bar is sticky; give it a soft shadow once content slides under it.
    const topBar = document.getElementById('topBar');
    const syncTopBarShadow = () => topBar.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', syncTopBarShadow, { passive: true });
    syncTopBarShadow();

    updateUI(false); 
};

function handleGlobalShortcuts(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;

    const t = e.target;
    const tag = t && t.tagName;
    const typing = !!t && (t.isContentEditable || tag === 'TEXTAREA' ||
        (tag === 'INPUT' && !['checkbox', 'button', 'submit', 'reset'].includes(t.type)));
    if (typing) return;

    // e.code as well as e.key: on a Hebrew keyboard layout Ctrl+C reports
    // e.key === 'ב', but e.code is still 'KeyC'.
    const isCopy = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
        (e.code === 'KeyC' || (e.key && e.key.toLowerCase() === 'c'));
    if (isCopy) {
        const selection = window.getSelection ? window.getSelection().toString() : '';
        if (selection) return;   // the person is copying text
        if (!canCopyScheduleImage()) return;
        if (currentSemesterState().courses.length === 0) return;
        e.preventDefault();
        exportToClipboard();
        return;
    }

    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const select = document.getElementById('semesterSelect');
        if (!select || tag === 'SELECT') return;   // a focused <select> already reacts to the arrows itself
        const next = select.selectedIndex + (e.key === 'ArrowLeft' ? 1 : -1);
        if (next < 0 || next >= select.options.length) return;
        e.preventDefault();
        select.selectedIndex = next;
        onSemesterChange();
    }
}
document.addEventListener('keydown', handleGlobalShortcuts);
