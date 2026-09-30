// ============================================================================
// Exams
//
// The exam data store (per-course, per-semester), the exams calendar dialog, and editing /
// adding / deleting exam entries.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

// =====================================================================
// Exam data store
// courseExamsMap: Map<courseName, {
//   exams:            [{type, date, time}],   // legacy flat list (kept for manual edits & back-compat)
//   examsBySemester:  { a?: [...], b?: [...], summer?: [...] },  // per-semester exam dates
//   shoamId:          string | null,           // legacy single shoam id
//   shoamIdBySemester:{ a?: string, b?: string, summer?: string }, // per-semester shoam ids
//   courseCode?:      string
// }>
// examsBySemester / shoamIdBySemester are populated from catalog course data.
// getAllExamEntries() uses them (when present) so a user enrolled only in
// semester א' never sees semester ב' exam dates for the same course.
// Manual edits always go into the flat `exams` list, which acts as an
// override for any semester bucket that is otherwise empty.
// Persisted to localStorage independently of rawCourses so it survives
// semester switches and clear-all.
// =====================================================================
const COURSE_EXAMS_STORAGE_KEY = 'courseExamsData';
let courseExamsMap = new Map(); // courseName → { exams, examsBySemester, shoamId, shoamIdBySemester, courseCode }

function loadCourseExamsFromStorage() {
    try {
        const raw = localStorage.getItem(COURSE_EXAMS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            Object.entries(parsed).forEach(([name, data]) => {
                courseExamsMap.set(name, data);
            });
        }
    } catch (e) { /* ignore */ }
}

function saveCourseExamsToStorage() {
    try {
        const obj = {};
        courseExamsMap.forEach((data, name) => { obj[name] = data; });
        localStorage.setItem(COURSE_EXAMS_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) { /* ignore */ }
}

// =====================================================================
// Semester date-range classification for exam splitting
//
// The catalog's flat `course.exams` array mixes exam dates from every
// semester a course runs in (e.g. semester א' מועד א' on 18/01 AND
// semester ב' מועד א' on 27/06 both appear in the same array).
// We split them by month using Israeli academic-year conventions:
//
//   semester א'  (key 'a')     : Oct–Feb  → months 10,11,12,1,2
//   semester ב'  (key 'b')     : Mar–Jul  → months 3,4,5,6,7
//   summer       (key 'summer'): Aug–Sep  → months 8,9
//
// An exam that falls outside these ranges (shouldn't happen in practice)
// stays in the flat `exams` list only, so it is never silently dropped.
// =====================================================================
const EXAM_MONTH_TO_SEMESTER = (function() {
    const map = {};
    [10, 11, 12, 1, 2].forEach(m => { map[m] = 'a'; });
    [3, 4, 5, 6, 7].forEach(m => { map[m] = 'b'; });
    [8, 9].forEach(m => { map[m] = 'summer'; });
    return map;
})();

/** Split a flat exam array into { a: [...], b: [...], summer: [...] }
 *  by pairing exam occurrences to semesters in chronological order.
 *
 *  Month-based bucketing is unreliable: semester A's moed-bet retake
 *  often falls in March, which EXAM_MONTH_TO_SEMESTER maps to 'b'.
 *  Instead we group exams by their type label, sort each group by date,
 *  and assign the kth occurrence to the kth semester in SEMESTER_LIST_ORDER
 *  that appears in semestersForCourse.  The earliest moed-aleph belongs
 *  to the first semester, the next to the second, and so on.
 *
 *  semestersForCourse may be a Set or an Array; order is derived from
 *  SEMESTER_LIST_ORDER so the result is always stable. */
function splitExamsBySemester(exams, semestersForCourse) {
    // Ordered list of semesters this course actually runs in.
    const semKeys = SEMESTER_LIST_ORDER.filter(s =>
        semestersForCourse instanceof Set
            ? semestersForCourse.has(s)
            : semestersForCourse.includes(s)
    ).filter(s => s !== 'annual');
    if (semKeys.length === 0) return {};

    const result = {};
    if (semKeys.length === 1) {
        // Single-semester: all exams go there.
        result[semKeys[0]] = exams.slice();
        return result;
    }

    // Group by type, sort each group by date, assign kth to semKeys[k].
    const byType = {};
    exams.forEach(exam => {
        const t = (exam.type || '').trim();
        (byType[t] = byType[t] || []).push(exam);
    });
    Object.values(byType).forEach(group => {
        group.sort((a, b) => {
            const da = examToDate(a), db = examToDate(b);
            if (da && db) return da - db;
            if (da) return -1; if (db) return 1;
            return 0;
        });
        group.forEach((exam, i) => {
            const key = semKeys[Math.min(i, semKeys.length - 1)];
            (result[key] = result[key] || []).push(exam);
        });
    });
    return result;
}

/** Derive per-semester shoam ids from the groups array.
 *  The new catalog format puts a `shoamId` on each group.
 *  We take the first (non-null) shoamId found for any group in each semester.
 *  Falls back to the top-level `course.shoamId` spread across all semesters
 *  when no group has its own shoamId (old format). */
function deriveShoamIdBySemester(course, semestersForCourse) {
    const result = {};
    const courseGroups = Array.isArray(course.groups) ? course.groups : [];

    // New format: per-group shoamId
    const groupsWithShoam = courseGroups.filter(g => g.shoamId);
    if (groupsWithShoam.length > 0) {
        groupsWithShoam.forEach(g => {
            const sem = g.semester === 'annual' ? null : g.semester;
            if (sem && semestersForCourse.has(sem) && !result[sem]) {
                result[sem] = g.shoamId;
            }
        });
        // For annual groups with a shoamId, apply to both a and b
        courseGroups.filter(g => g.semester === 'annual' && g.shoamId).forEach(g => {
            ['a', 'b'].forEach(sem => {
                if (semestersForCourse.has(sem) && !result[sem]) {
                    result[sem] = g.shoamId;
                }
            });
        });
    } else if (course.shoamId) {
        // Old format: single top-level shoamId — spread to all semesters
        semestersForCourse.forEach(sem => { result[sem] = course.shoamId; });
    }
    return result;
}

/** Register exam data from a fetched course object (called after any course detail load).
 *
 * Handles both the old format (flat exams, single top-level shoamId) and the
 * new format (flat exams mixing multiple semesters, per-group shoamId):
 *   - examsBySemester  is built by splitting the flat exam array on month ranges
 *   - shoamIdBySemester is derived from per-group shoamId fields (new format)
 *     or by spreading the single course.shoamId (old format)
 *
 * Stale-seed detection fires when any of these conditions hold for an existing entry:
 *   (a) exams list is empty and new data has exams → old version had no exam times
 *   (b) examsBySemester is missing → entry predates per-semester support
 *   (c) shoamIdBySemester is missing but the course now has shoam data → same
 * In those cases the catalog data is merged in without touching any manual edits
 * the user may have made to the flat exams list. */
function registerCourseExams(course) {
    if (!course || !course.nameHe) return;
    const existing = courseExamsMap.get(course.nameHe);
    const fetchedExams = Array.isArray(course.exams) ? course.exams : [];

    // Derive which semesters this course runs in from its groups array
    const courseGroups = Array.isArray(course.groups) ? course.groups : [];
    const semestersForCourse = new Set(
        courseGroups
            .map(g => g.semester)
            .filter(s => s && s !== 'annual')
    );
    if (courseGroups.some(g => g.semester === 'annual')) {
        semestersForCourse.add('a');
        semestersForCourse.add('b');
    }

    // Split the flat exams array into per-semester buckets by exam date
    const examsBySemester = splitExamsBySemester(fetchedExams, semestersForCourse);

    // Derive per-semester shoam ids (new: per-group; old: single top-level)
    const shoamIdBySemester = deriveShoamIdBySemester(course, semestersForCourse);

    // Stale-seed conditions
    const isStaleEmptySeed = existing && existing.exams && existing.exams.length === 0 && fetchedExams.length > 0;
    // Catalog has exams the stored entry doesn't — update catalog-sourced exams.
    // We detect this by checking if any catalog exam date isn't in stored.exams.
    // Manual edits (dates not in catalog) are preserved by merging: keep everything
    // in stored.exams that isn't a catalog exam, plus all catalog exams.
    const catalogDates = new Set(fetchedExams.map(e => e.date + '|' + e.type));
    const storedDates  = existing ? new Set((existing.exams || []).map(e => e.date + '|' + e.type)) : new Set();
    const catalogHasNewExams = fetchedExams.some(e => !storedDates.has(e.date + '|' + e.type));

    const isMissingPerSemesterExams = existing && !existing.examsBySemester;
    const hasShoamData = course.shoamId || courseGroups.some(g => g.shoamId);
    const isMissingPerSemesterShoam = existing && !existing.shoamIdBySemester && hasShoamData;

    if (!existing || isStaleEmptySeed) {
        // Nothing stored yet (or stale empty seed) — seed from the catalog fetch
        courseExamsMap.set(course.nameHe, {
            exams: fetchedExams,
            examsBySemester,
            courseCode: course.courseCode || null,
            shoamId: course.shoamId || null,
            shoamIdBySemester,
        });
        saveCourseExamsToStorage();
    } else {
        // Entry already exists — merge catalog data in, preserving manual edits.
        let changed = false;
        if (!existing.courseCode && course.courseCode) {
            existing.courseCode = course.courseCode;
            changed = true;
        }
        if (!existing.shoamId && course.shoamId) {
            existing.shoamId = course.shoamId;
            changed = true;
        }
        // If the catalog now has exam entries not present in stored.exams
        // (e.g. new JSON format added semester-b exam dates), merge them in.
        // Manual edits (exams whose date+type aren't in the catalog) are kept.
        if (catalogHasNewExams && fetchedExams.length > 0) {
            const manualEdits = (existing.exams || []).filter(e => !catalogDates.has(e.date + '|' + e.type));
            const merged = [...fetchedExams, ...manualEdits];
            merged.sort((a, b) => {
                const da = examToDate(a), db = examToDate(b);
                return (da && db) ? da - db : 0;
            });
            existing.exams = merged;
            existing.examsBySemester = splitExamsBySemester(merged, semestersForCourse);
            changed = true;
        } else if (isMissingPerSemesterExams) {
            // Back-fill examsBySemester by re-splitting the stored flat exams list.
            existing.examsBySemester = splitExamsBySemester(existing.exams || [], semestersForCourse);
            changed = true;
        }
        // Always overwrite shoamIdBySemester from the freshly-derived catalog data —
        // it is never manually edited, so there is nothing to preserve.
        // Guarding behind a key-count comparison caused stale stored maps (e.g.
        // both semesters pointing to the top-level shoamId from an older fetch)
        // to survive even after the catalog started providing correct per-group ids.
        if (Object.keys(shoamIdBySemester).length > 0) {
            existing.shoamIdBySemester = shoamIdBySemester;
            changed = true;
        } else if (!existing.shoamIdBySemester && course.shoamId) {
            // Fallback for courses with only a top-level shoamId and no per-group ids.
            existing.shoamIdBySemester = {};
            semestersForCourse.forEach(sem => { existing.shoamIdBySemester[sem] = course.shoamId; });
            changed = true;
        }
        if (changed) saveCourseExamsToStorage();
    }
}

/** Renders the exam dates (read-only) for a course detail dialog. */
function renderExams(course) {
    if (!course.exams || course.exams.length === 0) return '';
    const rows = course.exams.map((exam) => `
            <div class="exam-row">
                <span class="exam-type">${exam.type}</span>
                <span class="exam-datetime" dir="ltr">${exam.date}${exam.time ? ' · ' + exam.time : ''}</span>
            </div>`).join('');
    return `
            <div class="exam-section">
                <h4>מועדי בחינות</h4>
                ${rows}
            </div>`;
}

/** Renders the editable exam section in the searchAddDialog.
 *  Shows all semesters' exams grouped by semester, matching the groups
 *  layout above — the list dialog already shows every semester at once,
 *  so filtering to only the currently-selected semester would hide exams
 *  the user can see groups for. */
function renderExamsEditSection(course) {
    const el = document.getElementById('searchAddExamsEdit');
    if (!el) return;
    const stored = courseExamsMap.get(course.nameHe);
    const courseId = course.id;

    // Use course.exams (freshly fetched, full cross-semester list) as the
    // authoritative base.  Merge in any manual edits the user made in
    // stored.exams that don't appear in the catalog list — those are kept
    // so manual additions survive a re-open.  Stored.exams alone can be a
    // stale partial list (e.g. seeded from only one semester's view) so we
    // never use it as the sole source.
    const catalogExams = Array.isArray(course.exams) ? course.exams : [];
    const catalogKeys  = new Set(catalogExams.map(e => e.date + '|' + e.type));
    const manualEdits  = stored ? (stored.exams || []).filter(e => !catalogKeys.has(e.date + '|' + e.type)) : [];
    const flatExams    = [...catalogExams, ...manualEdits];

    // Determine which semesters this course is offered in (from groups),
    // so we can bucket exams the same way the groups are bucketed above.
    const semestersInCourse = [];
    SEMESTER_LIST_ORDER.forEach(sem => {
        const hasGroups = (course.groups || []).some(g =>
            sem === 'annual' ? g.semester === 'annual' :
            g.semester === sem || (sem !== 'annual' && g.semester === 'annual' && (sem === 'a' || sem === 'b'))
        );
        if (hasGroups && !semestersInCourse.includes(sem)) semestersInCourse.push(sem);
    });
    // Deduplicate: annual expands to a+b above, don't also show 'annual' bucket
    const semKeys = semestersInCourse.filter(s => s !== 'annual');
    if (semKeys.length === 0) semKeys.push(...SEMESTER_LIST_ORDER.slice(0, 3)); // fallback

    // Build per-semester exam buckets.
    //
    // Month-based bucketing (EXAM_MONTH_TO_SEMESTER) is unreliable here:
    // semester A's moed-bet retake often falls in March, which the month
    // map puts in 'b'. Instead, group exams by their moed type, sort each
    // type's occurrences chronologically, and assign the kth occurrence to
    // semKeys[k]. The earliest moed-aleph belongs to the first semester,
    // the next to the second, etc. Exams whose rank exceeds the number of
    // known semesters fall back to the last semKey so nothing is lost.
    const examsBySem = {};
    if (semKeys.length <= 1) {
        // Single-semester course: all exams belong to that one semester.
        flatExams.forEach(exam => {
            const key = semKeys[0];
            if (key) (examsBySem[key] = examsBySem[key] || []).push(exam);
        });
    } else {
        // Group by normalised moed type, sort each group by date, then
        // assign to semesters by rank.
        const byType = {};
        flatExams.forEach(exam => {
            const t = (exam.type || '').trim();
            (byType[t] = byType[t] || []).push(exam);
        });
        Object.values(byType).forEach(group => {
            group.sort((a, b) => {
                const da = examToDate(a), db = examToDate(b);
                if (da && db) return da - db;
                if (da) return -1; if (db) return 1;
                return 0;
            });
            group.forEach((exam, i) => {
                // kth exam of this type -> semKeys[k], clamped to last key.
                const key = semKeys[Math.min(i, semKeys.length - 1)];
                (examsBySem[key] = examsBySem[key] || []).push(exam);
            });
        });
    }

    // Helper: render one exam row
    const renderExamRow = (exam) => {
        let flatIdx = flatExams.indexOf(exam);
        if (flatIdx === -1) flatIdx = flatExams.findIndex(e =>
            e.date === exam.date && e.type === exam.type && e.time === exam.time);
        const editIdx = flatIdx >= 0 ? flatIdx : 0;
        const moedClass = getMoedClass(exam.type);
        return `<div class="exam-row" style="cursor:default;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="moed-badge ${moedClass}">${exam.type}</span>
                    <span dir="ltr" style="font-size:13px;">${exam.date}${exam.time ? ' ' + exam.time : ''}</span>
                </div>
                <button class="icon-btn" style="font-size:13px; padding:3px 6px;"
                    onclick="openEditExam('${courseId}', '${course.nameHe.replace(/'/g,"\\'")}', ${editIdx})"
                    title="ערוך">✏️</button>
            </div>`;
    };

    const totalExams = Object.values(examsBySem).reduce((n, arr) => n + arr.length, 0);
    const showSemesterHeaders = semKeys.length > 1;

    let html = `<div class="exam-section exam-section-edit">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                <h4 style="margin:0;">ערוך מועדי בחינות</h4>
                <button class="btn-simple" style="font-size:12px; padding:4px 8px;"
                    onclick="openAddExam('${courseId}', '${course.nameHe.replace(/'/g,"\\'")}')">+ הוסף מועד</button>
            </div>`;

    // Sort each bucket chronologically so exams always appear in date order
    // regardless of the order they appear in the flat catalog array.
    const sortByDate = arr => arr.slice().sort((a, b) => {
        const da = examToDate(a), db = examToDate(b);
        if (da && db) return da - db;
        if (da) return -1; if (db) return 1;
        return 0;
    });

    if (totalExams === 0) {
        html += `<p style="font-size:12px; color:var(--text-muted); margin:0;">אין מועדי בחינות רשומים.</p>`;
    } else if (showSemesterHeaders) {
        semKeys.forEach(sem => {
            const semExams = examsBySem[sem] || [];
            if (semExams.length === 0) return;
            html += `<div style="font-size:12px; font-weight:bold; color:var(--text-muted); margin:8px 0 4px;">${SEMESTER_MAP[sem] || sem}</div>`;
            sortByDate(semExams).forEach(exam => { html += renderExamRow(exam); });
        });
    } else {
        sortByDate(examsBySem[semKeys[0]] || []).forEach(exam => { html += renderExamRow(exam); });
    }

    html += `</div>`;
    el.innerHTML = html;
}

// =====================================================================
// Exam Schedule Dialog — the main exams calendar feature
// =====================================================================

function getMoedClass(type) {
    if (!type) return 'moed-a';
    if (type.includes("א'") || type.includes('A') || type.includes('1')) return 'moed-a';
    if (type.includes("ב'") || type.includes('B') || type.includes('2')) return 'moed-b';
    if (type.includes("ג'") || type.includes('C') || type.includes('3')) return 'moed-c';
    return 'moed-other';
}

/** Parse "DD/MM/YYYY" → {year, month (0-based), day} or null. */
function parseExamDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10), month = parseInt(parts[1], 10) - 1, year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return { year, month, day };
}

/** Returns Date object from exam or null. */
function examToDate(exam) {
    const p = parseExamDate(exam.date);
    if (!p) return null;
    return new Date(p.year, p.month, p.day);
}

/** All course names that appear in rawCourses for the given semester
 *  (including שנתי courses which span all semesters). */
function getCourseNamesForSemester(semester) {
    return new Set(
        rawCourses
            .filter(c => c.semester === semester || c.semester === 'שנתי')
            .map(c => c.name)
    );
}

/** Build the flat exam entry list for the given semester (Hebrew label, e.g. "א'").
 *  - Only courses that belong to that semester are included.
 *  - When the stored entry has examsBySemester, only the bucket for the
 *    *exact* semester the user is enrolled in is used — so a user registered
 *    only in semester א' never sees semester ב' exam dates for the same course.
 *    Falls back to the legacy flat `exams` array when no per-semester bucket
 *    exists (backward-compat) or when the user has manual edits there.
 *  - shoamId is similarly resolved per-semester when shoamIdBySemester is present.
 *  - `enrolled` = true when the course is required (not elective) OR is an
 *    elective that is currently active in the sidebar (activeElectives).
 *    An elective that is NOT active is "unchosen" and rendered dimmed.
 *  Each entry: { courseName, courseCode, shoamId, exam, enrolled, bg, border, text } */
function getAllExamEntries(semester) {
    const semCourseNames = getCourseNamesForSemester(semester);
    // Map the display semester label (e.g. "א'") back to the catalog key ('a'/'b'/'summer')
    const semesterKey = semesterKeyFromSelect(semester); // null for שנתי — not a display semester
    const entries = [];

    courseExamsMap.forEach((data, courseName) => {
        if (!semCourseNames.has(courseName)) return; // not enrolled in this semester

        // --- Resolve which exams to show for this semester ---
        // Re-split using the same type-pairing algorithm as renderExamsEditSection
        // so that semester A's moed-bet (often in March) is never mis-assigned
        // to semester B by a month-range check.
        // We derive which semesters the course runs in from the shoamIdBySemester
        // keys (always up-to-date after registerCourseExams) with a fallback to
        // examsBySemester keys and finally to all known semesters.
        const flatAll = data.exams || [];
        let examsForSem;
        if (semesterKey && flatAll.length > 0) {
            const knownSems = new Set(
                Object.keys(data.shoamIdBySemester || {})
                    .concat(Object.keys(data.examsBySemester || {}))
            );
            if (knownSems.size === 0) knownSems.add('a').add('b');
            const split = splitExamsBySemester(flatAll, knownSems);
            examsForSem = split[semesterKey] || [];
            // If nothing came back (e.g. single-semester course stored under a
            // different key), fall back to the full flat list so nothing is lost.
            if (examsForSem.length === 0) examsForSem = flatAll;
        } else {
            examsForSem = flatAll;
        }
        if (!examsForSem || examsForSem.length === 0) return;

        // --- Resolve which shoam link to show for this semester ---
        let shoamId;
        if (semesterKey && data.shoamIdBySemester && data.shoamIdBySemester[semesterKey]) {
            shoamId = data.shoamIdBySemester[semesterKey];
        } else {
            shoamId = data.shoamId || null;
        }

        // Determine whether this course is "chosen" for display purposes:
        // - required courses (isElective === false) are always chosen
        // - elective courses are chosen only when they are in activeElectives
        const courseEntries = rawCourses.filter(
            c => c.name === courseName && (c.semester === semester || c.semester === 'שנתי')
        );
        const isElective = courseEntries.length > 0 && courseEntries.every(c => c.isElective);
        const isEnrolled = !isElective || activeElectives.has(courseName);

        const colors = getCourseStyle(courseName, 'הרצאה', null);
        examsForSem.forEach(exam => {
            entries.push({
                courseName,
                courseCode: data.courseCode || '',
                shoamId,
                exam,
                enrolled: isEnrolled,
                bg: colors.bg,
                border: colors.border,
                text: colors.text,
            });
        });
    });

    // Sort by date, then courseName
    entries.sort((a, b) => {
        const da = examToDate(a.exam), db = examToDate(b.exam);
        if (da && db) return da - db;
        if (da) return -1; if (db) return 1;
        return a.courseName.localeCompare(b.courseName);
    });
    return entries;
}

/** Group entries by year-month and fill in every empty month between the
 *  first and last exam so the calendar is a continuous range, not a
 *  sparse list. Returns [{year, month, entries:[]}]. */
function groupEntriesByMonth(entries) {
    // First bucket entries into their months
    const byKey = new Map();
    entries.forEach(e => {
        const p = parseExamDate(e.exam.date);
        if (!p) return; // skip undated entries
        const key = `${p.year}-${p.month}`;
        if (!byKey.has(key)) byKey.set(key, { year: p.year, month: p.month, entries: [] });
        byKey.get(key).entries.push(e);
    });

    if (byKey.size === 0) return [];

    // Find the range
    const sorted = Array.from(byKey.values()).sort(
        (a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month
    );
    const first = sorted[0], last = sorted[sorted.length - 1];

    // Fill every month from first to last (empty months get entries: [])
    const result = [];
    let y = first.year, m = first.month;
    while (y < last.year || (y === last.year && m <= last.month)) {
        const key = `${y}-${m}`;
        result.push(byKey.get(key) || { year: y, month: m, entries: [] });
        m++;
        if (m > 11) { m = 0; y++; }
    }
    return result;
}

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DAYS_SHORT = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

/** Detect date-overlaps within the enrolled entries list. Returns Set of dateStr. */
function getOverlapDates(entries) {
    const enrolledByDate = {};
    entries.filter(e => e.enrolled).forEach(e => {
        const d = e.exam.date;
        if (!enrolledByDate[d]) enrolledByDate[d] = [];
        enrolledByDate[d].push(e.courseName);
    });
    const overlapDates = new Set();
    Object.entries(enrolledByDate).forEach(([d, names]) => {
        if (names.length > 1) overlapDates.add(d);
    });
    return overlapDates;
}

function openExamsDialog() {
    renderExamsDialog();
    document.getElementById('examsDialog').showModal();
    // For any enrolled catalog course that isn't in courseExamsMap yet
    // (e.g. courses added before the exam feature was introduced),
    // kick off a background fetch so their exam data appears on next open.
    _seedMissingCourseExams();
}

// Tracks which course IDs have already been re-fetched this page session so we
// don't hammer the server on every examsDialog open, but DO fetch once per load
// so new catalog data (extra exam dates, fresh shoamIds) is always picked up.
const _seededThisSession = new Set();

/** Background-fetch exam data for enrolled catalog courses across ALL
 *  semesters that either have no entry in courseExamsMap yet, or whose
 *  stored entry may be stale (missing fields or fewer exams than catalog).
 *  Each course is fetched at most once per page session — the session-level
 *  Set prevents redundant round-trips on repeated dialog opens while still
 *  ensuring the very first open after a catalog update picks up new data.
 *  Called both on page load (1.5 s delay so the catalog index settles first)
 *  and again when the exams dialog opens.
 *  Silently ignores errors and re-renders the open dialog when fetches return. */
function _seedMissingCourseExams() {
    const seen = new Set();
    rawCourses.forEach(c => {
        const courseId = extractCourseIdFromGroupId(c.courseGroupId);
        if (!courseId || seen.has(courseId)) return;
        seen.add(courseId);

        // Always fetch once per session so new catalog data is picked up.
        // fetchCourseDetail() is cached — repeated calls for the same id are free.
        if (_seededThisSession.has(courseId)) return;
        _seededThisSession.add(courseId);

        fetchCourseDetail(courseId).then(course => {
            if (document.getElementById('examsDialog').open) {
                renderExamsDialog();
            }
            // Also re-render the course detail dialog if it's open for this course
            if (document.getElementById('searchAddDialog').open && currentSearchAddCourse && currentSearchAddCourse.nameHe === course.nameHe) {
                renderSearchAddDialog(currentSearchAddCourse);
            }
        }).catch(() => { /* silently ignore network errors */ });
    });
}

function renderExamsDialog() {
    const body = document.getElementById('examsDialogBody');
    if (!body) return;
    const showUnchosen   = document.getElementById('examsShowUnchosenToggle')?.checked !== false;
    const showMoedGimel  = document.getElementById('examsShowMoedGimelToggle')?.checked === true;
    const currentSem     = getCurrentSemester();

    // All entries for the current semester only
    let allEntries = getAllExamEntries(currentSem);

    // Filter מועד ג unless the toggle is on
    if (!showMoedGimel) {
        allEntries = allEntries.filter(e => getMoedClass(e.exam.type) !== 'moed-c');
    }

    // Hide unchosen (elective-but-not-active) courses if toggle is off
    if (!showUnchosen) {
        allEntries = allEntries.filter(e => e.enrolled);
    }

    if (allEntries.length === 0) {
        // Check whether there simply are no exams for this semester yet
        const allForSem = getAllExamEntries(currentSem);
        const noData = allForSem.length === 0;
        body.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">
                <div style="font-size:48px; margin-bottom:12px;">📅</div>
                ${noData
                    ? `<p style="font-size:15px;">אין מועדי בחינות זמינים לסמסטר ${currentSem}.</p>
                       <p style="font-size:13px;">הוסיפו קורסים דרך חיפוש הקורסים כדי לראות את מועדי הבחינות שלהם.</p>`
                    : `<p style="font-size:15px;">כל המועדים מסוננים על ידי ההגדרות הנוכחיות.</p>`}
            </div>`;
        return;
    }

    const overlapDates = getOverlapDates(allEntries);

    // Overlap banner (only enrolled courses can actually conflict)
    let overlapBanner = '';
    if (overlapDates.size > 0) {
        const overlapList = Array.from(overlapDates).sort().map(d => {
            const names = allEntries.filter(e => e.enrolled && e.exam.date === d).map(e => e.courseName);
            return `<strong dir="ltr">${d}</strong>: ${names.join(', ')}`;
        }).join('<br>');
        overlapBanner = `<div class="exams-overlap-banner">
                <div style="font-weight:bold; margin-bottom:6px;">⚠️ חפיפות במועדי בחינות:</div>
                <div style="font-size:13px; line-height:1.8;">${overlapList}</div>
            </div>`;
    }

    // Legend
    const gimelBadge = showMoedGimel ? `<span class="moed-badge moed-c">מועד ג'</span>` : '';
    const legend = `<div class="exams-legend">
            <span class="moed-badge moed-a">מועד א'</span>
            <span class="moed-badge moed-b">מועד ב'</span>
            ${gimelBadge}
            <span class="exams-legend-sep">|</span>
            <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--border);border:1px solid var(--border);"></span>קורסי בחירה שלא הופעלו (עמומים)
            </span>
        </div>`;

    // Month grids — groupEntriesByMonth fills empty months between first and last
    const grouped = groupEntriesByMonth(allEntries);
    const monthsHtml = grouped.map(({ year, month, entries }) =>
        renderMonthGrid(year, month, entries, overlapDates)
    ).join('');

    body.innerHTML = `<div id="examsCalendarContent">${overlapBanner}${legend}${monthsHtml}</div>`;
}

function renderMonthGrid(year, month, entries, overlapDates) {
    // Build a Set of all days that have exams in this month
    const byDay = {};
    entries.forEach(e => {
        const p = parseExamDate(e.exam.date);
        if (p) {
            if (!byDay[p.day]) byDay[p.day] = [];
            byDay[p.day].push(e);
        }
    });

    // Calendar grid: first day of month
    const firstDay = new Date(year, month, 1);
    // JS: 0=Sun, but in Israel week starts Sunday. Map: Sun=0→col0, Mon=1→col1 … Sat=6→col6
    const startCol = firstDay.getDay(); // 0=Sun=א
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Day header (Sun-Sat in Hebrew)
    const dayHeaders = ['א','ב','ג','ד','ה','ו','ש'].map(d =>
        `<div class="exam-cal-cell exam-cal-hdr">${d}'</div>`).join('');

    // Build cells
    let cells = '';
    // Blank cells before first day
    for (let i = 0; i < startCol; i++) cells += `<div class="exam-cal-cell exam-cal-empty"></div>`;

    for (let d = 1; d <= daysInMonth; d++) {
        const dayEntries = byDay[d] || [];
        const dateStr = `${String(d).padStart(2,'0')}/${String(month+1).padStart(2,'0')}/${year}`;
        const hasOverlap = overlapDates.has(dateStr) && dayEntries.some(e => e.enrolled);
        const dayOfWeek = new Date(year, month, d).getDay();
        const isShabbat = dayOfWeek === 6;

        const cards = dayEntries.map(e => {
            const moedClass = getMoedClass(e.exam.type);
            const moedLabel = e.exam.type || '';
            const alpha = e.enrolled ? '' : ' exam-card-unchosen';
            const timeStr = e.exam.time ? ` · ${e.exam.time}` : '';
            const accentColor = e.enrolled ? e.border : 'var(--border)';
            const cardBg = e.enrolled
                ? `color-mix(in srgb, ${e.bg} 18%, var(--card))`
                : 'var(--bg-alt)';
            const shoamLink = e.shoamId
                ? `<a href="https://courses.biu.ac.il/CourseDetails.aspx?lid=${e.shoamId}" target="_blank" rel="noopener"
                          onclick="event.stopPropagation()"
                          class="exam-card-shoham-link" title="פתח בשוהם">שוהם ↗</a>`
                : '';
            return `<div class="exam-card${alpha}"
                    style="border-right: 3px solid ${accentColor}; background: ${cardBg};"
                    title="${e.courseName}${timeStr}\n${moedLabel}"
                    onclick="openExamCardEdit('${e.courseName.replace(/'/g,"\\'")}')">
                    <div class="exam-card-top-row">
                        ${e.exam.time ? `<span class="exam-card-time" dir="ltr">${e.exam.time}</span>` : ''}
                        <span class="moed-badge-small ${moedClass}">${moedLabel.replace('מועד ','')}</span>
                    </div>
                    <span class="exam-card-name">${e.courseName}</span>
                    ${shoamLink}
                </div>`;
        }).join('');

        const overlapDot = hasOverlap ? `<span class="exam-overlap-dot" title="חפיפה!">⚠️</span>` : '';
        cells += `<div class="exam-cal-cell ${dayEntries.length > 0 ? 'exam-cal-has-events' : ''} ${isShabbat ? 'exam-cal-shabbat' : ''}">
                <div class="exam-cal-day-num">${d}${overlapDot}</div>
                <div class="exam-cal-cards">${cards}</div>
            </div>`;
    }

    // Fill trailing blank cells to complete the last row
    const totalCells = startCol + daysInMonth;
    const trailingBlanks = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailingBlanks; i++) cells += `<div class="exam-cal-cell exam-cal-empty"></div>`;

    return `<div class="exam-month-block">
            <div class="exam-month-title">${HE_MONTHS[month]} ${year}</div>
            <div class="exam-cal-grid">
                ${dayHeaders}
                ${cells}
            </div>
        </div>`;
}

// =====================================================================
// Exam editing (from searchAddDialog and from calendar card click)
// =====================================================================

let _examEditCourse = null; // hold the full course object for the edit dialog

function openExamCardEdit(courseName) {
    // Open the exams list for this course — find it from map
    const data = courseExamsMap.get(courseName);
    if (!data || data.exams.length === 0) {
        // No exams stored yet (e.g. course added before the exam feature) — open add dialog
        openAddExam(null, courseName);
        return;
    }
    if (data.exams.length === 1) {
        openEditExam(null, courseName, 0, true);
    } else {
        // Multiple exams — open the first; user can't currently navigate between them
        // from here, but at least it opens rather than silently doing nothing.
        openEditExam(null, courseName, 0, true);
    }
}

function openAddExam(courseId, courseName) {
    document.getElementById('examEditTitle').innerText = 'הוסף מועד בחינה';
    document.getElementById('examEditCourseId').value = courseId || '';
    document.getElementById('examEditExamIndex').value = '-1'; // -1 = new
    document.getElementById('examEditCourseName').value = courseName;
    document.getElementById('examEditType').value = "מועד א'";
    document.getElementById('examEditDate').value = '';
    document.getElementById('examEditTime').value = '09:00';
    document.getElementById('examEditDeleteBtn').style.display = 'none';
    _examEditCourse = { id: courseId, nameHe: courseName };
    document.getElementById('examEditDialog').showModal();
}

function openEditExam(courseId, courseName, examIndex, fromCalendar = false) {
    const data = courseExamsMap.get(courseName);
    const exams = data ? data.exams : [];

    // If from calendar and multiple exams, show the first one; user can navigate
    const exam = exams[examIndex] || null;

    document.getElementById('examEditTitle').innerText = exam ? 'ערוך מועד בחינה' : 'הוסף מועד בחינה';
    document.getElementById('examEditCourseId').value = courseId || '';
    document.getElementById('examEditExamIndex').value = examIndex;
    document.getElementById('examEditCourseName').value = courseName;
    document.getElementById('examEditType').value = exam ? exam.type : "מועד א'";
    document.getElementById('examEditDate').value = exam ? exam.date : '';
    document.getElementById('examEditTime').value = exam && exam.time ? exam.time : '09:00';
    document.getElementById('examEditDeleteBtn').style.display = exam ? 'inline-block' : 'none';
    _examEditCourse = { id: courseId, nameHe: courseName };
    document.getElementById('examEditDialog').showModal();
}

function saveExamEdit() {
    const courseName = document.getElementById('examEditCourseName').value;
    const examIndex = parseInt(document.getElementById('examEditExamIndex').value, 10);
    const type = document.getElementById('examEditType').value;
    const date = document.getElementById('examEditDate').value.trim();
    const time = document.getElementById('examEditTime').value;

    if (!date) return alert('יש להזין תאריך.');
    if (!parseExamDate(date)) return alert('פורמט תאריך שגוי. השתמשו ב-DD/MM/YYYY.');

    const newExam = { type, date, time };
    const stored = courseExamsMap.get(courseName) || { exams: [], courseCode: null };
    const exams = [...(stored.exams || [])];

    if (examIndex === -1) {
        exams.push(newExam);
    } else {
        exams[examIndex] = newExam;
    }
    // Sort by date
    exams.sort((a, b) => {
        const da = examToDate(a), db = examToDate(b);
        return (da && db) ? da - db : 0;
    });
    // Rebuild per-semester buckets from the updated flat list so the calendar
    // and the edit section both stay in sync after a save.
    const semKeysAfterSave = new Set(
        Object.keys(stored.examsBySemester || {}).concat(Object.keys(stored.shoamIdBySemester || {}))
    );
    if (semKeysAfterSave.size === 0) semKeysAfterSave.add('a').add('b').add('summer');
    const rebuiltBySem = splitExamsBySemester(exams, semKeysAfterSave);
    courseExamsMap.set(courseName, { ...stored, exams, examsBySemester: rebuiltBySem });
    saveCourseExamsToStorage();

    document.getElementById('examEditDialog').close();

    // Refresh whichever dialog is open
    if (_examEditCourse && document.getElementById('searchAddDialog').open) {
        const course = { ..._examEditCourse, nameHe: courseName, exams };
        renderExamsEditSection(course);
        // searchAddExams (read-only) is kept empty; the edit section covers everything
        const examsEl = document.getElementById('searchAddExams');
        if (examsEl) examsEl.innerHTML = '';
    }
    if (document.getElementById('examsDialog').open) renderExamsDialog();
}

function deleteExamEntry() {
    const courseName = document.getElementById('examEditCourseName').value;
    const examIndex = parseInt(document.getElementById('examEditExamIndex').value, 10);
    if (examIndex < 0) return;
    if (!confirm('למחוק מועד בחינה זה?')) return;

    const stored = courseExamsMap.get(courseName);
    if (!stored) return;
    const exams = stored.exams.filter((_, i) => i !== examIndex);
    // Rebuild per-semester buckets so the calendar stays in sync after deletion.
    const semKeysAfterDel = new Set(
        Object.keys(stored.examsBySemester || {}).concat(Object.keys(stored.shoamIdBySemester || {}))
    );
    if (semKeysAfterDel.size === 0) semKeysAfterDel.add('a').add('b').add('summer');
    const rebuiltBySemDel = splitExamsBySemester(exams, semKeysAfterDel);
    courseExamsMap.set(courseName, { ...stored, exams, examsBySemester: rebuiltBySemDel });
    saveCourseExamsToStorage();
    document.getElementById('examEditDialog').close();

    if (document.getElementById('searchAddDialog').open && _examEditCourse) {
        const course = { ..._examEditCourse, nameHe: courseName, exams };
        renderExamsEditSection(course);
        const examsEl = document.getElementById('searchAddExams');
        if (examsEl) examsEl.innerHTML = '';
    }
    if (document.getElementById('examsDialog').open) renderExamsDialog();
}

// When a card in the exams calendar is clicked — find all exams for that course
// and let the user pick which one to edit (or just open the first).
function openExamCardEditFromCalendar(courseName) {
    const data = courseExamsMap.get(courseName);
    if (!data || !data.exams || data.exams.length === 0) return;
    if (data.exams.length === 1) {
        openEditExam(null, courseName, 0, true);
    } else {
        // Show a small picker inline — open exam[0] for now, user can navigate
        openEditExam(null, courseName, 0, true);
    }
}
