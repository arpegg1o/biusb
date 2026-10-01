// ============================================================================
// Schedule solver & navigation
//
// The web worker that enumerates conflict-free schedules, the updateUI() refresh cycle,
// status line, moving between generated schedules, and the semester selector.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

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
                // Timeless entries have no day/time — they can never conflict.
                if (!newClass.day || !newClass.start || !newClass.end) return null;
                const newStart = timeToMins(newClass.start);
                const newEnd = timeToMins(newClass.end);
                for (const cls of schedule) {
                    if (!cls.day || !cls.start || !cls.end) continue; // skip timeless
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
                let timelessCount = 0;

                const byDay = { 'א': [], 'ב': [], 'ג': [], 'ד': [], 'ה': [], 'ו': [] };
                sched.forEach(cls => {
                    if (!cls.day || !cls.start || !cls.end) { timelessCount++; return; } // timeless entries
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
                return { overlaps, gapMinutes, before12Count, timelessCount };
            }
            
            self.onmessage = function(e) {
                const { rawCourses, currentSem, activeElectives, allowOverlaps, pinnedGroupKey, anchorChoices } = e.data;
                const semCourses = rawCourses.filter(c => c.semester === currentSem || c.semester === "שנתי");

                const groupsToFulfill = {};
                const optionsMap = {};
                
                // Options of ONE slot that have exactly the same hours are the
                // same choice (e.g. two groups differing only by lecturer, both
                // added): keep the first, so schedules never repeat each other.
                // Options without fixed hours are never merged. A pinned group
                // is always the one kept.
                const optSessions = new Map();
                semCourses.forEach(c => {
                    if (c.isElective && !activeElectives.includes(c.name)) return;
                    const slot = c.name + " (" + c.type + ")";
                    const ok = c.courseGroupId || c.id;
                    const mk = slot + '#|#' + ok;
                    if (!optSessions.has(mk)) optSessions.set(mk, { slot: slot, optionKey: ok, sessions: [] });
                    optSessions.get(mk).sessions.push(c);
                });
                const optEntries = Array.from(optSessions.values());
                if (pinnedGroupKey) optEntries.sort((a, b) => (b.optionKey === pinnedGroupKey) - (a.optionKey === pinnedGroupKey));
                const seenSigs = new Set();
                const droppedOptions = new Set();
                optEntries.forEach(o => {
                    if (!o.sessions.every(c => c.day && c.start && c.end)) return;
                    const sig = o.slot + '#|#' + o.sessions.map(c => c.day + '|' + c.start + '|' + c.end).sort().join(',');
                    if (seenSigs.has(sig)) droppedOptions.add(o.slot + '#|#' + o.optionKey);
                    else seenSigs.add(sig);
                });

                semCourses.forEach(c => {
                    if (c.isElective && !activeElectives.includes(c.name)) return;
                    const key = c.name + " (" + c.type + ")";
                    const optionKey = c.courseGroupId || c.id; 
                    
                    if (droppedOptions.has(key + '#|#' + optionKey)) return;
                    if (!optionsMap[key]) optionsMap[key] = {};
                    if (!optionsMap[key][optionKey]) optionsMap[key][optionKey] = [];
                    optionsMap[key][optionKey].push(c);
                });
                
                // Pinned mode: force one specific group to be used (the
                // other slots stay free). Used when the user wants to move
                // to a group that isn't among the capped best schedules.
                if (pinnedGroupKey) {
                    for (const key in optionsMap) {
                        if (optionsMap[key][pinnedGroupKey]) {
                            const only = {};
                            only[pinnedGroupKey] = optionsMap[key][pinnedGroupKey];
                            optionsMap[key] = only;
                        }
                    }
                }

                for (const key in optionsMap) {
                    groupsToFulfill[key] = Object.values(optionsMap[key]);
                }
                
                // Hard caps so a big selection can never blow up memory.
                // The number of valid combinations grows multiplicatively
                // with every course group, so we never keep more than
                // MAX_KEEP partial/complete schedules alive.
                const MAX_KEEP = 400;
                let truncated = false;

                // anchorChoices = { "name (type)": groupId } of the schedule
                // currently on screen. When present, pruning keeps the
                // schedules that CHANGE THE FEWEST course slots relative to
                // it (ties broken by the normal quality ranking). The final
                // list is still sorted by quality only, so browsing order
                // is unchanged. A partial schedule's diff never decreases
                // as slots are added, so this pruning is exact for the
                // minimal-change schedules.
                function diffOf(sched) {
                    if (!anchorChoices) return 0;
                    const seen = {};
                    let d = 0;
                    for (const c of sched) {
                        const k = c.name + " (" + c.type + ")";
                        if (seen[k]) continue;
                        seen[k] = true;
                        const a = anchorChoices[k];
                        if (a !== undefined && a !== (c.courseGroupId || c.id)) d++;
                    }
                    return d;
                }
                function rank(list, byDiff) {
                    const scored = list.map(sched => {
                        const score = evaluateSchedule(sched);
                        score.diff = byDiff ? diffOf(sched) : 0;
                        return { sched, score };
                    });
                    scored.sort((a, b) => {
                        if (a.score.diff !== b.score.diff) return a.score.diff - b.score.diff;
                        if (a.score.overlaps !== b.score.overlaps) return a.score.overlaps - b.score.overlaps;
                        // A group with no hours adds no gaps/early classes, so it
                        // would otherwise ALWAYS look "best". Prefer groups that
                        // have real hours by default; the user can still switch
                        // to a no-hours group from the alternatives UI.
                        if (a.score.timelessCount !== b.score.timelessCount) return a.score.timelessCount - b.score.timelessCount;
                        if (a.score.gapMinutes !== b.score.gapMinutes) return a.score.gapMinutes - b.score.gapMinutes;
                        return a.score.before12Count - b.score.before12Count;
                    });
                    return scored.map(x => x.sched);
                }

                let results = [[]];
                let conflictDetails = null;
                const keys = Object.keys(groupsToFulfill);

                for (const key of keys) {
                    const options = groupsToFulfill[key];
                    let newResults = [];
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
                        // Prune early so newResults itself never gets huge.
                        if (newResults.length > MAX_KEEP * 8) {
                            newResults = rank(newResults, true).slice(0, MAX_KEEP);
                            truncated = true;
                        }
                    }

                    if (newResults.length > MAX_KEEP) {
                        newResults = rank(newResults, true).slice(0, MAX_KEEP);
                        truncated = true;
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

                // Pruning is a heuristic: it could (rarely) discard every
                // partial schedule that would have completed. If that
                // happened, fall back to a bounded depth-first search.
                if (results.length === 0 && truncated) {
                    const found = [];
                    let budget = 1500000;
                    const dfs = (idx, cur) => {
                        if (found.length >= MAX_KEEP || budget-- <= 0) return;
                        if (idx === keys.length) { found.push(cur); return; }
                        for (const optSessions of groupsToFulfill[keys[idx]]) {
                            let bad = false;
                            if (!allowOverlaps) {
                                for (const session of optSessions) {
                                    if (hasConflict(cur, session)) { bad = true; break; }
                                }
                            }
                            if (!bad) dfs(idx + 1, cur.concat(optSessions));
                            if (found.length >= MAX_KEEP || budget <= 0) return;
                        }
                    };
                    dfs(0, []);
                    if (found.length > 0) {
                        results = found;
                        conflictDetails = null;
                    }
                }

                // Sort all generated schedules globally from best to worst
                if (results.length > 0) results = rank(results, false);
                
                self.postMessage({ results, conflictDetails, truncated, pin: !!e.data.pinJump, pinRefresh: !!e.data.pinRefresh, seq: e.data.seq });
            };
        `;
    const blob = new Blob([workerScript], {type: 'application/javascript'});
    scheduleWorker = new Worker(URL.createObjectURL(blob));
    
    scheduleWorker.onmessage = function(e) {
        if (e.data.pin) { handlePinnedResult(e.data); return; }
        if (e.data.seq !== undefined && e.data.seq !== latestSolveSeq) return; // stale
        validSchedules = e.data.results;
        lastConflictDetails = e.data.conflictDetails;
        scheduleListTruncated = !!e.data.truncated;

        const currentSem = getCurrentSemester();
        
        if (pendingAlternativeJump) {
            const targetId = pendingAlternativeJump;
            pendingAlternativeJump = null;
            let foundIdx = -1;
            const containing = [];
            validSchedules.forEach((sc, i) => { if (sc.some(c => c.id === targetId)) containing.push(i); });
            if (containing.length > 0) {
                const sub = containing.map(i => validSchedules[i]);
                foundIdx = containing[chooseClosestScheduleIndex(sub, scheduleSnapshotBeforeUpdate)];
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
            const savedChoices = semesterChoices[currentSem];
            if (savedChoices && Object.keys(savedChoices).length && validSchedules.length > 0) {
                // Re-find the schedule that was on screen, wherever the new ranking put it.
                semesterIndices[currentSem] = chooseClosestByChoices(validSchedules, savedChoices);
            } else {
                const savedIdx = semesterIndices[currentSem];
                semesterIndices[currentSem] =
                    (typeof savedIdx === 'number' && savedIdx >= 0 && savedIdx < validSchedules.length) ? savedIdx : 0;
            }
        } else {
            // A course/group/elective actually changed within the same
            // semester — keep whatever's on screen as intact as
            // possible instead of jumping back to the "best" schedule.
            semesterIndices[currentSem] = chooseClosestScheduleIndex(validSchedules, scheduleSnapshotBeforeUpdate);
        }
        scheduleSnapshotBeforeUpdate = null;
        hasComputedOnce = true;
        lastComputedSemester = currentSem;
        const needsUnpinnedRefresh = !!e.data.pinRefresh && validSchedules.length > 0;
        if (importInProgress) { importInProgress = false; showToast('הנתונים יובאו בהצלחה ✓', 3000); }

        document.getElementById('calendarBody').style.opacity = '1';
        activeAlternativeKey = null; 
        
        updateStatus();
        renderCalendar();
        renderElectivesSidebar();
        updateCourseList();
        
        localStorage.setItem('mySchedulesIndices', JSON.stringify(semesterIndices));

        // That solve was restricted to schedules containing one group.
        // Recompute the normal list (anchored on what's showing now, so
        // the shown schedule stays put) to restore full browsing.
        if (needsUnpinnedRefresh) updateUI(false, true);
    };
}

function onSemesterChange() {
    activeAlternativeKey = null;
    localStorage.setItem('myScheduleSelectedSemester', getCurrentSemester());
    refreshCoursePickers();
    updateUI(false); // re-runs the solver, then re-renders the calendar (ghosts included)
}


// UI strict check - ALWAYS detects true physical overlaps for accurate coloring
function hasStrictConflict(schedule, newClass) {
    if (!newClass.day || !newClass.start || !newClass.end) return null; // timeless — never conflicts
    const newStart = timeToMins(newClass.start);
    const newEnd = timeToMins(newClass.end);
    for (const cls of schedule) {
        if (!cls.day || !cls.start || !cls.end) continue; // skip timeless
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
// The schedule currently on screen, as { "name (type)": groupId } — what
// the solver uses to keep the schedules that change the least.
function anchorChoicesFor(schedule) {
    return (schedule && schedule.length) ? scheduleGroupChoices(schedule) : null;
}

function chooseClosestScheduleIndex(candidates, previousSchedule) {
    if (candidates.length === 0) return 0;
    if (!previousSchedule || previousSchedule.length === 0) return 0;
    return chooseClosestByChoices(candidates, scheduleGroupChoices(previousSchedule));
}

function chooseClosestByChoices(candidates, previousChoices) {
    if (candidates.length === 0) return 0;
    let bestIdx = 0, bestScore = -1;
    candidates.forEach((sched, idx) => {
        const choices = scheduleGroupChoices(sched);
        let score = 0;
        for (const slotKey in previousChoices) {
            if (choices[slotKey] === previousChoices[slotKey]) score++;
        }
        // Candidates are sorted best-first; ties keep the earlier one.
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    return bestIdx;
}

function updateUI(pushHistory = true, silent = false) {
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

    // A silent refresh re-solves in the background (to restore the
    // full browsable list) while the schedule on screen is already
    // final — so no "computing" text and no dimming.
    if (!silent) {
        const statusEl = document.getElementById('scheduleStatus');
        statusEl.innerText = 'מחשב אפשרויות... ⏳';
        statusEl.style.color = 'var(--text-muted)';
        document.getElementById('calendarBody').style.opacity = '0.4';
    }

    // Only meaningful to compare against the schedule that was showing
    // if we're recomputing the SAME semester we last solved — right
    // after a semester switch (or on first load) validSchedules still
    // holds a different semester's schedules entirely, so there's
    // nothing valid here to snapshot.
    const sameSemesterAsLastCompute = hasComputedOnce && lastComputedSemester === currentSem;
    scheduleSnapshotBeforeUpdate = sameSemesterAsLastCompute ? (validSchedules[semesterIndices[currentSem]] || []) : null;

    let pinKey = null;
    if (pendingAlternativeJump) {
        const t = rawCourses.find(c => c.id === pendingAlternativeJump);
        if (t) pinKey = t.courseGroupId || t.id;
    }
    scheduleWorker.postMessage({
        rawCourses: rawCourses,
        currentSem: currentSem,
        activeElectives: Array.from(activeElectives),
        allowOverlaps: devModeAllowOverlaps,
        anchorChoices: anchorChoicesFor(scheduleSnapshotBeforeUpdate) || semesterChoices[currentSem] || null,
        pinnedGroupKey: pinKey,
        pinRefresh: !!pinKey,
        seq: ++latestSolveSeq
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
        statusEl.innerText = `מערכת ${semesterIndices[currentSem] + 1} מתוך ${validSchedules.length}${scheduleListTruncated ? '+' : ''}`;
        statusEl.style.color = 'var(--text-main)';
        statusEl.style.fontSize = '18px';
        statusEl.title = scheduleListTruncated ? 'יש יותר מדי אפשרויות - מוצגות המערכות הטובות ביותר בלבד' : '';

        const shown = validSchedules[semesterIndices[currentSem]];
        if (shown && shown.length) {
            semesterChoices[currentSem] = scheduleGroupChoices(shown);
            try { localStorage.setItem('mySchedulesChoices', JSON.stringify(semesterChoices)); } catch (e) {}
        }
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
