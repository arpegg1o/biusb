// ============================================================================
// Saved schedules
//
// Named saved schedules: storage and migration, snapshots, save / load / rename / delete,
// and the saved-schedules panel.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

// =====================================================================
// Saved schedules
//
// A saved schedule is a named snapshot of ONE semester's schedule: that
// semester's courses (rawCourses entries — which also carry each course's
// elective flag and colour; annual "שנתי" courses count for every
// semester they run in), which of those electives are switched on
// (activeElectives), and which alternative you were viewing
// (semesterIndices[sem]). Every semester has its own, completely
// separate list: the panel above the credit line shows only the saves
// of the semester selected in the picker, and loading one only replaces
// that semester's courses — the other semesters are left alone.
//
// Saves live in localStorage. A card gets a frame only while what's on
// screen is EXACTLY that save — same courses, same electives, same
// alternative number. Change anything (or browse to another
// alternative) and no card is framed; get back to the exact same state,
// or press save, and its frame is back. There is deliberately no
// "modified" marker of any kind.
//
// Behind the scenes the page also remembers, per semester, which save
// the working state was last loaded from / saved into
// (activeSavedScheduleIds) — only so that saving into it doesn't need a
// confirmation and the "unsaved changes" prompt can name it.
// =====================================================================
const SAVED_SCHEDULES_KEY = 'mySavedSchedules';
const ACTIVE_SAVED_SCHEDULES_KEY = 'myActiveSavedScheduleIds';   // { semester: saveId }
const LEGACY_ACTIVE_SAVED_SCHEDULE_KEY = 'myActiveSavedScheduleId'; // single id, from when saves covered every semester
const SAVED_SCHEDULE_SEMESTERS = ["א'", "ב'", "קיץ"];
let savedSchedules = [];           // [{ id, semester, name, savedAt, rawCourses, activeElectives, scheduleIndex }]
let activeSavedScheduleIds = {};   // per semester
let renamingSavedScheduleId = null;

const saveIconSVG = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
const trashIconSVG = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

// Does this course show up in that semester's calendar?
function belongsToSemester(course, semester) {
    return course.semester === semester || course.semester === "שנתי";
}

// The first version of this feature saved every semester in one snapshot.
// Split those into one save per semester that actually has courses, so
// nothing anyone already saved is lost.
function migrateLegacySavedSchedules(list) {
    const out = [];
    let changed = false;
    list.forEach(s => {
        if (s.semester) { out.push(s); return; }
        changed = true;
        const indices = s.semesterIndices || {};
        let semesters = SAVED_SCHEDULE_SEMESTERS.filter(sem => s.rawCourses.some(c => c.semester === sem));
        if (semesters.length === 0 && s.rawCourses.length > 0) semesters = ["א'"];  // only annual courses
        semesters.forEach((sem, i) => {
            const courses = s.rawCourses.filter(c => belongsToSemester(c, sem));
            const names = new Set(courses.map(c => c.name));
            out.push({
                id: i === 0 ? s.id : `${s.id}_${i}`,
                semester: sem,
                name: s.name,
                savedAt: s.savedAt,
                rawCourses: courses,
                activeElectives: (s.activeElectives || []).filter(n => names.has(n)),
                scheduleIndex: indices[sem] || 0
            });
        });
    });
    return { list: out, changed };
}

function loadSavedSchedulesFromStorage() {
    let list = [];
    try {
        const raw = localStorage.getItem(SAVED_SCHEDULES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        list = Array.isArray(parsed)
            ? parsed.filter(s => s && s.id && typeof s.name === 'string' && Array.isArray(s.rawCourses))
            : [];
    } catch (err) {
        console.error('Failed to parse saved schedules — starting with none.', err);
    }
    const migrated = migrateLegacySavedSchedules(list);
    savedSchedules = migrated.list;

    try {
        const parsedActive = JSON.parse(localStorage.getItem(ACTIVE_SAVED_SCHEDULES_KEY) || '{}');
        activeSavedScheduleIds = (parsedActive && typeof parsedActive === 'object') ? parsedActive : {};
    } catch (err) {
        activeSavedScheduleIds = {};
    }
    const legacyActiveId = localStorage.getItem(LEGACY_ACTIVE_SAVED_SCHEDULE_KEY);
    if (legacyActiveId) {
        const entry = savedSchedules.find(s => s.id === legacyActiveId);
        if (entry && !activeSavedScheduleIds[entry.semester]) activeSavedScheduleIds[entry.semester] = entry.id;
    }
    Object.keys(activeSavedScheduleIds).forEach(sem => {
        if (!savedSchedules.some(s => s.id === activeSavedScheduleIds[sem] && s.semester === sem)) delete activeSavedScheduleIds[sem];
    });

    if (migrated.changed || legacyActiveId !== null) persistSavedSchedules();
}

function persistSavedSchedules() {
    try {
        localStorage.setItem(SAVED_SCHEDULES_KEY, JSON.stringify(savedSchedules));
        localStorage.setItem(ACTIVE_SAVED_SCHEDULES_KEY, JSON.stringify(activeSavedScheduleIds));
        localStorage.removeItem(LEGACY_ACTIVE_SAVED_SCHEDULE_KEY);
        return true;
    } catch (err) {
        console.error('Failed to persist saved schedules.', err);
        alert("לא ניתן לשמור במערכת השמורות — ייתכן שהאחסון בדפדפן מלא.");
        return false;
    }
}

// --- the selected semester's slice of the working state ---
function currentSemesterState() {
    const semester = getCurrentSemester();
    const courses = rawCourses.filter(c => belongsToSemester(c, semester));
    const names = new Set(courses.map(c => c.name));
    return {
        semester,
        courses,
        electives: Array.from(activeElectives).filter(n => names.has(n)),
        index: semesterIndices[semester] || 0
    };
}

function snapshotCurrentSchedule() {
    const st = currentSemesterState();
    return {
        semester: st.semester,
        rawCourses: JSON.parse(JSON.stringify(st.courses)),
        activeElectives: st.electives,
        scheduleIndex: st.index
    };
}

// `content` = courses + electives (what "unsaved work" means);
// `full` also includes which alternative is on screen (what gets a card framed).
function scheduleSignatures(courses, electives, index) {
    const sorted = courses.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const content = JSON.stringify([sorted, Array.from(electives).sort()]);
    return { content, full: content + '#' + (index || 0) };
}
function currentSignatures() {
    const st = currentSemesterState();
    return scheduleSignatures(st.courses, st.electives, st.index);
}
function savedSignatures(saved) {
    return scheduleSignatures(saved.rawCourses, saved.activeElectives || [], saved.scheduleIndex);
}

function getSavedSchedulesForCurrentSemester() {
    const semester = getCurrentSemester();
    return savedSchedules.filter(s => s.semester === semester);
}
function getActiveSavedScheduleId() { return activeSavedScheduleIds[getCurrentSemester()] || null; }
function setActiveSavedScheduleId(id) {
    const semester = getCurrentSemester();
    if (id) activeSavedScheduleIds[semester] = id; else delete activeSavedScheduleIds[semester];
}
function getActiveSavedSchedule() {
    const id = getActiveSavedScheduleId();
    return getSavedSchedulesForCurrentSemester().find(s => s.id === id) || null;
}

// True when replacing this semester's courses would lose something
// that isn't stored in a save yet.
function hasUnsavedWork() {
    if (currentSemesterState().courses.length === 0) return false;
    const cur = currentSignatures().content;
    return !getSavedSchedulesForCurrentSemester().some(s => savedSignatures(s).content === cur);
}

// The working state was replaced wholesale (clear all / import) — it's no
// longer "the same schedule" as anything that was loaded before.
function detachFromSavedSchedule() {
    if (Object.keys(activeSavedScheduleIds).length === 0) return;
    activeSavedScheduleIds = {};
    persistSavedSchedules();
}

// "טיוטה 1", "טיוטה 2", … — the first number not already taken in this
// semester. New saves go straight into rename mode, so this is only a
// starting point.
function nextDefaultScheduleName() {
    const used = new Set(getSavedSchedulesForCurrentSemester().map(s => s.name));
    let n = 1;
    while (used.has(`טיוטה ${n}`)) n++;
    return `טיוטה ${n}`;
}

function describeSavedSchedule(saved) {
    const courseNames = new Set(saved.rawCourses.map(c => c.name));
    const electiveNames = new Set(saved.rawCourses.filter(c => c.isElective).map(c => c.name));
    const enabled = new Set(saved.activeElectives || []);
    const enabledCount = [...electiveNames].filter(n => enabled.has(n)).length;

    let text = courseNames.size === 1 ? 'קורס אחד' : `${courseNames.size} קורסים`;
    if (electiveNames.size > 0) text += ` · בחירה: ${enabledCount}/${electiveNames.size}`;
    return text;
}

function saveCurrentAsNewSchedule() {
    if (currentSemesterState().courses.length === 0) return alert("המערכת ריקה בסמסטר זה — הוסיפו קורסים לפני השמירה.");

    const entry = {
        id: 'ss_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: nextDefaultScheduleName(),
        savedAt: Date.now(),
        ...snapshotCurrentSchedule()
    };
    savedSchedules.push(entry);
    setActiveSavedScheduleId(entry.id);
    renamingSavedScheduleId = entry.id;  // straight into naming it
    persistSavedSchedules();
    renderSavedSchedules();
}

// Overwrite a save with what's on screen right now.
function overwriteSavedSchedule(id) {
    const saved = savedSchedules.find(s => s.id === id);
    if (!saved) return;
    if (currentSemesterState().courses.length === 0) return alert("המערכת ריקה בסמסטר זה — אין מה לשמור.");
    // Saving into the schedule you're working on is the normal "save"; only
    // overwriting a *different* one deserves a confirmation.
    if (id !== getActiveSavedScheduleId() && !confirm(`לדרוס את "${saved.name}" במערכת שמוצגת עכשיו?`)) return;

    Object.assign(saved, snapshotCurrentSchedule(), { savedAt: Date.now() });
    setActiveSavedScheduleId(id);
    persistSavedSchedules();
    renderSavedSchedules();
    showToast(`"${saved.name}" נשמרה ✓`);
}

function loadSavedSchedule(id) {
    const saved = savedSchedules.find(s => s.id === id);
    if (!saved || saved.semester !== getCurrentSemester()) return;
    const semester = saved.semester;

    // Already showing exactly this one.
    if (currentSignatures().full === savedSignatures(saved).full) {
        setActiveSavedScheduleId(id);
        persistSavedSchedules();
        renderSavedSchedules();
        return;
    }

    if (hasUnsavedWork()) {
        const active = getActiveSavedSchedule();
        const where = active ? `ב"${active.name}"` : 'במערכת הנוכחית';
        if (!confirm(`יש שינויים שלא נשמרו ${where}.\nלטעון את "${saved.name}" בכל זאת?`)) return;
    }

    saveState(true);  // keeps what was on screen in the undo history

    // Swap in only this semester's courses; every other semester stays put.
    const oldNames = new Set(rawCourses.filter(c => belongsToSemester(c, semester)).map(c => c.name));
    const keptCourses = rawCourses.filter(c => !belongsToSemester(c, semester));
    const keptNames = new Set(keptCourses.map(c => c.name));
    const savedCourses = JSON.parse(JSON.stringify(saved.rawCourses));
    const savedNames = new Set(savedCourses.map(c => c.name));
    const savedActive = new Set(saved.activeElectives || []);

    rawCourses = keptCourses.concat(savedCourses);
    // Electives are tracked by course name, so only touch the names that
    // belong to this semester's courses (before or after the swap).
    oldNames.forEach(n => { if (!savedNames.has(n) && !keptNames.has(n)) activeElectives.delete(n); });
    savedNames.forEach(n => {
        if (savedActive.has(n)) activeElectives.add(n);
        else if (!keptNames.has(n)) activeElectives.delete(n);
    });
    semesterIndices[semester] = saved.scheduleIndex || 0;
    delete semesterChoices[semester];

    setActiveSavedScheduleId(id);
    activeAlternativeKey = null;
    pendingAlternativeJump = null;

    saveState(false);          // persist the loaded state so a reload keeps it
    persistSavedSchedules();   // ...and which save it came from
    refreshCoursePickers();    // an open search/preview shows "already added" state
    // Same as opening the page fresh: honour the saved alternative
    // number instead of hunting for the closest match to the previous
    // schedule (see importData()).
    hasComputedOnce = false;
    updateUI(false);
}

function startRenameSavedSchedule(id) {
    renamingSavedScheduleId = id;
    renderSavedSchedules();
}

function commitRenameSavedSchedule(id, value) {
    // Guard: re-rendering removes the input, which fires its blur handler
    // again — by then renamingSavedScheduleId is already cleared.
    if (renamingSavedScheduleId !== id) return;
    renamingSavedScheduleId = null;

    const saved = savedSchedules.find(s => s.id === id);
    const name = (value || '').trim().slice(0, 40);
    if (saved && name && name !== saved.name) {
        saved.name = name;
        persistSavedSchedules();
    }
    renderSavedSchedules();
}

function cancelRenameSavedSchedule() {
    renamingSavedScheduleId = null;
    renderSavedSchedules();
}

function deleteSavedSchedule(id) {
    const saved = savedSchedules.find(s => s.id === id);
    if (!saved) return;
    if (!confirm(`למחוק את המערכת השמורה "${saved.name}"?`)) return;

    savedSchedules = savedSchedules.filter(s => s.id !== id);
    if (activeSavedScheduleIds[saved.semester] === id) delete activeSavedScheduleIds[saved.semester];
    if (renamingSavedScheduleId === id) renamingSavedScheduleId = null;
    persistSavedSchedules();
    renderSavedSchedules();
}

function renderSavedSchedules() {
    const listEl = document.getElementById('savedSchedulesList');
    const titleEl = document.getElementById('savedSchedulesTitle');
    if (!listEl) return;

    // Don't yank the name field out from under someone who's typing in it
    // (this gets called after every solver run and alternative change).
    const focused = document.activeElement;
    if (renamingSavedScheduleId && focused && focused.classList && focused.classList.contains('saved-schedule-rename-input')) return;

    const semester = getCurrentSemester();
    const semesterLabel = semester === 'קיץ' ? 'קיץ' : `סמסטר ${semester}`;
    const visible = getSavedSchedulesForCurrentSemester();
    // A rename that was open in another semester is void.
    if (renamingSavedScheduleId && !visible.some(s => s.id === renamingSavedScheduleId)) renamingSavedScheduleId = null;

    listEl.innerHTML = '';
    if (titleEl) titleEl.textContent = `מערכות שמורות · ${semesterLabel}`;

    // Names are user-typed, so everything below goes in via textContent /
    // DOM properties rather than innerHTML.
    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const makeIconButton = (svg, title, onClick) => {
        const btn = make('button', 'icon-btn');
        btn.innerHTML = svg;   // constant, trusted markup
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.onclick = onClick;
        return btn;
    };

    if (visible.length === 0) {
        listEl.appendChild(make('div', 'saved-schedules-empty',
            `עדיין אין מערכות שמורות ל${semesterLabel}. לחצו על "שמור מערכת נוכחית" כדי לשמור את הקורסים, קורסי הבחירה שנבחרו והמערכת שמוצגת — לכל סמסטר יש רשימה משלו.`));
        return;
    }

    const currentFull = currentSignatures().full;
    const activeId = getActiveSavedScheduleId();

    visible.forEach(saved => {
        // Framed only while what's on screen is exactly this save.
        const isExact = currentFull === savedSignatures(saved).full;

        const card = make('div', 'saved-schedule-card' + (isExact ? ' active' : ''));

        if (saved.id === renamingSavedScheduleId) {
            const input = make('input', 'saved-schedule-rename-input');
            input.type = 'text';
            input.value = saved.name;
            input.maxLength = 40;
            input.setAttribute('aria-label', 'שם המערכת');
            input.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRenameSavedSchedule(saved.id, input.value); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelRenameSavedSchedule(); }
            };
            input.onblur = () => commitRenameSavedSchedule(saved.id, input.value);
            card.appendChild(input);
            listEl.appendChild(card);
            // Has to happen once the input is in the document.
            input.focus();
            input.select();
            return;
        }

        const main = make('button', 'saved-schedule-main');
        main.title = 'טען מערכת זו';
        main.appendChild(make('span', 'saved-schedule-name', saved.name));
        main.appendChild(make('span', 'saved-schedule-meta', describeSavedSchedule(saved)));
        main.onclick = () => loadSavedSchedule(saved.id);
        card.appendChild(main);

        const actions = make('div', 'saved-schedule-actions');
        actions.appendChild(makeIconButton(saveIconSVG,
            saved.id === activeId ? 'שמור את המערכת הנוכחית כאן' : 'שמור את המערכת הנוכחית במקום מערכת זו',
            () => overwriteSavedSchedule(saved.id)));
        actions.appendChild(makeIconButton(editIconSVG, 'שנה שם', () => startRenameSavedSchedule(saved.id)));
        actions.appendChild(makeIconButton(trashIconSVG, 'מחק', () => deleteSavedSchedule(saved.id)));
        card.appendChild(actions);

        listEl.appendChild(card);
    });
}
