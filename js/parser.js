// ============================================================================
// Paste parser
//
// Turns text pasted from the university system into schedule entries. Groups whose day
// can't be read are reported and NOT saved (never guess a day).
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

// Day lists as Shoam writes them: "ב',ה'", "ב', ה'", "ב,ה", "ב' ה'".
const DAY_LIST_SRC = "[א-ו]'?(?:(?:\\s*,\\s*[א-ו]'?)|(?:\\s+[א-ו]'))*";
function splitDayList(str) {
    return str.split(/[,\s]+/).map(d => d.replace(/'/g, '')).filter(Boolean);
}
// Problems found while parsing a paste (e.g. a day that had to be
// guessed) — shown to the user instead of silently guessing.
let pasteWarnings = [];
// Groups whose day(s) could not be read. These are NOT saved (guessing a
// day would put wrong data on the calendar); the user is told instead.
let pasteProblems = [];

function processInput() {
    pasteWarnings = [];
    pasteProblems = [];
    const text = document.getElementById('pasteArea').value.trim();
    const forceElective = document.getElementById('addAsElectiveToggle').checked;
    if (!text) return;
    
    let added = processNewFormat(text, forceElective);
    
    if (added === 0) {
        // The fallback re-reads the same text, so don't report one group
        // twice: keep the first pass's problems (they carry the real
        // course name) unless the fallback added something itself.
        const firstPassProblems = pasteProblems;
        pasteProblems = [];
        added = processOldFormat(text, forceElective);
        if (added === 0 && firstPassProblems.length) pasteProblems = firstPassProblems;
    }

    const hasProblems = pasteProblems.length > 0;
    let problemMsg = '';
    if (hasProblems) {
        problemMsg = 'לא הצלחנו לזהות את היום עבור:\n' +
            pasteProblems.map(p => '• ' + p).join('\n') +
            '\n\nהשיעורים האלה לא נוספו, כדי שלא יישמרו ימים שגויים.' +
            (added > 0 ? '\nשאר הקורסים מהטקסט נוספו.' : '') +
            '\nהטקסט נשאר בתיבה — בדקו שהוא כולל את היום (למשל "יום ב\'"), או מלאו את היום ידנית בטופס שמתחת.';
    }

    if (added > 0) {
        console.info('[paste] parser v3 — courses added:', rawCourses.slice(-8).map(c => `${c.name} | ${c.type} | ${c.semester} | ${c.day} ${c.start}-${c.end} | group=${c.courseGroupId}`));
        if (hasProblems) {
            alert(problemMsg);
        } else if (pasteWarnings.length) {
            alert('שים לב:\n' + pasteWarnings.join('\n') + '\n\nאפשר לתקן ידנית בעריכה, או להוסיף את הקורס דרך החיפוש בקטלוג.');
        }
        // Keep the text and the dialog open when something was skipped,
        // so the user can fix it (re-submitting is safe: exact
        // duplicates are ignored).
        if (!hasProblems) {
            document.getElementById('pasteArea').value = '';
            document.getElementById('addAsElectiveToggle').checked = false;
        }
        updateUI(true);
        if (!hasProblems) document.getElementById('editDialog').close(); // now reached via the manual-add dialog, not the page directly
        // Try to link newly-pasted courses to catalog data (exams / "+" button).
        setTimeout(_linkLegacyCourses, 500);
    } else if (hasProblems) {
        alert(problemMsg);
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
             let dayBlocks = [];
             let orphanTimes = [];
             
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
                      // Shoam's table labels its columns ("יום  ב',ה'" /
                      // "שעה  10:00 - 12:00"); drop the label so the
                      // days / hours underneath are recognised.
                      line = line.replace(/^(?:ימים|יום|שעות|שעה)[\s:]+/, '');
                      const daysMatch = line.match(new RegExp("^(" + DAY_LIST_SRC + ")(?=\\s|$|[^א-ת])"));
                      const timeMatches = Array.from(line.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g));

                      if (daysMatch) {
                          dayBlocks.push({
                              days: splitDayList(daysMatch[1]),
                              // hours that appeared BEFORE the days line
                              // (some layouts list hours first) belong to
                              // the first days line.
                              times: dayBlocks.length === 0 ? orphanTimes.splice(0) : []
                          });
                      }

                      // A line may carry several time ranges; each
                      // belongs to the most recent list of days.
                      const target = dayBlocks.length > 0 ? dayBlocks[dayBlocks.length - 1].times : orphanTimes;
                      timeMatches.forEach(tm => target.push({
                          start: tm[1].padStart(5, '0'),
                          end: tm[2].padStart(5, '0')
                      }));
                  }
                  j++;
             }
             
             // Hours were found but no day could be read: report it
             // instead of silently skipping the group.
             if (dayBlocks.length === 0 && orphanTimes.length > 0) {
                 pasteProblems.push(cleanName + ' (' + type + ')');
             }

             // days[i] <-> times[i] (e.g. "ב',ה'" with "10:00-12:00" then
             // "12:00-14:00" = Mon 10-12, Thu 12-14). A single time range
             // listed for several days applies to each of those days.
             dayBlocks.forEach(block => {
                 if (block.times.length === 1) {
                     block.days.forEach(d => sessions.push({ day: d, start: block.times[0].start, end: block.times[0].end }));
                 } else {
                     block.times.forEach((t, idx) => {
                         if (idx < block.days.length) sessions.push({ day: block.days[idx], start: t.start, end: t.end });
                     });
                 }
             });

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
        const parsedList = parseChunkOld(chunk, forceElective);
        let addedAny = false;
        (parsedList || []).forEach(parsed => {
            let isDup = rawCourses.some(c => 
                 c.name === parsed.name && c.type === parsed.type && c.semester === parsed.semester &&
                 c.day === parsed.day && c.start === parsed.start && c.end === parsed.end
            );
            if (!isDup) {
                rawCourses.push(parsed); 
                addedAny = true;
            }
        });
        if (addedAny) parsedCount++;
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

    const semIndex = chunk.indexOf(semMatch[0]);
    const timeIndex = chunk.indexOf(timeMatch[0]);
    if(timeIndex < semIndex) return null;

    // Every time range after the semester, in order (a group can meet
    // on several days, each with its own hours).
    const tail = chunk.substring(timeIndex);
    const times = Array.from(tail.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g))
        .map(m => ({ start: m[1].padStart(5, '0'), end: m[2].padStart(5, '0') }));

    // Days: prefer an explicit "יום ..." label (whose own letters — the
    // ו in "יום" — must not be mistaken for a day), looked for first
    // between the semester and the hours, then anywhere in the block
    // (some layouts put the days after the hours); then a standalone
    // day token. If none is found the group is skipped and reported —
    // guessing a day would save wrong data.
    const between = chunk.substring(semIndex + semMatch[0].length, timeIndex);
    const labelRe = new RegExp("(?:^|\\s)(?:ימים|יום)\\s*(" + DAY_LIST_SRC + ")(?=\\s|$|[^א-ת])");
    const tokenRe = new RegExp("(?:^|\\s)([א-ו]'(?:(?:\\s*,\\s*[א-ו]'?)|(?:\\s+[א-ו]'))*)(?=\\s|$)");
    const singleRe = new RegExp("(?:^|\\s)([א-ו])(?=\\s|$)");
    let dayMatch = between.match(labelRe) || chunk.match(labelRe) || between.match(tokenRe) || between.match(singleRe);
    let days;
    if (dayMatch) {
        days = splitDayList(dayMatch[1]);
    } else {
        pasteProblems.push(type + ' (' + chunk.substring(type.length, type.length + 30).trim() + '...)');
        return null;
    }

    const pairs = [];
    if (times.length === 1) {
        days.forEach(d => pairs.push({ day: d, start: times[0].start, end: times[0].end }));
    } else {
        times.forEach((t, idx) => { if (idx < days.length) pairs.push({ day: days[idx], start: t.start, end: t.end }); });
    }
    if (pairs.length === 0) return null;
    if (times.length > days.length && times.length > 1) {
        pasteWarnings.push('"' + type + '": זוהו ' + times.length + ' טווחי שעות אך רק ' + days.length + ' ימים — ייתכן שחלק מהמפגשים חסרים.');
    }
    
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

    // Several meetings of one group must share a courseGroupId so the
    // solver treats them as ONE option instead of alternatives.
    const sharedGroupId = pairs.length > 1 ? Date.now() + Math.random().toString(36).substring(2, 8) : null;
    return pairs.map(pr => ({
        id: Date.now() + Math.random().toString(36).substring(2, 8),
        courseGroupId: sharedGroupId,
        name, type, semester, day: pr.day, start: pr.start, end: pr.end, isElective, color: null
    }));
}
