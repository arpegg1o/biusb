// ============================================================================
// Small shared helpers
//
// Time formatting/parsing, HTML escaping, colour helpers, and the toast. No dependencies on
// the rest of the app beyond the shared state.
//
// Classic script (not an ES module): every file in js/ shares ONE global scope, so
// functions and top-level let/const declared here are visible to the other files and to the
// inline onclick/onchange handlers in index.html. The load order lives in index.html.
// ============================================================================

function formatMinutesToTime(mins) {
    const h = Math.floor(mins / 60).toString().padStart(2, '0');
    const m = (mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function timeToMins(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Relative luminance (WCAG formula) → whether black or white text reads
// better on a given solid hex color.
function contrastTextColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const chan = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
    return luminance > 0.45 ? '#000' : '#fff';
}

function darkenHex(hex, factor) {
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor));
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor));
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor));
    return `rgb(${r}, ${g}, ${b})`;
}

// Course/event box colors. These used to be painted at 65% alpha so they
// "blended" softly with the page behind them — fine over the near-white
// light-theme background, but over a dark background the same blend
// turns the fill into a muddy dark color while the text stayed forced
// black, making it unreadable (this is the dark-mode bug from the
// screenshot). Fixed by painting these fully opaque, as a genuine solid
// color chip, and choosing the text color from that color's own
// luminance rather than assuming black always works.
function getCourseStyle(courseName, type, customColor) {
    if (customColor) {
        return { bg: customColor, border: darkenHex(customColor, 0.35), text: contrastTextColor(customColor) };
    }
    let hash = 0;
    for (let i = 0; i < courseName.length; i++) hash = courseName.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    const isMain = (type === 'הרצאה' || type === 'שיעור');
    // Always a light pastel by construction (82%/94% lightness), so
    // black text is always legible on it regardless of theme.
    return isMain
        ? { bg: `hsl(${hue}, 70%, 82%)`, border: `hsl(${hue}, 70%, 45%)`, text: '#000' }
        : { bg: `hsl(${hue}, 70%, 94%)`, border: `hsl(${hue}, 70%, 65%)`, text: '#000' };
}

let toastTimer = null;
// Empty message hides the toast immediately. `action` ({label, onClick})
// adds a button (e.g. "Undo"); such a toast accepts clicks, the plain
// ones stay click-through.
function showToast(message, duration = 2200, action = null) {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }
    clearTimeout(toastTimer);
    if (!message) { toast.classList.remove('visible'); return; }
    toast.textContent = message;
    toast.classList.toggle('has-action', !!action);
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => { showToast(''); action.onClick(); });
        toast.appendChild(btn);
    }
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}
