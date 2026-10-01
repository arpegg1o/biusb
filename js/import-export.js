// ============================================================================
// Import / export
//
// Schedule export (JSON, image, clipboard, PDF) and import.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

// --- Import / Export ---
function currentChoicesForExport() {
    const choices = JSON.parse(JSON.stringify(semesterChoices || {}));
    const sem = getCurrentSemester();
    const shown = validSchedules[semesterIndices[sem]];
    // Only trust what's on screen if it was solved for this semester.
    if (shown && shown.length && lastComputedSemester === sem) choices[sem] = scheduleGroupChoices(shown);
    return choices;
}

function exportData() {
    if (rawCourses.length === 0) return alert("אין נתונים לייצא.");
    
    const exportObject = {
        rawCourses: rawCourses,
        semesterIndices: semesterIndices,
        activeElectives: Array.from(activeElectives),
        // Which group is chosen per course slot, per semester — the index
        // alone is not stable across a re-solve, this is.
        semesterChoices: currentChoicesForExport()
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObject));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "schedule_data.json");
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

// =====================================================================
// Native Canvas export — no external libraries needed.
// Draws the schedule grid directly using the Canvas 2D API, reading the
// same data (rawCourses / validSchedules / getCourseStyle) that the live
// DOM renderer uses.  Produces a pixel-identical result without needing
// html2canvas (which requires a CDN load and is fragile).
// =====================================================================

function buildScheduleCanvas() {
    const currentSem  = getCurrentSemester();
    const currentIdx  = semesterIndices[currentSem] || 0;
    const schedule    = validSchedules[currentIdx] || [];

    // Collect timed entries for this semester
    const entries = schedule.filter(c => c.day && c.start && c.end);

    // Determine time range (same logic as renderCalendar)
    let minHour = 24, maxHour = 0;
    if (entries.length === 0) { minHour = 8; maxHour = 20; }
    else {
        entries.forEach(c => {
            const sh = parseInt(c.start.split(':')[0]);
            const eh = Math.ceil(timeToMins(c.end) / 60);
            if (sh < minHour) minHour = sh;
            if (eh > maxHour) maxHour = eh;
        });
        minHour = Math.max(0, minHour - 1);
        maxHour = Math.min(24, maxHour + 1);
    }

    // Which days are actually used?
    const usedDays = new Set(entries.map(c => c.day));
    const allDays  = DAY_LETTERS.filter(d => d !== 'ו' || usedDays.has('ו'));
    const dayLabels = { 'א': "ראשון", 'ב': "שני", 'ג': "שלישי", 'ד': "רביעי", 'ה': "חמישי", 'ו': "שישי" };

    // Layout constants (all in px, @2× for retina)
    const SCALE      = 2;
    const HOUR_PX    = 50 * SCALE;
    const TIME_W     = 56 * SCALE;
    const HDR_H      = 36 * SCALE;
    const BODY_H     = (maxHour - minHour) * HOUR_PX;
    const DAY_W      = Math.round(160 * SCALE);
    const TOTAL_W    = TIME_W + allDays.length * DAY_W;
    const TOTAL_H    = HDR_H + BODY_H;
    const CELL_PAD   = 4 * SCALE;
    const RADIUS     = 5 * SCALE;

    // RTL layout: time column is on the RIGHT, days run left→right as
    // Thursday … Sunday (so Sunday ends up on the far right, matching
    // the live RTL HTML calendar).
    // dayColX(di) returns the left edge of day-column at logical index di
    // (di=0 → ראשון/Sunday, rightmost; di=N-1 → leftmost day).
    const NUM_DAYS   = allDays.length;
    const DAYS_TOTAL = NUM_DAYS * DAY_W;          // total width of the day area
    // Time column sits at the far right.
    const TIME_X     = DAYS_TOTAL;                // left edge of the time column
    function dayColX(di) {
        // Reverse: logical index 0 (Sunday) → rightmost day slot.
        // Rightmost day slot starts at DAYS_TOTAL - DAY_W.
        return (NUM_DAYS - 1 - di) * DAY_W;
    }

    // Read CSS theme vars from the live document
    const cs         = getComputedStyle(document.documentElement);
    const BG_CARD    = cs.getPropertyValue('--card').trim()    || '#ffffff';
    const BG_ALT     = cs.getPropertyValue('--bg-alt').trim()  || '#f8f9fa';
    const CLR_BORDER = cs.getPropertyValue('--border').trim()  || '#e1e4e8';
    const CLR_TEXT   = cs.getPropertyValue('--text-main').trim()  || '#333333';
    const CLR_MUTED  = cs.getPropertyValue('--text-muted').trim() || '#666666';
    const FONT       = `${12 * SCALE}px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif`;
    const FONT_SM    = `${10 * SCALE}px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif`;
    const FONT_HDR   = `bold ${12 * SCALE}px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif`;

    const canvas = document.createElement('canvas');
    canvas.width  = TOTAL_W;
    canvas.height = TOTAL_H;
    const ctx = canvas.getContext('2d');

    // --- Background ---
    ctx.fillStyle = BG_CARD;
    ctx.fillRect(0, 0, TOTAL_W, TOTAL_H);

    // --- Header row ---
    ctx.fillStyle = BG_ALT;
    ctx.fillRect(0, 0, TOTAL_W, HDR_H);
    ctx.fillStyle = CLR_BORDER;
    ctx.fillRect(0, HDR_H - SCALE, TOTAL_W, SCALE);  // bottom border

    ctx.fillStyle = CLR_TEXT;
    ctx.font = FONT_HDR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // "שעה" header in time column (now on the right)
    ctx.fillText('שעה', TIME_X + TIME_W / 2, HDR_H / 2);

    // Day headers (RTL order: Sunday rightmost)
    allDays.forEach((d, i) => {
        const x = dayColX(i);
        ctx.fillStyle = CLR_BORDER;
        ctx.fillRect(x + DAY_W - SCALE, 0, SCALE, HDR_H); // right border of each day col
        ctx.fillStyle = CLR_TEXT;
        ctx.font = FONT_HDR;
        ctx.fillText(dayLabels[d] || d, x + DAY_W / 2, HDR_H / 2);
    });
    // Left border of the leftmost day column
    ctx.fillStyle = CLR_BORDER;
    ctx.fillRect(0, 0, SCALE, HDR_H);

    // --- Time column + hour grid lines ---
    ctx.fillStyle = BG_ALT;
    ctx.fillRect(TIME_X, HDR_H, TIME_W, BODY_H);
    ctx.fillStyle = CLR_BORDER;
    ctx.fillRect(TIME_X, HDR_H, SCALE, BODY_H); // left border of time col

    for (let h = minHour; h < maxHour; h++) {
        const y = HDR_H + (h - minHour) * HOUR_PX;
        // Hour grid line across the entire day area
        ctx.fillStyle = CLR_BORDER;
        ctx.fillRect(0, y, DAYS_TOTAL, SCALE);
        // Hour label
        ctx.fillStyle = CLR_MUTED;
        ctx.font = FONT_SM;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${h}:00`, TIME_X + TIME_W / 2, y + 4 * SCALE);
    }

    // Vertical day separators in body
    allDays.forEach((_, i) => {
        const x = dayColX(i);
        ctx.fillStyle = CLR_BORDER;
        ctx.fillRect(x + DAY_W - SCALE, HDR_H, SCALE, BODY_H); // right border
    });
    ctx.fillRect(0, HDR_H, SCALE, BODY_H); // left outer border

    // --- Helper: rounded rect ---
    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x,     y + h, x,     y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x,     y,     x + r, y,         r);
        ctx.closePath();
    }

    // --- Helper: wrap text RTL ---
    function drawWrappedText(text, cx, cy, maxW, lineH, maxLines, color, font) {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Split into words and reflow — canvas measureText works fine for Hebrew
        const words = text.split(' ');
        const lines = [];
        let cur = '';
        for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width > maxW && cur) {
                lines.push(cur);
                cur = w;
            } else {
                cur = test;
            }
        }
        if (cur) lines.push(cur);

        const slice = lines.slice(0, maxLines);
        const totalH = slice.length * lineH;
        const startY = cy - totalH / 2;
        slice.forEach((line, i) => {
            ctx.fillText(line, cx, startY + i * lineH, maxW);
        });
    }

    // --- Course event blocks ---
    // Group by day for overlap detection
    const byDay = {};
    allDays.forEach(d => { byDay[d] = []; });
    entries.forEach(c => { if (byDay[c.day]) byDay[c.day].push(c); });

    allDays.forEach((day, di) => {
        const dayEntries = byDay[day].slice().sort((a, b) => timeToMins(a.start) - timeToMins(b.start));
        if (!dayEntries.length) return;

        // Simple column-packing (mirrors renderCalendar)
        const cols = [];
        dayEntries.forEach(ev => {
            const s = timeToMins(ev.start);
            let placed = false;
            for (let ci = 0; ci < cols.length; ci++) {
                const lastEnd = timeToMins(cols[ci][cols[ci].length - 1].end);
                if (s >= lastEnd) { cols[ci].push(ev); ev._col = ci; placed = true; break; }
            }
            if (!placed) { ev._col = cols.length; cols.push([ev]); }
        });
        const numCols = cols.length;

        dayEntries.forEach(ev => {
            const colors  = getCourseStyle(ev.name, ev.type, ev.color);
            const top     = HDR_H + (timeToMins(ev.start) - minHour * 60) / 60 * HOUR_PX;
            const height  = (timeToMins(ev.end) - timeToMins(ev.start)) / 60 * HOUR_PX;
            const colW    = DAY_W / numCols;
            // RTL: day column X from the RTL helper; sub-columns also run RTL within the day
            const left    = dayColX(di) + (numCols - 1 - ev._col) * colW;
            const bx      = left + CELL_PAD;
            const by      = top + CELL_PAD;
            const bw      = colW - CELL_PAD * 2;
            const bh      = height - CELL_PAD * 2;

            if (bw < 2 || bh < 2) return;

            // Fill
            roundRect(bx, by, bw, bh, RADIUS);
            ctx.fillStyle = colors.bg;
            ctx.fill();

            // Border
            roundRect(bx, by, bw, bh, RADIUS);
            ctx.strokeStyle = colors.border;
            ctx.lineWidth = 2 * SCALE;
            ctx.stroke();

            // Text
            const textColor = colors.text;
            const cx = bx + bw / 2;
            const lineH = 14 * SCALE;
            const maxW  = bw - CELL_PAD * 2;

            if (bh >= 28 * SCALE) {
                // Course name (bold)
                drawWrappedText(ev.name, cx, by + bh * 0.38, maxW, lineH, bh > 60 * SCALE ? 3 : 2, textColor, `bold ${11 * SCALE}px "Segoe UI", Tahoma, sans-serif`);
                // Time
                if (bh >= 40 * SCALE) {
                    ctx.font = FONT_SM;
                    ctx.fillStyle = textColor;
                    ctx.globalAlpha = 0.8;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(`${ev.start}–${ev.end}`, cx, by + bh - CELL_PAD, maxW);
                    ctx.globalAlpha = 1;
                }
            } else {
                // Micro block — just the name, single line
                ctx.font = `bold ${9 * SCALE}px "Segoe UI", Tahoma, sans-serif`;
                ctx.fillStyle = textColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(ev.name, cx, by + bh / 2, maxW);
            }
        });
    });

    return canvas;
}

function exportToImage(format) {
    const currentSem = getCurrentSemester();
    const hasCourses = rawCourses.some(c => c.semester === currentSem || c.semester === 'שנתי');
    if (!hasCourses) return alert("אין מערכת לייצא כרגע.");

    try {
        const canvas = buildScheduleCanvas();
        const link = document.createElement('a');
        link.download = `Schedule_${currentSem}.${format}`;
        link.href = canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.97);
        link.click();
    } catch (err) {
        console.error('Export error:', err);
        alert("אירעה שגיאה בייצוא התמונה.");
    }
}

// Same picture as PNG export, but written to the clipboard.
// Uses the same native canvas renderer — no CDN dependency.
function exportToClipboard() {
    const currentSem = getCurrentSemester();
    const hasCourses = rawCourses.some(c => c.semester === currentSem || c.semester === 'שנתי');
    if (!hasCourses) return alert("אין מערכת לייצא כרגע.");

    if (!window.isSecureContext || !navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
        return alert("הדפדפן לא תומך בהעתקת תמונה ללוח (נדרש דפדפן עדכני ואתר מאובטח).\nאפשר להשתמש בייצוא כתמונה (PNG) במקום.");
    }

    showToast('מכין תמונה…', 15000);

    // Build immediately (sync) so the ClipboardItem is created inside the
    // click gesture — Safari requires this.
    let canvas;
    try { canvas = buildScheduleCanvas(); }
    catch (err) { showToast(''); alert("אירעה שגיאה בייצוא."); return; }

    const pngBlobPromise = new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
    );
    pngBlobPromise.catch(() => {});

    navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlobPromise })])
        .then(() => showToast('התמונה הועתקה ללוח ✓'))
        .catch(err => {
            console.error('Copy to clipboard failed:', err);
            showToast('');
            alert("לא הצלחנו להעתיק את התמונה ללוח.\nייתכן שהדפדפן חסם את הגישה ללוח — אפשר להשתמש בייצוא כתמונה (PNG) במקום.");
        });
}

// The export menu opens on hover with a mouse. Touch screens have no hover
// (and a tap-emulated one is unreliable), so there a tap on the button
// toggles it, and tapping anywhere else — or an item — closes it again.
function toggleExportMenu(e) {
    if (window.matchMedia('(hover: hover)').matches) return;   // mouse: CSS :hover handles it
    e.stopPropagation();
    document.querySelector('.dropdown').classList.toggle('open');
}

document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.dropdown-content.open').forEach(d => d.classList.remove('open'));
});

// --- Keyboard shortcuts ---
//   ← / →   move between semesters (RTL: ← = next, → = previous)
//   Ctrl/⌘+C copy the schedule image to the clipboard, but only when
//           nothing is selected — real text copying is never hijacked
// Both stay out of the way while typing in a field or with a dialog open.
function canCopyScheduleImage() {
    return !!(window.isSecureContext && navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined');
}

function exportToPDF() {
    const currentSem = getCurrentSemester();
    const hasCourses = rawCourses.some(c => c.semester === currentSem || c.semester === 'שנתי');
    if (!hasCourses) return alert("אין מערכת לייצא כרגע.");

    let canvas;
    try { canvas = buildScheduleCanvas(); }
    catch (err) { alert("אירעה שגיאה בייצוא."); return; }

    function runWithJsPDF() {
        try {
            const imgData = canvas.toDataURL('image/jpeg', 0.97);
            const w = canvas.width / 2, h = canvas.height / 2;
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
            pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
            pdf.save(`Schedule_${currentSem}.pdf`);
        } catch (err) {
            alert("אירעה שגיאה בייצור מסמך PDF.");
        }
    }

    if (typeof window.jspdf !== 'undefined') {
        runWithJsPDF();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = runWithJsPDF;
        script.onerror = () => alert("לא ניתן לטעון את ספריית ה-PDF. ודאו שיש חיבור לאינטרנט ונסו שוב, או השתמשו בייצוא PNG.");
        document.head.appendChild(script);
    }
}

// --- Parser Engine ---
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    showToast('טוען נתונים…', 60000);
    const reader = new FileReader();
    reader.onerror = function() {
        showToast('');
        alert("שגיאה בייבוא הקובץ.");
    };
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            let importedChoices = {};
            if (!Array.isArray(imported) && !(imported && imported.rawCourses)) throw new Error("Invalid format");
            saveState(true);

            if (Array.isArray(imported)) {
                rawCourses = imported;
                activeElectives = new Set();
                semesterIndices = { "א'": 0, "ב'": 0, "קיץ": 0 };
            } else {
                rawCourses = imported.rawCourses;
                semesterIndices = imported.semesterIndices || { "א'": 0, "ב'": 0, "קיץ": 0 };
                activeElectives = new Set(imported.activeElectives || []);
                const c = imported.semesterChoices;
                if (c && typeof c === 'object' && !Array.isArray(c)) importedChoices = c;
            }

            // The imported file's own chosen groups win over whatever was
            // remembered for the previous data (old exports have none, and
            // then the saved index is used).
            semesterChoices = importedChoices;
            try {
                if (Object.keys(importedChoices).length) localStorage.setItem('mySchedulesChoices', JSON.stringify(importedChoices));
                else localStorage.removeItem('mySchedulesChoices');
            } catch (err) {}
            saveState(false);   // persist the imported courses too, so a reload keeps them

            // This is an entirely new course list, not an edit to the
            // current one — comparing it against whatever schedule was
            // on screen before the import would be meaningless. Treat it
            // like a fresh page load instead.
            hasComputedOnce = false;
            detachFromSavedSchedule();
            showToast('מייבא ומחשב מערכת…', 60000);
            importInProgress = true;   // the solver clears this and shows "imported" when done
            updateUI(false);
            // Attempt to link any manually-entered / old-export courses to
            // catalog data so they get the "+" button and exam dates.
            // Small delay so the catalog index is ready when this runs.
            setTimeout(_linkLegacyCourses, 500);
        } catch (err) {
            importInProgress = false;
            showToast('');
            alert("שגיאה בייבוא הקובץ.");
        }
    };
    reader.readAsText(file);
    event.target.value = "";
}
