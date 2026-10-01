// ============================================================================
// Course list & electives sidebar
//
// The sidebar course list, elective toggles, and removing courses / clearing everything.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

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
                <span>${escapeHtml(name)}</span>
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
                        <span>${escapeHtml(name)}</span>
                        <div style="display:flex; border: 1px solid var(--border); border-radius:4px; overflow:hidden;">
                            <button class="make-elective-btn ${reqBtnClass}" style="border-radius:0" onclick="toggleCourseGlobalElectiveState(${jsArg(name)}, false)">חובה</button>
                            <button class="make-elective-btn ${eleBtnClass}" style="border-radius:0" onclick="toggleCourseGlobalElectiveState(${jsArg(name)}, true)">בחירה</button>
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
            const timeStrings = sessions.map(s => escapeHtml(`יום ${s.day}' | ${s.start} - ${s.end}`)).join('<br>');
            
            const row = document.createElement('div');
            row.className = 'course-option-row';
            
            const editBtnHtml = sessions.length === 1 ? `<button class="icon-btn" onclick="openEdit(${jsArg(first.id)})" title="עריכה ידנית">✏️</button>` : '';
            const addMoreBtnHtml = extractCourseIdFromGroupId(first.courseGroupId)
                ? `<button class="icon-btn" onclick="openAddMoreForCourse(${jsArg(first.id)})" title="הוסף חלקים נוספים לקורס (הרצאה/תרגיל/מעבדה...)">➕</button>`
                : '';

            row.innerHTML = `
                    <div style="font-size:14px; display:flex; align-items:flex-start; gap:10px;">
                        <span class="class-type" style="background:#7f8c8d; font-size:12px; margin-top:2px;">${escapeHtml(first.type)}</span>
                        <div>
                            <div style="font-weight:bold; font-size:12px; margin-bottom:4px;">סמסטר ${escapeHtml(first.semester)}</div>
                            <span dir="ltr" style="display:inline-block; font-size:12px; line-height: 1.4;">${timeStrings}</span>
                        </div>
                    </div>
                    <div>
                        ${editBtnHtml}
                        ${addMoreBtnHtml}
                        <button class="icon-btn" onclick="deleteCourseGroup(${jsArg(first.courseGroupId || first.id)})" title="מחק שורה זו (ימחק את כל הימים של קבוצה זו)">🗑️</button>
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
        semesterChoices = {}; localStorage.removeItem('mySchedulesChoices');
        localStorage.removeItem('mySchedulesHistory');
        detachFromSavedSchedule();
        updateUI(false);
    }
}
