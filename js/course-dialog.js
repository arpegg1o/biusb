// ============================================================================
// Course dialog (list view)
//
// The "add course" dialog listing a course's groups by semester, and adding/removing
// groups or whole courses from the schedule.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

let currentSearchAddCourse = null; // set by renderSearchAddDialog, read by toggleGroupInSchedule

function renderSearchAddDialog(course) {
    currentSearchAddCourse = course;
    document.getElementById('searchAddTitle').innerText = course.nameHe;
    const creditsDisplay = Number.isInteger(course.credits) ? course.credits : parseFloat(course.credits.toFixed(1));
    // Meta line: code · credits, then optional faculty / English name and syllabus link.
    // Catalog strings go through innerHTML, so escape them first.
    let metaHtml = `${course.courseCode} · ${creditsDisplay} נ"ז`;
    if (course.facultyNameHe) metaHtml += ` · ${escapeHtml(course.facultyNameHe)}`;
    if (course.englishName) metaHtml += ` · ${escapeHtml(course.englishName)}`;
    if (course.syllabus) {
        metaHtml += ` <a href="https://courses.biu.ac.il/${course.syllabus}" target="_blank" rel="noopener" style="font-size:12px; color:var(--primary); text-decoration:none; margin-right:8px;">סילבוס קורס ↗</a>`;
    }
    document.getElementById('searchAddMeta').innerHTML = metaHtml;
    document.getElementById('searchAddManualEditBtn').style.display = manualEditFallbackId ? 'inline-block' : 'none';

    // Reflect this course's ACTUAL current elective state (electives are
    // per-course, not per-group — see updateUI()'s name-level normalization)
    // rather than always resetting to unchecked, so re-opening an
    // already-added course shows the truth instead of a stale default.
    const groupIds = new Set(course.groups.map((g) => g.id));
    const isCurrentlyElective = rawCourses.some((c) => groupIds.has(c.courseGroupId) && c.isElective);
    document.getElementById('searchAddElectiveToggle').checked = isCurrentlyElective;

    const container = document.getElementById('searchAddGroups');
    container.innerHTML = renderGroupsBySemester(course)
        || '<p style="color:var(--text-muted); font-size:13px;">אין קבוצות זמינות לקורס זה.</p>';

    // searchAddExams (read-only) is intentionally left empty here;
    // renderExamsEditSection below shows the same data with edit controls,
    // so there's no need for a separate read-only heading that would
    // duplicate the שוהם link and the exam rows.
    // renderExamsEditSection resolves per-semester exam / shoam data internally.
    document.getElementById('searchAddExams').innerHTML = '';
    renderExamsEditSection(course);
}

// Real semester keys first (SEMESTER_MAP order), "annual" last since it
// isn't really "a semester" of its own — it spans both א'/ב'.
const SEMESTER_LIST_ORDER = ['a', 'b', 'summer', 'annual'];

/** The list view (#searchAddDialog) shows EVERY semester the course is
 * offered in at once, each clearly labeled and with its own "הוסף הכל" —
 * unlike the calendar-preview picker (and its own "הוסף הכל", see
 * addAllGroupsForCourse()), which only ever deals with the currently
 * selected semester. Selecting/removing a group here is therefore always
 * allowed regardless of which semester is currently active (see the
 * `true` passed to toggleGroupInSchedule() below). */
function renderGroupsBySemester(course) {
    const bySemester = {};
    for (const g of getMergedGroups(course)) {
        if (g.type === 'other') continue; // never offered, matches CourseDetailPanel
        (bySemester[g.semester] = bySemester[g.semester] || []).push(g);
    }

    return SEMESTER_LIST_ORDER.filter((sem) => bySemester[sem] && bySemester[sem].length).map((sem) => {
        const groupsByType = {};
        bySemester[sem].forEach((g) => { (groupsByType[g.type] = groupsByType[g.type] || []).push(g); });

        // "Lecture chosen" is evaluated per semester section, not just
        // for whichever semester happens to be selected in the header —
        // otherwise an exercise here could look permanently locked (or
        // wrongly unlocked) while looking at a semester that isn't active.
        const lectureGroupIds = (groupsByType.lecture || []).map((g) => g.id);
        const lectureChosen = lectureGroupIds.length === 0
            || rawCourses.some((c) => lectureGroupIds.includes(c.courseGroupId));

        const typeSections = SLOT_ORDER.filter((t) => groupsByType[t]).map((type) => {
            const locked = type === 'exercise' && !lectureChosen && !allowExerciseWithoutLecture;
            const rows = groupsByType[type].map((g) => {
                const added = isGroupAdded(g);
                const times = g.meetings
                    .filter((m) => DAY_LETTERS[m.dayOfWeek])
                    .map((m) => `יום ${DAY_LETTERS[m.dayOfWeek]}' ${formatMinutesToTime(m.startMinutes)}-${formatMinutesToTime(m.endMinutes)}`)
                    .join(', ');
                // Cluster chips next to the group code; remark under the time string.
                const clusterBadges = Array.isArray(g.clusters) && g.clusters.length
                    ? ' ' + g.clusters.map((c) => `<span class="cluster-badge">${escapeHtml(c)}</span>`).join(' ')
                    : '';
                const remarkHtml = g.remark
                    ? `<div class="group-remark">⚠️ ${escapeHtml(g.remark)}</div>`
                    : '';
                // External links — one שוהם / סילבוס pair per distinct source group.
                // When a merged row has several, each is tagged with its group code
                // and carries the lecturer's name as a tooltip.
                const links = g.links || [];
                const multi = links.length > 1;
                const linksHtml = links.map((l) => {
                    const tag = multi && l.groupCode ? ` (${escapeHtml(l.groupCode)})` : '';
                    const title = multi && l.lecturerName ? ` title="${escapeHtml(l.lecturerName)}"` : '';
                    const shoam = l.shoamId
                        ? `<a class="group-link"${title} href="https://courses.biu.ac.il/CourseDetails.aspx?lid=${l.shoamId}" target="_blank" rel="noopener">שוהם${tag} ↗</a>`
                        : '';
                    const syl = l.syllabus
                        ? `<a class="group-link"${title} href="https://courses.biu.ac.il/${l.syllabus}" target="_blank" rel="noopener">סילבוס${tag} ↗</a>`
                        : '';
                    return shoam + syl;
                }).join('');
                const linksBlock = linksHtml ? `<span class="group-links">${linksHtml}</span>` : '';
                return `
                        <div class="group-row ${added ? 'added' : ''}">
                            <div class="group-row-info">
                                <div><strong>קבוצה ${g.groupCode}</strong>${clusterBadges} — ${g.lecturerName || ''}</div>
                                <div style="color:var(--text-muted); font-size:12px;" dir="ltr">${times || '(ללא שעות)'}</div>
                                ${remarkHtml}
                                ${linksBlock}
                            </div>
                            <button class="btn-simple group-toggle-btn" style="padding:6px 12px; font-size:13px;"
                                    onclick="toggleGroupInSchedule('${g.id}', false, true)">
                                ${added ? 'הסרה' : 'הוספה'}
                            </button>
                        </div>`;
            }).join('');
            return `
                    <div class="group-section ${locked ? 'group-locked' : ''}">
                        <h4>${TYPE_LABELS_HE[type]}${locked ? ' — בחרו הרצאה תחילה' : ''}</h4>
                        ${rows}
                    </div>`;
        }).join('');

        // "הוסף הכל" / "הסר הכל" for this semester section — flips to
        // "remove" once every group of this course, in this semester, is
        // already added (nothing left for "add all" to do).
        const allSemGroups = bySemester[sem];
        const allSemAdded = allSemGroups.every(isGroupAdded);
        const addAllBtnHtml = allSemAdded
            ? `<button class="btn-simple" style="padding:5px 10px; font-size:12px;"
                        onclick="removeAllGroupsForCourseInSemester('${sem}')"
                        title="הסר את כל הקבוצות של הקורס בסמסטר ${SEMESTER_MAP[sem] || sem}">הסר הכל</button>`
            : `<button class="btn-simple" style="padding:5px 10px; font-size:12px;"
                        onclick="addAllGroupsForCourseInSemester('${sem}')"
                        title="הוסף את כל הקבוצות של הקורס בסמסטר ${SEMESTER_MAP[sem] || sem}">הוסף הכל</button>`;

        return `
                <div class="semester-section">
                    <div class="semester-section-header">
                        <h3>${SEMESTER_MAP[sem] || sem}</h3>
                        ${addAllBtnHtml}
                    </div>
                    ${typeSections}
                </div>`;
    }).join('');
}

/** The list view's per-semester "הוסף הכל" — adds every group of the
 * course in THIS semester specifically, whichever semester that is,
 * regardless of what's currently selected in the header. Distinct from
 * addAllGroupsForCourse() (the calendar-preview bar's "הוסף הכל"), which
 * only ever touches the currently-selected semester. */
function addAllGroupsForCourseInSemester(semesterKey) {
    const course = currentSearchAddCourse;
    if (!course) return;
    const toAdd = getMergedGroups(course).filter(
        (g) => g.type !== 'other' && g.semester === semesterKey && !isGroupAdded(g),
    );
    if (toAdd.length === 0) return;
    toAdd.forEach((g) => toggleGroupInSchedule(g.id, /* silent */ true, /* allowAnySemester */ true));
    updateUI(true);
    renderSearchAddDialog(course);
}

/** The button's other face once every group in this semester is already
 * added — "הוסף הכל" turns into "הסר הכל" so one click undoes it. */
function removeAllGroupsForCourseInSemester(semesterKey) {
    const course = currentSearchAddCourse;
    if (!course) return;
    const toRemove = getMergedGroups(course).filter(
        (g) => g.type !== 'other' && g.semester === semesterKey && isGroupAdded(g),
    );
    if (toRemove.length === 0) return;
    toRemove.forEach((g) => toggleGroupInSchedule(g.id, /* silent */ true, /* allowAnySemester */ true));
    updateUI(true);
    renderSearchAddDialog(course);
}


// Fixes a real bug: toggling "סמן קורס זה כבחירה" used to only affect
// groups added AFTER the toggle — flipping it for an already-added
// course silently did nothing until you removed and re-added every
// group by hand. Electives are tracked per COURSE NAME (see updateUI()'s
// nameStatusMap), so this updates every rawCourses entry belonging to
// this course immediately, whether or not it was just now added.
function onSearchAddElectiveToggleChange() {
    const course = currentSearchAddCourse;
    if (!course) return;
    const checked = document.getElementById('searchAddElectiveToggle').checked;
    const groupIds = new Set(course.groups.map((g) => g.id));
    let touchedAny = false;

    rawCourses.forEach((c) => {
        if (groupIds.has(c.courseGroupId)) {
            c.isElective = checked;
            touchedAny = true;
        }
    });

    if (touchedAny) {
        if (checked) activeElectives.add(course.nameHe); else activeElectives.delete(course.nameHe);
        updateUI(true);
    }
    // If nothing's added yet, there's nothing to update — the checked
    // state is simply read at add-time by toggleGroupInSchedule() below.
}

/** `silent`: skip updateUI() and re-rendering the open picker — for
 * callers (addAllGroupsForCourse(), addAllGroupsForCourseInSemester())
 * that add several groups in a row and want exactly one solver run /
 * re-render at the end, not one per group.
 * `allowAnySemester`: skip the "belt and braces" current-semester guard
 * below — used by the list view (#searchAddDialog), which now shows and
 * intentionally lets you add groups from every semester at once, not
 * just whichever one is currently selected in the header. */
function toggleGroupInSchedule(groupId, silent = false, allowAnySemester = false) {
    const course = currentSearchAddCourse;
    const group = course && findMergedGroup(course, groupId);
    if (!group) return;
    const courseName = course.nameHe;
    const ids = mergedGroupIds(group);

    if (isGroupAdded(group)) {
        // Inlined rather than calling deleteCourseGroup() directly — that
        // function also calls updateUI() itself, which would run the
        // (somewhat expensive) schedule-solver worker twice for one click.
        rawCourses = rawCourses.filter((c) => !ids.includes(c.courseGroupId || c.id));
    } else {
        // Belt and braces for the semester bug fixed in refreshCoursePickers():
        // the calendar-preview picker no longer OFFERS a group from another
        // semester, so this should be unreachable there — but never silently
        // add one by accident if it somehow is. The list view deliberately
        // bypasses this (allowAnySemester) since it offers every semester on
        // purpose.
        if (!allowAnySemester && !groupMatchesCurrentSemester(group)) {
            alert('קבוצה זו אינה מתקיימת בסמסטר הנבחר.');
            return;
        }

        const isElective = currentElectiveIntent();
        const type = TYPE_MAP[group.type];
        const semester = SEMESTER_MAP[group.semester] || "א'";
        let addedAny = false;

        if (group.meetings.length === 0) {
            // Timeless group — no scheduled hours. Add a single placeholder
            // entry so the solver still satisfies this slot (it can't
            // conflict with anything) and the course appears in the
            // timeless strip below the calendar.
            const isDup = rawCourses.some((c) =>
                (c.courseGroupId || c.id) === group.id && c.timeless);
            if (!isDup) {
                rawCourses.push({
                    id: Date.now() + Math.random().toString(36).substring(2, 8),
                    courseGroupId: group.id,
                    name: courseName, type, semester,
                    day: null, start: null, end: null,
                    timeless: true,
                    isElective, color: null,
                });
                addedAny = true;
            }
        } else {
            for (const m of group.meetings) {
                const day = DAY_LETTERS[m.dayOfWeek];
                if (!day) continue; // shouldn't happen — every meeting maps to a day now (see DAY_LETTERS)
                const start = formatMinutesToTime(m.startMinutes);
                const end = formatMinutesToTime(m.endMinutes);

                // Guards only against adding the very same meeting of the very
                // same group twice. It deliberately does NOT look at other
                // groups: there's no cap on how many הרצאה/תרגיל/… groups may
                // be picked, and two different groups that happen to share a
                // time are both allowed — they simply become alternatives, and
                // the solver still places exactly one of them at a time.
                const isDup = rawCourses.some((c) =>
                    (c.courseGroupId || c.id) === group.id &&
                    c.day === day && c.start === start && c.end === end);
                if (isDup) continue;

                rawCourses.push({
                    id: Date.now() + Math.random().toString(36).substring(2, 8),
                    courseGroupId: group.id, // real group id — also lets deleteCourseGroup() remove it cleanly
                    name: courseName, type, semester, day, start, end,
                    isElective, color: null,
                });
                addedAny = true;
            }
        }
        if (addedAny && isElective) activeElectives.add(courseName);
    }

    if (silent) return;

    updateUI(true);
    // Re-render whichever picker is currently showing so it reflects the
    // new added/removed state without closing — lets the student keep
    // picking, e.g. lecture then its exercise, in one sitting. The course
    // object itself never changes here, so no need to re-fetch it.
    if (document.getElementById('searchAddDialog').open) renderSearchAddDialog(course);
    if (previewState) renderPreviewBar();
}

/** Shared by both elective-toggle locations (the list dialog and the
 * calendar-preview bar) — whichever is currently the active picker. */
function currentElectiveIntent() {
    const cb = previewState
        ? document.getElementById('previewElectiveToggle')
        : document.getElementById('searchAddElectiveToggle');
    return cb ? cb.checked : false;
}
