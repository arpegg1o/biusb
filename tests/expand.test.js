'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// A tiny stand-in for the DOM: just what the expand code touches.
function fakeEvent(children = {}) {
  const listeners = {};
  const classes = new Set();
  const el = {
    tabIndex: -1, attrs: {}, listeners, classes,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector: (sel) => (children[sel] ? { textContent: children[sel] } : null),
    contains(node) { return node === this._focused; },
  };
  return el;
}
// What a click's target looks like: `inside` is the selector that closest() should find.
const target = (matches = []) => ({ closest: (sel) => (matches.includes(sel) ? {} : null) });

function setup({ hoverNone = true } = {}) {
  const all = [];
  const doc = {
    activeElement: null,
    querySelectorAll: () => all.filter((e) => e.classes.has('expanded')),
  };
  const app = loadApp({
    names: ['collapseExpandedEvents', 'collapseExpandedOnOutsideClick', 'makeCompactEventExpandable'],
    stubs: { document: doc, window: { matchMedia: () => ({ matches: hoverNone }) } },
  });
  const make = (children) => { const e = fakeEvent(children); all.push(e); app.makeCompactEventExpandable(e); return e; };
  return { app, doc, make };
}
const tap = (el, t = target()) => el.listeners.click({ target: t, pointerType: 'touch' });

test('a compact block becomes focusable and gets a readable label', () => {
  const { make } = setup();
  const el = make({ '.class-title': 'מבנה מחשב', '.class-type': 'הרצאה', '.class-time': ' 10:00 - 12:00 ' });
  assert.equal(el.tabIndex, 0);
  assert.equal(el.attrs.role, 'group');
  assert.equal(el.attrs['aria-label'], 'מבנה מחשב, הרצאה, 10:00 - 12:00');
});

test('tapping toggles the enlarged card', () => {
  const { make } = setup();
  const el = make({});
  tap(el);
  assert.ok(el.classes.has('expanded'));
  tap(el);
  assert.ok(!el.classes.has('expanded'));
});

test('opening one card closes any other', () => {
  const { make } = setup();
  const a = make({}), b = make({});
  tap(a);
  tap(b);
  assert.ok(!a.classes.has('expanded'));
  assert.ok(b.classes.has('expanded'));
});

test('pressing one of the block\'s real buttons does not toggle the card', () => {
  const { make } = setup();
  const el = make({});
  tap(el, target(['.box-btn, .box-btn-popup']));
  assert.ok(!el.classes.has('expanded'));
});

test('a mouse click is ignored (hover already covers it; it would stay stuck open)', () => {
  const { make } = setup({ hoverNone: false });
  const el = make({});
  el.listeners.click({ target: target(), pointerType: 'mouse' });
  assert.ok(!el.classes.has('expanded'));
});

test('without pointer info, a hover-less device counts as touch and a hover device does not', () => {
  const touch = setup({ hoverNone: true }).make({});
  touch.listeners.click({ target: target() });
  assert.ok(touch.classes.has('expanded'));

  const desktop = setup({ hoverNone: false }).make({});
  desktop.listeners.click({ target: target() });
  assert.ok(!desktop.classes.has('expanded'));
});

test('Escape closes the card and drops focus from it', () => {
  const { make, doc } = setup();
  const el = make({});
  tap(el);
  let blurred = false;
  const focused = { blur: () => { blurred = true; } };
  el._focused = focused; doc.activeElement = focused;

  el.listeners.keydown({ key: 'Escape' });
  assert.ok(!el.classes.has('expanded'));
  assert.ok(blurred);
});

test('other keys do nothing', () => {
  const { make } = setup();
  const el = make({});
  tap(el);
  el.listeners.keydown({ key: 'Enter' });
  assert.ok(el.classes.has('expanded'));
});

test('tapping outside closes an open card; tapping inside it does not', () => {
  const { make, app } = setup();
  const el = make({});
  tap(el);
  app.collapseExpandedOnOutsideClick({ target: target(['.class-event.expanded']) });
  assert.ok(el.classes.has('expanded'), 'inside tap keeps it open');
  app.collapseExpandedOnOutsideClick({ target: target() });
  assert.ok(!el.classes.has('expanded'), 'outside tap closes it');
});
