// ============================================================================
// ICS export (schedule + exams) with a customisation popup
//
// Both "יומן (ICS)" buttons open the same small dialog (#icsExportDialog, built on first
// use). The chosen options are remembered in localStorage per export kind.
//   - 'schedule': the schedule currently on screen, as weekly repeating events
//   - 'exams'   : the exams calendar (same list the exams dialog / PNG / PDF use)
// The low-level helpers (_icsEscape, _icsFold, _icsUtcStamp) live in exams-export.js.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

const ICS_OPTIONS_KEY = 'myIcsExportOptions';

// null = "not chosen yet": taken from the matching toggle in the exams dialog.
const ICS_DEFAULT_OPTIONS = {
    schedule: { prefix: '', suffix: '', showType: true, repeatWeekly: true, skipBreaks: true, addBreaks: false, reminder: 0, dates: {} },
    exams: {
        prefix: '', suffix: '', showMoed: true, includeUnchosen: null,
        moedA: true, moedB: true, moedC: null,
        durationHours: 3, reminder: 0, addShoamLink: true,
    },
};

// Bar-Ilan academic calendar 2026-27 (תשפ"ז). Update these two tables each year.
// Days with no classes (a range is inclusive). Exam-break periods are not listed:
// they fall outside the semester dates below, so no class is ever exported there.
const ICS_KNOWN_SEMESTERS = {
    "א'": { start: '2026-10-11', end: '2027-01-17' },
    "ב'": { start: '2027-03-01', end: '2027-06-25' },
    'קיץ': { start: '2027-08-15', end: '2027-09-24' },
};
const ICS_ACADEMIC_BREAKS = [
    { name: 'חופש יום בחירות', start: '2026-10-27', end: '2026-10-27' },
    { name: 'חופשת חג חנוכה', start: '2026-12-04', end: '2026-12-07' },
    { name: "צום י' בטבת (אין לימודים)", start: '2026-12-20', end: '2026-12-20' },
    { name: 'חופשת חג פורים', start: '2027-03-22', end: '2027-03-24' },
    { name: 'חופשת חג הפסח', start: '2027-04-18', end: '2027-04-30' },
    { name: 'יום הזיכרון ויום העצמאות', start: '2027-05-11', end: '2027-05-12' },
    { name: 'חופשת יום ירושלים', start: '2027-06-04', end: '2027-06-04' },
    { name: 'חופשת חג שבועות', start: '2027-06-10', end: '2027-06-11' },
];

let icsDialogMode = null; // 'schedule' | 'exams' while the dialog is open

function loadIcsOptions(mode) {
    let saved = {};
    try {
        const all = JSON.parse(localStorage.getItem(ICS_OPTIONS_KEY) || '{}');
        if (all && typeof all[mode] === 'object' && all[mode]) saved = all[mode];
    } catch (e) { /* ignore */ }
    return Object.assign({}, ICS_DEFAULT_OPTIONS[mode], saved);
}

function saveIcsOptions(mode, opts) {
    try {
        const all = JSON.parse(localStorage.getItem(ICS_OPTIONS_KEY) || '{}') || {};
        all[mode] = opts;
        localStorage.setItem(ICS_OPTIONS_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
}

// ---- date helpers ------------------------------------------------------
const _p2 = n => String(n).padStart(2, '0');
function _isoDate(d) { return `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}`; }
function _parseIsoDate(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
/** Local date-time as YYYYMMDDTHHMMSS (floating — shows at the same wall-clock time everywhere). */
function _icsLocal(d) {
    return `${d.getFullYear()}${_p2(d.getMonth() + 1)}${_p2(d.getDate())}` +
           `T${_p2(d.getHours())}${_p2(d.getMinutes())}00`;
}

/** Rough default semester dates (the catalog has none) — editable in the popup. */
function defaultSemesterDates(sem) {
    const now = new Date();
    if (ICS_KNOWN_SEMESTERS[sem] && now <= new Date(2027, 8, 30)) return ICS_KNOWN_SEMESTERS[sem];
    const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; // academic year starts ~Oct
    if (sem === "ב'") return { start: `${y + 1}-03-08`, end: `${y + 1}-06-18` };
    if (sem === 'קיץ') return { start: `${y + 1}-07-05`, end: `${y + 1}-08-20` };
    return { start: `${y}-10-25`, end: `${y + 1}-01-30` };
}

function _icsOneLine(s) { return String(s == null ? '' : s).replace(/[\r\n]+/g, ' '); }

function _icsAlarm(minutes) {
    if (!minutes || minutes <= 0) return [];
    return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', `TRIGGER:-PT${Math.round(minutes)}M`, 'END:VALARM'];
}

function _icsDownload(lines, filename) {
    const body = lines.map(_icsFold).join('\r\n') + '\r\n';
    const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function _icsHeader(name) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${name}//HE`, 'CALSCALE:GREGORIAN'];
}

// ---- data ----------------------------------------------------------------
/** Timed entries of the schedule on screen (timeless groups have no hours to export). */
function getScheduleEntriesForIcs() {
    const sem = getCurrentSemester();
    const shown = validSchedules[semesterIndices[sem] || 0];
    if (!shown || lastComputedSemester !== sem) return [];
    return shown.filter(c => c.day && c.start && c.end);
}

function getExamEntriesForIcs(opts, sem) {
    let entries = getAllExamEntries(sem);
    entries = entries.filter(e => {
        const cls = getMoedClass(e.exam.type);
        if (cls === 'moed-a') return opts.moedA;
        if (cls === 'moed-b') return opts.moedB;
        if (cls === 'moed-c') return opts.moedC;
        return true;
    });
    if (!opts.includeUnchosen) entries = entries.filter(e => e.enrolled);
    return entries;
}

// ---- builders --------------------------------------------------------------
function breaksInRange(startIso, endIso) {
    return ICS_ACADEMIC_BREAKS.filter(br => br.end >= startIso && br.start <= endIso);
}

function buildScheduleICS(opts, sem, entries) {
    const range = (opts.dates && opts.dates[sem]) || defaultSemesterDates(sem);
    const startD = _parseIsoDate(range.start), endD = _parseIsoDate(range.end);
    const breaks = breaksInRange(range.start, range.end);
    const onBreak = d => { const iso = _isoDate(d); return breaks.some(br => iso >= br.start && iso <= br.end); };
    const stamp = _icsUtcStamp();
    const lines = _icsHeader('Schedule');
    let count = 0;

    entries.forEach(c => {
        const dayIdx = DAY_LETTERS.indexOf(c.day);
        if (dayIdx < 0) return;
        // Every date in the semester that falls on this weekday.
        const first = new Date(startD);
        while (first.getDay() !== dayIdx) first.setDate(first.getDate() + 1);
        const dates = [];
        for (let d = new Date(first); d <= endD; d.setDate(d.getDate() + 7)) dates.push(new Date(d));
        // The series starts at the first date that isn't a break; later break dates are excluded.
        const firstKept = opts.skipBreaks ? dates.findIndex(d => !onBreak(d)) : (dates.length ? 0 : -1);
        if (firstKept < 0) return;
        const series = dates.slice(firstKept);
        const excluded = opts.skipBreaks ? series.filter(onBreak) : [];

        const [sh, sm] = c.start.split(':').map(Number);
        const [eh, em] = c.end.split(':').map(Number);
        const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
        const dtStart = at(series[0], sh, sm);
        const dtEnd = at(series[0], eh, em);

        const title = `${opts.prefix}${c.name}${opts.suffix}` + (opts.showType && c.type ? ` (${c.type})` : '');
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:sched-${sem}-${c.id}-${_icsLocal(dtStart)}@schedule`.replace(/\s+/g, '-'));
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`SUMMARY:${_icsEscape(_icsOneLine(title))}`);
        lines.push(`DTSTART:${_icsLocal(dtStart)}`);
        lines.push(`DTEND:${_icsLocal(dtEnd)}`);
        if (opts.repeatWeekly && series.length > 1) {
            lines.push(`RRULE:FREQ=WEEKLY;COUNT=${series.length}`);
            if (excluded.length) lines.push(`EXDATE:${excluded.map(d => _icsLocal(at(d, sh, sm))).join(',')}`);
        }
        lines.push(`DESCRIPTION:${_icsEscape([c.type, c.isElective ? 'בחירה' : ''].filter(Boolean).join(' | '))}`);
        lines.push(..._icsAlarm(opts.reminder));
        lines.push('END:VEVENT');
        count++;
    });

    // Breaks as all-day events (only those inside the exported semester).
    if (opts.addBreaks) {
        breaks.forEach(br => {
            const endExcl = _parseIsoDate(br.end);
            endExcl.setDate(endExcl.getDate() + 1);
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:break-${br.start}-${br.end}@schedule`);
            lines.push(`DTSTAMP:${stamp}`);
            lines.push(`SUMMARY:${_icsEscape(br.name)}`);
            lines.push(`DTSTART;VALUE=DATE:${br.start.replace(/-/g, '')}`);
            lines.push(`DTEND;VALUE=DATE:${_isoDate(endExcl).replace(/-/g, '')}`);
            lines.push('TRANSP:TRANSPARENT');
            lines.push('END:VEVENT');
        });
    }

    lines.push('END:VCALENDAR');
    return { lines, count };
}

function buildExamsICS(opts, entries) {
    const stamp = _icsUtcStamp();
    const usedUids = new Set();
    const lines = _icsHeader('Exam Schedule');
    let count = 0;

    entries.forEach(({ courseName, courseCode, shoamId, exam }) => {
        const d = parseExamDate(exam.date);
        if (!d) return;
        const t = exam.time ? String(exam.time).match(/^(\d{1,2}):(\d{2})/) : null;
        const dtDate = `${d.year}${_p2(d.month + 1)}${_p2(d.day)}`;
        const startDt = t ? new Date(d.year, d.month, d.day, +t[1], +t[2]) : null;
        const dtFull = startDt ? _icsLocal(startDt) : dtDate;

        let uid = `exam-${String(courseCode || courseName).replace(/[^\w\u0590-\u05FF-]+/g, '-')}-` +
                  `${String(exam.type || '').replace(/[^\w\u0590-\u05FF-]+/g, '-')}-${dtFull}@schedule`;
        for (let n = 2; usedUids.has(uid); n++) uid = uid.replace(/(-\d+)?@schedule$/, `-${n}@schedule`);
        usedUids.add(uid);

        const title = `${opts.prefix}${courseName}${opts.suffix}` + (opts.showMoed ? ` — ${exam.type || 'בחינה'}` : '');
        const link = opts.addShoamLink && shoamId ? `https://courses.biu.ac.il/CourseDetails.aspx?lid=${shoamId}` : '';

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`SUMMARY:${_icsEscape(_icsOneLine(title))}`);
        lines.push(`DTSTART${startDt ? '' : ';VALUE=DATE'}:${dtFull}`);
        if (startDt && opts.durationHours > 0) {
            lines.push(`DTEND:${_icsLocal(new Date(startDt.getTime() + opts.durationHours * 3600 * 1000))}`);
        }
        lines.push(`DESCRIPTION:${_icsEscape(`${courseCode || ''} | ${exam.type || ''}` + (link ? `\n${link}` : ''))}`);
        if (link) lines.push(`URL:${link}`);
        lines.push(..._icsAlarm(opts.reminder));
        lines.push('END:VEVENT');
        count++;
    });

    lines.push('END:VCALENDAR');
    return { lines, count };
}

// ---- dialog ------------------------------------------------------------------
function _icsTextField(id, label, value, placeholder) {
    return `<div class="form-group"><label for="${id}">${label}</label>
        <input type="text" id="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder || '')}" maxlength="60"></div>`;
}
function _icsToggle(id, label, checked) {
    return `<div class="form-group"><label class="toggle-label"><div class="switch">
        <input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span class="slider"></span></div>${label}</label></div>`;
}
function _icsSelect(id, label, options, current) {
    const opts = options.map(([v, text]) => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${text}</option>`).join('');
    return `<div class="form-group"><label for="${id}">${label}</label><select id="${id}">${opts}</select></div>`;
}

function ensureIcsDialog() {
    let dlg = document.getElementById('icsExportDialog');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'icsExportDialog';
    dlg.style.maxHeight = '90vh';
    dlg.style.overflowY = 'auto';
    dlg.innerHTML = `
        <h3 style="margin-top:0;" id="icsDialogTitle">ייצוא ליומן</h3>
        <div id="icsDialogBody"></div>
        <div class="dialog-buttons">
            <button class="btn-simple" onclick="document.getElementById('icsExportDialog').close()">ביטול</button>
            <button class="btn-simple" onclick="confirmIcsExport()" style="background: var(--primary); color: white; border: none;">ייצא</button>
        </div>`;
    document.body.appendChild(dlg);
    return dlg;
}

function openIcsExportDialog(mode) {
    const sem = getCurrentSemester();
    const opts = loadIcsOptions(mode);
    let html;

    if (mode === 'schedule') {
        if (getScheduleEntriesForIcs().length === 0) return alert('אין שיעורים עם שעות קבועות לייצא בסמסטר הנוכחי.');
        const range = (opts.dates && opts.dates[sem]) || defaultSemesterDates(sem);
        html = `
            <p style="font-size:13px; color:var(--text-muted); margin-top:0;">המערכת המוצגת עכשיו (סמסטר ${escapeHtml(sem)}), כאירועים שחוזרים כל שבוע.</p>
            <div style="display:flex; gap:10px;">
                <div style="flex:1;"><div class="form-group"><label for="icsStart">תחילת הסמסטר</label><input type="date" id="icsStart" value="${range.start}"></div></div>
                <div style="flex:1;"><div class="form-group"><label for="icsEnd">סוף הסמסטר</label><input type="date" id="icsEnd" value="${range.end}"></div></div>
            </div>
            ${_icsToggle('icsRepeat', 'חזור כל שבוע עד סוף הסמסטר', opts.repeatWeekly)}
            ${_icsToggle('icsSkipBreaks', 'אל תייצא שיעורים בימי חופשה', opts.skipBreaks)}
            ${_icsToggle('icsAddBreaks', 'הוסף את החופשות כאירועי יום שלם', opts.addBreaks)}
            ${_icsTextField('icsPrefix', 'טקסט לפני שם הקורס', opts.prefix, 'לדוגמה: 📚 ')}
            ${_icsTextField('icsSuffix', 'טקסט אחרי שם הקורס', opts.suffix, '')}
            ${_icsToggle('icsShowType', 'הוסף את סוג השיעור לכותרת (הרצאה / תרגיל…)', opts.showType)}
            ${_icsSelect('icsReminder', 'תזכורת', [[0, 'ללא'], [10, '10 דקות לפני'], [30, '30 דקות לפני'], [60, 'שעה לפני']], opts.reminder)}`;
    } else {
        if (getAllExamEntries(sem).length === 0) return alert('אין מועדי בחינות לייצא.');
        const unchosen = opts.includeUnchosen !== null ? opts.includeUnchosen : document.getElementById('examsShowUnchosenToggle')?.checked !== false;
        const moedC = opts.moedC !== null ? opts.moedC : document.getElementById('examsShowMoedGimelToggle')?.checked === true;
        html = `
            <p style="font-size:13px; color:var(--text-muted); margin-top:0;">מועדי הבחינות של סמסטר ${escapeHtml(sem)}.</p>
            ${_icsToggle('icsUnchosen', 'כלול קורסי בחירה שלא נבחרו', unchosen)}
            ${_icsToggle('icsMoedA', "כלול מועד א'", opts.moedA)}
            ${_icsToggle('icsMoedB', "כלול מועד ב'", opts.moedB)}
            ${_icsToggle('icsMoedC', "כלול מועד ג'", moedC)}
            ${_icsTextField('icsPrefix', 'טקסט לפני שם הקורס', opts.prefix, 'לדוגמה: 📝 ')}
            ${_icsTextField('icsSuffix', 'טקסט אחרי שם הקורס', opts.suffix, '')}
            ${_icsToggle('icsShowMoed', 'הוסף את המועד לכותרת (מועד א\' / ב\'…)', opts.showMoed)}
            ${_icsToggle('icsShoam', 'הוסף קישור לשוהם', opts.addShoamLink)}
            ${_icsSelect('icsDuration', 'משך הבחינה (למועדים עם שעה)', [[0, 'לא מוגדר'], [2, 'שעתיים'], [3, '3 שעות'], [4, '4 שעות']], opts.durationHours)}
            ${_icsSelect('icsReminder', 'תזכורת', [[0, 'ללא'], [60, 'שעה לפני'], [1440, 'יום לפני'], [2880, 'יומיים לפני'], [10080, 'שבוע לפני']], opts.reminder)}`;
    }

    const dlg = ensureIcsDialog();
    icsDialogMode = mode;
    document.getElementById('icsDialogTitle').innerText = mode === 'schedule' ? 'ייצוא המערכת ליומן (ICS)' : 'ייצוא מועדי בחינות ליומן (ICS)';
    document.getElementById('icsDialogBody').innerHTML = html;
    dlg.showModal();
}

function confirmIcsExport() {
    const mode = icsDialogMode;
    if (!mode) return;
    const sem = getCurrentSemester();
    const val = id => document.getElementById(id);
    const opts = loadIcsOptions(mode);
    opts.prefix = _icsOneLine(val('icsPrefix').value);
    opts.suffix = _icsOneLine(val('icsSuffix').value);
    opts.reminder = parseInt(val('icsReminder').value, 10) || 0;

    let result, filename;
    if (mode === 'schedule') {
        const start = val('icsStart').value, end = val('icsEnd').value;
        const s = _parseIsoDate(start), e = _parseIsoDate(end);
        if (!s || !e) return alert('יש להזין תאריכי תחילת וסוף סמסטר.');
        if (e < s) return alert('תאריך הסיום חייב להיות אחרי תאריך ההתחלה.');
        opts.dates = Object.assign({}, opts.dates, { [sem]: { start, end } });
        opts.repeatWeekly = val('icsRepeat').checked;
        opts.skipBreaks = val('icsSkipBreaks').checked;
        opts.addBreaks = val('icsAddBreaks').checked;
        opts.showType = val('icsShowType').checked;
        result = buildScheduleICS(opts, sem, getScheduleEntriesForIcs());
        filename = `schedule-${sem}.ics`;
    } else {
        opts.includeUnchosen = val('icsUnchosen').checked;
        opts.moedA = val('icsMoedA').checked;
        opts.moedB = val('icsMoedB').checked;
        opts.moedC = val('icsMoedC').checked;
        opts.showMoed = val('icsShowMoed').checked;
        opts.addShoamLink = val('icsShoam').checked;
        opts.durationHours = parseFloat(val('icsDuration').value) || 0;
        result = buildExamsICS(opts, getExamEntriesForIcs(opts, sem));
        filename = `exams-${sem}.ics`;
    }

    if (result.count === 0) return alert('לא נמצאו אירועים לייצא עם ההגדרות שנבחרו.');
    saveIcsOptions(mode, opts);
    _icsDownload(result.lines, filename);
    document.getElementById('icsExportDialog').close();
    showToast(`יוצאו ${result.count} אירועים ✓`);
}
