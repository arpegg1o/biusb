// ============================================================================
// Exam exports
//
// Canvas-drawn PNG, PDF, ICS and JSON exports of the exam schedule.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

function toggleExamsExportMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('examsExportMenu');
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    document.querySelectorAll('.dropdown-content.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) menu.classList.add('open');
}

// =====================================================================
// Exam exports — native Canvas 2D, faithful to the site's visual design.
//
// Layout mirrors the DOM exactly:
//   • Full-width canvas (no multi-column month layout)
//   • One month block per section, stacked vertically → long image / multi-page PDF
//   • 7-column calendar grid (Sun … Sat), cells with day numbers
//   • Exam cards inside cells: right-side accent border in course colour,
//     moed-badge-small (א׳/ב׳/ג׳), time (muted), bold course name
//   • Unchosen electives rendered at 50% opacity
//   • Overlap banner at the top when conflicts exist
//   • Respects current light/dark theme
// =====================================================================

/** True when the page is currently showing the dark theme. */
function _examIsDark() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark')  return true;
    if (t === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Draw a rounded rectangle path (no fill/stroke — caller does that).
 * Safe: r is clamped so it never exceeds half the shorter side.
 */
function _examRRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (r <= 0) { ctx.rect(x, y, w, h); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);   ctx.arcTo(x+w, y,   x+w, y+r,   r);
    ctx.lineTo(x + w, y + h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x + r, y + h);   ctx.arcTo(x,   y+h, x,   y+h-r, r);
    ctx.lineTo(x, y + r);       ctx.arcTo(x,   y,   x+r, y,     r);
    ctx.closePath();
}

/** Colours for the small in-card moed badge, matching .moed-badge-small in CSS. */
function _moedBadgeColors(moedClass, dark) {
    const T = {
        'moed-a': dark
            ? { bg: 'rgba(67,160,71,0.22)',  text: '#a5d6a7', border: 'rgba(67,160,71,0.55)' }
            : { bg: 'rgba(67,160,71,0.15)',  text: '#2e7d32', border: 'rgba(67,160,71,0.4)'  },
        'moed-b': dark
            ? { bg: 'rgba(251,140,0,0.22)',  text: '#ffcc80', border: 'rgba(251,140,0,0.55)' }
            : { bg: 'rgba(251,140,0,0.15)',  text: '#e65100', border: 'rgba(251,140,0,0.4)'  },
        'moed-c': dark
            ? { bg: 'rgba(233,30,99,0.22)',  text: '#f48fb1', border: 'rgba(233,30,99,0.55)' }
            : { bg: 'rgba(233,30,99,0.12)',  text: '#880e4f', border: 'rgba(233,30,99,0.35)' },
    };
    return T[moedClass] || (dark
        ? { bg: 'rgba(156,39,176,0.22)', text: '#ce93d8', border: 'rgba(156,39,176,0.55)' }
        : { bg: 'rgba(156,39,176,0.12)', text: '#4a148c', border: 'rgba(156,39,176,0.35)' });
}

/**
 * Build a single tall Canvas that mirrors the exam-calendar dialog.
 * Returns the canvas element, or null if there are no entries to show.
 */
function buildExamsCanvas() {
    const currentSem    = getCurrentSemester();
    const showMoedGimel = document.getElementById('examsShowMoedGimelToggle')?.checked === true;
    const showUnchosen  = document.getElementById('examsShowUnchosenToggle')?.checked !== false;
    const dark          = _examIsDark();

    let allEntries = getAllExamEntries(currentSem);
    if (!showMoedGimel) allEntries = allEntries.filter(e => getMoedClass(e.exam.type) !== 'moed-c');
    if (!showUnchosen)  allEntries = allEntries.filter(e => e.enrolled);
    if (allEntries.length === 0) return null;

    // ── Resolve theme colours from live CSS vars ──────────────────────
    const cs = getComputedStyle(document.documentElement);
    const cv = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const BG      = cv('--bg',        dark ? '#121212' : '#f5f7fa');
    const CARD    = cv('--card',      dark ? '#1e1e1e' : '#ffffff');
    const BGALT   = cv('--bg-alt',    dark ? '#2c2c2c' : '#f8f9fa');
    const BORDER  = cv('--border',    dark ? '#333333' : '#e1e4e8');
    const TEXT    = cv('--text-main', dark ? '#e0e0e0' : '#333333');
    const MUTED   = cv('--text-muted',dark ? '#aaaaaa' : '#666666');
    const PRIMARY = cv('--primary',   '#4a90e2');
    const FONT    = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';

    // ── Layout (all in logical px; canvas drawn at SCALE× for retina) ─
    const SCALE     = 2;
    const PAD       = 20;           // outer horizontal padding
    const CANVAS_W  = 900;          // logical width (matches a comfortable dialog width)
    const GRID_W    = CANVAS_W - PAD * 2;
    const GAP       = 3;            // gap between grid cells
    const CELL_W    = (GRID_W - GAP * 6) / 7;  // 7 columns
    const CELL_MIN_H= 80;           // minimum cell height (matches CSS min-height)
    const CARD_PAD_H= 4;            // card vertical padding
    const CARD_PAD_V= 5;            // card horizontal padding
    const CARD_RADIUS = 5;
    const BADGE_H   = 16;           // height of the small moed badge pill
    const CARD_LINE_H = 15;         // line-height for course name text
    const DOW_HDR_H = 28;           // day-of-week header row height
    const MONTH_TITLE_H = 38;       // "ינואר 2027" heading row
    const MONTH_GAP = 32;           // gap between month blocks

    const HE_DOW    = ["א'","ב'","ג'","ד'","ה'","ו'","ש'"];  // Sun→Sat
    const HE_MOS    = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                       'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

    const overlapDates = getOverlapDates(allEntries);
    const grouped      = groupEntriesByMonth(allEntries);

    // ── Pass 1: measure total canvas height ───────────────────────────
    // For each month we need to know the actual height of every cell
    // (cells with many cards are taller than CELL_MIN_H).
    // We do a dry-run measure with a temp canvas so text wrapping is accurate.
    const measureCtx = document.createElement('canvas').getContext('2d');

    /** Estimate height of one exam card (name may wrap). */
    function measureCardH(entry) {
        const moedLabel = (entry.exam.type || '').replace('מועד ', '');
        const hasTime   = !!entry.exam.time;

        // top row: badge + time (single line)
        const topRowH = BADGE_H + CARD_PAD_H;

        // course name — may wrap
        const nameMaxW = CELL_W - CARD_PAD_V * 2 - 3 /* accent border */ - 4;
        measureCtx.font = `bold ${11}px ${FONT}`;
        const words = entry.courseName.split(' ');
        let line = '', lines = 0;
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (measureCtx.measureText(test).width > nameMaxW && line) {
                lines++;
                line = w;
            } else { line = test; }
        }
        if (line) lines++;
        const nameH = lines * CARD_LINE_H;

        return CARD_PAD_H + topRowH + nameH + CARD_PAD_H + 2; // +2 for gap between rows
    }

    /** Compute the pixel height of one calendar cell for a given day's entries. */
    function cellHeight(entries) {
        if (entries.length === 0) return CELL_MIN_H;
        const dayNumH = 22;
        const cardPad = 2; // gap between cards
        let h = dayNumH + 3; // day number + small padding
        entries.forEach(e => { h += measureCardH(e) + cardPad; });
        h += 3; // bottom padding
        return Math.max(CELL_MIN_H, h);
    }

    /** For a given month, compute the height of each calendar row (week). */
    function monthRowHeights(year, month, entries) {
        const byDay = {};
        entries.forEach(e => {
            const p = parseExamDate(e.exam.date);
            if (p) (byDay[p.day] = byDay[p.day] || []).push(e);
        });
        const startCol   = new Date(year, month, 1).getDay();
        const daysInMonth= new Date(year, month + 1, 0).getDate();
        const totalCells = startCol + daysInMonth;
        const numRows    = Math.ceil(totalCells / 7);

        const rowH = [];
        for (let row = 0; row < numRows; row++) {
            let maxH = CELL_MIN_H;
            for (let col = 0; col < 7; col++) {
                const dayNum = row * 7 + col - startCol + 1;
                if (dayNum < 1 || dayNum > daysInMonth) continue;
                maxH = Math.max(maxH, cellHeight(byDay[dayNum] || []));
            }
            rowH.push(maxH);
        }
        return rowH;
    }

    // Overlap banner
    const BANNER_H = overlapDates.size > 0 ? 56 : 0;
    // Legend
    const LEGEND_H = 36;

    let totalH = PAD + BANNER_H + (BANNER_H ? 16 : 0) + LEGEND_H + 20;
    const monthMeta = grouped.map(m => {
        const rh = monthRowHeights(m.year, m.month, m.entries);
        const mh = MONTH_TITLE_H + DOW_HDR_H + rh.reduce((s, h) => s + h + GAP, 0);
        totalH += mh + MONTH_GAP;
        return { ...m, rowHeights: rh, blockH: mh };
    });
    totalH += PAD;

    // ── Create canvas ─────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width  = CANVAS_W * SCALE;
    canvas.height = totalH  * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // Page background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, CANVAS_W, totalH);

    let y = PAD;

    // ── Overlap banner ────────────────────────────────────────────────
    if (overlapDates.size > 0) {
        const bx = PAD, bw = GRID_W;
        ctx.fillStyle = dark ? '#3e2f00' : '#fff8e1';
        _examRRect(ctx, bx, y, bw, BANNER_H, 8);
        ctx.fill();
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 1.5;
        _examRRect(ctx, bx, y, bw, BANNER_H, 8);
        ctx.stroke();

        ctx.font = `bold 13px ${FONT}`;
        ctx.fillStyle = dark ? '#ffd54f' : '#5d4037';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';
        ctx.fillText('⚠️ חפיפות במועדי בחינות:', CANVAS_W - PAD - 12, y + 10);
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = dark ? '#ffcc80' : '#6d4c00';
        const overlapLine = Array.from(overlapDates).sort().map(d => {
            const names = allEntries.filter(e => e.enrolled && e.exam.date === d).map(e => e.courseName);
            return `${d}: ${names.join(', ')}`;
        }).join('   •   ');
        ctx.fillText(overlapLine, CANVAS_W - PAD - 12, y + 30);
        y += BANNER_H + 16;
    }

    // ── Legend ────────────────────────────────────────────────────────
    const legendItems = [
        { label: "מועד א'", cls: 'moed-a' },
        { label: "מועד ב'", cls: 'moed-b' },
        ...(showMoedGimel ? [{ label: "מועד ג'", cls: 'moed-c' }] : []),
    ];
    ctx.textBaseline = 'middle';
    let lx = PAD;
    const LBH = 22, LBR = 11; // legend badge height & border-radius
    legendItems.forEach(item => {
        const c = _moedBadgeColors(item.cls, dark);
        ctx.font = `bold 12px ${FONT}`;
        const tw = ctx.measureText(item.label).width;
        const lbw = tw + 22;
        ctx.fillStyle = c.bg;
        _examRRect(ctx, lx, y + (LEGEND_H - LBH) / 2, lbw, LBH, LBR);
        ctx.fill();
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 1.5;
        _examRRect(ctx, lx, y + (LEGEND_H - LBH) / 2, lbw, LBH, LBR);
        ctx.stroke();
        ctx.fillStyle = c.text;
        ctx.textAlign = 'center';
        ctx.fillText(item.label, lx + lbw / 2, y + LEGEND_H / 2);
        lx += lbw + 10;
    });
    // Unchosen legend dot
    const dotX = lx + 14, dotY = y + LEGEND_H / 2;
    ctx.beginPath(); ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fillStyle = BORDER; ctx.fill();
    ctx.strokeStyle = BORDER; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    ctx.fillText("קורסי בחירה שלא הופעלו (עמומים)", CANVAS_W - PAD, y + LEGEND_H / 2);
    y += LEGEND_H + 20;

    // ── Month blocks ──────────────────────────────────────────────────
    monthMeta.forEach(({ year: yr, month: mo, entries: mEntries, rowHeights }) => {
        // Month title
        ctx.font = `bold 18px ${FONT}`;
        ctx.fillStyle = PRIMARY;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${HE_MOS[mo]} ${yr}`, CANVAS_W - PAD, y + MONTH_TITLE_H / 2);
        // Underline
        ctx.fillStyle = PRIMARY;
        ctx.fillRect(PAD, y + MONTH_TITLE_H - 3, GRID_W, 2);
        y += MONTH_TITLE_H;

        // Day-of-week headers (Sun=right … Sat=left in RTL)
        for (let col = 0; col < 7; col++) {
            // col 0 = Sunday = rightmost in RTL
            const cx = PAD + (6 - col) * (CELL_W + GAP) + CELL_W / 2;
            ctx.font = `bold 12px ${FONT}`;
            ctx.fillStyle = MUTED;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(HE_DOW[col], cx, y + DOW_HDR_H / 2);
        }
        y += DOW_HDR_H;

        // Build byDay
        const byDay = {};
        mEntries.forEach(e => {
            const p = parseExamDate(e.exam.date);
            if (p) (byDay[p.day] = byDay[p.day] || []).push(e);
        });

        const startCol    = new Date(yr, mo, 1).getDay();
        const daysInMonth = new Date(yr, mo + 1, 0).getDate();

        let col = startCol;
        let row = 0;
        let rowY = y;

        for (let d = 1; d <= daysInMonth; d++) {
            const rh      = rowHeights[row];
            const dayEntries = byDay[d] || [];
            const dowIdx  = col; // 0=Sun … 6=Sat
            const isShabbat = dowIdx === 6;

            // Cell x: RTL — col 0 (Sunday) is rightmost
            const cx = PAD + (6 - col) * (CELL_W + GAP);

            // Cell background
            const dateStr = `${String(d).padStart(2,'0')}/${String(mo+1).padStart(2,'0')}/${yr}`;
            const hasOverlap = overlapDates.has(dateStr) && dayEntries.some(e => e.enrolled);

            let cellBg = BGALT;
            if (dayEntries.length > 0) cellBg = CARD;
            if (isShabbat) cellBg = BG;

            ctx.globalAlpha = isShabbat ? 0.7 : 1;
            _examRRect(ctx, cx, rowY, CELL_W, rh, 6);
            ctx.fillStyle = cellBg;
            ctx.fill();
            if (hasOverlap) {
                ctx.fillStyle = dark ? 'rgba(255,213,79,0.12)' : 'rgba(255,213,79,0.25)';
                _examRRect(ctx, cx, rowY, CELL_W, rh, 6);
                ctx.fill();
            }
            ctx.strokeStyle = BORDER;
            ctx.lineWidth   = 1;
            _examRRect(ctx, cx, rowY, CELL_W, rh, 6);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Day number
            ctx.font = `bold 12px ${FONT}`;
            ctx.fillStyle = TEXT;
            ctx.textAlign  = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(String(d) + (hasOverlap ? ' ⚠️' : ''), cx + CELL_W - 5, rowY + 3);

            // Exam cards
            let cardY = rowY + 22;
            dayEntries.forEach(entry => {
                const moedClass = getMoedClass(entry.exam.type);
                const moedLabel = (entry.exam.type || '').replace('מועד ', '');
                const unchosen  = !entry.enrolled;

                ctx.globalAlpha = unchosen ? 0.5 : 1;

                // Card background: color-mix(course bg 18%, card) when enrolled
                let cardBgColor = BGALT;
                if (!unchosen) {
                    // Approximate the CSS color-mix by blending entry.bg at 18% over CARD
                    cardBgColor = _blendHex(entry.bg, CARD, 0.18);
                }
                const accentColor = unchosen ? BORDER : entry.border;

                const cardH = measureCardH(entry);
                const cardX = cx + 3 + 1; // 1px gap after accent border
                const cardW = CELL_W - 3 - 4; // 3px accent + 1px right gap

                // Card fill
                _examRRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
                ctx.fillStyle = cardBgColor;
                ctx.fill();
                // Card border (thin, all sides except right which is overridden)
                _examRRect(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
                ctx.strokeStyle = BORDER;
                ctx.lineWidth = 1;
                ctx.stroke();
                // Right accent bar (3px, course colour)
                ctx.fillStyle = accentColor;
                _examRRect(ctx, cx + 1, cardY, 3, cardH, 3);
                ctx.fill();

                // Top row: time (left in RTL = right side of card visually) + moed badge
                const topRowY  = cardY + CARD_PAD_H;
                const badgeColors = _moedBadgeColors(moedClass, dark);
                ctx.font = `bold 9px ${FONT}`;
                const badgeTw  = ctx.measureText(moedLabel).width;
                const badgeW   = badgeTw + 10;
                const badgeX   = cardX + CARD_PAD_V;
                // badge pill
                _examRRect(ctx, badgeX, topRowY, badgeW, BADGE_H, BADGE_H / 2);
                ctx.fillStyle = badgeColors.bg; ctx.fill();
                ctx.strokeStyle = badgeColors.border; ctx.lineWidth = 1; ctx.stroke();
                ctx.fillStyle = badgeColors.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(moedLabel, badgeX + badgeW / 2, topRowY + BADGE_H / 2);

                // Time (muted, right side of top row)
                if (entry.exam.time) {
                    ctx.font = `10px ${FONT}`;
                    ctx.fillStyle = unchosen ? MUTED : MUTED;
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(entry.exam.time, cardX + cardW - CARD_PAD_V, topRowY + BADGE_H / 2);
                }

                // Course name (bold, may wrap)
                const nameY   = topRowY + BADGE_H + 3;
                const nameMaxW = cardW - CARD_PAD_V * 2;
                ctx.font = `bold 11px ${FONT}`;
                ctx.fillStyle = unchosen ? MUTED : TEXT;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'top';
                // Word-wrap
                const words = entry.courseName.split(' ');
                let line = '', lineY = nameY;
                for (const w of words) {
                    const test = line ? line + ' ' + w : w;
                    if (ctx.measureText(test).width > nameMaxW && line) {
                        ctx.fillText(line, cardX + cardW - CARD_PAD_V, lineY);
                        lineY += CARD_LINE_H;
                        line = w;
                    } else { line = test; }
                }
                if (line) ctx.fillText(line, cardX + cardW - CARD_PAD_V, lineY);

                ctx.globalAlpha = 1;
                cardY += cardH + 2;
            });

            // Advance column/row
            col++;
            if (col === 7) {
                col = 0;
                rowY += rh + GAP;
                row++;
            }
        }

        // Advance y past the last row
        y = rowY + (rowHeights[row] ?? 0) + GAP + MONTH_GAP;
    });

    return canvas;
}

/**
 * Blend hexColor over baseHex at alpha (0–1).
 * Returns a CSS hex string.  Falls back to baseHex on parse failure.
 */
function _blendHex(hexColor, baseHex, alpha) {
    function parse(h) {
        h = (h || '').trim().replace('#','');
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        const n = parseInt(h, 16);
        return isNaN(n) ? null : [n>>16&255, n>>8&255, n&255];
    }
    const c = parse(hexColor), b = parse(baseHex);
    if (!c || !b) return baseHex;
    const r = Math.round(c[0]*alpha + b[0]*(1-alpha));
    const g = Math.round(c[1]*alpha + b[1]*(1-alpha));
    const bl= Math.round(c[2]*alpha + b[2]*(1-alpha));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
}

function exportExamsPNG() {
    const canvas = buildExamsCanvas();
    if (!canvas) return alert('אין תוכן לייצא.');
    const link = document.createElement('a');
    link.download = 'exam_schedule.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function exportExamsPDF() {
    const canvas = buildExamsCanvas();
    if (!canvas) return alert('אין תוכן לייצא.');

    function run() {
        try {
            const { jsPDF } = window.jspdf;
            // Each "page" in the PDF is A4 landscape.  We slice the tall canvas
            // into page-sized strips so the PDF has multiple pages rather than
            // one enormous unreadable page.
            const A4_W_MM  = 297, A4_H_MM  = 210;   // landscape A4
            const A4_W_PX  = canvas.width  / 2;      // logical px (canvas drawn @2×)
            const PAGE_H_PX= Math.round(A4_W_PX * A4_H_MM / A4_W_MM);

            const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            let sliceY = 0;

            while (sliceY < canvas.height / 2) {
                if (sliceY > 0) pdf.addPage('a4', 'landscape');

                // Draw this slice onto a temporary canvas
                const sliceH = Math.min(PAGE_H_PX, canvas.height / 2 - sliceY);
                const tmp = document.createElement('canvas');
                tmp.width  = canvas.width;
                tmp.height = sliceH * 2;
                const tctx = tmp.getContext('2d');
                tctx.drawImage(canvas, 0, sliceY * 2, canvas.width, sliceH * 2,
                                       0, 0, canvas.width, sliceH * 2);

                pdf.addImage(tmp.toDataURL('image/jpeg', 0.92), 'JPEG',
                             0, 0, A4_W_MM, (sliceH / A4_W_PX) * A4_W_MM);
                sliceY += PAGE_H_PX;
            }
            pdf.save('exam_schedule.pdf');
        } catch (e) {
            console.error(e);
            alert('שגיאה בייצוא PDF.');
        }
    }

    if (typeof window.jspdf !== 'undefined') {
        run();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = run;
        script.onerror = () => alert('לא ניתן לטעון ספריית PDF. נסו לייצא כ-PNG.');
        document.head.appendChild(script);
    }
}

// ── ICS helpers (RFC 5545) ─────────────────────────────────────────────
/** TEXT values: escape backslash, semicolon, comma and newlines. */
function _icsEscape(text) {
    return String(text == null ? '' : text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/** Folds a content line to at most 75 octets (UTF-8), never splitting a
 *  character; continuation lines start with one space. */
function _icsFold(line) {
    const enc = new TextEncoder();
    let out = '', cur = '', bytes = 0;
    for (const ch of line) {
        const b = enc.encode(ch).length;
        if (bytes + b > 75) { out += cur + '\r\n '; cur = ''; bytes = 1; }
        cur += ch;
        bytes += b;
    }
    return out + cur;
}

/** DTSTAMP value: current UTC time as YYYYMMDDTHHMMSSZ. */
function _icsUtcStamp(d = new Date()) {
    const p2 = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
           `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
}

// The ICS export (button + options popup) lives in js/ics-export.js: openIcsExportDialog('exams').

function exportExamsJSON() {
    const currentSem = getCurrentSemester();
    const semNames   = getCourseNamesForSemester(currentSem);
    const obj = {};
    courseExamsMap.forEach((data, name) => {
        if (semNames.has(name)) obj[name] = data;
    });
    const str = JSON.stringify(obj, null, 2);
    const link = document.createElement('a');
    link.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(str);
    link.download = `exams-${currentSem}.json`;
    link.click();
}
