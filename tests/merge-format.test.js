'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

function setup(rawCourses = []) {
  const app = loadApp({
    state: ['rawCourses'],
    names: [
      'formatMinutesToTime', 'meetingSignature', 'absorbGroupMeta', 'getMergedGroups',
      'mergedGroupIds', 'isGroupIdInSchedule', 'isGroupAdded', 'findMergedGroup',
      'extractCourseIdFromGroupId', 'formatCatalogSyncMessage',
    ],
  });
  app.rawCourses = rawCourses;
  return app;
}

// A catalog group as it appears in the course files.
const group = (id, over = {}) => ({
  id, type: 'lecture', semester: 'a', groupCode: id.split('-g')[1], lecturerName: '',
  meetings: [{ dayOfWeek: 1, startMinutes: 600, endMinutes: 720 }], ...over,
});
const course = (...groups) => ({ id: '88230-2027', courseCode: '88230', groups });

// ── formatMinutesToTime ─────────────────────────────────────────────────────
test('formatMinutesToTime zero-pads hours and minutes', () => {
  const { formatMinutesToTime: f } = setup();
  assert.equal(f(0), '00:00');
  assert.equal(f(545), '09:05');
  assert.equal(f(600), '10:00');
  assert.equal(f(1410), '23:30');
});

// ── meetingSignature ────────────────────────────────────────────────────────
test('meetingSignature ignores the order of meetings', () => {
  const { meetingSignature: sig } = setup();
  const a = { meetings: [{ dayOfWeek: 1, startMinutes: 600, endMinutes: 720 }, { dayOfWeek: 3, startMinutes: 60, endMinutes: 120 }] };
  const b = { meetings: [...a.meetings].reverse() };
  assert.equal(sig(a), sig(b));
});

test('meetingSignature tells different hours apart', () => {
  const { meetingSignature: sig } = setup();
  const at = (start) => ({ meetings: [{ dayOfWeek: 1, startMinutes: start, endMinutes: 720 }] });
  assert.notEqual(sig(at(600)), sig(at(630)));
});

// ── getMergedGroups ─────────────────────────────────────────────────────────
test('groups that differ only by lecturer merge into one option', () => {
  const { getMergedGroups } = setup();
  const merged = getMergedGroups(course(
    group('88230-2027-g01', { lecturerName: 'Cohen' }),
    group('88230-2027-g02', { lecturerName: 'Levi' }),
  ));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, '88230-2027-g01', 'keeps the FIRST group\'s real id');
  assert.deepEqual(merged[0].mergedIds, ['88230-2027-g01', '88230-2027-g02']);
  assert.equal(merged[0].lecturerName, 'Cohen/Levi');
  assert.equal(merged[0].groupCode, '01/02');
});

test('identical lecturers are not repeated', () => {
  const { getMergedGroups } = setup();
  const [m] = getMergedGroups(course(
    group('88230-2027-g01', { lecturerName: 'Cohen' }),
    group('88230-2027-g02', { lecturerName: 'Cohen' }),
  ));
  assert.equal(m.lecturerName, 'Cohen');
});

test('different hours, semester or type are never merged', () => {
  const { getMergedGroups } = setup();
  const merged = getMergedGroups(course(
    group('88230-2027-g01'),
    group('88230-2027-g02', { meetings: [{ dayOfWeek: 1, startMinutes: 630, endMinutes: 720 }] }),
    group('88230-2027-g03', { semester: 'b' }),
    group('88230-2027-g04', { type: 'exercise' }),
  ));
  assert.equal(merged.length, 4);
});

test('groups with no fixed hours each stay their own option', () => {
  const { getMergedGroups } = setup();
  const merged = getMergedGroups(course(
    group('88230-2027-g01', { meetings: [] }),
    group('88230-2027-g02', { meetings: [] }),
  ));
  assert.equal(merged.length, 2);
});

test('remarks and Shoham/syllabus links are combined without duplicates', () => {
  const { getMergedGroups } = setup();
  const [m] = getMergedGroups(course(
    group('88230-2027-g01', { remark: 'Zoom', shoamId: 's1', syllabus: 'a.pdf' }),
    group('88230-2027-g02', { remark: 'Zoom', shoamId: 's1', syllabus: 'a.pdf' }),
    group('88230-2027-g03', { remark: 'Room 5', shoamId: 's2' }),
  ));
  assert.equal(m.remark, 'Zoom | Room 5');
  assert.deepEqual(m.shoamIds, ['s1', 's2']);
  assert.equal(m.shoamId, 's1');
  assert.equal(m.links.length, 2, 'the duplicate link is skipped');
});

test('the merge is cached but never leaks into serialized course data', () => {
  const { getMergedGroups } = setup();
  const c = course(group('88230-2027-g01'));
  assert.equal(getMergedGroups(c), getMergedGroups(c));
  assert.ok(!Object.keys(c).includes('__mergedGroups'));
  assert.ok(!JSON.stringify(c).includes('__mergedGroups'));
});

test('getMergedGroups copes with missing data', () => {
  const { getMergedGroups } = setup();
  assert.deepEqual(getMergedGroups(null), []);
  assert.deepEqual(getMergedGroups({}), []);
});

// ── merged-id helpers ───────────────────────────────────────────────────────
test('a merged option is found — and counted as added — under any id it stands for', () => {
  const c = course(group('88230-2027-g01'), group('88230-2027-g02'));
  // Saved earlier under the SECOND group's id, before merging existed.
  const app = setup([{ id: 'x', courseGroupId: '88230-2027-g02' }]);
  const [m] = app.getMergedGroups(c);

  assert.deepEqual(app.mergedGroupIds(m), ['88230-2027-g01', '88230-2027-g02']);
  assert.equal(app.findMergedGroup(c, '88230-2027-g02'), m);
  assert.equal(app.findMergedGroup(c, 'nope'), null);
  assert.equal(app.isGroupAdded(m), true);
});

test('a group that is not in the schedule is not "added"', () => {
  const c = course(group('88230-2027-g01'));
  const app = setup([{ id: 'x', courseGroupId: '11111-2027-g01' }]);
  assert.equal(app.isGroupAdded(app.getMergedGroups(c)[0]), false);
});

test('mergedGroupIds of an unmerged group is just its own id', () => {
  const { mergedGroupIds } = setup();
  assert.deepEqual(mergedGroupIds({ id: 'a' }), ['a']);
  assert.deepEqual(mergedGroupIds(null), []);
});

// ── extractCourseIdFromGroupId ──────────────────────────────────────────────
test('extractCourseIdFromGroupId recognises catalog-style group ids only', () => {
  const { extractCourseIdFromGroupId: x } = setup();
  assert.equal(x('66201-2027-g01'), '66201-2027');
  assert.equal(x('88230-2027-g12'), '88230-2027');
  // pasted / manual entries use a timestamp-ish id, or none
  assert.equal(x('17907043176947mcspu'), null);
  assert.equal(x(null), null);
  assert.equal(x(undefined), null);
  assert.equal(x(''), null);
});

// ── formatCatalogSyncMessage ────────────────────────────────────────────────
test('sync toast names the group when one changed', () => {
  const { formatCatalogSyncMessage: msg } = setup();
  assert.equal(msg([{ name: 'מבנה מחשב', groupCode: '01' }]), 'הקבוצה 01 של "מבנה מחשב" עודכנה בהתאם לקטלוג.');
});

test('sync toast omits the group when the catalog gave no code', () => {
  const { formatCatalogSyncMessage: msg } = setup();
  assert.equal(msg([{ name: 'מבנה מחשב' }]), '"מבנה מחשב" עודכנה בהתאם לקטלוג.');
});

test('sync toast counts when several changed', () => {
  const { formatCatalogSyncMessage: msg } = setup();
  assert.equal(msg([{ name: 'a' }, { name: 'b' }, { name: 'c' }]), '3 קבוצות עודכנו בהתאם לקטלוג.');
});
