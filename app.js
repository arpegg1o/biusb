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
    // Set right before every scheduleWorker.postMessage() (see updateUI()),
    // this is the exact schedule that was on screen for the semester being
    // recomputed — or null when there's nothing meaningful to compare
    // against (first solve of the session, or just switched to a semester
    // that hasn't been solved yet this session). The worker's response uses
    // it to keep the new schedule as close as possible to what was showing
    // rather than always jumping to the "best" one — see
    // chooseClosestScheduleIndex() and scheduleWorker.onmessage.
    let scheduleSnapshotBeforeUpdate = null;
    let hasComputedOnce = false;
    let lastComputedSemester = null;
    
    const HOUR_HEIGHT = 50; 
    
    const editIconSVG = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    const searchIconSVG = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    const minusIconSVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    const plusIconSVG = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><line x1="5" y1="12" x2="19" y2="12"></line><line x1="12" y1="5" x2="12" y2="19"></line></svg>`;

    const sunSVG = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
    const moonSVG = `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    // Mobile view-mode toggle icons (see toggleCalendarViewMode()): each
    // icon shows the view a tap would switch TO, matching the theme
    // button's own convention (sun shown while dark, moon shown while light).
    const tableViewSVG = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;
    const stackViewSVG = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="4" rx="1"></rect><rect x="4" y="10" width="16" height="4" rx="1"></rect><rect x="4" y="16" width="16" height="4" rx="1"></rect></svg>`;

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
    // Same {id, nameHe} rows as departmentNameById, plus a pre-normalized
    // name for fuzzy search — backs the department-filter search box in
    // Settings (see onDeptFilterSearchInput()).
    let departmentsList = [];
    const courseDetailCache = new Map();

    async function loadCatalogIndex() {
        try {
            const [indexRes, deptRes] = await Promise.all([
                fetch('data/search-index.json'),
                fetch('data/departments.json'),
            ]);
            catalogIndex = await indexRes.json();
            // The fuzzy-search haystack is built (and cached) separately —
            // see getFilteredCatalog() — since it only needs rebuilding when
            // the department filter changes, not on every keystroke.

            const departments = deptRes.ok ? await deptRes.json() : [];
            departmentNameById = new Map(departments.map((d) => [d.id, d.nameHe]));
            departmentsList = departments.map((d) => ({ id: d.id, nameHe: d.nameHe, norm: normalizeForFuzzyMatch(d.nameHe) }));
            // Chips in an already-open Settings dialog were rendered with
            // raw ids (name lookup wasn't ready yet) — fill in real names
            // now that it is.
            renderDeptFilterChips();
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
    // keystroke would be wasteful — cache the department-filtered {index,
    // haystack} pair and only rebuild it when the department filter (see
    // Settings → "סנן קורסים לפי מחלקה") or the loaded catalog itself
    // actually changes. Search deliberately does NOT restrict by the
    // currently-selected semester (see getFilteredCatalog()) — a course
    // offered in a semester you aren't currently looking at should still be
    // findable; picking it just falls back to the list view (#searchAddDialog)
    // if there's nothing to preview in the active semester, same as it
    // already does when a course has no groups at all in that semester.
    let filteredCatalogCache = { deptKey: undefined, sourceIndex: undefined, index: [], haystack: [] };

    /** '' when the department filter is off or has nothing selected (i.e.
     * doesn't restrict anything); otherwise a stable, order-independent key
     * for the chosen department ids, used only to know when to rebuild the
     * cache above. */
    function currentDeptFilterKey() {
        if (!departmentFilterEnabled || departmentFilterIds.size === 0) return '';
        return Array.from(departmentFilterIds).sort().join(',');
    }

    function getFilteredCatalog() {
        const deptKey = currentDeptFilterKey();
        if (filteredCatalogCache.deptKey === deptKey && filteredCatalogCache.sourceIndex === catalogIndex) {
            return filteredCatalogCache;
        }
        const activeDeptIds = deptKey ? new Set(deptKey.split(',')) : null;
        const index = (catalogIndex || []).filter((e) => !activeDeptIds || activeDeptIds.has(e.departmentId));
        const haystack = index.map((e) =>
            normalizeForFuzzyMatch(`${e.nameHeNorm} ${e.nameEnNorm || ''} ${e.lecturersNorm || ''} ${e.courseCode}`));
        filteredCatalogCache = { deptKey, sourceIndex: catalogIndex, index, haystack };
        return filteredCatalogCache;
    }

    // Results render a handful at a time with a trailing "עוד אפשרויות" row
    // that reveals the next batch on click (loadMoreSearchResults()), rather
    // than dumping everything at once — searchResultsCache itself always
    // holds the full (capped) match set so "load more" never re-searches.
    const SEARCH_PAGE_SIZE = 8;
    const SEARCH_RESULTS_CAP = 200;
    let searchVisibleCount = SEARCH_PAGE_SIZE;
    // A course-code-style query: digits, optionally grouped with '-' or a
    // space the way course codes are often written/remembered (e.g.
    // "88-222", "88 222") — the grouping is purely visual, so it's stripped
    // before matching and "88222" and "88-222" are treated identically.
    const PLAIN_NUMBER_RE = /^[\d\s-]*\d[\d\s-]*$/;
    /** Strips everything but digits from a course code, so a code stored
     * with a '-' (e.g. "88-222") still matches a plain "88222" query and
     * vice versa — the dash is just visual grouping, not part of the number. */
    function normalizeCourseCodeDigits(code) { return String(code).replace(/\D+/g, ''); }

    function onSearchInput() {
        searchDropdownEl = searchDropdownEl || document.getElementById('searchResultsDropdown');
        searchInputEl = searchInputEl || document.getElementById('courseSearchInput');

        if (catalogIndex === null) {
            searchDropdownEl.style.display = 'block';
            searchDropdownEl.innerHTML = '<div class="search-loading">טוען קטלוג קורסים…</div>';
            return;
        }

        const { index: semesterIndex, haystack: semesterHaystack } = getFilteredCatalog();

        const query = searchInputEl.value.trim();
        let results;
        if (!query) {
            results = semesterIndex.slice(0, SEARCH_RESULTS_CAP);
        } else if (PLAIN_NUMBER_RE.test(query)) {
            // "search by just a number" — a course code (e.g. "89111") is a
            // single short numeric token, which uFuzzy's edit-distance
            // scoring doesn't rank as reliably as free text. Match the code
            // directly instead: exact/prefix matches first, then any code
            // that merely contains the digits typed. '-'/spaces are just
            // visual grouping (e.g. "88-222"), so they're stripped from BOTH
            // sides before comparing — "88222" finds a course whose stored
            // code is "88222" just as well as one stored as "88-222".
            const digits = query.replace(/\D+/g, '');
            results = semesterIndex
                .filter((e) => normalizeCourseCodeDigits(e.courseCode).includes(digits))
                .sort((a, b) => {
                    const rank = (e) => {
                        const codeDigits = normalizeCourseCodeDigits(e.courseCode);
                        return codeDigits === digits ? 0 : codeDigits.startsWith(digits) ? 1 : 2;
                    };
                    const diff = rank(a) - rank(b);
                    return diff !== 0 ? diff : a.courseCode.localeCompare(b.courseCode);
                })
                .slice(0, SEARCH_RESULTS_CAP);
        } else {
            const needle = normalizeForFuzzyMatch(query);
            const [idxs, info, order] = fuzzy.search(semesterHaystack, needle, undefined, 1000);
            results = (!idxs || !info || !order) ? [] : order.slice(0, SEARCH_RESULTS_CAP).map((i) => semesterIndex[info.idx[i]]);
        }

        searchResultsCache = results;
        searchVisibleCount = SEARCH_PAGE_SIZE; // fresh query/input — reset "load more" progress
        renderSearchDropdown();
    }

    function renderSearchDropdown() {
        searchDropdownEl.style.display = 'block';
        if (searchResultsCache.length === 0) {
            searchDropdownEl.innerHTML = '<div class="search-empty">לא נמצאו קורסים תואמים.</div>';
            return;
        }
        const visible = searchResultsCache.slice(0, searchVisibleCount);
        let html = visible.map((r, i) => {
            const dept = departmentNameById.get(r.departmentId);
            return `
            <div class="search-result-item" onclick="selectSearchResult(${i})">
                <div class="search-result-name">${r.nameHe}</div>
                <div class="search-result-meta">${r.courseCode}${dept ? ' · ' + dept : ''}</div>
            </div>
        `;
        }).join('');
        if (searchResultsCache.length > searchVisibleCount) {
            html += `<div class="search-result-item search-more-item" onclick="loadMoreSearchResults()">עוד אפשרויות…</div>`;
        }
        searchDropdownEl.innerHTML = html;
    }

    /** Bottom "עוד אפשרויות" row — reveals the next page of the already-
     * computed searchResultsCache, no re-search needed. */
    function loadMoreSearchResults() {
        searchVisibleCount += SEARCH_PAGE_SIZE;
        renderSearchDropdown();
    }

    // Any search-results dropdown (the main course search, and the
    // department-filter search in Settings) closes when a click lands
    // outside its own .search-box wrapper. Uses composedPath() rather than
    // e.target.closest(): a click on a row that re-renders the dropdown
    // (e.g. "עוד אפשרויות" replacing the list with more results) detaches
    // the clicked element from the DOM WHILE the click is still bubbling —
    // at that point e.target.closest() can no longer find its (now former)
    // ancestors and wrongly treats the click as "outside", closing the very
    // dropdown that just re-rendered. composedPath() was captured before
    // any of that happened, so it isn't affected.
    document.addEventListener('click', (e) => {
        const path = e.composedPath ? e.composedPath() : [];
        const insideSearchBox = path.some((el) => el.classList && el.classList.contains('search-box'));
        if (insideSearchBox) return;
        document.querySelectorAll('.search-results-dropdown').forEach((dd) => { dd.style.display = 'none'; });
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
    // This site's calendar has 6 day columns (Sun-Fri). שישי (index 5) is
    // hidden by default (see updateFridayVisibility()) since most courses
    // never use it, but it is a fully real column: a group that meets on
    // Friday can be added like any other, and doing so reveals it.
    const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];

    function formatMinutesToTime(mins) {
        const h = Math.floor(mins / 60).toString().padStart(2, '0');
        const m = (mins % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }

    // =====================================================================
    // Group merging — a course sometimes lists what is, calendar-wise, the
    // very same option twice: same type, same semester, exactly the same
    // meetings, and nothing different but the lecturer. Those are one choice
    // as far as a schedule is concerned, so they're merged into a single
    // option whose lecturer reads "name1/name2" (and whose group code reads
    // "01/02"). The merged option keeps the FIRST group's real id, and
    // remembers every id it stands for (mergedIds), so adding, removing and
    // "is it already added?" all keep working for entries that were saved
    // under any one of them (including ones saved before this merging existed).
    // =====================================================================
    function meetingSignature(group) {
        return group.meetings
            .map((m) => `${m.dayOfWeek}-${m.startMinutes}-${m.endMinutes}`)
            .sort()
            .join('|');
    }

    function getMergedGroups(course) {
        if (!course || !Array.isArray(course.groups)) return [];
        if (course.__mergedGroups) return course.__mergedGroups;

        const merged = [];
        const byKey = new Map();

        for (const g of course.groups) {
            // Groups with no fixed hours have no times that could be "exactly
            // the same", so each of those stays its own listed option.
            const key = g.meetings.length === 0
                ? null
                : `${g.type}|${g.semester}|${meetingSignature(g)}`;
            const existing = key ? byKey.get(key) : null;
            const lecturer = (g.lecturerName || '').trim();
            const code = (g.groupCode === undefined || g.groupCode === null) ? '' : String(g.groupCode);

            if (existing) {
                existing.mergedIds.push(g.id);
                if (lecturer && !existing.lecturerNames.includes(lecturer)) existing.lecturerNames.push(lecturer);
                if (code && !existing.groupCodes.includes(code)) existing.groupCodes.push(code);
                continue;
            }

            const entry = Object.assign({}, g, {
                mergedIds: [g.id],
                lecturerNames: lecturer ? [lecturer] : [],
                groupCodes: code ? [code] : [],
            });
            merged.push(entry);
            if (key) byKey.set(key, entry);
        }

        merged.forEach((e) => {
            e.lecturerName = e.lecturerNames.join('/');
            e.groupCode = e.groupCodes.join('/');
        });

        // Non-enumerable so it never leaks into anything that serializes the
        // cached course object.
        Object.defineProperty(course, '__mergedGroups', { value: merged, enumerable: false });
        return merged;
    }

    function mergedGroupIds(group) {
        if (!group) return [];
        return group.mergedIds || [group.id];
    }

    function isGroupIdInSchedule(id) {
        return rawCourses.some((c) => (c.courseGroupId || c.id) === id);
    }

    function isGroupAdded(group) {
        return mergedGroupIds(group).some(isGroupIdInSchedule);
    }

    /** Looks a (possibly merged) group up by any of the ids it stands for. */
    function findMergedGroup(course, groupId) {
        const groups = getMergedGroups(course);
        return groups.find((g) => g.id === groupId)
            || groups.find((g) => mergedGroupIds(g).includes(groupId))
            || null;
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

        const container = document.getElementById('searchAddGroups');
        container.innerHTML = renderGroupsBySemester(course)
            || '<p style="color:var(--text-muted); font-size:13px;">אין קבוצות זמינות לקורס זה.</p>';
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
                    return `
                        <div class="group-row ${added ? 'added' : ''}">
                            <div>
                                <div><strong>קבוצה ${g.groupCode}</strong> — ${g.lecturerName || ''}</div>
                                <div style="color:var(--text-muted); font-size:12px;" dir="ltr">${times || '(ללא שעות)'}</div>
                            </div>
                            <button class="btn-simple" style="padding:6px 12px; font-size:13px;"
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
                        <div><strong>קבוצה ${g.groupCode}</strong> — ${g.lecturerName || ''}</div>
                        <button class="btn-simple" style="padding:4px 10px; font-size:12px;" onclick="pickPreviewGroup('${g.id}')">${added ? 'הסרה' : 'הוספה'}</button>
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
            } else if (scheduleSnapshotBeforeUpdate === null) {
                // Cold start (page just loaded), or we just switched to a
                // semester that hasn't been solved yet this session —
                // nothing comparable is in memory. Trust (and just clamp)
                // whatever index was already saved for this semester rather
                // than resetting to the "best" schedule: re-running the
                // (deterministic) solver on the same input reproduces the
                // exact same list of schedules in the exact same order, so
                // the saved index still points at the same schedule as before.
                const savedIdx = semesterIndices[currentSem];
                semesterIndices[currentSem] =
                    (typeof savedIdx === 'number' && savedIdx >= 0 && savedIdx < validSchedules.length) ? savedIdx : 0;
            } else {
                // A course/group/elective actually changed within the same
                // semester — keep whatever's on screen as intact as
                // possible instead of jumping back to the "best" schedule.
                semesterIndices[currentSem] = chooseClosestScheduleIndex(validSchedules, scheduleSnapshotBeforeUpdate);
            }
            scheduleSnapshotBeforeUpdate = null;
            hasComputedOnce = true;
            lastComputedSemester = currentSem;

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

        const savedElectives = localStorage.getItem('myActiveElectives');
        if (savedElectives) activeElectives = new Set(JSON.parse(savedElectives));

        loadSavedSchedulesFromStorage();

        // The top bar is sticky; give it a soft shadow once content slides under it.
        const topBar = document.getElementById('topBar');
        const syncTopBarShadow = () => topBar.classList.toggle('scrolled', window.scrollY > 4);
        window.addEventListener('scroll', syncTopBarShadow, { passive: true });
        syncTopBarShadow();

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

    function onSemesterChange() {
        activeAlternativeKey = null;
        refreshCoursePickers();
        updateUI(false); // re-runs the solver, then re-renders the calendar (ghosts included)
    }

    function hexToRgba(hex, alpha) {
        let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Relative luminance (WCAG formula) → whether black or white text reads
    // better on a given solid hex color.
    function contrastTextColor(hex) {
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        const chan = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        const luminance = 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
        return luminance > 0.45 ? '#000' : '#fff';
    }

    function darkenHex(hex, factor) {
        const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor));
        const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor));
        const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor));
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Course/event box colors. These used to be painted at 65% alpha so they
    // "blended" softly with the page behind them — fine over the near-white
    // light-theme background, but over a dark background the same blend
    // turns the fill into a muddy dark color while the text stayed forced
    // black, making it unreadable (this is the dark-mode bug from the
    // screenshot). Fixed by painting these fully opaque, as a genuine solid
    // color chip, and choosing the text color from that color's own
    // luminance rather than assuming black always works.
    function getCourseStyle(courseName, type, customColor) {
        if (customColor) {
            return { bg: customColor, border: darkenHex(customColor, 0.35), text: contrastTextColor(customColor) };
        }
        let hash = 0;
        for (let i = 0; i < courseName.length; i++) hash = courseName.charCodeAt(i) + ((hash << 5) - hash);
        const hue = Math.abs(hash) % 360;
        const isMain = (type === 'הרצאה' || type === 'שיעור');
        // Always a light pastel by construction (82%/94% lightness), so
        // black text is always legible on it regardless of theme.
        return isMain
            ? { bg: `hsl(${hue}, 70%, 82%)`, border: `hsl(${hue}, 70%, 45%)`, text: '#000' }
            : { bg: `hsl(${hue}, 70%, 94%)`, border: `hsl(${hue}, 70%, 65%)`, text: '#000' };
    }


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

    // Loads html2canvas from the CDN on first use (same URL the PDF export uses).
    function ensureHtml2canvas() {
        if (typeof html2canvas !== 'undefined') return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load html2canvas'));
            document.head.appendChild(script);
        });
    }

    // Renders the calendar to a canvas the way every image export wants it:
    // per-box action buttons hidden, `.exporting` styling on, and both put
    // back afterwards whether the capture worked or not.
    function captureCalendarCanvas(calendar) {
        const actions = document.querySelectorAll('.box-actions');
        actions.forEach(a => a.style.display = 'none');
        calendar.classList.add('exporting');

        const bgColor = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#ffffff';
        const restore = () => {
            calendar.classList.remove('exporting');
            actions.forEach(a => a.style.display = 'flex');
        };

        return html2canvas(calendar, {
            backgroundColor: bgColor,
            scale: 2
        }).then(canvas => {
            restore();
            return canvas;
        }, err => {
            restore();
            throw err;
        });
    }

    function exportToImage(format) {
        const calendar = document.querySelector('.calendar-wrapper');
        if (!calendar || validSchedules.length === 0) return alert("אין מערכת לייצא כרגע.");

        ensureHtml2canvas()
            .then(() => runImageCapture(calendar, format))
            .catch(() => alert("אירעה שגיאה בייצוא התמונה."));
    }

    function runImageCapture(calendar, format) {
        return captureCalendarCanvas(calendar).then(canvas => {
            const link = document.createElement('a');
            link.download = `Schedule_${getCurrentSemester()}.${format}`;
            link.href = canvas.toDataURL(`image/${format}`);
            link.click();
        }).catch(err => {
            alert("אירעה שגיאה בייצוא התמונה.");
        });
    }

    // Same picture as the PNG export, but put on the clipboard instead of
    // downloaded. The clipboard only reliably takes PNG, so there's no JPG
    // variant. Needs a secure context (https or localhost) and a browser that
    // supports ClipboardItem (Chrome/Edge/Safari; Firefox 127+).
    function exportToClipboard() {
        const calendar = document.querySelector('.calendar-wrapper');
        if (!calendar || validSchedules.length === 0) return alert("אין מערכת לייצא כרגע.");

        if (!window.isSecureContext || !navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
            return alert("הדפדפן לא תומך בהעתקת תמונה ללוח (נדרש דפדפן עדכני ואתר מאובטח).\nאפשר להשתמש בייצוא כתמונה (PNG) במקום.");
        }

        showToast('מכין תמונה…', 15000);

        // The image takes a moment to render, and Safari only lets
        // clipboard.write() run inside the click that started it — so the
        // ClipboardItem is created right now, holding a *promise* of the
        // PNG, and the browser waits for it.
        const pngBlobPromise = ensureHtml2canvas()
            .then(() => captureCalendarCanvas(calendar))
            .then(canvas => new Promise((resolve, reject) => {
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')), 'image/png');
            }));

        // The clipboard call below reports a failed render to the user; this
        // no-op branch just stops the browser also logging it as an
        // "unhandled rejection" (the ClipboardItem consumes the promise
        // internally, which JS can't see).
        pngBlobPromise.catch(() => {});

        navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlobPromise })])
            .then(() => showToast('התמונה הועתקה ללוח ✓'))
            .catch(err => {
                console.error('Copy to clipboard failed:', err);
                showToast('');
                alert("לא הצלחנו להעתיק את התמונה ללוח.\nייתכן שהדפדפן חסם את הגישה ללוח — אפשר להשתמש בייצוא כתמונה (PNG) במקום.");
            });
    }

    // The export menu opens on hover with a mouse. Touch screens have no hover
    // (and a tap-emulated one is unreliable), so there a tap on the button
    // toggles it, and tapping anywhere else — or an item — closes it again.
    function toggleExportMenu(e) {
        if (window.matchMedia('(hover: hover)').matches) return;   // mouse: CSS :hover handles it
        e.stopPropagation();
        document.querySelector('.dropdown').classList.toggle('open');
    }
    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    });

    // --- Keyboard shortcuts ---
    //   ← / →   move between semesters (RTL: ← = next, → = previous)
    //   Ctrl/⌘+C copy the schedule image to the clipboard, but only when
    //           nothing is selected — real text copying is never hijacked
    // Both stay out of the way while typing in a field or with a dialog open.
    function canCopyScheduleImage() {
        return !!(window.isSecureContext && navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined');
    }

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
            if (validSchedules.length === 0 || currentSemesterState().courses.length === 0) return;
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

    let toastTimer = null;
    // Empty message hides the toast immediately.
    function showToast(message, duration = 2200) {
        let toast = document.getElementById('appToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appToast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        clearTimeout(toastTimer);
        if (!message) { toast.classList.remove('visible'); return; }
        toast.textContent = message;
        toast.classList.add('visible');
        toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
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

                // This is an entirely new course list, not an edit to the
                // current one — comparing it against whatever schedule was
                // on screen before the import would be meaningless. Treat it
                // like a fresh page load instead, so updateUI() honors the
                // imported (or reset) semesterIndices directly rather than
                // hunting for "the closest match" to the pre-import schedule.
                hasComputedOnce = false;
                detachFromSavedSchedule();
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
                          const daysMatch = line.match(/^([א-ו]'?(?:\s*,\s*[א-ו]'?)*)/);
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
            if (parsed) {
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
        const dayMatch = between.match(/([א-ו]'?)/);
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

    // Key the solver itself uses for a "slot to fulfill" — one per
    // course-name+type (e.g. "אלגברה לינארית 1 (תרגיל)") — see
    // `groupsToFulfill` inside initWorker()'s worker script. Used here to
    // compare two concrete schedules slot-by-slot rather than session-entry
    // by session-entry (one group can have several weekly sessions, i.e.
    // several entries sharing one slot).
    function scheduleSlotKey(c) { return `${c.name} (${c.type})`; }

    /** For a concrete schedule (one array of the individual session entries
     * the solver returns), returns { slotKey: groupId } — the specific
     * group chosen for every slot in it. groupId is courseGroupId (or, for
     * a manually-entered/no-group session, its own id) — the same identity
     * the worker groups alternatives by (`optionKey` in initWorker()). */
    function scheduleGroupChoices(schedule) {
        const choices = {};
        for (const c of schedule) {
            choices[scheduleSlotKey(c)] = c.courseGroupId || c.id;
        }
        return choices;
    }

    /** Picks, among the newly computed candidate schedules, the one that
     * keeps the most slots assigned to the SAME group as `previousSchedule`
     * — i.e. the smallest possible change from what was on screen before
     * this add/remove/edit. This is what lets adding a course into an empty
     * slot leave every other course untouched, and — when that's not
     * possible — moves as few other courses as possible instead of
     * reshuffling the whole schedule. Falls back to index 0 (the solver's
     * own best-first ordering) when there's no previous schedule to compare
     * against, or nothing in it survived into any candidate. */
    function chooseClosestScheduleIndex(candidates, previousSchedule) {
        if (candidates.length === 0) return 0;
        if (!previousSchedule || previousSchedule.length === 0) return 0;

        const previousChoices = scheduleGroupChoices(previousSchedule);
        let bestIdx = 0;
        let bestScore = -1;
        candidates.forEach((sched, idx) => {
            const choices = scheduleGroupChoices(sched);
            let score = 0;
            for (const slotKey in previousChoices) {
                if (choices[slotKey] === previousChoices[slotKey]) score++;
            }
            // Candidates are already sorted best-first by the solver — ties
            // keep whichever came first, i.e. the objectively "nicer" one.
            if (score > bestScore) {
                bestScore = score;
                bestIdx = idx;
            }
        });
        return bestIdx;
    }

    function updateUI(pushHistory = true) {
        if (pushHistory) saveState(true);
        document.getElementById('undoBtn').disabled = historyStack.length === 0;

        const currentSem = getCurrentSemester();
        
        const nameStatusMap = {};
        rawCourses.forEach(c => { if(c.isElective) nameStatusMap[c.name] = true; });
        rawCourses.forEach(c => { c.isElective = !!nameStatusMap[c.name]; });

        // Every edit / undo / elective toggle comes through here, so this is
        // where the "modified" marker on the active saved schedule is kept
        // up to date.
        renderSavedSchedules();

        const statusEl = document.getElementById('scheduleStatus');
        statusEl.innerText = 'מחשב אפשרויות... ⏳';
        statusEl.style.color = 'var(--text-muted)';
        document.getElementById('calendarBody').style.opacity = '0.4';

        // Only meaningful to compare against the schedule that was showing
        // if we're recomputing the SAME semester we last solved — right
        // after a semester switch (or on first load) validSchedules still
        // holds a different semester's schedules entirely, so there's
        // nothing valid here to snapshot.
        const sameSemesterAsLastCompute = hasComputedOnce && lastComputedSemester === currentSem;
        scheduleSnapshotBeforeUpdate = sameSemesterAsLastCompute ? (validSchedules[semesterIndices[currentSem]] || []) : null;

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

        // Which saved card is framed depends on which alternative is
        // showing, and every change of it comes through here.
        renderSavedSchedules();
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
            // __groupIds covers merged groups (see getMergedGroups()): the ghost
            // counts as chosen if ANY of the ids it stands for is in the schedule.
            const added = (cls.__groupIds || [cls.id]).some(isGroupIdInSchedule);
            el.className = 'class-event ghost preview-ghost' + (added ? ' preview-ghost-added' : '');
            el.style.top = `${top}px`;
            el.style.height = `${height}px`;
            el.style.backgroundColor = colors.bg;
            el.style.borderColor = colors.border;
            el.style.color = colors.text;
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
        el.style.color = colors.text;
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
                el.style.color = 'var(--text-main)';
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
                <button class="box-btn" onclick="openEdit('${cls.id}')" title="עריכה ידנית (יום/שעה/סוג/שם)">${editIconSVG}</button>
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

            // "+" near the minus: lets you add other parts of this SAME course
            // (a תרגיל you don't have yet, another lecture alternative, ...)
            // without going back through search — opens the exact same
            // calendar-preview bar search gives you (see startPreview()).
            // Only courses that came from search/catalog have this (their
            // courseGroupId decodes back to a real catalog course id); a
            // manually-entered or pasted course has no catalog to add from.
            if (extractCourseIdFromGroupId(cls.courseGroupId)) {
                buttonsHTML = `
                    <button class="box-btn" onclick="openAddMoreForCourse('${cls.id}')" title="הוסף חלקים נוספים לקורס (הרצאה/תרגיל/מעבדה...)">
                        ${plusIconSVG}
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
        const days = DAY_LETTERS;
        days.forEach(day => document.getElementById(`day-${day}`).innerHTML = '');
        
        const timeGrid = document.getElementById('timeGrid');
        timeGrid.innerHTML = ''; 

        if (validSchedules.length === 0 && !previewState) {
            document.getElementById('calendarBody').style.height = '100px';
            updateFridayVisibility(false);
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

        const elementsByDay = Object.fromEntries(days.map((d) => [d, []]));

        // While previewing a type, that type's real (already-added) groups
        // are skipped here — their ghost below already represents them
        // (with an "added" style and its own click-to-remove), so rendering
        // both was a literal visual duplicate of the same block.
        const previewedGroupIds = previewState
            ? new Set(
                  previewState.course.groups
                      .filter((g) => g.type === previewState.type && groupMatchesCurrentSemester(g))
                      .map((g) => g.id),
              )
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

        updateFridayVisibility(elementsByDay['ו'].length > 0);

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
                
                const editBtnHtml = sessions.length === 1 ? `<button class="icon-btn" onclick="openEdit('${first.id}')" title="עריכה ידנית">✏️</button>` : '';
                const addMoreBtnHtml = extractCourseIdFromGroupId(first.courseGroupId)
                    ? `<button class="icon-btn" onclick="openAddMoreForCourse('${first.id}')" title="הוסף חלקים נוספים לקורס (הרצאה/תרגיל/מעבדה...)">➕</button>`
                    : '';

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
                        ${addMoreBtnHtml}
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
            detachFromSavedSchedule();
            updateUI(false);
        }
    }

    // Extra rows added via "+ הוסף מפגש נוסף": each is a fully independent
    // course entry (own type, semester, day/time, elective status) that
    // shares only the course NAME typed in the main field above — a quick
    // way to add several sections of one course (e.g. its הרצאה AND תרגיל)
    // without reopening this dialog. They are NOT tied to the main row via
    // courseGroupId; each is saved as its own rawCourses entry, exactly as
    // if it had been added on a separate visit to this dialog. Reset to
    // empty every time the dialog opens (openManualAdd()/openManualEditDialog()).
    let extraSessionRowCount = 0;

    function onExtraTypeChange(selectEl) {
        const custom = selectEl.closest('.session-row').querySelector('.extraSessionTypeCustom');
        custom.style.display = selectEl.value === '__custom__' ? 'block' : 'none';
    }

    function addExtraSessionRow() {
        extraSessionRowCount++;
        const wrap = document.createElement('div');
        wrap.className = 'session-row extra';
        wrap.dataset.sessionRow = 'extraSession' + extraSessionRowCount;
        wrap.innerHTML = `
            <div class="session-row-header">
                <span>שורה נוספת לאותו שם קורס</span>
                <button type="button" class="session-row-remove" onclick="this.closest('.session-row').remove()" title="הסר שורה זו">✕</button>
            </div>
            <div class="form-group">
                <label>סוג</label>
                <select class="extraSessionType" onchange="onExtraTypeChange(this)">
                    <option value="הרצאה">הרצאה</option>
                    <option value="תרגיל">תרגיל</option>
                    <option value="מעבדה">מעבדה</option>
                    <option value='שו"ת'>שו"ת</option>
                    <option value="סדנא">סדנא</option>
                    <option value="תגבור">תגבור</option>
                    <option value="שיעור">שיעור (אחר)</option>
                    <option value="__custom__">מותאם אישית...</option>
                </select>
                <input type="text" class="extraSessionTypeCustom" placeholder="הקלד סוג מותאם אישית" style="display:none; margin-top:8px;">
            </div>
            <div class="form-group">
                <label>סמסטר</label>
                <select class="extraSessionSemester">
                    <option value="א'">א'</option>
                    <option value="ב'">ב'</option>
                    <option value="שנתי">שנתי</option>
                    <option value="קיץ">קיץ</option>
                </select>
            </div>
            <div class="form-group">
                <label>יום</label>
                <select class="extraSessionDay">
                    <option value="א">ראשון</option>
                    <option value="ב">שני</option>
                    <option value="ג">שלישי</option>
                    <option value="ד">רביעי</option>
                    <option value="ה">חמישי</option>
                    <option value="ו">שישי</option>
                </select>
            </div>
            <div style="display:flex; gap:10px;">
                <div class="form-group" style="flex:1;">
                    <label>שעת התחלה</label>
                    <input type="time" class="extraSessionStart" value="08:00">
                </div>
                <div class="form-group" style="flex:1;">
                    <label>שעת סיום</label>
                    <input type="time" class="extraSessionEnd" value="10:00">
                </div>
            </div>
            <div class="form-group">
                <label class="toggle-label" style="font-weight:normal; font-size:13px;">
                    <div class="switch">
                        <input type="checkbox" class="extraSessionElective">
                        <span class="slider"></span>
                    </div>
                    סמן שורה זו כבחירה (ולא חובה)
                </label>
            </div>
        `;
        wrap.querySelector('.extraSessionSemester').value = document.getElementById('editSemester').value;
        document.getElementById('editSessionsList').appendChild(wrap);
    }

    function clearExtraSessionRows() {
        document.getElementById('editSessionsList').querySelectorAll('.session-row.extra').forEach(el => el.remove());
    }

    function collectExtraSessions() {
        return Array.from(document.getElementById('editSessionsList').querySelectorAll('.session-row.extra')).map(row => {
            const typeSel = row.querySelector('.extraSessionType').value;
            const type = typeSel === '__custom__' ? row.querySelector('.extraSessionTypeCustom').value.trim() : typeSel;
            return {
                type,
                semester: row.querySelector('.extraSessionSemester').value,
                day: row.querySelector('.extraSessionDay').value,
                start: row.querySelector('.extraSessionStart').value,
                end: row.querySelector('.extraSessionEnd').value,
                isElective: row.querySelector('.extraSessionElective').checked
            };
        });
    }

    // Built-in options in #editType — anything else means a course was saved
    // with a free-text custom type, so the form should reopen on "מותאם
    // אישית..." with that text filled in rather than silently falling back
    // to a built-in value. See onEditTypeChange()/openManualEditDialog().
    const EDIT_TYPE_BUILTINS = ['הרצאה', 'תרגיל', 'מעבדה', 'שו"ת', 'סדנא', 'תגבור', 'שיעור'];

    function onEditTypeChange() {
        const isCustom = document.getElementById('editType').value === '__custom__';
        document.getElementById('editTypeCustom').style.display = isCustom ? 'block' : 'none';
    }

    function getEditTypeValue() {
        const sel = document.getElementById('editType').value;
        if (sel === '__custom__') return document.getElementById('editTypeCustom').value.trim();
        return sel;
    }

    function setEditTypeValue(type) {
        if (EDIT_TYPE_BUILTINS.includes(type)) {
            document.getElementById('editType').value = type;
            document.getElementById('editTypeCustom').value = '';
        } else {
            document.getElementById('editType').value = '__custom__';
            document.getElementById('editTypeCustom').value = type || '';
        }
        onEditTypeChange();
    }

    function openManualAdd() {
        document.getElementById('editId').value = '';
        document.getElementById('editName').value = '';
        setEditTypeValue('הרצאה');
        document.getElementById('editSemester').value = getCurrentSemester() || "א'";
        document.getElementById('editDay').value = 'א';
        document.getElementById('editStart').value = '08:00';
        document.getElementById('editEnd').value = '10:00';
        document.getElementById('editColor').value = '#4a90e2';
        document.getElementById('editUseCustomColor').checked = false;
        document.getElementById('editElectiveToggle').checked = false;
        clearExtraSessionRows();

        document.getElementById('editDeleteBtn').style.display = 'none';
        document.getElementById('editDialogTitle').innerText = 'הוספת שיעור';
        document.getElementById('pasteAddSection').style.display = 'block';
        document.getElementById('editElectiveSection').style.display = 'block';
        document.getElementById('editDialog').showModal();
    }

    // A courseGroupId that matches our real catalog's id scheme
    // ("<courseCode>-<year>-g<groupCode>", e.g. "66201-2027-g01") means this
    // entry came from the search flow, not paste/manual entry — only those
    // can have "more parts" fetched from the catalog. See
    // openAddMoreForCourse() (the "+" button) below and README.md.
    function extractCourseIdFromGroupId(groupId) {
        if (!groupId) return null;
        const match = String(groupId).match(/^(.+)-g[^-]+$/);
        return match ? match[1] : null;
    }

    let manualEditFallbackId = null; // set only when reached via openAddMoreForCourse() on a search-based entry

    const TYPE_MAP_REVERSE = Object.fromEntries(Object.entries(TYPE_MAP).map(([k, v]) => [v, k]));

    // ✏️ always opens the plain structured form (עריכה ידנית) now, for every
    // entry — search-based or pasted alike. Picking a different/extra group
    // of a search-based course is the "+" button's job (openAddMoreForCourse,
    // which opens the calendar-preview bar); the pencil is purely "edit this
    // one row's fields directly."
    function openEdit(id) {
        manualEditFallbackId = null;
        openManualEditDialog(id);
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
        setEditTypeValue(c.type);
        document.getElementById('editSemester').value = c.semester;
        document.getElementById('editDay').value = c.day;
        document.getElementById('editStart').value = c.start;
        document.getElementById('editEnd').value = c.end;
        clearExtraSessionRows();

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
        // Elective status while editing is changed via the ✔ בחירה button on
        // the course row (updateUI()'s nameStatusMap), not this dialog — see
        // README "Fixed: marking a course בחירה via search...". Hide it here
        // exactly like the paste box, per the same "new class only" rule.
        document.getElementById('editElectiveSection').style.display = 'none';
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
        const type = getEditTypeValue();
        const semester = document.getElementById('editSemester').value;
        const day = document.getElementById('editDay').value;
        const start = document.getElementById('editStart').value;
        const end = document.getElementById('editEnd').value;
        const extraEntries = collectExtraSessions();

        const useCustomColor = document.getElementById('editUseCustomColor').checked;
        const color = useCustomColor ? document.getElementById('editColor').value : null;

        if (!name || !type || !start || !end) return alert("אנא מלא את כל השדות");
        for (const s of extraEntries) {
            if (!s.type || !s.start || !s.end) return alert("אנא מלא סוג, יום ושעות לכל שורה נוספת, או הסר אותה.");
        }

        const isDupCheck = (n, t, sem, d, st, en) => rawCourses.some(c =>
            c.name === n && c.type === t && c.semester === sem &&
            c.day === d && c.start === st && c.end === en
        );

        // Extra rows are independent entries that only share the course
        // name — add them regardless of whether we're adding or editing;
        // they never touch the id/group being edited below.
        let extraAddedCount = 0;
        extraEntries.forEach(s => {
            if (isDupCheck(name, s.type, s.semester, s.day, s.start, s.end)) return;
            rawCourses.push({
                id: Date.now() + Math.random().toString(36).substring(2, 8),
                courseGroupId: null,
                name, type: s.type, semester: s.semester, day: s.day, start: s.start, end: s.end,
                isElective: s.isElective, color
            });
            extraAddedCount++;
            if (s.isElective) activeElectives.add(name);
        });

        if (id) {
            const c = rawCourses.find(c => c.id === id);
            if (c) {
                if (isDupCheck(name, type, semester, day, start, end) && (c.name !== name || c.type !== type || c.semester !== semester || c.day !== day || c.start !== start || c.end !== end)) {
                    return alert("קורס זה כבר קיים במערכת באותן שעות בדיוק.");
                }
                c.name = name; c.type = type; c.semester = semester;
                c.day = day; c.start = start; c.end = end; c.color = color;
            }
        } else {
            const useElective = document.getElementById('editElectiveToggle').checked;
            if (isDupCheck(name, type, semester, day, start, end)) {
                if (extraAddedCount === 0) return alert("קורס זה כבר קיים במערכת באותן שעות בדיוק.");
            } else {
                rawCourses.push({
                    id: Date.now() + Math.random().toString(36).substring(2, 8),
                    courseGroupId: null,
                    name, type, semester, day, start, end, isElective: useElective, color
                });
                if (useElective) activeElectives.add(name);
            }
        }
        document.getElementById('editDialog').close();
        updateUI(true);
    }


    let currentTableZoom = 1.0;
    let initialPinchDistance = null;
    let initialPinchZoom = 1.0;

    function getFitTableZoom() {
        const wrapper = document.querySelector('.calendar-wrapper');
        const content = document.getElementById('calendarTableContent');
        if (!wrapper || !content) return 1.0;
        const availableWidth = wrapper.clientWidth - 8;
        const isFridayVisible = !wrapper.classList.contains('hide-friday');
        const baseWidth = isFridayVisible ? 840 : 720;
        return Math.min(1.0, Math.max(0.25, availableWidth / baseWidth));
    }

    function setTableZoom(zoom) {
        const content = document.getElementById('calendarTableContent');
        if (!content) return;
        const fitZoom = getFitTableZoom();
        const minZoom = Math.min(0.25, fitZoom);
        const maxZoom = 2.2;
        currentTableZoom = Math.max(minZoom, Math.min(maxZoom, zoom));

        content.style.zoom = currentTableZoom;
        if (!('zoom' in document.documentElement.style)) {
            content.style.transform = `scale(${currentTableZoom})`;
            content.style.transformOrigin = 'top right';
        }
    }

    function zoomCalendarStep(delta) {
        setTableZoom(currentTableZoom + delta);
    }

    function fitTableToScreen() {
        setTableZoom(getFitTableZoom());
    }

    function initTablePinchZoom() {
        const wrapper = document.querySelector('.calendar-wrapper');
        if (!wrapper) return;

        wrapper.addEventListener('touchstart', (e) => {
            if (!document.body.classList.contains('force-table-view')) return;
            if (e.touches.length === 2) {
                initialPinchDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialPinchZoom = currentTableZoom;
            }
        }, { passive: true });

        wrapper.addEventListener('touchmove', (e) => {
            if (!document.body.classList.contains('force-table-view')) return;
            if (e.touches.length === 2 && initialPinchDistance) {
                const currentDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                if (currentDist > 0) {
                    setTableZoom(initialPinchZoom * (currentDist / initialPinchDistance));
                }
            }
        }, { passive: true });

        wrapper.addEventListener('touchend', (e) => {
            if (e.touches.length < 2) initialPinchDistance = null;
        }, { passive: true });
    }

    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.warn(`Fullscreen request failed: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }
