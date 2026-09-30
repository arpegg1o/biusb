'use strict';
// Guards the multi-file layout. The scripts are classic (non-module) files that
// share one global scope, so the mistakes that can happen are mechanical:
// a file missing from index.html, a missing ?v=, two files declaring the same
// function, an inline onclick pointing at something that doesn't exist, or a
// top-level statement that needs a file loaded later.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SCRIPT_FILES, INDEX_HTML, ROOT } = require('./harness');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const onDisk = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);

test('every script tag in index.html points at a file that exists, once', () => {
  for (const f of SCRIPT_FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is in index.html but missing on disk`);
  assert.equal(new Set(SCRIPT_FILES).size, SCRIPT_FILES.length, 'a script is listed twice');
});

test('every file in js/ is loaded by index.html (no orphans)', () => {
  const missing = onDisk.filter((f) => !SCRIPT_FILES.includes(f));
  assert.deepEqual(missing, [], `these files are not loaded by index.html: ${missing.join(', ')}`);
});

test('state.js loads first and main.js last', () => {
  assert.equal(SCRIPT_FILES[0], 'js/state.js');
  assert.equal(SCRIPT_FILES.at(-1), 'js/main.js');
});

// Only real tags - the explanatory comment at the top of index.html also mentions ?v=.
const localTags = () => INDEX_HTML.match(/<(?:script[^>]*\ssrc="js\/[^"]*"|link[^>]*href="styles\.css[^"]*")[^>]*>/g) || [];

test('every local <script> and stylesheet tag carries a ?v= cache-busting value', () => {
  const tags = localTags();
  assert.equal(tags.length, SCRIPT_FILES.length + 1);
  const bare = tags.filter((t) => !/\?v=[^"]+"/.test(t));
  assert.deepEqual(bare, [], 'these tags have no ?v= (browsers would keep serving stale copies)');
});

test('all ?v= values in index.html are identical (stamp-version.sh stamps them together)', () => {
  const versions = new Set(localTags().map((t) => (t.match(/\?v=([^"]+)"/) || [])[1]));
  assert.equal(versions.size, 1, `mixed versions: ${[...versions].join(', ')}`);
});

test('every file is valid JavaScript', () => {
  for (const f of SCRIPT_FILES) assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
});

test('no function or variable is declared at top level in two files', () => {
  const seen = new Map();
  const re = /^(?:async\s+)?function\s+([\w$]+)\s*\(|^(?:const|let|var)\s+([\w$]+)\s*[=;,]/gm;
  for (const f of SCRIPT_FILES) {
    for (const m of read(f).matchAll(re)) {
      const name = m[1] || m[2];
      seen.set(name, [...(seen.get(name) || []), f]);
    }
  }
  const dups = [...seen].filter(([, files]) => files.length > 1).map(([n, files]) => `${n} (${files.join(', ')})`);
  assert.deepEqual(dups, [], 'a later file would silently override the earlier declaration');
});

// ── inline handlers ─────────────────────────────────────────────────────────
// onclick="foo()" is resolved against the GLOBAL scope, so foo must be a
// top-level function in some js file. (One such handler used to point at a
// function that was private to the old wrapper and would have thrown.)
test('every function called from an inline on*="…" handler exists at top level', () => {
  const declared = new Set();
  for (const f of SCRIPT_FILES) for (const m of read(f).matchAll(/^(?:async\s+)?function\s+([\w$]+)\s*\(/gm)) declared.add(m[1]);

  const keywords = new Set(['if', 'for', 'while', 'function', 'return', 'switch', 'catch', 'typeof']);
  const sources = [['index.html', INDEX_HTML], ...SCRIPT_FILES.map((f) => [f, read(f)])];
  const problems = [];
  for (const [file, text] of sources) {
    for (const attr of text.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
      for (const call of attr[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = call[1];
        if (!keywords.has(name) && !declared.has(name)) problems.push(`${file}: ${name}() in ${attr[0].slice(0, 60)}…`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

// ── load order ──────────────────────────────────────────────────────────────
// Run every script, in index.html's order, in one shared context (like the
// browser does). A top-level statement that uses something from a file loaded
// LATER throws here. Everything else is deferred into functions, which this
// can't reach - the tests in the other files cover those.
test('all scripts load in order without error, and register the start-up hook', () => {
  const noop = () => {};
  const context = {
    document: { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: noop },
    uFuzzy: class {},           // vendor/uFuzzy.iife.min.js
    console: { info: noop, log: noop, error: noop, debug: noop },
    setTimeout: noop, fetch: noop,
  };
  context.window = context;
  vm.createContext(context);
  for (const f of SCRIPT_FILES) {
    assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }).runInContext(context), `loading ${f}`);
  }
  assert.equal(typeof context.window.onload, 'function');
});
