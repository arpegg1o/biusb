'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// A fresh app + fake DOM per test, so state never leaks between tests.
function setup() {
  const els = {
    pasteArea: { value: '' },
    addAsElectiveToggle: { checked: false },
    editDialog: { closed: false, close() { this.closed = true; } },
  };
  const alerts = [];
  const app = loadApp({
    state: ['rawCourses', 'activeElectives', 'pasteWarnings', 'pasteProblems'],
    names: ['DAY_LIST_SRC', 'splitDayList', 'normalizePasteSemester', 'processInput', 'processNewFormat', 'processOldFormat', 'parseChunkOld'],
    stubs: {
      document: { getElementById: (id) => els[id] },
      alert: (m) => alerts.push(m),
      updateUI() {}, _linkLegacyCourses() {}, setTimeout() {},
      console: { info() {}, debug() {}, log() {} },
    },
  });
  const paste = (text) => { els.pasteArea.value = text; app.processInput(); };
  const saved = () => app.rawCourses.map((c) => `${c.day} ${c.start}-${c.end}`);
  return { app, els, alerts, paste, saved };
}

test('splitDayList reads the different ways days are written', () => {
  const { app } = setup();
  assert.deepEqual(app.splitDayList("ב', ה'"), ['ב', 'ה']);
  assert.deepEqual(app.splitDayList('ב,ה'), ['ב', 'ה']);
  assert.deepEqual(app.splitDayList("א' ג'"), ['א', 'ג']);
  assert.deepEqual(app.splitDayList("ד'"), ['ד']);
});

// ── the silent-Sunday regression ────────────────────────────────────────────

test('old format with NO day is not saved (used to become Sunday) and is reported', () => {
  const { els, alerts, paste, app } = setup();
  paste("הרצאה מבנה מחשב 89230-01 סמסטר א' 15:00-18:00 16:00-18:00");

  assert.equal(app.rawCourses.length, 0, 'nothing may be saved with a guessed day');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /לא הצלחנו לזהות את היום/);
  assert.match(alerts[0], /הרצאה/);
  assert.notEqual(els.pasteArea.value, '', 'the pasted text stays so the person can fix it');
  assert.equal(els.editDialog.closed, false, 'the dialog stays open');
});

test('new format with hours but NO day line is not saved and names the course', () => {
  const { alerts, paste, app } = setup();
  paste("מבנה מחשב\nהרצאה\nסמסטר א'\n10:00 - 12:00");

  assert.equal(app.rawCourses.length, 0);
  assert.match(alerts[0], /• מבנה מחשב \(הרצאה\)/);
});

test('a group without a day never turns into א', () => {
  const { paste, app } = setup();
  paste("תרגיל אלגברה 89111-02 סמסטר ב' 09:00-11:00");
  assert.ok(!app.rawCourses.some((c) => c.day === 'א'));
});

// ── normal pastes still work ────────────────────────────────────────────────

test('old format with a day is saved and the dialog closes', () => {
  const { els, alerts, paste, saved } = setup();
  paste("שיבוץ פנוי חובה הרצאה מבנה מחשב 89230-01 סמסטר א' יום ב' 15:00-18:00");

  assert.deepEqual(saved(), ['ב 15:00-18:00']);
  assert.equal(alerts.length, 0);
  assert.equal(els.pasteArea.value, '');
  assert.equal(els.editDialog.closed, true);
});

test('old format pairs each day with its own hours', () => {
  const { paste, saved } = setup();
  paste("הרצאה מבנה מחשב 89230-01 סמסטר א' יום ב',ה' 10:00-12:00 12:00-14:00");
  assert.deepEqual(saved(), ['ב 10:00-12:00', 'ה 12:00-14:00']);
});

test('new format: one hours range applies to every listed day', () => {
  const { paste, saved, app } = setup();
  paste("מבנה מחשב\nהרצאה\nסמסטר א'\nיום ב',ה'\nשעה 10:00 - 12:00");
  assert.deepEqual(saved(), ['ב 10:00-12:00', 'ה 10:00-12:00']);
  assert.equal(new Set(app.rawCourses.map((c) => c.courseGroupId)).size, 1, 'one group id ties the sessions together');
  assert.equal(app.rawCourses[0].semester, "א'");
  assert.equal(app.rawCourses[0].type, 'הרצאה');
});

test('more hour ranges than days still saves, with a warning', () => {
  const { alerts, paste, saved } = setup();
  paste("הרצאה מבנה מחשב 89230-01 סמסטר א' יום ב' 10:00-12:00 12:00-14:00");
  assert.deepEqual(saved(), ['ב 10:00-12:00']);
  assert.match(alerts[0], /זוהו 2 טווחי שעות/);
});

// ── mixed / repeated / unusable input ───────────────────────────────────────

test('re-pasting the same text does not add duplicates', () => {
  const { paste, app, alerts } = setup();
  const text = "הרצאה מבנה מחשב 89230-01 סמסטר א' יום ב' 15:00-18:00";
  paste(text);
  paste(text);
  assert.equal(app.rawCourses.length, 1);
  assert.match(alerts.at(-1), /לא חולצו קורסים חדשים/);
});

test('text that is not a schedule adds nothing and says so', () => {
  const { paste, app, alerts } = setup();
  paste('hello world');
  assert.equal(app.rawCourses.length, 0);
  assert.match(alerts[0], /לא חולצו קורסים חדשים/);
});

test('empty input does nothing and shows no alert', () => {
  const { paste, app, alerts } = setup();
  paste('   ');
  assert.equal(app.rawCourses.length, 0);
  assert.equal(alerts.length, 0);
});
