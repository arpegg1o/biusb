'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, SCRIPT_FILES, ROOT } = require('./harness');

// ── 1. annual semester in the paste parser ──────────────────────────────────
function parserApp() {
  const els = { pasteArea: { value: '' }, addAsElectiveToggle: { checked: false }, editDialog: { close() {} } };
  const app = loadApp({
    state: ['rawCourses', 'activeElectives', 'pasteWarnings', 'pasteProblems'],
    names: ['DAY_LIST_SRC', 'splitDayList', 'normalizePasteSemester', 'processInput', 'processNewFormat', 'processOldFormat', 'parseChunkOld'],
    stubs: { document: { getElementById: (id) => els[id] }, alert() {}, updateUI() {}, _linkLegacyCourses() {}, setTimeout() {},
             console: { info() {}, debug() {}, log() {} } },
  });
  return { app, paste: (t) => { els.pasteArea.value = t; app.processInput(); } };
}

test('normalizePasteSemester keeps annual as "שנתי" and adds the apostrophe to א/ב', () => {
  const { app } = parserApp();
  assert.equal(app.normalizePasteSemester('שנתי'), 'שנתי');
  assert.equal(app.normalizePasteSemester('א'), "א'");
  assert.equal(app.normalizePasteSemester("ב'"), "ב'");
});

test('pasted annual course (new format) gets semester "שנתי"', () => {
  const { app, paste } = parserApp();
  paste("מבנה מחשב\nהרצאה\nסמסטר שנתי\nיום ב'\nשעה 10:00 - 12:00");
  assert.equal(app.rawCourses.length, 1);
  assert.equal(app.rawCourses[0].semester, 'שנתי');
});

test('pasted annual course (old format) gets semester "שנתי"', () => {
  const { app, paste } = parserApp();
  paste("הרצאה מבנה מחשב 89230-01 סמסטר שנתי יום ב' 10:00-12:00");
  assert.equal(app.rawCourses.length, 1);
  assert.equal(app.rawCourses[0].semester, 'שנתי');
});

test('semesters א and ב still parse as before', () => {
  const { app, paste } = parserApp();
  paste("הרצאה מבנה מחשב 89230-01 סמסטר ב יום ב' 10:00-12:00");
  assert.equal(app.rawCourses[0].semester, "ב'");
});

// ── 2. names with quotes in inline handlers ─────────────────────────────────
const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('jsArg output is safe in a double-quoted attribute and decodes back to the exact name', () => {
  const { jsArg } = loadApp({ names: ['escapeHtml', 'jsArg'] });
  for (const name of [`חדו"א ב'`, `a\\b`, `x');alert(1);('`, '</script><img src=x onerror=alert(1)>', 'שורה\nחדשה']) {
    const attr = jsArg(name);
    assert.ok(!/["<>]/.test(attr), `raw special char left in attribute: ${attr}`);
    assert.equal(JSON.parse(decodeEntities(attr)), name);
  }
});

test('no inline handler interpolates a value inside hand-written single quotes', () => {
  // onclick="foo('${x}')" breaks on a name containing ' and is injectable. Only
  // values that come from fixed constants may still be written that way.
  const constants = new Set(['t', 'sem']);
  const bad = [];
  for (const f of SCRIPT_FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\bon[a-z]+="[^"]*'\$\{([^}]+)\}'/g)) {
      if (!constants.has(m[1].trim())) bad.push(`${f}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ── 3. editing an exam from the calendar opens THAT exam ────────────────────
function examEditApp(exams) {
  const els = {};
  const el = (id) => els[id] = els[id] || { value: '', style: {}, showModal() {}, options: [{ value: "מועד א'" }, { value: "מועד ב'" }] };
  const app = loadApp({
    state: ['courseExamsMap', '_examEditCourse'],
    names: ['openExamCardEdit', 'openEditExamByKey', 'openEditExam', 'openAddExam'],
    stubs: { document: { getElementById: el } },
  });
  app.courseExamsMap = new Map([['קורס', { exams }]]);
  return { app, el };
}
const EXAMS = [
  { type: "מועד א'", date: '20/01/2027', time: '09:00' },
  { type: "מועד ב'", date: '05/03/2027', time: '10:00' },
  { type: "מועד א'", date: '27/06/2027', time: '13:00' },
];

test('clicking a card opens the exam with that date+type, not exam #0', () => {
  const { app, el } = examEditApp(EXAMS);
  app.openExamCardEdit('קורס', '27/06/2027', "מועד א'", '13:00');
  assert.equal(String(el('examEditExamIndex').value), '2');
  assert.equal(el('examEditDate').value, '27/06/2027');
  assert.equal(el('examEditTime').value, '13:00');
});

test('an exam that is not stored opens the add dialog pre-filled instead of editing another one', () => {
  const { app, el } = examEditApp(EXAMS);
  app.openExamCardEdit('קורס', '01/09/2027', "מועד ב'", '08:00');
  assert.equal(String(el('examEditExamIndex').value), '-1');
  assert.equal(el('examEditDate').value, '01/09/2027');
  assert.equal(el('examEditType').value, "מועד ב'");
});

// ── 4. ICS export ───────────────────────────────────────────────────────────
function icsApp(entries, { gimel = false, unchosen = true } = {}) {
  const captured = { parts: null, alerts: [] };
  const app = loadApp({
    names: ['parseExamDate', 'getMoedClass', '_icsEscape', '_icsFold', '_icsUtcStamp', 'exportExamsICS'],
    stubs: {
      getCurrentSemester: () => "ב'",
      getAllExamEntries: () => entries,
      document: {
        getElementById: (id) => ({ examsShowMoedGimelToggle: { checked: gimel }, examsShowUnchosenToggle: { checked: unchosen } }[id]),
        createElement: () => ({ click() {} }),
      },
      Blob: class { constructor(parts) { captured.parts = parts; } },
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
      setTimeout() {},
      alert: (m) => captured.alerts.push(m),
    },
  });
  return { app, captured, text: () => captured.parts && captured.parts.join('') };
}
const entry = (over = {}) => ({ courseName: 'מבנה', courseCode: '89230', enrolled: true,
  exam: { type: "מועד א'", date: '20/06/2027', time: '09:00' }, ...over });

test('ICS: every event has DTSTAMP, and the file ends with CRLF', () => {
  const { app, text } = icsApp([entry()]);
  app.exportExamsICS();
  assert.match(text(), /DTSTAMP:\d{8}T\d{6}Z\r\n/);
  assert.ok(text().endsWith('END:VCALENDAR\r\n'));
});

test('ICS: text is escaped (comma, semicolon, backslash)', () => {
  const { app, text } = icsApp([entry({ courseName: 'a, b; c\\d' })]);
  app.exportExamsICS();
  assert.ok(text().includes('SUMMARY:a\\, b\\; c\\\\d'));
});

test('ICS: long lines are folded to 75 octets without splitting characters, and unfold losslessly', () => {
  const name = 'קורס '.repeat(30).trim();
  const { app, text } = icsApp([entry({ courseName: name })]);
  app.exportExamsICS();
  for (const line of text().split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `too long: ${line}`);
  assert.ok(text().replace(/\r\n /g, '').includes(`SUMMARY:${name} — מועד א'`));
});

test('ICS: uses the same entries as the calendar (a March moed bet of semester A is not dropped)', () => {
  const march = entry({ exam: { type: "מועד ב'", date: '05/03/2027', time: '' } });
  const { app, text } = icsApp([march]);
  app.exportExamsICS();
  assert.ok(text().includes('DTSTART;VALUE=DATE:20270305'));
});

test('ICS: respects the moed-gimel and unchosen toggles', () => {
  const gimel = entry({ exam: { type: "מועד ג'", date: '01/09/2027', time: '' } });
  const dim = entry({ courseName: 'בחירה', enrolled: false });
  let r = icsApp([entry(), gimel, dim]); r.app.exportExamsICS();
  assert.ok(!r.text().includes('20270901'), 'gimel hidden by default');
  assert.ok(r.text().includes('SUMMARY:בחירה'), 'unchosen shown by default');
  r = icsApp([entry(), dim], { unchosen: false }); r.app.exportExamsICS();
  assert.ok(!r.text().includes('SUMMARY:בחירה'));
});

test('ICS: two identical exams get distinct UIDs; nothing to export just says so', () => {
  let r = icsApp([entry(), entry()]); r.app.exportExamsICS();
  const uids = r.text().match(/^UID:.*$/gm);
  assert.equal(new Set(uids).size, 2);
  r = icsApp([]); r.app.exportExamsICS();
  assert.equal(r.captured.parts, null);
  assert.equal(r.captured.alerts.length, 1);
});

// ── 5. search dropdown after the catalog finishes loading ───────────────────
function catalogApp({ open, fail = false }) {
  const calls = { search: 0 };
  const dd = { style: { display: open ? 'block' : 'none' } };
  const app = loadApp({
    state: ['catalogIndex', 'departmentNameById', 'departmentsList'],
    names: ['loadCatalogIndex'],
    stubs: {
      fetch: async () => { if (fail) throw new Error('offline'); return { ok: true, json: async () => [{ id: 'x', nameHe: 'מבנה' }] }; },
      document: { getElementById: () => dd },
      onSearchInput: () => { calls.search++; },
      normalizeForFuzzyMatch: (s) => s, renderDeptFilterChips() {},
      console: { error() {}, info() {}, log() {} },
    },
  });
  return { app, calls };
}

test('a search typed while the catalog loads is redrawn once it has loaded', async () => {
  const { app, calls } = catalogApp({ open: true });
  await app.loadCatalogIndex();
  assert.equal(calls.search, 1);
  assert.equal(app.catalogIndex.length, 1);
});

test('a closed dropdown is left alone, and a failed load still replaces "loading…"', async () => {
  let r = catalogApp({ open: false }); await r.app.loadCatalogIndex();
  assert.equal(r.calls.search, 0);
  r = catalogApp({ open: true, fail: true }); await r.app.loadCatalogIndex();
  assert.equal(r.calls.search, 1);
  assert.deepEqual(r.app.catalogIndex, []);
});
