// ============================================================================
// Alternatives & pinning
//
// Finding and jumping to alternative groups for a course in the current schedule, including
// the instant-move fast path and the pinned-result fallback.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

/** Hours of one option (all its sessions) as a comparable string, or null
 * when it has no fixed hours (those are never treated as the same). */
function optionSignature(sessions) {
    if (!sessions.every(c => c.day && c.start && c.end)) return null;
    return sessions.map(c => c.day + '|' + c.start + '|' + c.end).sort().join(',');
}

/** The other options (as a flat list of entries) that could replace the one
 * currently in the schedule for a slot ("name - type"). Options with exactly
 * the same hours as the chosen one — or as an earlier option in the list — are
 * the same choice and are shown once (the solver treats them the same way). */
function getAlternativeEntries(currentSem, courseKey, schedule) {
    const byOption = new Map();
    rawCourses.forEach(c => {
        if (!(c.semester === currentSem || c.semester === "שנתי")) return;
        if (`${c.name} - ${c.type}` !== courseKey) return;
        const k = c.courseGroupId || c.id;
        if (!byOption.has(k)) byOption.set(k, []);
        byOption.get(k).push(c);
    });
    const chosenKeys = new Set(schedule.map(c => c.courseGroupId || c.id));
    const seen = new Set();
    byOption.forEach((sessions, k) => {
        if (!chosenKeys.has(k)) return;
        const sig = optionSignature(sessions);
        if (sig !== null) seen.add(sig);
    });
    const out = [];
    byOption.forEach((sessions, k) => {
        if (chosenKeys.has(k)) return;
        const sig = optionSignature(sessions);
        if (sig !== null) {
            if (seen.has(sig)) return;
            seen.add(sig);
        }
        sessions.forEach(c => out.push(c));
    });
    return out;
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
    
    const currentOptionKey = cls.courseGroupId || cls.id;
    let alternatives = Object.values(optionsMap);

    // Options with identical hours are one choice, not several.
    const curSet = alternatives.find(o => (o[0].courseGroupId || o[0].id) === currentOptionKey);
    const seenSigs = new Set();
    if (curSet) { const cs = optionSignature(curSet); if (cs !== null) seenSigs.add(cs); }
    alternatives = alternatives.filter(o => {
        if (o === curSet) return true;
        const sg = optionSignature(o);
        if (sg === null) return true;
        if (seenSigs.has(sg)) return false;
        seenSigs.add(sg);
        return true;
    });
    
    // If there are literally no other options, it should ALWAYS remain locked!
    if (alternatives.length <= 1) return 'locked'; 

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
            else if (scheduleListTruncated || validSchedules.some(sched => sched.some(c => c.id === optSessions[0].id))) {
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
    
    const targetClass = rawCourses.find(c => c.id === targetId);

    // When the list is truncated, the best-fitting schedule for this
    // move may not be in it — ask the solver for schedules using this
    // exact group, keeping everything else as unchanged as possible.
    if (scheduleListTruncated && targetClass) {
        // Fast path: if just swapping THIS group into the schedule
        // that's on screen causes no conflict, that is by definition
        // the minimal change (nothing else moves) — apply it right
        // now, no solver run needed.
        if (tryInstantMove(targetClass, currentSem, currentSchedule)) return;

        // Otherwise solve for it; dim the calendar so the click
        // visibly registered while that runs.
        latestSolveSeq++;
        document.getElementById('calendarBody').style.opacity = '0.4';
        pendingPinRequest = { targetId };
        scheduleWorker.postMessage({
            rawCourses: rawCourses,
            currentSem: currentSem,
            activeElectives: Array.from(activeElectives),
            allowOverlaps: devModeAllowOverlaps,
            pinnedGroupKey: targetClass.courseGroupId || targetClass.id,
            anchorChoices: anchorChoicesFor(currentSchedule),
            pinJump: true
        });
        return;
    }

    const candidateIndices = [];
    validSchedules.forEach((schedule, idx) => {
        if (schedule.some(cls => cls.id === targetId)) candidateIndices.push(idx);
    });

    if (candidateIndices.length > 0) {
        // Fewest changed course slots; ties go to the better-ranked one.
        const sub = candidateIndices.map(i => validSchedules[i]);
        const bestIndex = candidateIndices[chooseClosestScheduleIndex(sub, currentSchedule)];
        semesterIndices[currentSem] = bestIndex;
        activeAlternativeKey = null;
        updateStatus();
        renderCalendar();
        localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
    } else {
        jumpToAlternativeFallback(targetId);
    }
}

function tryInstantMove(targetClass, currentSem, currentSchedule) {
    const key = targetClass.courseGroupId || targetClass.id;
    const sessions = rawCourses.filter(c =>
        (c.courseGroupId || c.id) === key &&
        (c.semester === currentSem || c.semester === "שנתי"));
    if (sessions.length === 0) return false;

    const rest = currentSchedule.filter(c => !(c.name === targetClass.name && c.type === targetClass.type));
    if (!devModeAllowOverlaps) {
        for (const session of sessions) {
            if (hasStrictConflict(rest, session)) return false;
        }
    }

    // Only this slot changes; everything else stays exactly as it was.
    validSchedules = validSchedules.concat([rest.concat(sessions)]);
    semesterIndices[currentSem] = validSchedules.length - 1;
    latestSolveSeq++; // drop any in-flight (now outdated) solver result
    activeAlternativeKey = null;
    updateStatus();
    renderCalendar();
    renderElectivesSidebar();
    updateCourseList();
    localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
    scheduleSilentRefresh();
    return true;
}

// Re-solve in the background shortly after a move so the schedule list
// (arrows, counter, alternatives) is rebuilt around the new schedule.
// Debounced so a burst of moves costs a single solve.
function scheduleSilentRefresh() {
    clearTimeout(silentRefreshTimer);
    silentRefreshTimer = setTimeout(() => updateUI(false, true), 400);
}

// Result of a pinned solve: append the schedules that contain the
// requested group and jump to the one closest to what's on screen.
function handlePinnedResult(data) {
    const req = pendingPinRequest;
    pendingPinRequest = null;
    if (!req) return;
    if (data.results && data.results.length > 0) {
        const currentSem = getCurrentSemester();
        const currentSchedule = validSchedules[semesterIndices[currentSem]] || [];
        const idx = chooseClosestScheduleIndex(data.results, currentSchedule);
        validSchedules = data.results;
        semesterIndices[currentSem] = idx;
        activeAlternativeKey = null;
        updateStatus();
        renderCalendar();
        renderElectivesSidebar();
        updateCourseList();
        localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));
        // Restore the full (unpinned) list, anchored on the new schedule.
        document.getElementById('calendarBody').style.opacity = '1';
        updateUI(false, true);
    } else {
        document.getElementById('calendarBody').style.opacity = '1';
        jumpToAlternativeFallback(req.targetId);
    }
}

function jumpToAlternativeFallback(targetId) {
    const currentSem = getCurrentSemester();
    const currentSchedule = validSchedules[semesterIndices[currentSem]] || [];
    const targetClass = rawCourses.find(c => c.id === targetId);
    if (!targetClass) return;
    const currentOptionKey = targetClass.courseGroupId || targetClass.id;
    const scheduleMinusSource = currentSchedule.filter(c => c.name !== targetClass.name || c.type !== targetClass.type);
    const targetSessions = rawCourses.filter(c => (c.courseGroupId || c.id) === currentOptionKey);

    let conflictObj = null;
    for (const session of targetSessions) {
        const conf = hasStrictConflict(scheduleMinusSource, session);
        if (conf) { conflictObj = conf; break; }
    }

    if (conflictObj && conflictObj.isElective) {
        removeElectiveAndJump(conflictObj.name, targetId, null);
    } else {
        alert("לא ניתן להעביר את השיעור לכאן כי הוא מתנגש עם שיעור שאין לו חלופה.");
    }
}
