    let rawCourses = [];
    let historyStack = [];
    let validSchedules = [];
    let activeElectives = new Set();
    let semesterIndices = { "א'": 0, "ב'": 0, "קיץ": 0 };
    let activeAlternativeKey = null; 
    let scheduleWorker = null; 
    let lastConflictDetails = null; 
    let pendingAlternativeJump = null; 
    let devModeAllowOverlaps = false; 
    
    const HOUR_HEIGHT = 50; 
    
    const editIconSVG = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    const searchIconSVG = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    const minusIconSVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;

    const sunSVG = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
    const moonSVG = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

    // =====================================================================
    // Course search — replaces the paste box as the primary way to add a
    // course (paste moved into the manual-add dialog, see openManualAdd()).
    // Ported verbatim from the real app's search logic:
    //   packages/core/src/hebrew/normalize.ts   (normalizeHebrew, fuzzy fold)
    //   apps/web/features/search/useCourseSearch.ts   (uFuzzy config)
    // so this experiment searches the exact same real, scraped course data
    // with the exact same matching rules — just without a build step.
    // =====================================================================

    // --- Hebrew normalization (verbatim port of packages/core/src/hebrew/normalize.ts) ---
    const HEBREW_DIACRITICS = /[֑-ׇ]/g;
    const HEBREW_PUNCTUATION = /[׳״'".,;:()\-–—]/g;
    const WHITESPACE_RE = /\s+/g;
    const FINAL_LETTER_MAP = { "ם": "מ", "ן": "נ", "ץ": "צ", "ף": "פ", "ך": "כ" };
    const CONFUSABLE_GROUPS = [
        ["א", "ע"], ["ת", "ט"], ["כ", "ק"], ["ח", "כ"], ["ס", "שׂ"], ["ב", "ו"],
    ];
    const CONFUSABLE_MAP = Object.fromEntries(
        CONFUSABLE_GROUPS.flatMap(([canonical, ...rest]) => rest.map((ch) => [ch, canonical])),
    );

    function stripNiqqud(text) { return text.replace(HEBREW_DIACRITICS, ""); }
    function foldFinalLetters(text) { return text.replace(/[םןץףך]/g, (ch) => FINAL_LETTER_MAP[ch] ?? ch); }
    function collapseKtivMale(text) { return text.replace(/יי+/g, "י").replace(/וו+/g, "ו"); }
    function foldConfusables(text) { return Array.from(text).map((ch) => CONFUSABLE_MAP[ch] ?? ch).join(""); }

    function normalizeHebrewText(text) {
        return foldFinalLetters(stripNiqqud(text).replace(HEBREW_PUNCTUATION, " "))
            .replace(WHITESPACE_RE, " ").trim().toLowerCase();
    }
    function normalizeForFuzzyMatch(text) {
        return foldConfusables(collapseKtivMale(normalizeHebrewText(text)));
    }

    // --- uFuzzy setup (same config as useCourseSearch.ts, incl. the Hebrew
    // word-boundary fix — uFuzzy's defaults treat every Hebrew codepoint as a
    // separator, which would otherwise match nothing at all for a pure-Hebrew query) ---
    const HEBREW_BLOCK = "\\u0590-\\u05FF";
    const fuzzy = new uFuzzy({
        intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1,
        interSplit: `[^A-Za-z0-9${HEBREW_BLOCK}']+`,
        interBound: `[^A-Za-z0-9${HEBREW_BLOCK}]`,
    });

    let catalogIndex = null;      // raw search-index.json entries
    let departmentNameById = new Map();
    const courseDetailCache = new Map();

    async function loadCatalogIndex() {
        try {
            const [indexRes, deptRes] = await Promise.all([
                fetch('data/search-index.json'),
                fetch('data/departments.json'),
            ]);
            catalogIndex = await indexRes.json();
            // The fuzzy-search haystack is built per-semester instead of once
            // here — see getSemesterFilteredCatalog() — since only choosing
            // courses from the currently selected semester is the point.

            const departments = deptRes.ok ? await deptRes.json() : [];
            departmentNameById = new Map(departments.map((d) => [d.id, d.nameHe]));
        } catch (err) {
            console.error('Failed to load course catalog — search will be unavailable.', err);
            catalogIndex = [];
        }
    }

    function fetchCourseDetail(id) {
        if (!courseDetailCache.has(id)) {
            courseDetailCache.set(id, fetch(`data/courses/${id}.json`).then((r) => {
                if (!r.ok) throw new Error(`Failed to load course ${id}: ${r.status}`);
                return r.json();
            }));
        }
        return courseDetailCache.get(id);
    }

    let searchDropdownEl, searchInputEl;
    let searchResultsCache = [];

    // "only allow choosing courses from the current semester" — a course
    // matches the semester picker (#semesterSelect, "א'"/"ב'"/"קיץ") if it
    // has a group in that exact semester, OR an annual group (spans both
    // א'/ב', but not קיץ) — same rule the main Schedule Maker app uses.
    function semesterKeyFromSelect(sem) {
        if (sem === "א'") return 'a';
        if (sem === "ב'") return 'b';
        if (sem === "קיץ") return 'summer';
        return null;
    }

    // Recomputing the fuzzy haystack for ~thousands of entries on every
    // keystroke would be wasteful — cache the semester-filtered {index,
    // haystack} pair and only rebuild it when the semester (or the loaded
    // catalog itself) actually changes.
    let filteredCatalogCache = { semester: undefined, sourceIndex: undefined, index: [], haystack: [] };

    function getSemesterFilteredCatalog() {
        const sem = getCurrentSemester();
        if (filteredCatalogCache.semester === sem && filteredCatalogCache.sourceIndex === catalogIndex) {
            return filteredCatalogCache;
        }
        const key = semesterKeyFromSelect(sem);
        const index = (catalogIndex || []).filter(
            (e) => !key || !e.semesters || e.semesters.includes(key) || e.semesters.includes('annual'),
        );
        const haystack = index.map((e) =>
            normalizeForFuzzyMatch(`${e.nameHeNorm} ${e.nameEnNorm || ''} ${e.lecturersNorm || ''} ${e.courseCode}`));
        filteredCatalogCache = { semester: sem, sourceIndex: catalogIndex, index, haystack };
        return filteredCatalogCache;
    }

    function onSearchInput() {
        searchDropdownEl = searchDropdownEl || document.getElementById('searchResultsDropdown');
        searchInputEl = searchInputEl || document.getElementById('courseSearchInput');

        if (catalogIndex === null) {
            searchDropdownEl.style.display = 'block';
            searchDropdownEl.innerHTML = '<div class="search-loading">טוען קטלוג קורסים…</div>';
            return;
        }

        const { index: semesterIndex, haystack: semesterHaystack } = getSemesterFilteredCatalog();

        const query = searchInputEl.value.trim();
        let results;
        if (!query) {
            results = semesterIndex.slice(0, 20);
        } else {
            const needle = normalizeForFuzzyMatch(query);
            const [idxs, info, order] = fuzzy.search(semesterHaystack, needle, undefined, 1000);
            results = (!idxs || !info || !order) ? [] : order.slice(0, 30).map((i) => semesterIndex[info.idx[i]]);
        }

        searchResultsCache = results;
        searchDropdownEl.style.display = 'block';
        if (results.length === 0) {
            searchDropdownEl.innerHTML = '<div class="search-empty">לא נמצאו קורסים תואמים.</div>';
            return;
        }
        searchDropdownEl.innerHTML = results.map((r, i) => {
            const dept = departmentNameById.get(r.departmentId);
            return `
            <div class="search-result-item" onclick="selectSearchResult(${i})">
                <div class="search-result-name">${r.nameHe}</div>
                <div class="search-result-meta">${r.courseCode}${dept ? ' · ' + dept : ''}</div>
            </div>
        `;
        }).join('');
    }

    document.addEventListener('click', (e) => {
        const box = document.querySelector('.search-box');
        if (box && !box.contains(e.target)) {
            const dd = document.getElementById('searchResultsDropdown');
            if (dd) dd.style.display = 'none';
        }
    });

    async function selectSearchResult(index) {
        const entry = searchResultsCache[index];
        if (!entry) return;
        document.getElementById('searchResultsDropdown').style.display = 'none';
        document.getElementById('courseSearchInput').value = '';
        manualEditFallbackId = null; // fresh pick, not reached via the edit button

        try {
            const course = await fetchCourseDetail(entry.id);
            const types = availablePreviewTypes(course);
            startPreview(course, types[0] || 'lecture');
        } catch (err) {
            alert('שגיאה בטעינת הקורס.');
            console.error(err);
        }
    }

    // Real MeetingType -> this site's Hebrew type vocabulary. "other" (ש.מחלקה,
    // פרויקט, etc. — see the ingest parser) is deliberately excluded, same as
    // the main app's CourseDetailPanel.
    const TYPE_MAP = { lecture: 'הרצאה', exercise: 'תרגיל', lab: 'מעבדה', seminar: 'סדנא', reinforcement: 'תגבור' };
    const TYPE_LABELS_HE = { lecture: 'הרצאה', exercise: 'תרגיל', lab: 'מעבדה', seminar: 'סמינר', reinforcement: 'תגבור (רשות)' };
    const SLOT_ORDER = ['lecture', 'exercise', 'lab', 'seminar', 'reinforcement'];
    const SEMESTER_MAP = { a: "א'", b: "ב'", annual: 'שנתי', summer: 'קיץ' };
    // This site's calendar only has 5 day columns (Sun-Thu) — Friday classes
    // are excluded, same as this file's own text parser already does.
    const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', null];

    function formatMinutesToTime(mins) {
        const h = Math.floor(mins / 60).toString().padStart(2, '0');
        const m = (mins % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }

    let currentSearchAddCourse = null; // set by renderSearchAddDialog, read by toggleGroupInSchedule

    function renderSearchAddDialog(course) {
        currentSearchAddCourse = course;
        document.getElementById('searchAddTitle').innerText = course.nameHe;
        document.getElementById('searchAddMeta').innerText = `${course.courseCode} · ${course.credits} נ"ז`;
        document.getElementById('searchAddManualEditBtn').style.display = manualEditFallbackId ? 'inline-block' : 'none';

        // Reflect this course's ACTUAL current elective state (electives are
        // per-course, not per-group — see updateUI()'s name-level normalization)
        // rather than always resetting to unchecked, so re-opening an
        // already-added course shows the truth instead of a stale default.
        const groupIds = new Set(course.groups.map((g) => g.id));
        const isCurrentlyElective = rawCourses.some((c) => groupIds.has(c.courseGroupId) && c.isElective);
        document.getElementById('searchAddElectiveToggle').checked = isCurrentlyElective;

        const groupsByType = {};
        for (const g of course.groups) {
            if (g.type === 'other') continue; // never offered, matches CourseDetailPanel
            if (g.meetings.length > 0 && g.meetings.every((m) => m.dayOfWeek === 5)) continue; // Friday-only, unsupported
            (groupsByType[g.type] = groupsByType[g.type] || []).push(g);
        }

        const lectureChosen = groupsByType.lecture
            ? groupsByType.lecture.some((g) => rawCourses.some((c) => (c.courseGroupId || c.id) === g.id))
            : true;

        const container = document.getElementById('searchAddGroups');
        container.innerHTML = SLOT_ORDER.filter((t) => groupsByType[t]).map((type) => {
            const locked = type === 'exercise' && !lectureChosen && !allowExerciseWithoutLecture;
            const rows = groupsByType[type].map((g) => {
                const added = rawCourses.some((c) => (c.courseGroupId || c.id) === g.id);
                const times = g.meetings
                    .filter((m) => DAY_LETTERS[m.dayOfWeek])
                    .map((m) => `יום ${DAY_LETTERS[m.dayOfWeek]}' ${formatMinutesToTime(m.startMinutes)}-${formatMinutesToTime(m.endMinutes)}`)
                    .join(', ');
                return `
                    <div class="group-row ${added ? 'added' : ''}">
                        <div>
                            <div><strong>קבוצה ${g.groupCode}</strong> — ${g.lecturerName || ''}</div>
                            <div style="color:var(--text-muted); font-size:12px;" dir="ltr">${times || '(ללא שעות)'}</div>
                        </div>
                        <button class="btn-simple" style="padding:6px 12px; font-size:13px;"
                                onclick="toggleGroupInSchedule('${g.id}')">
                            ${added ? 'הסרה' : 'הוספה'}
                        </button>
                    </div>`;
            }).join('');
            return `
                <div class="group-section ${locked ? 'group-locked' : ''}">
                    <h4>${TYPE_LABELS_HE[type]}${locked ? ' — בחרו הרצאה תחילה' : ''}</h4>
                    ${rows}
                </div>`;
        }).join('') || '<p style="color:var(--text-muted); font-size:13px;">אין קבוצות זמינות לקורס זה.</p>';
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

    function toggleGroupInSchedule(groupId) {
        const course = currentSearchAddCourse;
        const group = course && course.groups.find((g) => g.id === groupId);
        if (!group) return;
        const courseId = course.id;
        const courseName = course.nameHe;

        const alreadyAdded = rawCourses.some((c) => (c.courseGroupId || c.id) === group.id);

        if (alreadyAdded) {
            // Inlined rather than calling deleteCourseGroup() directly — that
            // function also calls updateUI() itself, which would run the
            // (somewhat expensive) schedule-solver worker twice for one click.
            rawCourses = rawCourses.filter((c) => (c.courseGroupId || c.id) !== group.id);
        } else {
            const isElective = currentElectiveIntent();
            const type = TYPE_MAP[group.type];
            const semester = SEMESTER_MAP[group.semester] || "א'";
            let addedAny = false;

            for (const m of group.meetings) {
                const day = DAY_LETTERS[m.dayOfWeek];
                if (!day) continue; // Friday — unsupported by this site's calendar
                const start = formatMinutesToTime(m.startMinutes);
                const end = formatMinutesToTime(m.endMinutes);

                const isDup = rawCourses.some((c) =>
                    c.name === courseName && c.type === type && c.semester === semester &&
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
            if (addedAny && isElective) activeElectives.add(courseName);
        }

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

    function getPreviewGhostEntries() {
        if (!previewState) return [];
        const { course, type } = previewState;
        const entries = [];
        course.groups
            .filter((g) => g.type === type)
            .forEach((g) => {
                g.meetings.forEach((m) => {
                    const day = DAY_LETTERS[m.dayOfWeek];
                    if (!day) return; // Friday — unsupported by this site's calendar
                    entries.push({
                        day,
                        classData: {
                            id: g.id,
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
        const present = new Set(course.groups.filter((g) => g.type !== 'other').map((g) => g.type));
        return SLOT_ORDER.filter((t) => present.has(t));
    }

    function isLectureChosen(course) {
        const lectureGroupIds = course.groups.filter((g) => g.type === 'lecture').map((g) => g.id);
        if (lectureGroupIds.length === 0) return true; // no lecture at all — nothing to unlock
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
        const noHourGroups = course.groups.filter((g) => g.type === type && g.meetings.length === 0);
        const noHourHtml = noHourGroups.length ? `
            <div style="margin-top:10px; border-top:1px solid var(--border); padding-top:8px;">
                <p style="font-size:12px; color:var(--text-muted); margin:0 0 6px;">קבוצות ללא שעות קבועות:</p>
                ${noHourGroups.map((g) => {
                    const added = rawCourses.some((c) => (c.courseGroupId || c.id) === g.id);
                    return `<div class="group-row ${added ? 'added' : ''}" style="margin-bottom:4px;">
                        <div><strong>קבוצה ${g.groupCode}</strong> — ${g.lecturerName || ''}</div>
                        <button class="btn-simple" style="padding:4px 10px; font-size:12px;" onclick="pickPreviewGroup('${g.id}')">${added ? 'הסרה' : 'הוספה'}</button>
                    </div>`;
                }).join('')}
            </div>` : '';

        bar.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                <div>
                    <strong>${course.nameHe}</strong>
                    <span style="font-size:12px; color:var(--text-muted);"> · ${course.courseCode} · ${course.credits} נ"ז</span>
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
                    <button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="showListFromPreview()">תצוגת רשימה</button>
                    <button class="btn-simple" style="padding:6px 10px; font-size:12px;" onclick="exitPreview()">סיום</button>
                </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">${tabsHtml}</div>
            ${noHourHtml}
            <p style="font-size:12px; color:var(--text-muted); margin:8px 0 0;">לחצו על אחת האפשרויות המסומנות בלוח (המקווקוות) כדי לבחור אותה.</p>
        `;

        const groupIds = new Set(course.groups.map((g) => g.id));
        document.getElementById('previewElectiveToggle').checked =
            rawCourses.some((c) => groupIds.has(c.courseGroupId) && c.isElective);
    }

    function timeToMins(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    }
    
    // Use index 0 as it is pre-sorted from best to worst
    function jumpToBestSchedule() {
        if (validSchedules && validSchedules.length > 0) {
            const currentSem = getCurrentSemester();
            semesterIndices[currentSem] = 0;
            updateStatus();
            renderCalendar();
            localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
        }
    }

    // --- INIT WEB WORKER ---
    function initWorker() {
        const workerScript = `
            function timeToMins(t) {
                const parts = t.split(':');
                return parseInt(parts[0]) * 60 + parseInt(parts[1]);
            }
            
            function hasConflict(schedule, newClass) {
                const newStart = timeToMins(newClass.start);
                const newEnd = timeToMins(newClass.end);
                for (const cls of schedule) {
                    if (cls.day !== newClass.day) continue;
                    const start = timeToMins(cls.start);
                    const end = timeToMins(cls.end);
                    if (newStart < end && newEnd > start) return cls; 
                }
                return null;
            }
            
            function evaluateSchedule(sched) {
                let overlaps = 0;
                let gapMinutes = 0;
                let before12Count = 0;

                const byDay = { 'א': [], 'ב': [], 'ג': [], 'ד': [], 'ה': [], 'ו': [] };
                sched.forEach(cls => {
                    if (byDay[cls.day]) byDay[cls.day].push(cls);
                    if (timeToMins(cls.start) < 720) before12Count++; // 720 = 12:00
                });

                for (const day in byDay) {
                    const dayClasses = byDay[day].sort((a, b) => timeToMins(a.start) - timeToMins(b.start));
                    
                    // Count overlaps
                    for (let j = 0; j < dayClasses.length; j++) {
                        for (let k = j + 1; k < dayClasses.length; k++) {
                            const endJ = timeToMins(dayClasses[j].end);
                            const startK = timeToMins(dayClasses[k].start);
                            if (startK < endJ) overlaps++; 
                        }
                    }

                    // Calculate gaps
                    let blocks = [];
                    dayClasses.forEach(cls => {
                        const s = timeToMins(cls.start);
                        const e = timeToMins(cls.end);
                        if (blocks.length === 0) {
                            blocks.push({ s, e });
                        } else {
                            let last = blocks[blocks.length - 1];
                            if (s <= last.e) {
                                last.e = Math.max(last.e, e);
                            } else {
                                blocks.push({ s, e });
                            }
                        }
                    });

                    for (let j = 0; j < blocks.length - 1; j++) {
                        gapMinutes += (blocks[j+1].s - blocks[j].e);
                    }
                }
                return { overlaps, gapMinutes, before12Count };
            }
            
            self.onmessage = function(e) {
                const { rawCourses, currentSem, activeElectives, allowOverlaps } = e.data;
                const semCourses = rawCourses.filter(c => c.semester === currentSem || c.semester === "שנתי");

                const groupsToFulfill = {};
                const optionsMap = {};
                
                semCourses.forEach(c => {
                    if (c.isElective && !activeElectives.includes(c.name)) return;
                    const key = c.name + " (" + c.type + ")";
                    const optionKey = c.courseGroupId || c.id; 
                    
                    if (!optionsMap[key]) optionsMap[key] = {};
                    if (!optionsMap[key][optionKey]) optionsMap[key][optionKey] = [];
                    optionsMap[key][optionKey].push(c);
                });
                
                for (const key in optionsMap) {
                    groupsToFulfill[key] = Object.values(optionsMap[key]);
                }
                
                let results = [[]];
                let conflictDetails = null;

                for (const key of Object.keys(groupsToFulfill)) {
                    const options = groupsToFulfill[key];
                    const newResults = [];
                    let lastConflict = null;

                    for (const res of results) {
                        for (const optSessions of options) {
                            let conflictObj = null;
                            
                            if (!allowOverlaps) {
                                for (const session of optSessions) {
                                    conflictObj = hasConflict(res, session);
                                    if (conflictObj) break;
                                }
                            }
                            
                            if (!conflictObj) {
                                newResults.push([...res, ...optSessions]);
                            } else {
                                lastConflict = conflictObj;
                            }
                        }
                    }
                    
                    results = newResults;
                    
                    if (results.length === 0) {
                        conflictDetails = {
                            failedCourse: key,
                            conflictWith: lastConflict ? (lastConflict.name + " (" + lastConflict.type + ")") : "קורס אחר"
                        };
                        break;
                    }
                }
                
                // Sort all generated schedules globally from best to worst
                if (results.length > 0) {
                    const scoredResults = results.map(sched => ({
                        sched,
                        score: evaluateSchedule(sched)
                    }));
                    scoredResults.sort((a, b) => {
                        if (a.score.overlaps !== b.score.overlaps) return a.score.overlaps - b.score.overlaps;
                        if (a.score.gapMinutes !== b.score.gapMinutes) return a.score.gapMinutes - b.score.gapMinutes;
                        return a.score.before12Count - b.score.before12Count;
                    });
                    results = scoredResults.map(item => item.sched);
                }
                
                self.postMessage({ results, conflictDetails });
            };
        `;
        const blob = new Blob([workerScript], {type: 'application/javascript'});
        scheduleWorker = new Worker(URL.createObjectURL(blob));
        
        scheduleWorker.onmessage = function(e) {
            validSchedules = e.data.results;
            lastConflictDetails = e.data.conflictDetails;

            const currentSem = getCurrentSemester();
            
            if (pendingAlternativeJump) {
                const targetId = pendingAlternativeJump;
                pendingAlternativeJump = null;
                let foundIdx = -1;
                for (let i = 0; i < validSchedules.length; i++) {
                    if (validSchedules[i].some(c => c.id === targetId)) {
                        foundIdx = i; break;
                    }
                }
                if (foundIdx !== -1) {
                    semesterIndices[currentSem] = foundIdx;
                } else {
                    alert("גם לאחר הסרת קורס הבחירה, לא נמצא שיבוץ תקין.");
                    semesterIndices[currentSem] = 0;
                }
            } else {
                semesterIndices[currentSem] = 0;
            }

            document.getElementById('calendarBody').style.opacity = '1';
            activeAlternativeKey = null; 
            
            updateStatus();
            renderCalendar();
            renderElectivesSidebar();
            updateCourseList();
            
            localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
        };
    }

    window.onload = () => {
        initWorker();
        loadCatalogIndex();

        applyThemeMode(getThemeMode());

        devModeAllowOverlaps = localStorage.getItem('myScheduleDevMode') === 'true';

        allowExerciseWithoutLecture = localStorage.getItem('myScheduleAllowExerciseWithoutLecture') === 'true';

        const saved = localStorage.getItem('mySchedulesData');
        if (saved) rawCourses = JSON.parse(saved);
        
        const savedHistory = localStorage.getItem('mySchedulesHistory');
        if (savedHistory) historyStack = JSON.parse(savedHistory);
        
        const savedIndices = localStorage.getItem('mySchedulesIndices');
        if (savedIndices) semesterIndices = JSON.parse(savedIndices);

        const savedElectives = localStorage.getItem('myActiveElectives');
        if (savedElectives) activeElectives = new Set(JSON.parse(savedElectives));

        updateUI(false); 
    };

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

    // --- Dev mode (allow overlaps) — lives only in the Settings dialog now
    // (moved out of the main controls bar). setDevMode() stays the single
    // entry point in case anything else ever needs to flip it programmatically. ---
    function setDevMode(checked) {
        devModeAllowOverlaps = checked;
        localStorage.setItem('myScheduleDevMode', devModeAllowOverlaps);
        document.getElementById('settingsOverlapsToggle').checked = checked;
        updateUI(false);
    }

    // --- Settings: allow choosing a תרגיל before/without a lecture ---
    let allowExerciseWithoutLecture = false;

    function setAllowExerciseWithoutLecture(checked) {
        allowExerciseWithoutLecture = checked;
        localStorage.setItem('myScheduleAllowExerciseWithoutLecture', checked);
        if (currentSearchAddCourse) renderSearchAddDialog(currentSearchAddCourse);
    }

    function resetAllCustomColors() {
        if (!confirm('לאפס את כל הצבעים המותאמים אישית שנשמרו לקורסים?')) return;
        rawCourses.forEach((c) => { c.color = null; });
        updateUI(true);
    }

    function openSettingsDialog() {
        document.getElementById('settingsOverlapsToggle').checked = devModeAllowOverlaps;
        document.getElementById('settingsExerciseWithoutLectureToggle').checked = allowExerciseWithoutLecture;
        const radio = document.querySelector(`input[name="settingsTheme"][value="${getThemeMode()}"]`);
        if (radio) radio.checked = true;
        document.getElementById('settingsDialog').showModal();
    }

    function saveState(pushHistory = true) {
        if (pushHistory) {
            historyStack.push(JSON.stringify(rawCourses));
            if (historyStack.length > 10) historyStack.shift(); 
            localStorage.setItem('mySchedulesHistory', JSON.stringify(historyStack));
        }
        localStorage.setItem('mySchedulesData', JSON.stringify(rawCourses));
        localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
        localStorage.setItem('myActiveElectives', JSON.stringify(Array.from(activeElectives)));
    }

    function undoAction() {
        if (historyStack.length === 0) return;
        rawCourses = JSON.parse(historyStack.pop());
        localStorage.setItem('mySchedulesHistory', JSON.stringify(historyStack));
        updateUI(false); 
    }

    function getCurrentSemester() { return document.getElementById('semesterSelect').value; }
    function onSemesterChange() { activeAlternativeKey = null; updateUI(false); }

    function hexToRgba(hex, alpha) {
        let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function getCourseStyle(courseName, type, customColor) {
        if (customColor) {
            return { bg: hexToRgba(customColor, 0.65), border: customColor };
        }
        let hash = 0;
        for (let i = 0; i < courseName.length; i++) hash = courseName.charCodeAt(i) + ((hash << 5) - hash);
        const hue = Math.abs(hash) % 360;
        const isMain = (type === 'הרצאה' || type === 'שיעור');
        return isMain ? { bg: `hsla(${hue}, 70%, 82%, 0.65)`, border: `hsl(${hue}, 70%, 45%)` } : { bg: `hsla(${hue}, 70%, 94%, 0.65)`, border: `hsl(${hue}, 70%, 65%)` };
    }


    // --- Import / Export ---
    function exportData() {
        if (rawCourses.length === 0) return alert("אין נתונים לייצא.");
        
        const exportObject = {
            rawCourses: rawCourses,
            semesterIndices: semesterIndices,
            activeElectives: Array.from(activeElectives)
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObject));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "schedule_data.json");
        document.body.appendChild(downloadAnchorNode); 
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    function exportToImage(format) {
        const calendar = document.querySelector('.calendar-wrapper');
        if (!calendar || validSchedules.length === 0) return alert("אין מערכת לייצא כרגע.");
        
        if (typeof html2canvas === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = () => runImageCapture(calendar, format);
            document.head.appendChild(script);
        } else {
            runImageCapture(calendar, format);
        }
    }

    function runImageCapture(calendar, format) {
        const actions = document.querySelectorAll('.box-actions');
        actions.forEach(a => a.style.display = 'none');
        calendar.classList.add('exporting');
        
        const bgColor = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#ffffff';

        html2canvas(calendar, { 
            backgroundColor: bgColor,
            scale: 2 
        }).then(canvas => {
            calendar.classList.remove('exporting');
            actions.forEach(a => a.style.display = 'flex');
            const link = document.createElement('a');
            link.download = `Schedule_${getCurrentSemester()}.${format}`;
            link.href = canvas.toDataURL(`image/${format}`);
            link.click();
        }).catch(err => {
            calendar.classList.remove('exporting');
            actions.forEach(a => a.style.display = 'flex');
            alert("אירעה שגיאה בייצוא התמונה.");
        });
    }

    function exportToPDF() {
        const calendar = document.querySelector('.calendar-wrapper');
        if (!calendar || validSchedules.length === 0) return alert("אין מערכת לייצא כרגע.");
        
        if (typeof html2canvas === 'undefined') {
            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            document.head.appendChild(script1);
            script1.onload = checkJSPDF;
        } else {
            checkJSPDF();
        }

        function checkJSPDF() {
            if (typeof window.jspdf === 'undefined') {
                const script2 = document.createElement('script');
                script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                script2.onload = () => runPDFCapture(calendar);
                document.head.appendChild(script2);
            } else {
                runPDFCapture(calendar);
            }
        }
    }

    function runPDFCapture(calendar) {
        const actions = document.querySelectorAll('.box-actions');
        actions.forEach(a => a.style.display = 'none');
        calendar.classList.add('exporting');
        
        const bgColor = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#ffffff';

        html2canvas(calendar, { 
            backgroundColor: bgColor,
            scale: 2 
        }).then(canvas => {
            calendar.classList.remove('exporting');
            actions.forEach(a => a.style.display = 'flex');
            
            const imgData = canvas.toDataURL('image/jpeg', 0.98);
            const width = canvas.width / 2; 
            const height = canvas.height / 2;
            
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'px', format: [width, height] });
            
            pdf.addImage(imgData, 'JPEG', 0, 0, width, height);
            pdf.save(`Schedule_${getCurrentSemester()}.pdf`);
            
        }).catch(err => {
            calendar.classList.remove('exporting');
            actions.forEach(a => a.style.display = 'flex');
            alert("אירעה שגיאה בייצור מסמך PDF.");
        });
    }

    // --- Parser Engine ---
    function importData(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                saveState(true); 

                if (Array.isArray(imported)) {
                    rawCourses = imported;
                    activeElectives = new Set();
                    semesterIndices = { "א'": 0, "ב'": 0, "קיץ": 0 };
                } else if (imported && imported.rawCourses) {
                    rawCourses = imported.rawCourses;
                    semesterIndices = imported.semesterIndices || { "א'": 0, "ב'": 0, "קיץ": 0 };
                    activeElectives = new Set(imported.activeElectives || []);
                } else {
                    throw new Error("Invalid format");
                }

                updateUI(false);
                alert("הנתונים יובאו בהצלחה!");
            } catch (err) { 
                alert("שגיאה בייבוא הקובץ."); 
            }
        };
        reader.readAsText(file);
        event.target.value = ""; 
    }

    function processInput() {
        const text = document.getElementById('pasteArea').value.trim();
        const forceElective = document.getElementById('addAsElectiveToggle').checked;
        if (!text) return;
        
        let added = processNewFormat(text, forceElective);
        
        if (added === 0) {
            added = processOldFormat(text, forceElective);
        }

        if (added > 0) {
            document.getElementById('pasteArea').value = '';
            document.getElementById('addAsElectiveToggle').checked = false;
            updateUI(true);
            document.getElementById('editDialog').close(); // now reached via the manual-add dialog, not the page directly
        } else {
            if (text.length > 0) {
                alert("לא חולצו קורסים חדשים מהטקסט.\nייתכן שהטקסט אינו בפורמט הנתמך או שהקורסים כבר קיימים במערכת בדיוק באותן השעות.");
            }
        }
    }

    function processNewFormat(text, forceElective) {
        const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(l => l);
        let parsedCount = 0;
        let i = 0;
        
        while(i < lines.length) {
             let typeIdx = -1;
             for(let j = i; j < lines.length && j <= i + 5; j++) { 
                 if (/^(הרצאה|תרגיל|מעבדה|שו"ת|סדנא|שיעור)$/.test(lines[j])) {
                     typeIdx = j;
                     break;
                 }
             }
             
             if (typeIdx !== -1) {
                 let nameLine = lines[i];
                 let cleanName = nameLine.replace(/^\d{2,6}-?\d{0,3}\s*/, '');
                 cleanName = cleanName.replace(/\s*(?:\d{1,3})?\s*(?:פרופ'?|ד"ר|דר'?|ד״ר|מר\s|גב\s|דוקטור).*$/, '');
                 cleanName = cleanName.replace(/\s*\d{2,3}\s*(?:[a-zA-Zא-ת].*)?$/, '');
                 cleanName = cleanName.trim();
                 if (!cleanName) cleanName = "קורס לא ידוע";
                 
                 let type = lines[typeIdx];
                 let semester = "א'";
                 let sessions = [];
                 let pendingDays = [];
                 
                 let j = typeIdx + 1;
                 while(j < lines.length) {
                      if (/^(הרצאה|תרגיל|מעבדה|שו"ת|סדנא|שיעור)$/.test(lines[j])) break;
                      if (/^\d{5,}/.test(lines[j])) break;
                      
                      let line = lines[j];
                      
                      if (line.includes('סמסטר')) {
                          const semMatch = line.match(/סמסטר\s*(א'|ב'|א|ב|שנתי)/);
                          if (semMatch) {
                              semester = semMatch[1].replace("'", "") + "'";
                              if (semester === "שנת'") semester = "שנתי";
                          }
                      } else {
                          const daysMatch = line.match(/^([א-ה]'?(?:\s*,\s*[א-ה]'?)*)/);
                          const timeMatch = line.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
                          
                          if (daysMatch) {
                              pendingDays = daysMatch[1].split(',').map(d => d.replace(/['\s]/g, ""));
                          }
                          
                          if (timeMatch && pendingDays.length > 0) {
                              const day = pendingDays.shift();
                              sessions.push({
                                  day: day,
                                  start: timeMatch[1].padStart(5, '0'),
                                  end: timeMatch[2].padStart(5, '0')
                              });
                          }
                      }
                      j++;
                 }
                 
                 if (sessions.length > 0) {
                     let courseGroupId = Date.now() + Math.random().toString(36).substring(2, 8);
                     let isElective = forceElective || cleanName.includes('בחירה');
                     
                     let addedAny = false;
                     sessions.forEach(session => {
                          let isDup = rawCourses.some(c => 
                              c.name === cleanName && c.type === type && c.semester === semester &&
                              c.day === session.day && c.start === session.start && c.end === session.end
                          );
                          
                          if (!isDup) {
                              rawCourses.push({
                                  id: Date.now() + Math.random().toString(36).substring(2, 8),
                                  courseGroupId: courseGroupId,
                                  name: cleanName,
                                  type: type,
                                  semester: semester,
                                  day: session.day,
                                  start: session.start,
                                  end: session.end,
                                  isElective: isElective,
                                  color: null
                              });
                              addedAny = true;
                          }
                     });
                     if (addedAny) {
                         parsedCount++;
                         if (isElective) activeElectives.add(cleanName);
                     }
                 }
                 i = j > i ? j : i + 1; 
             } else {
                 i++;
             }
        }
        return parsedCount;
    }

    function processOldFormat(text, forceElective) {
        let cleanText = text.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ');
        const chunks = cleanText.split(/(?=(?:הרצאה|תרגיל|מעבדה|שו"ת|סדנא|שיעור)\s)/);
        let parsedCount = 0;

        chunks.forEach(chunk => {
            const parsed = parseChunkOld(chunk, forceElective);
            if (parsed && parsed.day !== 'ו') { 
                let isDup = rawCourses.some(c => 
                     c.name === parsed.name && c.type === parsed.type && c.semester === parsed.semester &&
                     c.day === parsed.day && c.start === parsed.start && c.end === parsed.end
                );
                if (!isDup) {
                    rawCourses.push(parsed); 
                    parsedCount++; 
                }
            }
        });
        return parsedCount;
    }

    function parseChunkOld(chunk, forceElective) {
        chunk = chunk.trim();
        const typeMatch = chunk.match(/^(הרצאה|תרגיל|מעבדה|שו"ת|סדנא|שיעור)/);
        if (!typeMatch) return null;
        const type = typeMatch[1];
        
        const semMatch = chunk.match(/סמסטר\s*(א'|ב'|א|ב|שנתי)/);
        if (!semMatch) return null;
        let semester = semMatch[1].replace("'", "") + "'";
        if (semester === "שנת'") semester = "שנתי";
        
        const timeMatch = chunk.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (!timeMatch) return null;
        const start = timeMatch[1].padStart(5, '0');
        const end = timeMatch[2].padStart(5, '0');
        
        const semIndex = chunk.indexOf(semMatch[0]);
        const timeIndex = chunk.indexOf(timeMatch[0]);
        if(timeIndex < semIndex) return null;
        
        const between = chunk.substring(semIndex + semMatch[0].length, timeIndex);
        const dayMatch = between.match(/([א-ה]'?)/);
        let day = dayMatch ? dayMatch[1].replace("'", "") : 'א';
        
        let isElective = forceElective || (chunk.includes('בחירה') && !chunk.includes('חובה'));
        
        let name = "קורס לא ידוע";
        const idMatch = chunk.match(/\d{2,5}-?\d{2,3}/);
        let endIndex = semIndex;
        if (idMatch && chunk.indexOf(idMatch[0]) > type.length) endIndex = chunk.indexOf(idMatch[0]);
        
        name = chunk.substring(type.length, endIndex).trim();
        name = name.replace(/^(?:חובה|בחירה)\s+/g, '').replace(/\s+(?:חובה|בחירה)$/g, '').trim();
        name = name.replace(/^\d{2,6}-?\d{0,3}\s*/, '');
        name = name.replace(/\s*(?:\d{1,3})?\s*(?:פרופ'?|ד"ר|דר'?|ד״ר|מר\s|גב\s|דוקטור).*$/, '');
        name = name.replace(/\s*\d{2,3}\s*(?:[a-zA-Zא-ת].*)?$/, '');
        name = name.trim();
        if (!name) name = "קורס ללא שם";

        if (isElective) activeElectives.add(name);

        return { id: Date.now() + Math.random().toString(36).substring(2, 8), courseGroupId: null, name, type, semester, day, start, end, isElective, color: null };
    }


    // UI strict check - ALWAYS detects true physical overlaps for accurate coloring
    function hasStrictConflict(schedule, newClass) {
        const newStart = timeToMins(newClass.start);
        const newEnd = timeToMins(newClass.end);
        for (const cls of schedule) {
            if (cls.day !== newClass.day) continue;
            const start = timeToMins(cls.start);
            const end = timeToMins(cls.end);
            if (newStart < end && newEnd > start) return cls; 
        }
        return null;
    }

    function removeElectiveAndJump(electiveName, targetId, event) {
        if(event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (activeElectives.has(electiveName)) {
            activeElectives.delete(electiveName);
            pendingAlternativeJump = targetId;
            updateUI(true); 
        }
    }

    function updateUI(pushHistory = true) {
        if (pushHistory) saveState(true);
        document.getElementById('undoBtn').disabled = historyStack.length === 0;

        const currentSem = getCurrentSemester();
        
        const nameStatusMap = {};
        rawCourses.forEach(c => { if(c.isElective) nameStatusMap[c.name] = true; });
        rawCourses.forEach(c => { c.isElective = !!nameStatusMap[c.name]; });

        const statusEl = document.getElementById('scheduleStatus');
        statusEl.innerText = 'מחשב אפשרויות... ⏳';
        statusEl.style.color = 'var(--text-muted)';
        document.getElementById('calendarBody').style.opacity = '0.4';

        scheduleWorker.postMessage({
            rawCourses: rawCourses,
            currentSem: currentSem,
            activeElectives: Array.from(activeElectives),
            allowOverlaps: devModeAllowOverlaps
        });
    }

    function updateStatus() {
        const statusEl = document.getElementById('scheduleStatus');
        const currentSem = getCurrentSemester();
        
        if (validSchedules.length === 0) {
            if (lastConflictDetails) {
                statusEl.innerText = `התנגשות: ${lastConflictDetails.failedCourse} מול ${lastConflictDetails.conflictWith}`;
                statusEl.title = 'לא ניתן לשבץ את שני הקורסים במקביל כפי שהוגדרו';
            } else {
                statusEl.innerText = 'יש התנגשויות בחובות או בבחירה הפעילה';
                statusEl.title = '';
            }
            statusEl.style.color = 'var(--danger)';
            statusEl.style.fontSize = '14px'; 
        } else {
            statusEl.innerText = `מערכת ${semesterIndices[currentSem] + 1} מתוך ${validSchedules.length}`;
            statusEl.style.color = 'var(--text-main)';
            statusEl.style.fontSize = '18px';
            statusEl.title = '';
        }
    }

    function changeSchedule(step) {
        if (validSchedules.length === 0) return;
        const currentSem = getCurrentSemester();
        semesterIndices[currentSem] += step;
        
        if (semesterIndices[currentSem] >= validSchedules.length) semesterIndices[currentSem] = 0;
        if (semesterIndices[currentSem] < 0) semesterIndices[currentSem] = validSchedules.length - 1;
        
        activeAlternativeKey = null; 
        updateStatus();
        renderCalendar();
        localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
    }

    function toggleSidebarElective(courseName) {
        if (activeElectives.has(courseName)) {
            activeElectives.delete(courseName);
            updateUI(true);
        } else {
            activeElectives.add(courseName);
            updateUI(true); 
        }
    }

    function renderElectivesSidebar() {
        const listEl = document.getElementById('electiveSidebarList');
        listEl.innerHTML = '';
        
        const currentSem = getCurrentSemester();
        const semCourses = rawCourses.filter(c => c.semester === currentSem || c.semester === "שנתי");
        const electiveNames = [...new Set(semCourses.filter(c => c.isElective).map(c => c.name))];
        
        if (electiveNames.length === 0) {
            listEl.innerHTML = '<div style="color:var(--text-muted); font-size:12px; text-align:center;">אין קורסי בחירה בסמסטר זה.</div>';
            return;
        }

        const currentSchedule = validSchedules[semesterIndices[currentSem]] || [];

        electiveNames.forEach(name => {
            const isActive = activeElectives.has(name);
            let statusClass = 'locked';
            let dotColor = 'var(--icon-locked)';
            let titleText = 'הקורס מתנגש לחלוטין עם שאר המערכת';

            if (isActive) {
                statusClass = 'active';
                dotColor = 'var(--icon-active)';
                titleText = 'פעיל במערכת - לחץ כדי להסיר';
            } else {
                const optionsMap = {};
                semCourses.filter(c => c.name === name).forEach(c => {
                    const optionKey = c.courseGroupId || c.id;
                    if (!optionsMap[c.type]) optionsMap[c.type] = {};
                    if (!optionsMap[c.type][optionKey]) optionsMap[c.type][optionKey] = [];
                    optionsMap[c.type][optionKey].push(c);
                });
                
                const groupKeys = Object.keys(optionsMap);
                
                function checkGroup(groupIndex, currentSet) {
                    if (groupIndex >= groupKeys.length) return true; 
                    const typeOptions = Object.values(optionsMap[groupKeys[groupIndex]]);
                    
                    for (const optSessions of typeOptions) {
                        let hasConf = false;
                        for (const session of optSessions) {
                            if (hasStrictConflict(currentSchedule, session) || hasStrictConflict(currentSet, session)) {
                                hasConf = true; break;
                            }
                        }
                        if (!hasConf) {
                            if (checkGroup(groupIndex + 1, [...currentSet, ...optSessions])) return true;
                        }
                    }
                    return false;
                }
                
                const fitsSeamlessly = checkGroup(0, []);

                if (fitsSeamlessly) {
                    statusClass = 'free';
                    dotColor = 'var(--icon-free)';
                    titleText = 'פנוי - ניתן להוסיף כעת ללא שינוי המערכת';
                } else {
                    let fitsAnywhere = false;
                    for (const sched of validSchedules) {
                        function checkGroupAnywhere(groupIndex, currentSet) {
                            if (groupIndex >= groupKeys.length) return true; 
                            const typeOptions = Object.values(optionsMap[groupKeys[groupIndex]]);
                            for (const optSessions of typeOptions) {
                                let hasConf = false;
                                for (const session of optSessions) {
                                    if (hasStrictConflict(sched, session) || hasStrictConflict(currentSet, session)) {
                                        hasConf = true; break;
                                    }
                                }
                                if (!hasConf) {
                                    if (checkGroupAnywhere(groupIndex + 1, [...currentSet, ...optSessions])) return true;
                                }
                            }
                            return false;
                        }
                        if (checkGroupAnywhere(0, [])) {
                            fitsAnywhere = true; break;
                        }
                    }

                    if (fitsAnywhere) {
                        statusClass = 'conditional';
                        dotColor = 'var(--icon-conditional)';
                        titleText = 'דורש שינוי - הוספה תשנה את פריסת שאר השיעורים';
                    } else if (devModeAllowOverlaps) {
                        statusClass = 'conditional';
                        dotColor = 'var(--icon-conditional)';
                        titleText = 'דורש שינוי / ייצור חפיפה (מצב מפתח)';
                    }
                }
            }

            const li = document.createElement('li');
            li.className = `elective-item status-${statusClass}`;
            li.title = titleText;
            li.onclick = () => {
                if (statusClass !== 'locked' || isActive) toggleSidebarElective(name);
            };
            
            li.innerHTML = `
                <span>${name}</span>
                <span class="status-dot" style="background-color: ${dotColor}"></span>
            `;
            listEl.appendChild(li);
        });
    }

    function toggleCourseGlobalElectiveState(courseName, makeElective) {
        rawCourses.forEach(c => {
            if (c.name === courseName) c.isElective = makeElective;
        });
        if (makeElective) activeElectives.add(courseName); else activeElectives.delete(courseName); 
        updateUI(true);
    }

    function getSearchStatus(cls, currentSchedule) {
        const currentSem = getCurrentSemester();
        const semCourses = rawCourses.filter(c => c.semester === currentSem || c.semester === "שנתי");
        
        const optionsMap = {};
        semCourses.filter(c => c.name === cls.name && c.type === cls.type).forEach(c => {
            const optionKey = c.courseGroupId || c.id;
            if (!optionsMap[optionKey]) optionsMap[optionKey] = [];
            optionsMap[optionKey].push(c);
        });
        
        const alternatives = Object.values(optionsMap);
        
        // If there are literally no other options, it should ALWAYS remain locked!
        if (alternatives.length <= 1) return 'locked'; 

        const currentOptionKey = cls.courseGroupId || cls.id;
        const scheduleMinusThis = currentSchedule.filter(c => (c.courseGroupId || c.id) !== currentOptionKey);
        
        let canMoveNow = false;
        let canMoveLater = false; 

        for (const optSessions of alternatives) {
            if ((optSessions[0].courseGroupId || optSessions[0].id) === currentOptionKey) continue;
            
            let conflict = null;
            for (const session of optSessions) {
                const conf = hasStrictConflict(scheduleMinusThis, session);
                if (conf) { conflict = conf; break; }
            }
            
            if (!conflict) {
                canMoveNow = true;
            } else {
                if (conflict.isElective) {
                    canMoveLater = true;
                }
                else if (validSchedules.some(sched => sched.some(c => c.id === optSessions[0].id))) {
                    canMoveLater = true;
                }
            }
        }
        
        // In Dev Mode, as long as there ARE options (>1), we flag it as conditional 
        // to allow the user to drag it anywhere, bypassing strict layout validations.
        if (devModeAllowOverlaps) return 'conditional';

        if (canMoveNow) return 'free';
        if (canMoveLater) return 'conditional';
        return 'locked';
    }

    function toggleAlternatives(courseKey) {
        activeAlternativeKey = (activeAlternativeKey === courseKey) ? null : courseKey;
        renderCalendar();
    }

    function jumpToAlternative(targetId) {
        const currentSem = getCurrentSemester();
        const currentSchedule = validSchedules[semesterIndices[currentSem]] || [];
        
        const candidateIndices = [];
        validSchedules.forEach((schedule, idx) => {
            if (schedule.some(cls => cls.id === targetId)) candidateIndices.push(idx);
        });

        if (candidateIndices.length > 0) {
            let bestIndex = candidateIndices[0];
            let maxOverlap = -1;

            candidateIndices.forEach(idx => {
                const candidateSchedule = validSchedules[idx];
                let overlapCount = 0;
                candidateSchedule.forEach(cls => {
                    if (currentSchedule.some(currentCls => currentCls.id === cls.id)) overlapCount++;
                });

                if (overlapCount > maxOverlap) {
                    maxOverlap = overlapCount;
                    bestIndex = idx;
                }
            });

            semesterIndices[currentSem] = bestIndex;
            activeAlternativeKey = null; 
            updateStatus();
            renderCalendar();
            localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
        } else {
            const targetClass = rawCourses.find(c => c.id === targetId);
            if (targetClass) {
                const currentOptionKey = targetClass.courseGroupId || targetClass.id;
                const scheduleMinusSource = currentSchedule.filter(c => c.name !== targetClass.name || c.type !== targetClass.type);
                
                const targetSessions = rawCourses.filter(c => (c.courseGroupId || c.id) === currentOptionKey);
                
                let conflictObj = null;
                for(const session of targetSessions) {
                    const conf = hasStrictConflict(scheduleMinusSource, session);
                    if (conf) { conflictObj = conf; break; }
                }
                
                if (conflictObj && conflictObj.isElective) {
                    removeElectiveAndJump(conflictObj.name, targetId, null);
                } else {
                    alert("לא ניתן להעביר את השיעור לכאן כי הוא מתנגש עם שיעור שאין לו חלופה.");
                }
            }
        }
    }

    function createEventElement(cls, isGhost = false, currentSchedule = [], dynamicStartHour = 8) {
        const startMins = timeToMins(cls.start);
        const endMins = timeToMins(cls.end);
        const top = ((startMins - (dynamicStartHour * 60)) / 60) * HOUR_HEIGHT;
        const height = ((endMins - startMins) / 60) * HOUR_HEIGHT;

        // Search-preview ghost (see startPreview()/getPreviewGhostEntries()) —
        // a candidate group being previewed on the real calendar, deliberately
        // NOT routed through the alternative-jump/conflict logic below (that's
        // for swapping an ALREADY-scheduled course, a different feature).
        if (cls.__isPreviewGhost) {
            const el = document.createElement('div');
            const colors = getCourseStyle(cls.name, cls.type, null);
            const added = rawCourses.some((c) => (c.courseGroupId || c.id) === cls.id);
            el.className = 'class-event ghost preview-ghost' + (added ? ' preview-ghost-added' : '');
            el.style.top = `${top}px`;
            el.style.height = `${height}px`;
            el.style.backgroundColor = colors.bg;
            el.style.borderColor = colors.border;
            el.title = added ? 'לחיצה להסרה' : 'לחיצה לבחירה';
            el.onclick = () => pickPreviewGroup(cls.id);
            el.innerHTML = `
                <div class="class-title">${cls.name}</div>
                ${cls.lecturerName ? `<div style="font-size: clamp(8px, 10cqw, 10px); margin-top: 1px;">${cls.lecturerName}</div>` : ''}
                <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${cls.start} - ${cls.end}</span></div>
                <div style="font-size: 10px; margin-top: 4px; font-weight: bold;">${added ? '✓ נבחר — לחיצה להסרה' : 'לחיצה לבחירה'}</div>
            `;
            return el;
        }

        const el = document.createElement('div');
        const colors = getCourseStyle(cls.name, cls.type, cls.color);

        el.className = `class-event ${isGhost ? 'ghost' : ''}`;
        el.style.top = `${top}px`;
        el.style.height = `${height}px`;
        el.style.backgroundColor = colors.bg;
        el.style.borderColor = colors.border;
        el.style.setProperty('--event-bg', colors.bg);

        const courseKey = `${cls.name} - ${cls.type}`;
        if (!isGhost && activeAlternativeKey && activeAlternativeKey !== courseKey) el.classList.add('dimmed');

        if (isGhost) {
            const currentOptionKey = cls.courseGroupId || cls.id;
            const scheduleMinusSource = currentSchedule.filter(c => c.name !== cls.name || c.type !== cls.type);
            
            const targetSessions = rawCourses.filter(c => (c.courseGroupId || c.id) === currentOptionKey);
            let conflictingClass = null;
            for(const session of targetSessions) {
                const conf = hasStrictConflict(scheduleMinusSource, session);
                if (conf) { conflictingClass = conf; break; }
            }
            
            const existsInValid = validSchedules.some(s => s.some(c => c.id === cls.id));
            
            if (conflictingClass) {
                if (devModeAllowOverlaps) {
                    el.style.borderColor = 'var(--danger)';
                    el.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                    el.title = `חפיפה עם ${conflictingClass.name} (מצב מפתח)`;
                    
                    el.innerHTML = `
                        <div class="class-title" title="${cls.name}">${cls.name}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${cls.start} - ${cls.end}</span></div>
                        <div style="font-size: 10px; color: var(--danger); margin-top: 4px; font-weight: bold;">(ייצור חפיפה)</div>
                    `;
                }
                else if (existsInValid) {
                    el.style.borderColor = 'var(--icon-conditional)';
                    el.style.backgroundColor = 'rgba(230, 126, 34, 0.1)';
                    el.title = `הזזה לכאן תזיז גם את ${conflictingClass.name}`;
                    
                    el.innerHTML = `
                        <div class="class-title" title="${cls.name}">${cls.name}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${cls.start} - ${cls.end}</span></div>
                        <div style="font-size: 10px; color: var(--icon-conditional); margin-top: 4px; font-weight: bold;">(יזיז שיעור אחר)</div>
                    `;
                } else if (conflictingClass.isElective) {
                    el.style.borderColor = 'var(--danger)';
                    el.style.backgroundColor = 'rgba(231, 76, 60, 0.05)';
                    el.title = `הזזה לכאן תמחק את קורס הבחירה ${conflictingClass.name}`;
                    
                    let extraHTML = `
                    <div style="margin-top: 5px; z-index: 10;">
                        <button class="box-btn danger" style="padding: 3px 6px; font-size: 10px; width: 100%; border-radius: 4px; color: white; background: var(--danger); border: none; font-weight: bold; cursor: pointer;" 
                                onclick="removeElectiveAndJump('${conflictingClass.name}', '${cls.id}', event)" title="לחץ כדי למחוק את קורס הבחירה ולשבץ פה">
                            הסר '${conflictingClass.name}'
                        </button>
                    </div>`;

                    el.innerHTML = `
                        <div class="class-title" title="${cls.name}">${cls.name}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${cls.start} - ${cls.end}</span></div>
                        <div style="font-size: 10px; color: var(--danger); margin-top: 4px; font-weight: bold;">(ימחק את '${conflictingClass.name}')</div>
                        ${extraHTML}
                    `;
                } else {
                    el.style.borderColor = 'var(--danger)';
                    el.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                    el.classList.add('dimmed');
                    el.title = `מתנגש עם חובה: ${conflictingClass.name}`;
                    el.innerHTML = `
                        <div class="class-title" title="${cls.name}">${cls.name}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${cls.start} - ${cls.end}</span></div>
                        <div style="font-size: 10px; color: var(--danger); margin-top: 4px; font-weight: bold;">(חסום - מתנגש)</div>
                    `;
                }

                if (devModeAllowOverlaps || existsInValid || (conflictingClass && conflictingClass.isElective)) {
                    el.addEventListener('dragover', (e) => e.preventDefault());
                    el.addEventListener('dragenter', (e) => { e.preventDefault(); el.style.borderStyle = 'solid'; el.style.backgroundColor = 'rgba(46, 204, 113, 0.2)'; });
                    el.addEventListener('dragleave', (e) => { el.style.borderStyle = 'dashed'; el.style.backgroundColor = (existsInValid && !devModeAllowOverlaps) ? 'rgba(230, 126, 34, 0.1)' : 'rgba(231, 76, 60, 0.05)'; });
                    el.addEventListener('drop', (e) => {
                        e.preventDefault();
                        const draggedId = e.dataTransfer.getData('text/plain');
                        if(draggedId) {
                            jumpToAlternative(cls.id);
                        }
                    });
                    el.setAttribute('onclick', `jumpToAlternative('${cls.id}')`);
                }
            } else {
                el.title = "לחץ (או גרור לכאן) כדי להעביר את השיעור לשעה זו";
                el.addEventListener('dragover', (e) => e.preventDefault());
                el.addEventListener('dragenter', (e) => { e.preventDefault(); el.style.borderStyle = 'solid'; el.style.backgroundColor = 'rgba(46, 204, 113, 0.2)'; });
                el.addEventListener('dragleave', (e) => { el.style.borderStyle = 'dashed'; el.style.backgroundColor = colors.bg; });
                el.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if(draggedId) jumpToAlternative(cls.id);
                });

                el.setAttribute('onclick', `jumpToAlternative('${cls.id}')`);
                el.innerHTML = `
                    <div class="class-title" title="${cls.name}">${cls.name}</div>
                    <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${cls.start} - ${cls.end}</span></div>
                `;
            }
        } else {
            const status = getSearchStatus(cls, currentSchedule);
            const statusColor = `var(--icon-${status})`;
            
            el.addEventListener('mousemove', (e) => {
                const isText = e.target.closest('.class-title, .class-type, .elective-badge, span');
                const isButton = e.target.closest('.box-btn, .box-actions');
                
                if (isText) {
                    el.draggable = false;
                    el.classList.remove('draggable-area', 'locked-area');
                    el.classList.add('text-area');
                    el.title = "";
                } else if (isButton) {
                    el.draggable = false;
                    el.classList.remove('draggable-area', 'text-area', 'locked-area');
                    el.title = "";
                } else {
                    if (status === 'locked') {
                        el.draggable = false;
                        el.classList.remove('draggable-area', 'text-area');
                        el.classList.add('locked-area');
                        el.title = "אין חלופות לקורס זה";
                    } else {
                        el.draggable = true;
                        el.classList.remove('text-area', 'locked-area');
                        el.classList.add('draggable-area');
                        el.title = "ניתן לגרור כדי לראות חלופות";
                    }
                }
            });

            el.addEventListener('mouseleave', () => {
                el.draggable = false;
                el.classList.remove('draggable-area', 'text-area', 'locked-area');
            });

            if (status !== 'locked') {
                let openedByDrag = false;
                el.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', cls.id);
                    if (activeAlternativeKey !== courseKey) {
                        openedByDrag = true;
                        setTimeout(() => {
                            activeAlternativeKey = courseKey;
                            renderCalendar();
                        }, 0);
                    }
                });
                
                el.addEventListener('dragend', (e) => {
                    if (openedByDrag && activeAlternativeKey === courseKey) {
                        activeAlternativeKey = null;
                        renderCalendar();
                    }
                    openedByDrag = false;
                });
            }

            let buttonsHTML = `
                <button class="box-btn" onclick="openEdit('${cls.id}')" title="ערוך קורס">${editIconSVG}</button>
                <button class="box-btn ${status === 'locked' ? 'locked' : ''}" 
                        onclick="${status === 'locked' ? '' : `toggleAlternatives('${courseKey}')`}" 
                        title="${status === 'locked' ? 'נעול - אין אופציות אחרות' : 'הצג חלופות קיימות (או גרור את השיעור)'}" 
                        style="color: ${statusColor};">
                    ${searchIconSVG}
                </button>
            `;

            if (cls.isElective) {
                buttonsHTML = `
                    <button class="box-btn delete-btn" onclick="toggleSidebarElective('${cls.name}')" title="הסר קורס בחירה" style="color:var(--danger)">
                        ${minusIconSVG}
                    </button>
                    ${buttonsHTML}
                `;
            }

            el.innerHTML = `
                <div class="box-actions">${buttonsHTML}</div>
                <div class="class-content" style="position:relative; z-index:2; text-align:center;">
                    <div class="class-title" title="${cls.name}">${cls.name}</div>
                    <div class="class-meta">
                        <span class="class-type">${cls.type}</span>
                        ${cls.isElective ? '<span class="elective-badge">בחירה</span>' : ''}
                    </div>
                    <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px);">
                        <span dir="ltr">${cls.start} - ${cls.end}</span>
                    </div>
                </div>
            `;
        }
        return el;
    }

    function renderCalendar() {
        const days = ['א', 'ב', 'ג', 'ד', 'ה'];
        days.forEach(day => document.getElementById(`day-${day}`).innerHTML = '');
        
        const timeGrid = document.getElementById('timeGrid');
        timeGrid.innerHTML = ''; 

        if (validSchedules.length === 0 && !previewState) {
            document.getElementById('calendarBody').style.height = '100px';
            return;
        }

        document.querySelector('.calendar-wrapper').classList.toggle('preview-mode', !!previewState);
        const previewGhosts = previewState ? getPreviewGhostEntries() : [];

        const currentSem = getCurrentSemester();
        const currentIdx = semesterIndices[currentSem] || 0;
        const schedule = validSchedules[currentIdx] || [];

        let minHour = 24;
        let maxHour = 0;

        let classesToRender = [...schedule];
        if (activeAlternativeKey) {
            const allAlternatives = rawCourses.filter(c =>
                (c.semester === currentSem || c.semester === "שנתי") &&
                `${c.name} - ${c.type}` === activeAlternativeKey
            );
            allAlternatives.forEach(alt => {
                if (!schedule.some(c => c.id === alt.id)) classesToRender.push(alt);
            });
        }

        if (classesToRender.length === 0 && previewGhosts.length === 0) {
            minHour = 8; maxHour = 20;
        } else {
            classesToRender.forEach(cls => {
                const sHour = parseInt(cls.start.split(':')[0]);
                const eHour = Math.ceil(timeToMins(cls.end) / 60);
                if (sHour < minHour) minHour = sHour;
                if (eHour > maxHour) maxHour = eHour;
            });
            previewGhosts.forEach(({ classData }) => {
                const sHour = parseInt(classData.start.split(':')[0]);
                const eHour = Math.ceil(timeToMins(classData.end) / 60);
                if (sHour < minHour) minHour = sHour;
                if (eHour > maxHour) maxHour = eHour;
            });
        }

        minHour = Math.max(0, minHour - 1);
        maxHour = Math.min(24, maxHour + 1);

        const totalHeight = (maxHour - minHour) * HOUR_HEIGHT;
        document.getElementById('calendarBody').style.height = `${totalHeight}px`;

        for (let i = minHour; i < maxHour; i++) {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.innerText = `${i}:00`;
            timeGrid.appendChild(slot);
        }

        const elementsByDay = { 'א': [], 'ב': [], 'ג': [], 'ד': [], 'ה': [] };

        // While previewing a type, that type's real (already-added) groups
        // are skipped here — their ghost below already represents them
        // (with an "added" style and its own click-to-remove), so rendering
        // both was a literal visual duplicate of the same block.
        const previewedGroupIds = previewState
            ? new Set(previewState.course.groups.filter((g) => g.type === previewState.type).map((g) => g.id))
            : null;

        schedule.forEach(cls => {
            if (previewedGroupIds && previewedGroupIds.has(cls.courseGroupId)) return;
            if(elementsByDay[cls.day]) elementsByDay[cls.day].push({ classData: cls, isGhost: false });
        });

        previewGhosts.forEach(({ classData, day }) => {
            if (elementsByDay[day]) elementsByDay[day].push({ classData, isGhost: true });
        });

        if (activeAlternativeKey) {
            const allAlternatives = rawCourses.filter(c => 
                (c.semester === currentSem || c.semester === "שנתי") && 
                `${c.name} - ${c.type}` === activeAlternativeKey
            );
            allAlternatives.forEach(altClass => {
                if (!schedule.some(c => c.id === altClass.id) && elementsByDay[altClass.day]) {
                    elementsByDay[altClass.day].push({ classData: altClass, isGhost: true });
                }
            });
        }

        days.forEach(day => {
            const col = document.getElementById(`day-${day}`);
            const events = elementsByDay[day];
            if (!events || events.length === 0) return;

            events.sort((a, b) => {
                const aStart = timeToMins(a.classData.start);
                const bStart = timeToMins(b.classData.start);
                if (aStart !== bStart) return aStart - bStart;
                return timeToMins(a.classData.end) - timeToMins(b.classData.end);
            });

            let groups = [];
            let currentGroup = [];
            let currentGroupEnd = -1;

            events.forEach(ev => {
                const start = timeToMins(ev.classData.start);
                const end = timeToMins(ev.classData.end);

                if (currentGroup.length === 0) {
                    currentGroup.push(ev);
                    currentGroupEnd = end;
                } else if (start < currentGroupEnd) {
                    currentGroup.push(ev);
                    currentGroupEnd = Math.max(currentGroupEnd, end);
                } else {
                    groups.push(currentGroup);
                    currentGroup = [ev];
                    currentGroupEnd = end;
                }
            });
            if (currentGroup.length > 0) groups.push(currentGroup);

            groups.forEach(group => {
                let cols = [];
                group.forEach(ev => {
                    const start = timeToMins(ev.classData.start);
                    let placed = false;
                    for (let i = 0; i < cols.length; i++) {
                        const lastEnd = timeToMins(cols[i][cols[i].length - 1].classData.end);
                        if (start >= lastEnd) {
                            cols[i].push(ev);
                            ev.column = i;
                            placed = true;
                            break;
                        }
                    }
                    if (!placed) {
                        ev.column = cols.length;
                        cols.push([ev]);
                    }
                });

                const numCols = cols.length;
                group.forEach(ev => {
                    const el = createEventElement(ev.classData, ev.isGhost, schedule, minHour);
                    
                    const widthPercent = 100 / numCols;
                    const rightPercent = widthPercent * ev.column;
                    
                    el.style.width = numCols === 1 ? '100%' : `calc(${widthPercent}% - 4px)`;
                    el.style.right = `${rightPercent}%`;
                    el.style.left = 'auto'; 
                    el.style.marginRight = numCols === 1 ? '0' : '2px';
                    
                    col.appendChild(el);
                });
            });
        });
    }

    function updateCourseList() {
        const list = document.getElementById('addedCoursesList');
        list.innerHTML = '';
        
        const coursesByName = {};
        rawCourses.forEach(c => {
            if (!coursesByName[c.name]) coursesByName[c.name] = { isElective: c.isElective, items: [] };
            coursesByName[c.name].items.push(c);
        });

        Object.keys(coursesByName).forEach(name => {
            const data = coursesByName[name];
            const groupDiv = document.createElement('div');
            groupDiv.className = 'course-group';
            
            const reqBtnClass = !data.isElective ? 'active' : '';
            const eleBtnClass = data.isElective ? 'active' : '';

            groupDiv.innerHTML = `
                <div class="course-group-title">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <span>${name}</span>
                        <div style="display:flex; border: 1px solid var(--border); border-radius:4px; overflow:hidden;">
                            <button class="make-elective-btn ${reqBtnClass}" style="border-radius:0" onclick="toggleCourseGlobalElectiveState('${name}', false)">חובה</button>
                            <button class="make-elective-btn ${eleBtnClass}" style="border-radius:0" onclick="toggleCourseGlobalElectiveState('${name}', true)">בחירה</button>
                        </div>
                    </div>
                    <span style="font-size:13px; color:var(--text-muted);">${data.items.length} שורות / חלופות</span>
                </div>
            `;

            const groupedByTypeAndOption = {};
            data.items.forEach(opt => {
                const k = opt.courseGroupId || opt.id;
                if(!groupedByTypeAndOption[k]) groupedByTypeAndOption[k] = [];
                groupedByTypeAndOption[k].push(opt);
            });
            
            Object.values(groupedByTypeAndOption).forEach(sessions => {
                const first = sessions[0];
                const timeStrings = sessions.map(s => `יום ${s.day}' | ${s.start} - ${s.end}`).join('<br>');
                
                const row = document.createElement('div');
                row.className = 'course-option-row';
                
                const editBtnHtml = sessions.length === 1 ? `<button class="icon-btn" onclick="openEdit('${first.id}')" title="ערוך">✏️</button>` : '';

                row.innerHTML = `
                    <div style="font-size:14px; display:flex; align-items:flex-start; gap:10px;">
                        <span class="class-type" style="background:#7f8c8d; font-size:12px; margin-top:2px;">${first.type}</span>
                        <div>
                            <div style="font-weight:bold; font-size:12px; margin-bottom:4px;">סמסטר ${first.semester}</div>
                            <span dir="ltr" style="display:inline-block; font-size:12px; line-height: 1.4;">${timeStrings}</span>
                        </div>
                    </div>
                    <div>
                        ${editBtnHtml}
                        <button class="icon-btn" onclick="deleteCourseGroup('${first.courseGroupId || first.id}')" title="מחק שורה זו (ימחק את כל הימים של קבוצה זו)">🗑️</button>
                    </div>
                `;
                groupDiv.appendChild(row);
            });
            
            list.appendChild(groupDiv);
        });
    }

    function deleteCourseGroup(groupIdOrId) {
        rawCourses = rawCourses.filter(c => (c.courseGroupId || c.id) !== groupIdOrId);
        updateUI(true);
    }

    function clearAll() {
        if(confirm("האם למחוק הכל?")) {
            rawCourses = []; historyStack = []; activeElectives.clear();
            semesterIndices = { "א'": 0, "ב'": 0, "קיץ": 0 };
            localStorage.removeItem('mySchedulesHistory');
            updateUI(false);
        }
    }

    function openManualAdd() {
        document.getElementById('editId').value = '';
        document.getElementById('editName').value = '';
        document.getElementById('editType').value = 'הרצאה';
        document.getElementById('editSemester').value = getCurrentSemester() || "א'";
        document.getElementById('editDay').value = 'א';
        document.getElementById('editStart').value = '08:00';
        document.getElementById('editEnd').value = '10:00';
        document.getElementById('editColor').value = '#4a90e2';
        document.getElementById('editUseCustomColor').checked = false;
        
        document.getElementById('editDeleteBtn').style.display = 'none';
        document.getElementById('editDialogTitle').innerText = 'הוספת שיעור';
        document.getElementById('pasteAddSection').style.display = 'block';
        document.getElementById('editDialog').showModal();
    }

    // A courseGroupId that matches our real catalog's id scheme
    // ("<courseCode>-<year>-g<groupCode>", e.g. "66201-2027-g01") means this
    // entry came from the search flow, not paste/manual entry — for those,
    // "edit" should reopen the real course-selection screen (its actual
    // lecture/exercise/etc. groups), not the generic structured form. See
    // openEdit() below and README.md.
    function extractCourseIdFromGroupId(groupId) {
        if (!groupId) return null;
        const match = String(groupId).match(/^(.+)-g[^-]+$/);
        return match ? match[1] : null;
    }

    let manualEditFallbackId = null; // set only when reached via openEdit() on a search-based entry

    const TYPE_MAP_REVERSE = Object.fromEntries(Object.entries(TYPE_MAP).map(([k, v]) => [v, k]));

    function openEdit(id) {
        const c = rawCourses.find(c => c.id === id);
        if (!c) return;
        const courseId = extractCourseIdFromGroupId(c.courseGroupId);
        if (courseId) {
            openSearchEditDialog(courseId, id, TYPE_MAP_REVERSE[c.type] || 'lecture');
        } else {
            manualEditFallbackId = null;
            openManualEditDialog(id);
        }
    }

    async function openSearchEditDialog(courseId, manualFallbackId, initialType) {
        manualEditFallbackId = manualFallbackId;
        try {
            const course = await fetchCourseDetail(courseId);
            const types = availablePreviewTypes(course);
            startPreview(course, types.includes(initialType) ? initialType : (types[0] || 'lecture'));
        } catch (err) {
            alert('שגיאה בטעינת הקורס.');
            console.error(err);
        }
    }

    // "still allow to edit it manually" — a fallback out of the search-based
    // group picker into the original structured form, for the one specific
    // entry that was clicked (a course can have several rawCourses entries;
    // only that one's manual form makes sense here).
    function openManualEditFromSearch() {
        const id = manualEditFallbackId;
        document.getElementById('searchAddDialog').close();
        exitPreview();
        if (id) openManualEditDialog(id);
    }

    function openManualEditDialog(id) {
        const c = rawCourses.find(c => c.id === id);
        if(!c) return;
        document.getElementById('editId').value = c.id;
        document.getElementById('editName').value = c.name;
        document.getElementById('editType').value = c.type;
        document.getElementById('editSemester').value = c.semester;
        document.getElementById('editDay').value = c.day;
        document.getElementById('editStart').value = c.start;
        document.getElementById('editEnd').value = c.end;

        if (c.color) {
            document.getElementById('editColor').value = c.color;
            document.getElementById('editUseCustomColor').checked = true;
        } else {
            document.getElementById('editColor').value = '#4a90e2';
            document.getElementById('editUseCustomColor').checked = false;
        }

        document.getElementById('editDeleteBtn').style.display = 'inline-block';
        document.getElementById('editDialogTitle').innerText = 'עריכת שיעור';
        document.getElementById('pasteAddSection').style.display = 'none';
        document.getElementById('editDialog').showModal();
    }

    function deleteFromEdit() {
        const id = document.getElementById('editId').value;
        if(id) {
            const target = rawCourses.find(c => c.id === id);
            if (target) deleteCourseGroup(target.courseGroupId || target.id);
            document.getElementById('editDialog').close();
        }
    }

    function saveEdit() {
        const id = document.getElementById('editId').value;
        const name = document.getElementById('editName').value.trim();
        const type = document.getElementById('editType').value;
        const semester = document.getElementById('editSemester').value;
        const day = document.getElementById('editDay').value;
        const start = document.getElementById('editStart').value;
        const end = document.getElementById('editEnd').value;
        
        const useCustomColor = document.getElementById('editUseCustomColor').checked;
        const color = useCustomColor ? document.getElementById('editColor').value : null;

        if (!name || !start || !end) return alert("אנא מלא את כל השדות");

        if (id) {
            const c = rawCourses.find(c => c.id === id);
            if(c) {
                c.name = name; c.type = type; c.semester = semester; 
                c.day = day; c.start = start; c.end = end; c.color = color;
            }
        } else {
            const isDup = rawCourses.some(c => 
                c.name === name && c.type === type && c.semester === semester &&
                c.day === day && c.start === start && c.end === end
            );
            if (isDup) return alert("קורס זה כבר קיים במערכת באותן שעות בדיוק.");
            
            rawCourses.push({
                id: Date.now() + Math.random().toString(36).substring(2, 8),
                courseGroupId: null,
                name, type, semester, day, start, end, isElective: false, color
            });
        }
        document.getElementById('editDialog').close();
        updateUI(true);
    }
