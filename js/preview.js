// ============================================================================
// Calendar-preview picker
//
// Instead of choosing a group from a list, show the candidate groups as ghost blocks on the
// calendar and let the person pick one there.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

// =====================================================================
// Calendar-preview picker — "instead of picking from a list, show a
// preview of all the possible hours and how they will look in the
// schedule": rather than (only) the plain list in #searchAddDialog,
// candidate groups for the active type render as clickable ghost blocks
// directly on the real calendar (see getPreviewGhostEntries(),
// createEventElement()'s __isPreviewGhost branch, and renderCalendar()'s
// .preview-mode dimming), with a small non-modal floating bar
// (#previewControlBar) for switching type/marking elective/listing
// groups that have no fixed hours to preview. A plain list is still one
// click away ("תצוגת רשימה") for anyone who prefers it, or for the
// no-fixed-hours case where there's nothing to draw on a calendar.
// =====================================================================
let previewState = null; // { course, type } | null

/** Same semester rule as search (see semesterKeyFromSelect above): a
 * group belongs to the currently-selected semester if it matches
 * exactly, or is annual (spans both א'/ב'). Used everywhere the
 * calendar-preview picker looks at a course's groups, so it never
 * offers/previews a group from a semester the student isn't even
 * looking at. */
function groupMatchesCurrentSemester(g) {
    const key = semesterKeyFromSelect(getCurrentSemester());
    if (!key) return true;
    return g.semester === key || g.semester === 'annual';
}

function getPreviewGhostEntries() {
    if (!previewState) return [];
    const { course, type } = previewState;
    const entries = [];
    getMergedGroups(course)
        .filter((g) => g.type === type && groupMatchesCurrentSemester(g))
        .forEach((g) => {
            g.meetings.forEach((m) => {
                const day = DAY_LETTERS[m.dayOfWeek];
                if (!day) return; // out-of-range dayOfWeek in the data — shouldn't happen
                entries.push({
                    day,
                    classData: {
                        id: g.id,
                        __groupIds: mergedGroupIds(g),
                        name: course.nameHe,
                        type: TYPE_MAP[g.type],
                        lecturerName: g.lecturerName || '',
                        start: formatMinutesToTime(m.startMinutes),
                        end: formatMinutesToTime(m.endMinutes),
                        __isPreviewGhost: true,
                    },
                });
            });
        });
    return entries;
}

function availablePreviewTypes(course) {
    const present = new Set(
        getMergedGroups(course)
            .filter((g) => g.type !== 'other' && groupMatchesCurrentSemester(g))
            .map((g) => g.type),
    );
    return SLOT_ORDER.filter((t) => present.has(t));
}

function isLectureChosen(course) {
    const lectureGroupIds = course.groups
        .filter((g) => g.type === 'lecture' && groupMatchesCurrentSemester(g))
        .map((g) => g.id);
    // No lecture offered this semester — nothing to unlock, so an
    // exercise must not stay locked forever.
    if (lectureGroupIds.length === 0) return true;
    return rawCourses.some((c) => lectureGroupIds.includes(c.courseGroupId));
}

/** Entry point from search selection and from the ✏️ edit button —
 * replaces opening the list dialog directly. `type` is which section to
 * show first (lecture if the course has one, else whatever it does have). */
function startPreview(course, type) {
    currentSearchAddCourse = course;
    previewState = { course, type };
    document.getElementById('searchAddDialog').close();
    renderPreviewBar();
    renderCalendar();
}

function exitPreview() {
    previewState = null;
    const bar = document.getElementById('previewControlBar');
    if (bar) bar.style.display = 'none';
    renderCalendar();
}

function switchPreviewType(type) {
    if (!previewState) return;
    previewState.type = type;
    renderPreviewBar();
    renderCalendar();
}

/** Clicking a ghost block on the calendar. */
function pickPreviewGroup(groupId) {
    toggleGroupInSchedule(groupId); // adds/removes + reruns the solver + re-renders the calendar
    renderPreviewBar();
}

function onPreviewElectiveToggleChange() {
    if (!previewState) return;
    const checked = document.getElementById('previewElectiveToggle').checked;
    const course = previewState.course;
    const groupIds = new Set(course.groups.map((g) => g.id));
    let touchedAny = false;
    rawCourses.forEach((c) => {
        if (groupIds.has(c.courseGroupId)) { c.isElective = checked; touchedAny = true; }
    });
    if (touchedAny) {
        if (checked) activeElectives.add(course.nameHe); else activeElectives.delete(course.nameHe);
        updateUI(true);
    }
}

/** Escape hatch back to the plain list (#searchAddDialog) — e.g. for
 * anyone who just prefers a list, or on a small screen where dragging
 * around the calendar is awkward. */
function showListFromPreview() {
    const course = previewState ? previewState.course : currentSearchAddCourse;
    const fallbackId = manualEditFallbackId;
    exitPreview();
    if (!course) return;
    manualEditFallbackId = fallbackId;
    document.getElementById('searchAddManualEditBtn').style.display = fallbackId ? 'inline-block' : 'none';
    document.getElementById('searchAddDialog').showModal();
    renderSearchAddDialog(course);
}

/** The "+" button on a calendar box / course-list row: reopens the same
 * calendar-preview bar search gives you (startPreview), scoped to this
 * course, so the student can add a part of the course they don't have
 * yet (or another alternative) without going back through search.
 * Prefers a type the course has nothing added in yet — that's the whole
 * point of "add other parts" — falling back to the clicked box's own
 * type (so it still opens something sensible) if every type already has
 * something added. */
async function openAddMoreForCourse(id) {
    const c = rawCourses.find((x) => x.id === id);
    if (!c) return;
    const courseId = extractCourseIdFromGroupId(c.courseGroupId);
    if (!courseId) return; // manual/pasted entry — no catalog to add more from
    manualEditFallbackId = id;
    try {
        const course = await fetchCourseDetail(courseId);
        const types = availablePreviewTypes(course);
        const addedTypes = new Set(
            rawCourses.filter((rc) => rc.name === course.nameHe).map((rc) => TYPE_MAP_REVERSE[rc.type]),
        );
        const missingType = types.find((t) => !addedTypes.has(t));
        const clickedType = TYPE_MAP_REVERSE[c.type];
        const initialType = missingType || (types.includes(clickedType) ? clickedType : types[0] || 'lecture');
        startPreview(course, initialType);
    } catch (err) {
        alert('שגיאה בטעינת הקורס.');
        console.error(err);
    }
}

/** "הוסף הכל" in the preview bar — adds every group of this course, in
 * the currently-selected semester, across every type, that isn't already
 * in the schedule. There's no cap on how many groups of a type may be
 * chosen (see toggleGroupInSchedule()), so this is safe: it just gives
 * the solver every alternative to pick from, one at a time, per type. */
function addAllGroupsForCourse() {
    if (!previewState) return;
    const course = previewState.course;
    currentSearchAddCourse = course;
    const toAdd = getMergedGroups(course).filter(
        (g) => g.type !== 'other' && groupMatchesCurrentSemester(g) && !isGroupAdded(g),
    );
    if (toAdd.length === 0) return;
    toAdd.forEach((g) => toggleGroupInSchedule(g.id, /* silent */ true));
    updateUI(true);
    renderPreviewBar();
}

/** The button's other face once everything is already added — "הוסף הכל"
 * turns into "הסר הכל" (see the button markup in renderPreviewBar()) so
 * one click can undo an "add all" just as easily as it applied one. */
function removeAllGroupsForCourse() {
    if (!previewState) return;
    const course = previewState.course;
    currentSearchAddCourse = course;
    const toRemove = getMergedGroups(course).filter(
        (g) => g.type !== 'other' && groupMatchesCurrentSemester(g) && isGroupAdded(g),
    );
    if (toRemove.length === 0) return;
    toRemove.forEach((g) => toggleGroupInSchedule(g.id, /* silent */ true));
    updateUI(true);
    renderPreviewBar();
}

function renderPreviewBar() {
    if (!previewState) return;
    const bar = document.getElementById('previewControlBar');
    if (!bar) return;
    const { course, type } = previewState;
    bar.style.display = 'block';

    const lectureChosen = isLectureChosen(course);
    const types = availablePreviewTypes(course);
    const tabsHtml = types.map((t) => {
        const locked = t === 'exercise' && !lectureChosen && !allowExerciseWithoutLecture;
        const active = t === type;
        return `<button class="btn-simple" style="padding:6px 10px; font-size:12px;${active ? ' background:var(--primary); color:white; border-color:var(--primary);' : ''}"
                ${locked ? 'disabled title="בחרו הרצאה תחילה"' : ''} onclick="switchPreviewType('${t}')">${TYPE_LABELS_HE[t]}</button>`;
    }).join('');

    // "for courses that do not have a fixed hour, allow the user to
    // choose them from a list" — groups of the active type with no
    // meetings at all can't be drawn as a calendar ghost, so they get a
    // small plain list here instead.
    const noHourGroups = getMergedGroups(course).filter(
        (g) => g.type === type && g.meetings.length === 0 && groupMatchesCurrentSemester(g),
    );
    const noHourHtml = noHourGroups.length ? `
            <div style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">
                <p style="font-size:12px; color:var(--text-muted); margin:0 0 6px;">קבוצות ללא שעות קבועות:</p>
                ${noHourGroups.map((g) => {
                    const added = isGroupAdded(g);
                    return `<div class="group-row ${added ? 'added' : ''}" style="margin-bottom:4px;">
                        <div><strong>קבוצה ${escapeHtml(g.groupCode)}</strong> — ${escapeHtml(g.lecturerName || '')}</div>
                        <button class="btn-simple" style="padding:4px 10px; font-size:12px;" onclick="pickPreviewGroup(${jsArg(g.id)})">${added ? 'הסרה' : 'הוספה'}</button>
                    </div>`;
                }).join('')}
            </div>` : '';

    // "הוסף הכל" / "הסר הכל" — the same button flips between adding
    // everything left to add and removing everything once there's
    // nothing left TO add (i.e. every group of this course, this
    // semester, is already in the schedule).
    const allSemesterGroups = getMergedGroups(course).filter((g) => g.type !== 'other' && groupMatchesCurrentSemester(g));
    const allAdded = allSemesterGroups.length > 0 && allSemesterGroups.every(isGroupAdded);
    const addAllBtnHtml = allSemesterGroups.length === 0
        ? `<button class="btn-simple" style="padding:6px 10px; font-size:12px;" disabled title="לקורס זה אין קבוצות בסמסטר הנוכחי">הוסף הכל</button>`
        : allAdded
            ? `<button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="removeAllGroupsForCourse()" title="הסר את כל הקבוצות של הקורס בסמסטר הנוכחי">הסר הכל</button>`
            : `<button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="addAllGroupsForCourse()" title="הוסף את כל הקבוצות של הקורס בסמסטר הנוכחי (הרצאה, תרגיל, מעבדה וכו')">הוסף הכל</button>`;

    bar.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                <div>
                    <strong>${escapeHtml(course.nameHe)}</strong>
                    <span style="font-size:12px; color:var(--text-muted);"> · ${escapeHtml(course.courseCode)} · ${Number.isInteger(course.credits) ? course.credits : parseFloat(course.credits.toFixed(1))} נ"ז</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <label class="toggle-label" style="font-size:12px;">
                        <div class="switch">
                            <input type="checkbox" id="previewElectiveToggle" onchange="onPreviewElectiveToggleChange()">
                            <span class="slider"></span>
                        </div>
                        בחירה
                    </label>
                    ${manualEditFallbackId ? '<button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="openManualEditFromSearch()">עריכה ידנית</button>' : ''}
                    ${addAllBtnHtml}
                    <button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="showListFromPreview()">תצוגת רשימה</button>
                    <button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="exitPreview()">סיום</button>
                </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">${tabsHtml}</div>
            ${noHourHtml}
            ${types.length === 0
                ? `<p style="font-size:12px; color:var(--danger); margin:8px 0 0;">לקורס זה אין קבוצות בסמסטר ${getCurrentSemester()}. החליפו סמסטר כדי לבחור ממנו קבוצות.</p>`
                : '<p style="font-size:12px; color:var(--text-muted); margin:8px 0 0;">לחצו על אחת האפשרויות המסומנות בלוח (המקווקוות) כדי לבחור אותה. ניתן לבחור כמה אפשרויות מאותו הסוג — במערכת תוצג אחת מהן בכל פעם.</p>'}
        `;

    const groupIds = new Set(course.groups.map((g) => g.id));
    document.getElementById('previewElectiveToggle').checked =
        rawCourses.some((c) => groupIds.has(c.courseGroupId) && c.isElective);
}

/** Everything that offers groups to add is semester-scoped (the search
 * dropdown, the list dialog, the calendar-preview bar). None of them used
 * to be re-rendered when the semester picker changed, so a picker opened
 * in one semester kept offering that semester's groups — and adding one
 * put a course in a semester it doesn't belong to. Called on every
 * semester change, for whichever of them happens to be open. */
function refreshCoursePickers() {
    const dropdown = document.getElementById('searchResultsDropdown');
    if (dropdown && dropdown.style.display !== 'none') onSearchInput();

    const listDialog = document.getElementById('searchAddDialog');
    if (listDialog && listDialog.open && currentSearchAddCourse) renderSearchAddDialog(currentSearchAddCourse);

    if (previewState) {
        // The type being previewed may not even exist in the new semester.
        const types = availablePreviewTypes(previewState.course);
        if (types.length > 0 && !types.includes(previewState.type)) previewState.type = types[0];
        renderPreviewBar();
    }
}
