'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

function setup(rawCourses = []) {
  const storage = new Map();
  const calls = { updateUI: [], toasts: [] };
  const app = loadApp({
    state: ['rawCourses', 'historyStack', 'activeElectives', 'semesterIndices'],
    names: [
      'DAY_LETTERS', 'TYPE_MAP', 'SEMESTER_MAP', 'formatMinutesToTime',
      'saveState', 'undoAction',
      'planCatalogSync', 'formatCatalogSyncMessage', 'applyCatalogSync', 'undoCatalogSync',
    ],
    stubs: {
      localStorage: { setItem: (k, v) => storage.set(k, v), getItem: (k) => storage.get(k) ?? null },
      updateUI: (...args) => calls.updateUI.push(args),
      showToast: (message, duration, action) => calls.toasts.push({ message, duration, action }),
      console: { info() {}, debug() {}, log() {} },
    },
  });
  app.rawCourses = rawCourses;
  return { app, storage, calls };
}

const entry = (over) => ({
  id: 'e1', courseGroupId: '88230-2027-g01', name: 'מבנה מחשב', type: 'הרצאה', semester: "א'",
  day: 'א', start: '10:00', end: '12:00', isElective: false, color: null, ...over,
});
const catalogGroup = (meetings, over = {}) => ({
  id: '88230-2027-g01', type: 'lecture', semester: 'a', groupCode: '01', meetings, ...over,
});
const meeting = (dayOfWeek, startMinutes, endMinutes) => ({ dayOfWeek, startMinutes, endMinutes });
const course = (...groups) => ({ courseCode: '88230', groups });

// ── planCatalogSync ─────────────────────────────────────────────────────────
test('no plan when the saved hours already match the catalog (any order)', () => {
  const { app } = setup();
  const saved = [entry({ id: 'a', day: 'א', start: '10:00', end: '12:00' }), entry({ id: 'b', day: 'ג', start: '14:00', end: '16:00' })];
  const group = catalogGroup([meeting(2, 840, 960), meeting(0, 600, 720)]);
  assert.equal(app.planCatalogSync(saved, group), null);
});

test('a moved meeting produces replacement entries that keep the user\'s data', () => {
  const { app } = setup();
  const saved = [entry({ isElective: true, color: '#abcdef' })];
  const plan = app.planCatalogSync(saved, catalogGroup([meeting(1, 660, 780)]));

  assert.deepEqual(plan.have, ['א|10:00|12:00']);
  assert.deepEqual(plan.want, ['ב|11:00|13:00']);
  assert.equal(plan.fresh.length, 1);
  assert.deepEqual(
    { name: plan.fresh[0].name, day: plan.fresh[0].day, start: plan.fresh[0].start, end: plan.fresh[0].end,
      type: plan.fresh[0].type, semester: plan.fresh[0].semester, isElective: plan.fresh[0].isElective,
      color: plan.fresh[0].color, courseGroupId: plan.fresh[0].courseGroupId },
    { name: 'מבנה מחשב', day: 'ב', start: '11:00', end: '13:00', type: 'הרצאה', semester: "א'",
      isElective: true, color: '#abcdef', courseGroupId: '88230-2027-g01' },
  );
});

test('an added meeting is picked up', () => {
  const { app } = setup();
  const plan = app.planCatalogSync([entry()], catalogGroup([meeting(0, 600, 720), meeting(2, 600, 720)]));
  assert.deepEqual(plan.fresh.map((f) => f.day), ['א', 'ג']);
});

test('nothing to do for timeless groups, unsaved groups, or unshowable meetings', () => {
  const { app } = setup();
  assert.equal(app.planCatalogSync([entry()], catalogGroup([])), null, 'catalog group has no hours');
  assert.equal(app.planCatalogSync([entry({ courseGroupId: 'other-g01' })], catalogGroup([meeting(1, 600, 720)])), null, 'group not saved');
  assert.equal(app.planCatalogSync([entry({ timeless: true })], catalogGroup([meeting(1, 600, 720)])), null, 'saved entry is timeless');
  // Saturday (6) has no calendar column: the user's entries must NOT be wiped.
  assert.equal(app.planCatalogSync([entry()], catalogGroup([meeting(6, 600, 720)])), null);
});

// ── applyCatalogSync ────────────────────────────────────────────────────────
test('apply corrects the schedule in place and leaves other courses alone', () => {
  const other = entry({ id: 'o', courseGroupId: '11111-2027-g01', name: 'אחר' });
  const { app } = setup([other, entry(), entry({ id: 'z', courseGroupId: '22222-2027-g01', name: 'עוד' })]);
  const updates = app.applyCatalogSync([course(catalogGroup([meeting(1, 660, 780)]))]);

  assert.equal(updates.length, 1);
  assert.deepEqual(app.rawCourses.map((c) => c.name), ['אחר', 'מבנה מחשב', 'עוד'], 'same position');
  assert.equal(app.rawCourses[1].day, 'ב');
});

test('apply saves the corrected schedule and tells the person, with an Undo', () => {
  const { app, storage, calls } = setup([entry()]);
  app.applyCatalogSync([course(catalogGroup([meeting(1, 660, 780)]))]);

  assert.equal(JSON.parse(storage.get('mySchedulesData'))[0].day, 'ב', 'persisted after the fix');
  assert.deepEqual(calls.updateUI, [[false]], 'refresh without pushing a second history entry');
  assert.equal(calls.toasts.length, 1);
  assert.match(calls.toasts[0].message, /הקבוצה 01 של "מבנה מחשב" עודכנה בהתאם לקטלוג/);
  assert.equal(calls.toasts[0].action.label, 'בטל');
});

test('Undo puts the pre-sync schedule back (history holds the OLD state, not the new one)', () => {
  const { app, calls } = setup([entry()]);
  app.applyCatalogSync([course(catalogGroup([meeting(1, 660, 780)]))]);
  assert.equal(app.historyStack.length, 1);
  assert.equal(JSON.parse(app.historyStack[0])[0].day, 'א');

  calls.toasts[0].action.onClick();

  assert.equal(app.rawCourses.length, 1);
  assert.deepEqual([app.rawCourses[0].day, app.rawCourses[0].start, app.rawCourses[0].end], ['א', '10:00', '12:00']);
  assert.equal(calls.toasts.at(-1).message, 'העדכון מהקטלוג בוטל');
});

test('Undo refuses if the person has changed something since, and changes nothing', () => {
  const { app, calls } = setup([entry()]);
  app.applyCatalogSync([course(catalogGroup([meeting(1, 660, 780)]))]);

  // The person edits something else afterwards (pushes a newer history entry).
  app.rawCourses = [...app.rawCourses, entry({ id: 'new', courseGroupId: null, name: 'חדש' })];
  app.saveState(true);
  const before = JSON.stringify(app.rawCourses);

  calls.toasts[0].action.onClick();

  assert.equal(JSON.stringify(app.rawCourses), before);
  assert.match(calls.toasts.at(-1).message, /בוצעו שינויים נוספים/);
});

test('when nothing differs: no history entry, no refresh, no toast', () => {
  const { app, calls } = setup([entry()]);
  const updates = app.applyCatalogSync([course(catalogGroup([meeting(0, 600, 720)]))]);

  assert.deepEqual(updates, []);
  assert.equal(app.historyStack.length, 0);
  assert.equal(calls.updateUI.length, 0);
  assert.equal(calls.toasts.length, 0);
});

test('several corrected groups share one undo step and one toast', () => {
  const { app, calls } = setup([
    entry(),
    entry({ id: 'e2', courseGroupId: '88230-2027-g02', type: 'תרגיל' }),
  ]);
  const updates = app.applyCatalogSync([course(
    catalogGroup([meeting(1, 660, 780)]),
    catalogGroup([meeting(3, 660, 780)], { id: '88230-2027-g02', type: 'exercise', groupCode: '02' }),
  )]);

  assert.equal(updates.length, 2);
  assert.equal(app.historyStack.length, 1, 'one snapshot for the whole sync');
  assert.equal(calls.toasts.length, 1);
  assert.equal(calls.toasts[0].message, '2 קבוצות עודכנו בהתאם לקטלוג.');

  calls.toasts[0].action.onClick();
  assert.deepEqual(app.rawCourses.map((c) => c.day), ['א', 'א'], 'both reverted together');
});

test('failed catalog fetches (null) are ignored', () => {
  const { app, calls } = setup([entry()]);
  assert.deepEqual(app.applyCatalogSync([null, { groups: null }]), []);
  assert.equal(calls.toasts.length, 0);
});
