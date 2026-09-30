// ============================================================================
// Course search box
//
// Hebrew text normalisation, the uFuzzy search setup, the department-filtered catalog view,
// and the search dropdown (typing, result list, "load more", picking a result).
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

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
