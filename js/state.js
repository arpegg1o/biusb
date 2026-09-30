// ============================================================================
// Shared state & constants
//
// The schedule data everything else reads and writes (rawCourses, undo history, selected
// semester slices), runtime flags, icon SVGs, the type/semester/day lookup tables, and the
// save/undo primitives. Loaded first: other files only use it from inside functions.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

let rawCourses = [];
let historyStack = [];
let validSchedules = [];
let activeElectives = new Set();
let semesterIndices = { "א'": 0, "ב'": 0, "קיץ": 0 };
let activeAlternativeKey = null; 
let scheduleWorker = null; 
// True when the solver hit its cap and is only showing the best N schedules.
let scheduleListTruncated = false;
// Set while waiting for a pinned solve (see jumpToAlternative()).
let pendingPinRequest = null;
// Every solver request is tagged; a response whose tag is no longer the
// latest is stale (the user has since changed something) and is dropped,
// so a slow older result can never undo what's on screen.
let latestSolveSeq = 0;
let silentRefreshTimer = null;
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
