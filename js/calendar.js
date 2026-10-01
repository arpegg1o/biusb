// ============================================================================
// Calendar rendering
//
// Building the event blocks, the timeless strip and the week grid; the tap/keyboard "expand"
// behaviour of compact blocks; table zoom, pinch-zoom and full screen.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

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
                <div class="class-title">${escapeHtml(cls.name)}</div>
                ${cls.lecturerName ? `<div style="font-size: clamp(8px, 10cqw, 10px); margin-top: 1px;">${escapeHtml(cls.lecturerName)}</div>` : ''}
                <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span></div>
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
    el.style.setProperty('--event-border-color', colors.border);

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
        
        const existsInValid = scheduleListTruncated || validSchedules.some(s => s.some(c => c.id === cls.id));
        
        if (conflictingClass) {
            el.style.color = 'var(--text-main)';
            if (devModeAllowOverlaps) {
                el.style.borderColor = 'var(--danger)';
                el.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                el.title = `חפיפה עם ${conflictingClass.name} (מצב מפתח)`;
                
                el.innerHTML = `
                        <div class="class-title" title="${escapeHtml(cls.name)}">${escapeHtml(cls.name)}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span></div>
                        <div style="font-size: 10px; color: var(--danger); margin-top: 4px; font-weight: bold;">(ייצור חפיפה)</div>
                    `;
            }
            else if (existsInValid) {
                el.style.borderColor = 'var(--icon-conditional)';
                el.style.backgroundColor = 'rgba(230, 126, 34, 0.1)';
                el.title = `הזזה לכאן תזיז גם את ${conflictingClass.name}`;
                
                el.innerHTML = `
                        <div class="class-title" title="${escapeHtml(cls.name)}">${escapeHtml(cls.name)}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span></div>
                        <div style="font-size: 10px; color: var(--icon-conditional); margin-top: 4px; font-weight: bold;">(יזיז שיעור אחר)</div>
                    `;
            } else if (conflictingClass.isElective) {
                el.style.borderColor = 'var(--danger)';
                el.style.backgroundColor = 'rgba(231, 76, 60, 0.05)';
                el.title = `הזזה לכאן תמחק את קורס הבחירה ${conflictingClass.name}`;
                
                let extraHTML = `
                    <div style="margin-top: 5px; z-index: 10;">
                        <button class="box-btn danger" style="padding: 3px 6px; font-size: 10px; width: 100%; border-radius: 4px; color: white; background: var(--danger); border: none; font-weight: bold; cursor: pointer;" 
                                onclick="removeElectiveAndJump(${jsArg(conflictingClass.name)}, ${jsArg(cls.id)}, event)" title="לחץ כדי למחוק את קורס הבחירה ולשבץ פה">
                            הסר '${escapeHtml(conflictingClass.name)}'
                        </button>
                    </div>`;

                el.innerHTML = `
                        <div class="class-title" title="${escapeHtml(cls.name)}">${escapeHtml(cls.name)}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span></div>
                        <div style="font-size: 10px; color: var(--danger); margin-top: 4px; font-weight: bold;">(ימחק את '${escapeHtml(conflictingClass.name)}')</div>
                        ${extraHTML}
                    `;
            } else {
                el.style.borderColor = 'var(--danger)';
                el.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                el.classList.add('dimmed');
                el.title = `מתנגש עם חובה: ${conflictingClass.name}`;
                el.innerHTML = `
                        <div class="class-title" title="${escapeHtml(cls.name)}">${escapeHtml(cls.name)}</div>
                        <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span></div>
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
                el.onclick = () => jumpToAlternative(cls.id);
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

            el.onclick = () => jumpToAlternative(cls.id);
            el.innerHTML = `
                    <div class="class-title" title="${escapeHtml(cls.name)}">${escapeHtml(cls.name)}</div>
                    <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px); margin-top: 2px;"><span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span></div>
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

        const isLocked = status === 'locked';

        let buttonsHTML = `
                <button type="button" class="box-btn" 
                        onclick="event.stopPropagation(); openEdit(${jsArg(cls.id)})" 
                        onpointerdown="event.stopPropagation()"
                        title="עריכה ידנית (יום/שעה/סוג/שם)">${editIconSVG}</button>
                <button type="button" class="box-btn ${isLocked ? 'locked' : ''}" 
                        ${isLocked ? 'aria-disabled="true"' : ''}
                        onclick="event.stopPropagation(); ${isLocked ? 'event.preventDefault();' : `toggleAlternatives(${jsArg(courseKey)})`}" 
                        onpointerdown="event.stopPropagation()"
                        title="${isLocked ? 'נעול - אין אופציות אחרות' : 'הצג חלופות קיימות (או גרור את השיעור)'}" 
                        style="color: ${statusColor};">
                    ${searchIconSVG}
                </button>
            `;

        if (cls.isElective) {
            buttonsHTML = `
                    <button type="button" class="box-btn delete-btn" 
                            onclick="event.stopPropagation(); toggleSidebarElective(${jsArg(cls.name)})" 
                            onpointerdown="event.stopPropagation()"
                            title="הסר קורס בחירה" style="color:var(--danger)">
                        ${minusIconSVG}
                    </button>
                    ${buttonsHTML}
                `;
        }

        if (extractCourseIdFromGroupId(cls.courseGroupId)) {
            buttonsHTML = `
                    <button type="button" class="box-btn" 
                            onclick="event.stopPropagation(); openAddMoreForCourse(${jsArg(cls.id)})" 
                            onpointerdown="event.stopPropagation()"
                            title="הוסף חלקים נוספים לקורס (הרצאה/תרגיל/מעבדה...)">
                        ${plusIconSVG}
                    </button>
                    ${buttonsHTML}
                `;
        }

        el.innerHTML = `
                <div class="class-content" style="text-align:center;">
                    <div class="box-actions">${buttonsHTML}</div>
                    <div class="class-title" title="${escapeHtml(cls.name)}">${escapeHtml(cls.name)}</div>
                    <div class="class-meta">
                        <span class="class-type">${escapeHtml(cls.type)}</span>
                        ${cls.isElective ? '<span class="elective-badge">בחירה</span>' : ''}
                    </div>
                    <div class="class-time" style="font-size: clamp(9px, 11cqw, 11px);">
                        <span dir="ltr">${escapeHtml(cls.start)} - ${escapeHtml(cls.end)}</span>
                    </div>
                </div>
            `;
    }
    return el;
}

function renderTimelessStrip() {
    const strip = document.getElementById('timelessStrip');
    if (!strip) return;

    const currentSem = getCurrentSemester();
    const currentIdx = semesterIndices[currentSem] || 0;
    const schedule = validSchedules[currentIdx] || [];

    // Collect timeless entries from the current schedule (unique by courseGroupId)
    const seen = new Set();
    const timeless = schedule.filter(c => {
        if (!c.timeless) return false;
        const key = c.courseGroupId || c.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // While a course's alternatives are open, its no-hours groups that
    // are NOT currently chosen are offered here too — they have no
    // place on the calendar grid, so this strip is the only place
    // they can be picked from.
    const timelessAlts = [];
    if (activeAlternativeKey) {
        const seenAlt = new Set(seen);
        rawCourses.forEach(c => {
            if (!c.timeless) return;
            if (!(c.semester === currentSem || c.semester === "שנתי")) return;
            if (`${c.name} - ${c.type}` !== activeAlternativeKey) return;
            const key = c.courseGroupId || c.id;
            if (seenAlt.has(key)) return;
            seenAlt.add(key);
            timelessAlts.push(c);
        });
    }

    if (timeless.length === 0 && timelessAlts.length === 0) {
        strip.style.display = 'none';
        return;
    }

    strip.style.display = '';
    strip.innerHTML = '';

    const label = document.createElement('div');
    label.className = 'timeless-strip-label';
    label.textContent = 'קורסים ללא שעות קבועות:';
    strip.appendChild(label);

    const chips = document.createElement('div');
    chips.className = 'timeless-chips';
    strip.appendChild(chips);

    const makeChip = (c, opts) => {
        const colors = getCourseStyle(c.name, c.type, c.color);
        const chip = document.createElement('span');
        chip.className = 'timeless-chip' + (opts.ghost ? ' ghost' : '') + (opts.clickable ? ' clickable' : '') + (opts.dimmed ? ' dimmed' : '');
        chip.style.background = colors.bg;
        chip.style.borderColor = colors.border;
        chip.style.color = colors.text;
        if (opts.title) chip.title = opts.title;

        const nameEl = document.createElement('span');
        nameEl.textContent = c.name;
        chip.appendChild(nameEl);

        const typeEl = document.createElement('span');
        typeEl.className = 'timeless-chip-type';
        typeEl.textContent = c.type;
        chip.appendChild(typeEl);

        if (opts.icon) {
            const iconEl = document.createElement('span');
            iconEl.className = 'timeless-chip-icon';
            iconEl.textContent = opts.icon;
            chip.appendChild(iconEl);
        }
        if (opts.onClick) {
            chip.setAttribute('role', 'button');
            chip.tabIndex = 0;
            chip.addEventListener('click', opts.onClick);
            chip.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); opts.onClick(); }
            });
        }
        return chip;
    };

    timeless.forEach(c => {
        const courseKey = `${c.name} - ${c.type}`;
        const status = getSearchStatus(c, schedule);
        const canSwitch = status !== 'locked';
        chips.appendChild(makeChip(c, {
            clickable: canSwitch,
            dimmed: !!activeAlternativeKey && activeAlternativeKey !== courseKey,
            icon: canSwitch ? '🔍' : '',
            title: canSwitch ? 'הצג חלופות קיימות (קבוצות אחרות של אותו קורס)' : 'נעול - אין אופציות אחרות',
            onClick: canSwitch ? () => toggleAlternatives(courseKey) : null,
        }));
    });

    timelessAlts.forEach(c => {
        chips.appendChild(makeChip(c, {
            ghost: true,
            clickable: true,
            icon: '⇄',
            title: 'קבוצה ללא שעות קבועות - לחיצה לבחירה',
            onClick: () => jumpToAlternative(c.id),
        }));
    });
}

function renderCalendar() {
    const days = DAY_LETTERS;
    days.forEach(day => document.getElementById(`day-${day}`).innerHTML = '');
    renderTimelessStrip();
    
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
        const allAlternatives = getAlternativeEntries(currentSem, activeAlternativeKey, schedule);
        allAlternatives.forEach(alt => {
            if (!schedule.some(c => c.id === alt.id)) classesToRender.push(alt);
        });
    }

    const timedClassesToRender = classesToRender.filter(cls => cls.day && cls.start && cls.end);
    if (timedClassesToRender.length === 0 && previewGhosts.length === 0) {
        minHour = 8; maxHour = 20;
    } else {
        timedClassesToRender.forEach(cls => {
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
        if (!cls.day || !cls.start || !cls.end) return; // timeless — shown in strip below calendar
        if(elementsByDay[cls.day]) elementsByDay[cls.day].push({ classData: cls, isGhost: false });
    });

    previewGhosts.forEach(({ classData, day }) => {
        if (elementsByDay[day]) elementsByDay[day].push({ classData, isGhost: true });
    });

    if (activeAlternativeKey) {
        const allAlternatives = getAlternativeEntries(currentSem, activeAlternativeKey, schedule);
        allAlternatives.forEach(altClass => {
            if (!altClass.day || !altClass.start || !altClass.end) return; // timeless
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
                // How far (in % of THIS block's width) the column extends beyond
                // the block on each side. The hover-enlarged card uses these to
                // grow across the whole day column, as if nothing overlapped it.
                el.style.setProperty('--ext-right', (rightPercent / widthPercent * 100).toFixed(3));
                el.style.setProperty('--ext-left', (Math.max(0, 100 - rightPercent - widthPercent) / widthPercent * 100).toFixed(3));
                el.style.left = 'auto'; 
                el.style.marginRight = numCols === 1 ? '0' : '2px';

                // Classify blocks by height so CSS can scale content and
                // enable hover-expand for tight ones:
                //   data-small  (< 32px): micro — only tiny buttons + 1-line title
                //   data-medium (32–79px): compact — smaller buttons, 1-2 line title, no badges
                //   (none)      (≥ 80px): full layout — all content visible at rest
                const blockH = parseFloat(el.style.height) || 0;
                if (el.classList.contains('ghost')) {
                    el.removeAttribute('data-small');
                    el.removeAttribute('data-medium');
                    el.removeAttribute('data-btn-rows');
                } else if (blockH < 32) {
                    el.setAttribute('data-small', '');
                    el.removeAttribute('data-medium');
                    el.removeAttribute('data-btn-rows');
                } else if (blockH < 80) {
                    el.setAttribute('data-medium', '');
                    el.removeAttribute('data-small');
                    el.removeAttribute('data-btn-rows');
                } else {
                    el.removeAttribute('data-small');
                    el.removeAttribute('data-medium');

                    // For full-size blocks, check if buttons fit in one row.
                    // Each .box-btn is 22px wide + 2px gap, plus 6px total padding.
                    // Count buttons by querying the rendered .box-actions children.
                    const boxActions = el.querySelector('.box-actions');
                    if (boxActions) {
                        const btnCount = boxActions.querySelectorAll('.box-btn').length;
                        const btnRowWidth = btnCount * 22 + Math.max(0, btnCount - 1) * 2 + 10; // btns + gaps + padding
                        // Approximate block pixel width from percentage + numCols
                        const colEl = col;
                        const colWidth = colEl.getBoundingClientRect
                            ? (colEl.getBoundingClientRect().width || colEl.offsetWidth || 80)
                            : (colEl.offsetWidth || 80);
                        const blockW = colWidth / numCols - 4; // subtract margin
                        if (btnCount > 1 && btnRowWidth > blockW && blockW > 0) {
                            // How many buttons fit per row?
                            const perRow = Math.max(1, Math.floor((blockW - 10) / 24));
                            if (perRow < btnCount) {
                                el.setAttribute('data-btn-rows', '');
                                // Replace all buttons with a single "…" that reveals them on click
                                const fullHTML = boxActions.innerHTML;
                                boxActions.innerHTML = `
                                        <button type="button" class="box-btn box-btn-overflow"
                                                onpointerdown="event.stopPropagation()"
                                                onclick="event.stopPropagation(); (function(btn){
                                                    var pop = btn.parentElement.querySelector('.box-btn-popup');
                                                    if (!pop) return;
                                                    var isOpen = pop.classList.toggle('open');
                                                    if (isOpen) {
                                                        var closeHandler = function(e){
                                                            if (!btn.parentElement.contains(e.target)){
                                                                pop.classList.remove('open');
                                                                document.removeEventListener('click', closeHandler, true);
                                                            }
                                                        };
                                                        document.addEventListener('click', closeHandler, true);
                                                    }
                                                })(this)"
                                                title="פעולות">…</button>
                                        <div class="box-btn-popup">${fullHTML}</div>
                                    `;
                            }
                        }
                    }
                }

                if (el.hasAttribute('data-small') || el.hasAttribute('data-medium')) makeCompactEventExpandable(el);

                col.appendChild(el);
            });
        });
    });
}

// Compact calendar blocks enlarge into a card on hover (CSS). That left
// touch screens and keyboard users without a way to read them, so:
//   - tap  → toggles the enlarged card (class "expanded"); tapping
//            anywhere else, or pressing Escape, closes it
//   - Tab  → the block is focusable and the card opens on keyboard focus
//            (CSS :focus-visible), including while focus is on one of
//            its buttons
// Mouse clicks are ignored: hover already covers them, and a click-made
// "expanded" would otherwise stay stuck open after the pointer leaves.
function makeCompactEventExpandable(el) {
    const text = sel => { const n = el.querySelector(sel); return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', [text('.class-title'), text('.class-type'), text('.class-time')].filter(Boolean).join(', '));

    el.addEventListener('click', (e) => {
        if (e.target.closest('.box-btn, .box-btn-popup')) return; // a real button press
        const touchLike = e.pointerType ? e.pointerType !== 'mouse' : window.matchMedia('(hover: none)').matches;
        if (!touchLike) return;
        const open = !el.classList.contains('expanded');
        collapseExpandedEvents();
        if (open) el.classList.add('expanded');
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        el.classList.remove('expanded');
        if (el.contains(document.activeElement)) document.activeElement.blur();
    });
}

function collapseExpandedEvents() {
    document.querySelectorAll('.class-event.expanded').forEach(x => x.classList.remove('expanded'));
}
// One listener for the whole page: a tap outside any expanded card closes it.
function collapseExpandedOnOutsideClick(e) {
    if (!e.target.closest('.class-event.expanded')) collapseExpandedEvents();
}
document.addEventListener('click', collapseExpandedOnOutsideClick);


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
    document.body.classList.toggle('schedule-only-mode');
    
    // Automatically re-fit the table to the screen now that the sidebars/padding are gone
    if (document.body.classList.contains('force-table-view')) {
        setTimeout(fitTableToScreen, 50); 
    }
}
