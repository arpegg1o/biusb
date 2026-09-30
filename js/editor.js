// ============================================================================
// Manual add / edit
//
// The manual add and edit dialogs (including extra-session rows) and saving edits.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

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

let manualEditFallbackId = null; // set only when reached via openAddMoreForCourse() on a search-based entry

const TYPE_MAP_REVERSE = Object.fromEntries(Object.entries(TYPE_MAP).map(([k, v]) => [v, k]));

// ✏️ Smart router: opens תצוגת רשימה (list dialog) for catalog-based
// courses so the user can swap groups easily. Falls back to עריכה ידנית
// only for manually-added courses where every type has just one option
// (nothing to pick from in a list).
async function openEdit(id) {
    manualEditFallbackId = id;
    const c = rawCourses.find(x => x.id === id);
    if (!c) return;

    const courseId = extractCourseIdFromGroupId(c.courseGroupId);
    if (courseId) {
        // Catalog course — open the list dialog (same as "תצוגת רשימה")
        try {
            const course = await fetchCourseDetail(courseId);
            currentSearchAddCourse = course;
            document.getElementById('searchAddManualEditBtn').style.display = 'inline-block';
            document.getElementById('searchAddDialog').showModal();
            renderSearchAddDialog(course);
        } catch (err) {
            // Fallback to manual edit if fetch fails
            openManualEditDialog(id);
        }
        return;
    }

    // Manually-added course: check if every type in rawCourses for this
    // course name has only one distinct option (one courseGroupId/id).
    // If so, open עריכה ידנית directly; otherwise open the list dialog.
    const courseName = c.name;
    const byType = {};
    rawCourses.filter(x => x.name === courseName).forEach(x => {
        const key = x.courseGroupId || x.id;
        if (!byType[x.type]) byType[x.type] = new Set();
        byType[x.type].add(key);
    });
    const hasMultipleOptions = Object.values(byType).some(s => s.size > 1);

    if (hasMultipleOptions) {
        // Show a synthetic list dialog for the manual course
        _openManualCourseListDialog(id);
    } else {
        openManualEditDialog(id);
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

    // Show a "תצוגת רשימה" button when this entry has a catalog course behind it.
    // We anchor to the editDeleteBtn's parent so we're always in the right footer
    // row without needing to know the footer's class name.
    const courseId = extractCourseIdFromGroupId(c.courseGroupId);
    let listViewBtn = document.getElementById('editDialogListViewBtn');
    if (!listViewBtn) {
        listViewBtn = document.createElement('button');
        listViewBtn.id = 'editDialogListViewBtn';
        listViewBtn.type = 'button';
        listViewBtn.className = 'btn-simple';
        listViewBtn.style.cssText = 'padding:6px 12px; font-size:13px;';
        listViewBtn.innerText = 'תצוגת רשימה';

        // Insert as the first child of the footer row that contains editDeleteBtn,
        // so all buttons sit on one flex line.
        const deleteBtn = document.getElementById('editDeleteBtn');
        const footerRow = deleteBtn ? deleteBtn.parentElement : null;
        if (footerRow) {
            // Make sure the footer is a flex row so everything sits inline
            footerRow.style.display = 'flex';
            footerRow.style.flexWrap = 'wrap';
            footerRow.style.gap = '8px';
            footerRow.style.alignItems = 'center';
            footerRow.insertBefore(listViewBtn, footerRow.firstChild);
        } else {
            document.getElementById('editDialog').appendChild(listViewBtn);
        }
    }
    if (courseId) {
        listViewBtn.style.display = 'inline-block';
        listViewBtn.onclick = async () => {
            document.getElementById('editDialog').close();
            try {
                const course = await fetchCourseDetail(courseId);
                manualEditFallbackId = id;
                currentSearchAddCourse = course;
                document.getElementById('searchAddManualEditBtn').style.display = 'inline-block';
                document.getElementById('searchAddDialog').showModal();
                renderSearchAddDialog(course);
            } catch(err) { alert('שגיאה בטעינת הקורס.'); }
        };
    } else {
        listViewBtn.style.display = 'none';
    }

    document.getElementById('editDialog').showModal();
}

/** Shows a simple group-picker for a manually-added course that has
 *  multiple options per type (no catalog data, so we synthesise the list
 *  from rawCourses directly). Uses the existing #searchAddDialog chrome. */
function _openManualCourseListDialog(id) {
    const c = rawCourses.find(x => x.id === id);
    if (!c) return;
    const courseName = c.name;

    // Group by type → list of distinct options (courseGroupId or id)
    const byType = {};
    rawCourses.filter(x => x.name === courseName).forEach(x => {
        const key = x.courseGroupId || x.id;
        if (!byType[x.type]) byType[x.type] = {};
        if (!byType[x.type][key]) byType[x.type][key] = [];
        byType[x.type][key].push(x);
    });

    let html = '';
    Object.entries(byType).forEach(([type, options]) => {
        const optList = Object.entries(options).map(([key, sessions]) => {
            const times = sessions.map(s => escapeHtml(`יום ${s.day}' ${s.start}-${s.end}`)).join(', ');
            const isActive = validSchedules.length > 0
                ? (validSchedules[semesterIndices[getCurrentSemester()]] || []).some(sc => (sc.courseGroupId || sc.id) === key)
                : false;
            return `
                    <div class="group-row${isActive ? ' added' : ''}">
                        <div>
                            <div style="font-size:12px; color:var(--text-muted);">${times}</div>
                        </div>
                        <button class="btn-simple" style="padding:5px 10px; font-size:12px;"
                                onclick="openEdit(${jsArg(sessions[0].id)}); document.getElementById('searchAddDialog').close();">
                            עריכה
                        </button>
                    </div>`;
        }).join('');
        html += `<div class="group-section"><h4>${escapeHtml(type)}</h4>${optList}</div>`;
    });

    // Reuse the searchAddDialog for display
    document.getElementById('searchAddTitle').innerText = courseName;
    document.getElementById('searchAddMeta').innerHTML = 'קורס ידני';
    document.getElementById('searchAddManualEditBtn').style.display = 'none';
    document.getElementById('searchAddGroups').innerHTML = html || '<p style="color:var(--text-muted); font-size:13px;">אין קבוצות.</p>';
    document.getElementById('searchAddExams').innerHTML = '';
    const examsEdit = document.getElementById('searchAddExamsEdit');
    if (examsEdit) examsEdit.innerHTML = '';
    document.getElementById('searchAddDialog').showModal();
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
