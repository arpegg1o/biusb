// ============================================================================
// Catalog data & merge logic
//
// Loading the catalog index / course files, merging groups that differ only by lecturer,
// re-syncing saved entries with the catalog (with its toast + undo), and linking older
// manually-added courses to catalog courses.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

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
            fetch('data/search-index.json', { cache: 'no-cache' }),
            fetch('data/departments.json', { cache: 'no-cache' }),
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

    // If the person started typing while the catalog was still loading, the
    // dropdown is showing "loading…" and nothing else would ever redraw it.
    const searchDropdown = document.getElementById('searchResultsDropdown');
    if (searchDropdown && searchDropdown.style.display !== 'none') onSearchInput();
}

function fetchCourseDetail(id) {
    if (!courseDetailCache.has(id)) {
        courseDetailCache.set(id, fetch(`data/courses/${id}.json`, { cache: 'no-cache' }).then((r) => {
            if (!r.ok) throw new Error(`Failed to load course ${id}: ${r.status}`);
            return r.json();
        }).then((course) => {
            registerCourseExams(course);
            return course;
        }));
    }
    return courseDetailCache.get(id);
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

// Folds one source group's clusters / remark / Shoham + syllabus links into a
// merged entry (see getMergedGroups). Duplicates are skipped.
function absorbGroupMeta(entry, g, lecturer, code) {
    (Array.isArray(g.clusters) ? g.clusters : []).forEach((c) => {
        if (c && !entry.clusters.includes(c)) entry.clusters.push(c);
    });
    const remark = (g.remark || '').trim();
    if (remark && !entry.remarks.includes(remark)) entry.remarks.push(remark);
    if (g.shoamId || g.syllabus) {
        const shoamId = g.shoamId || null;
        const syllabus = g.syllabus || null;
        const dup = entry.links.some((l) => l.shoamId === shoamId && l.syllabus === syllabus);
        if (!dup) entry.links.push({ groupCode: code, lecturerName: lecturer, shoamId, syllabus });
    }
}

// One entry per source group; further groups are folded in with addToGroupEntry().
function newGroupEntry(g) {
    const lecturer = (g.lecturerName || '').trim();
    const code = (g.groupCode === undefined || g.groupCode === null) ? '' : String(g.groupCode);
    const entry = Object.assign({}, g, {
        mergedIds: [g.id],
        lecturerNames: lecturer ? [lecturer] : [],
        groupCodes: code ? [code] : [],
        clusters: [],
        remarks: [],
        links: [],
    });
    absorbGroupMeta(entry, g, lecturer, code);
    return entry;
}

function addToGroupEntry(entry, g) {
    const lecturer = (g.lecturerName || '').trim();
    const code = (g.groupCode === undefined || g.groupCode === null) ? '' : String(g.groupCode);
    entry.mergedIds.push(g.id);
    if (lecturer && !entry.lecturerNames.includes(lecturer)) entry.lecturerNames.push(lecturer);
    if (code && !entry.groupCodes.includes(code)) entry.groupCodes.push(code);
    absorbGroupMeta(entry, g, lecturer, code);
}

function finalizeGroupEntry(e) {
    e.lecturerName = e.lecturerNames.join('/');
    e.groupCode = e.groupCodes.join('/');
    // Merged metadata (nothing from the combined groups is dropped):
    //  - clusters: de-duplicated union
    //  - remark:   distinct remarks joined with " | " (single remark if they agree)
    //  - shoamIds / syllabi: every distinct id / link; shoamId / syllabus keep the
    //    first one for callers that only read a single value
    //  - links: per-group { groupCode, lecturerName, shoamId, syllabus } so each
    //    lecturer/group can be tied to its own link
    e.remark = e.remarks.join(' | ');
    e.shoamIds = [...new Set(e.links.map((l) => l.shoamId).filter(Boolean))];
    e.syllabi = [...new Set(e.links.map((l) => l.syllabus).filter(Boolean))];
    if (e.shoamIds.length) e.shoamId = e.shoamIds[0];
    if (e.syllabi.length) e.syllabus = e.syllabi[0];
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

        if (existing) {
            addToGroupEntry(existing, g);
            continue;
        }

        const entry = newGroupEntry(g);
        merged.push(entry);
        if (key) byKey.set(key, entry);
    }

    merged.forEach(finalizeGroupEntry);

    // Non-enumerable so it never leaks into anything that serializes the
    // cached course object.
    Object.defineProperty(course, '__mergedGroups', { value: merged, enumerable: false });
    return merged;
}

/** The groups as the LIST view (#searchAddDialog) shows them. Same as
 * getMergedGroups(), except that a merged option whose source groups carry
 * DIFFERENT remarks is shown as separate rows (grouped by remark), so a
 * remark that belongs to one lecturer's group never appears under the other.
 * Only the list view uses this: the calendar preview, the schedule and
 * everything else keep using the fully merged groups. Each entry has the
 * same shape as a merged one (mergedIds = the source ids it stands for). */
function getListViewGroups(course) {
    if (!course || !Array.isArray(course.groups)) return [];
    if (course.__listViewGroups) return course.__listViewGroups;

    const out = [];
    for (const m of getMergedGroups(course)) {
        const sources = m.mergedIds.length > 1
            ? m.mergedIds.map((id) => course.groups.find((g) => g.id === id)).filter(Boolean)
            : [];
        const remarkOf = (g) => (g.remark || '').trim();
        if (sources.length < 2 || new Set(sources.map(remarkOf)).size < 2) { out.push(m); continue; }

        const byRemark = new Map();   // sources with the same remark stay merged
        for (const g of sources) {
            const k = remarkOf(g);
            if (byRemark.has(k)) addToGroupEntry(byRemark.get(k), g);
            else byRemark.set(k, newGroupEntry(g));
        }
        byRemark.forEach((e) => { finalizeGroupEntry(e); out.push(e); });
    }

    Object.defineProperty(course, '__listViewGroups', { value: out, enumerable: false });
    return out;
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

/** Same lookup, over the list view's groups (see getListViewGroups()). */
function findListViewGroup(course, groupId) {
    const groups = getListViewGroups(course);
    return groups.find((g) => g.id === groupId)
        || groups.find((g) => mergedGroupIds(g).includes(groupId))
        || null;
}


// =====================================================================
// Catalog re-sync
//
// Entries added from the catalog are stored in localStorage with the
// day/time frozen at the moment they were added. If the catalog data
// for that group was wrong then (or has since been corrected), the saved
// entries kept showing the old, wrong meetings forever — a hard refresh
// doesn't touch localStorage. On load, re-derive the meetings of every
// catalog-linked group from the freshly fetched course file whenever the
// saved entries no longer match it. Groups that no longer exist in the
// catalog file are left untouched.
// =====================================================================
// Compares the saved entries of ONE catalog group with the group's meetings
// in the freshly fetched catalog. Returns null when nothing needs to
// change, otherwise { entries, have, want, fresh }: the stale saved
// entries and the replacement entries built from the catalog.
function planCatalogSync(list, group) {
    if (!group || !group.meetings || group.meetings.length === 0) return null; // timeless — nothing to compare
    const entries = list.filter(c => c.courseGroupId === group.id && !c.timeless);
    if (entries.length === 0) return null;

    const meetings = group.meetings.filter(m => DAY_LETTERS[m.dayOfWeek]);
    // Nothing the calendar can show (e.g. only a Saturday meeting): leave
    // the user's entries alone rather than deleting them.
    if (meetings.length === 0) return null;

    const want = meetings.map(m => `${DAY_LETTERS[m.dayOfWeek]}|${formatMinutesToTime(m.startMinutes)}|${formatMinutesToTime(m.endMinutes)}`);
    const have = entries.map(c => `${c.day}|${c.start}|${c.end}`);
    if (want.slice().sort().join(',') === have.slice().sort().join(',')) return null;

    const first = entries[0];
    const fresh = meetings.map(m => ({
        id: Date.now() + Math.random().toString(36).substring(2, 8),
        courseGroupId: group.id,
        name: first.name,
        type: TYPE_MAP[group.type] || first.type,
        semester: SEMESTER_MAP[group.semester] || first.semester,
        day: DAY_LETTERS[m.dayOfWeek],
        start: formatMinutesToTime(m.startMinutes),
        end: formatMinutesToTime(m.endMinutes),
        isElective: first.isElective,
        color: first.color || null,
    }));
    return { entries, have, want, fresh };
}

// Toast text for the entries that were just re-synced.
function formatCatalogSyncMessage(updates) {
    if (updates.length === 1) {
        const u = updates[0];
        const group = u.groupCode ? `הקבוצה ${u.groupCode} של ` : '';
        return `${group}"${u.name}" עודכנה בהתאם לקטלוג.`;
    }
    return `${updates.length} קבוצות עודכנו בהתאם לקטלוג.`;
}

// Applies every needed correction for the fetched catalog courses.
// The pre-sync state is put on the undo stack FIRST (updateUI(true) would
// snapshot the already-corrected schedule, making "undo" a no-op), and the
// person is told — a block that moves on its own is otherwise baffling.
function applyCatalogSync(courses) {
    const updates = [];
    let snapshot = null;
    courses.forEach(course => {
        if (!course || !Array.isArray(course.groups)) return;
        course.groups.forEach(group => {
            const plan = planCatalogSync(rawCourses, group);
            if (!plan) return;
            if (snapshot === null) {
                saveState(true);
                snapshot = historyStack[historyStack.length - 1];
            }
            const firstIdx = rawCourses.indexOf(plan.entries[0]);
            const stale = new Set(plan.entries);
            rawCourses = rawCourses.filter(c => !stale.has(c));
            rawCourses.splice(Math.min(firstIdx, rawCourses.length), 0, ...plan.fresh);
            console.info('[syncCatalog] refreshed', group.id, 'from', plan.have, 'to', plan.want);
            updates.push({ name: plan.entries[0].name, groupCode: group.groupCode, courseCode: course.courseCode });
        });
    });
    if (updates.length === 0) return updates;

    saveState(false);   // persist the corrected schedule without adding a second history entry
    updateUI(false);
    showToast(formatCatalogSyncMessage(updates), 12000, {
        label: 'בטל',
        onClick: () => undoCatalogSync(snapshot),
    });
    return updates;
}

// Only reverts if nothing else has happened since — otherwise "undo" would
// silently undo the person's own later edit instead of the sync.
function undoCatalogSync(snapshot) {
    if (historyStack[historyStack.length - 1] !== snapshot) {
        showToast('בוצעו שינויים נוספים מאז — אפשר להשתמש בכפתור הביטול.', 5000);
        return;
    }
    undoAction();
    showToast('העדכון מהקטלוג בוטל');
}

function _syncCatalogEntries() {
    console.info('[syncCatalog] build 20260929-3 running');
    const courseIds = new Set();
    rawCourses.forEach(c => {
        const id = extractCourseIdFromGroupId(c.courseGroupId);
        if (id) courseIds.add(id);
    });
    if (courseIds.size === 0) return;

    Promise.all([...courseIds].map(id =>
        fetchCourseDetail(id).catch(() => null)
    )).then(applyCatalogSync);
}

// =====================================================================
// Legacy-course linking
//
// Courses that were added via paste/manual-entry before the search flow
// existed (or imported from an old JSON export) have no catalog-style
// courseGroupId, so they don't get the "+" button or exam data.
//
// This function runs once per page load (after the catalog index has
// settled).  For every group of rawCourses entries that share a name and
// have no valid catalog courseGroupId, it searches the catalog for a
// course with the same name (exact match).  If found, it fetches the
// course detail and checks whether ALL the existing sessions (identified
// by type + day + start + end) are present inside any of that catalog
// course's groups.  When they are, it rewrites the courseGroupId of those
// entries to the matching catalog group's id — giving them the "+" button,
// elective management, and (via registerCourseExams / _seedMissingCourseExams)
// exam data on the next pass.
//
// The check is intentionally strict: ALL sessions of a manually-entered
// group must be found in the catalog group.  Partial matches are ignored
// so we never silently rewrite an entry that the user customised by hand.
// =====================================================================
// Tracks which course names were successfully linked this session
// (not used to skip failed attempts — those always retry).
const _linkedThisSession = new Set();

function _linkLegacyCourses() {
    if (!catalogIndex || catalogIndex.length === 0) {
        console.debug('[linkLegacy] catalog not ready yet, skipping');
        return;
    }

    // Collect names that need linking (no valid catalog courseGroupId).
    const namesToLink = new Set(
        rawCourses
            .filter(c => !extractCourseIdFromGroupId(c.courseGroupId))
            .map(c => c.name)
    );
    if (namesToLink.size === 0) {
        console.debug('[linkLegacy] nothing to link');
        return;
    }

    console.debug('[linkLegacy] names to link:', [...namesToLink]);

    // Build TWO lookups for maximum coverage:
    //   1. normalised-name → catalog entries (exact fuzzy-normalised match)
    //   2. exact Hebrew name → catalog entries (direct nameHe match)
    // Each maps to an ARRAY, not a single entry: the same Hebrew course
    // name can legitimately appear more than once in the catalog (cross-
    // listed courses, the same course offered under a different course
    // code by another department/track, etc). Keeping only the first hit
    // meant that whenever THAT entry happened to be the wrong one, linking
    // silently failed for every option even though a correct match existed
    // elsewhere in the catalog under the same name.
    const catalogByNormName = new Map();
    const catalogByExactName = new Map();
    catalogIndex.forEach(entry => {
        const norm = normalizeForFuzzyMatch(entry.nameHe);
        if (!catalogByNormName.has(norm)) catalogByNormName.set(norm, []);
        catalogByNormName.get(norm).push(entry);
        if (!catalogByExactName.has(entry.nameHe)) catalogByExactName.set(entry.nameHe, []);
        catalogByExactName.get(entry.nameHe).push(entry);
    });

    namesToLink.forEach(courseName => {
        // Only skip names that were SUCCESSFULLY linked — don't skip failed attempts.
        if (_linkedThisSession.has(courseName)) return;

        // Try exact-name candidates first, then normalised-match candidates,
        // de-duplicated by id (an entry can satisfy both lookups).
        const norm = normalizeForFuzzyMatch(courseName);
        const seenIds = new Set();
        const candidates = [
            ...(catalogByExactName.get(courseName) || []),
            ...(catalogByNormName.get(norm) || []),
        ].filter(entry => {
            if (seenIds.has(entry.id)) return false;
            seenIds.add(entry.id);
            return true;
        });

        if (candidates.length === 0) {
            console.debug('[linkLegacy] no catalog match for:', courseName, '(norm:', norm + ')');
            return; // not in catalog — leave as-is
        }

        console.debug('[linkLegacy] found', candidates.length, 'catalog candidate(s) for:', courseName,
            '→', candidates.map(c => c.id));

        // For each distinct "option group" of the manually-entered course
        // (entries that share the same courseGroupId, or the same id when
        // courseGroupId is null), try to find a matching catalog group.
        const optionKeys = new Set(
            rawCourses
                .filter(c => c.name === courseName && !extractCourseIdFromGroupId(c.courseGroupId))
                .map(c => c.courseGroupId || c.id)
        );
        if (optionKeys.size === 0) return;

        console.debug('[linkLegacy]', courseName, '— option groups to try:', optionKeys.size);

        // Try each candidate catalog entry in turn, stopping at the first
        // one that actually matches at least one option. Only after every
        // candidate has failed do we give up on this course name.
        function tryCandidate(i) {
            if (i >= candidates.length) {
                console.debug('[linkLegacy] failed to link any groups for', courseName,
                    '— tried', candidates.length, 'catalog candidate(s)');
                return;
            }
            const catalogEntry = candidates[i];

            fetchCourseDetail(catalogEntry.id).then(course => {
                let anyLinked = false;

                optionKeys.forEach(optKey => {
                    const sessions = rawCourses.filter(
                        c => c.name === courseName && (c.courseGroupId || c.id) === optKey
                    );
                    if (sessions.length === 0) return;

                    // Build a set of "type|day|start|end" signatures for this option.
                    const sessionSigs = new Set(
                        sessions.map(s => `${TYPE_MAP_REVERSE[s.type] || s.type}|${s.day}|${s.start}|${s.end}`)
                    );

                    console.debug('[linkLegacy] candidate', catalogEntry.id, 'option', optKey, 'sigs:', [...sessionSigs]);

                    // Look for a catalog group that contains ALL these sessions.
                    // Also try a "subset" match: at least one session matches and
                    // the catalog group has the same type — for courses where the
                    // manually-entered data may be a partial subset of the group.
                    let matchingGroup = (course.groups || []).find(g => {
                        if (g.type === 'other') return false;
                        const catalogSigs = new Set(
                            g.meetings.map(m => {
                                const day = DAY_LETTERS[m.dayOfWeek];
                                const start = formatMinutesToTime(m.startMinutes);
                                const end   = formatMinutesToTime(m.endMinutes);
                                return `${g.type}|${day}|${start}|${end}`;
                            })
                        );
                        // Every manually-entered session must be present in the catalog group.
                        return [...sessionSigs].every(sig => catalogSigs.has(sig));
                    });

                    if (!matchingGroup) {
                        // Fallback: try matching by type only — find the first catalog
                        // group whose type matches any of this option's sessions.
                        // Useful when a pasted course has fewer sessions than the catalog
                        // (e.g. only one meeting time captured out of two).
                        const sessionTypes = new Set(sessions.map(s => TYPE_MAP_REVERSE[s.type] || s.type));
                        const typeOnlyMatch = (course.groups || []).find(g =>
                            g.type !== 'other' && sessionTypes.has(g.type) &&
                            g.meetings.some(m => {
                                const day = DAY_LETTERS[m.dayOfWeek];
                                const start = formatMinutesToTime(m.startMinutes);
                                const end   = formatMinutesToTime(m.endMinutes);
                                return sessionSigs.has(`${g.type}|${day}|${start}|${end}`);
                            })
                        );
                        if (typeOnlyMatch) {
                            console.debug('[linkLegacy] partial match (type+time subset) for', courseName, 'group', optKey, '→ catalog group', typeOnlyMatch.id);
                            matchingGroup = typeOnlyMatch;
                        } else {
                            console.debug('[linkLegacy] no catalog group matched for', courseName, 'option', optKey, 'in candidate', catalogEntry.id,
                                '\n  session sigs:', [...sessionSigs],
                                '\n  catalog groups:', (course.groups || []).filter(g => g.type !== 'other').map(g => ({
                                    id: g.id, type: g.type,
                                    sigs: g.meetings.map(m => `${g.type}|${DAY_LETTERS[m.dayOfWeek]}|${formatMinutesToTime(m.startMinutes)}|${formatMinutesToTime(m.endMinutes)}`)
                                }))
                            );
                            return;
                        }
                    }

                    console.debug('[linkLegacy] linking', courseName, 'option', optKey, '→ catalog group', matchingGroup.id, '(candidate', catalogEntry.id + ')');

                    // Rewrite the courseGroupId for all sessions in this option.
                    sessions.forEach(s => { s.courseGroupId = matchingGroup.id; });
                    anyLinked = true;
                });

                if (anyLinked) {
                    _linkedThisSession.add(courseName); // only mark success
                    // Persist the updated courseGroupIds and pick up exam data.
                    saveState(false);
                    // Kick off exam seeding now that the entries have real groupIds.
                    _seedMissingCourseExams();
                    // Re-render if the exam dialog or course list is open.
                    if (document.getElementById('examsDialog').open) renderExamsDialog();
                    updateUI(false);
                    console.debug('[linkLegacy] successfully linked', courseName, 'via catalog candidate', catalogEntry.id);
                } else {
                    console.debug('[linkLegacy] catalog candidate', catalogEntry.id, 'matched nothing for', courseName, '— trying next candidate');
                    tryCandidate(i + 1);
                }
            }).catch(err => {
                console.debug('[linkLegacy] fetch failed for', catalogEntry.id, err);
                tryCandidate(i + 1);
            });
        }

        tryCandidate(0);
    });
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
