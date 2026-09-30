'use strict';
// Loads REAL functions out of ../js/*.js so tests run against the shipping code
// (no copy to drift out of sync). The scripts need a browser, so instead of
// running them we cut named top-level declarations out of their source and
// evaluate just those, with stubs for whatever they touch.
//
// The list of files comes from the <script src="js/..."> tags in index.html,
// so the page and the tests can never disagree about which files exist. Names
// are looked up across ALL of them - you don't say which file a function is in.
//
//   const app = loadApp({
//     names: ['formatMinutesToTime', 'DAY_LETTERS'],   // functions / const / let, in dependency order
//     state: ['rawCourses'],                            // `let` variables you want get/set access to
//     stubs: { alert: () => {} },                       // globals the code expects (document, alert, ...)
//   });
//   app.formatMinutesToTime(545)  // '09:05'

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// Same order the browser loads them in.
const SCRIPT_FILES = [...INDEX_HTML.matchAll(/<script[^>]*\ssrc="(js\/[^"?]+)/g)].map((m) => m[1]);
if (SCRIPT_FILES.length === 0) throw new Error('harness: no <script src="js/..."> tags found in index.html');
const APP_SOURCE = SCRIPT_FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const parses = (code) => {
  try { new vm.Script(code); return true; } catch { return false; }
};

// The end of a declaration is the first closing brace (functions) or
// semicolon (const/let) at which the text parses as a complete statement. That
// is robust against braces inside strings, regexes, comments and templates,
// which a hand-rolled brace counter is not.
function extractDeclaration(name) {
  // Top-level declarations start at column 0; nested ones (and the worker's
  // source inside a template string) are indented, so they never match.
  const fn = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(APP_SOURCE);
  const variable = new RegExp(`^(?:const|let)\\s+${name}\\s*=`, 'm').exec(APP_SOURCE);
  const match = fn || variable;
  if (!match) throw new Error(`harness: "${name}" is not a top-level declaration in js/*.js`);

  const closer = fn ? '}' : ';';
  for (let i = APP_SOURCE.indexOf(closer, match.index); i !== -1; i = APP_SOURCE.indexOf(closer, i + 1)) {
    const candidate = APP_SOURCE.slice(match.index, i + 1);
    if (parses(candidate)) return candidate;
  }
  throw new Error(`harness: could not find the end of "${name}" in js/*.js`);
}

function loadApp({ names = [], state = [], stubs = {} } = {}) {
  const declarations = [...new Set([...state, ...names])].map(extractDeclaration);
  const exported = names.filter((n) => !state.includes(n));
  const accessors = state.map((n) => `get ${n}() { return ${n}; }, set ${n}(v) { ${n} = v; }`);
  const body = `${declarations.join('\n')}\nreturn { ${[...exported, ...accessors].join(', ')} };`;

  const stubNames = Object.keys(stubs);
  return new Function(...stubNames, body)(...stubNames.map((k) => stubs[k]));
}

module.exports = { loadApp, extractDeclaration, SCRIPT_FILES, INDEX_HTML, ROOT };
