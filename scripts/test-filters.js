/* Filters, against the real functions lifted out of index.html.
 *
 * Reproduces the reported case (62 PANs, 2 Allotted, 1 B-HNI) and pins the two
 * rules the UI now promises:
 *   1. a chip's number equals the number of rows you get by clicking it, and
 *   2. a plain click leaves exactly one filter active - picking a chip in one
 *      row clears the other row, so no stale filter is left behind.
 * Shift/Ctrl-click (additive) and the per-filter ✕ are covered too.
 * Run: node scripts/test-filters.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('not found: ' + decl);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + decl);
}
function grabVar(decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('not found: ' + decl);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(i, j + 1);
  }
  throw new Error('unbalanced: ' + decl);
}

const code = [
  grabVar('var CAT_DISPLAY'), grabVar('var STATUS_TEXT'), grabVar('var CAT_PREFER'),
  grab('function displayCat('), grab('function matchesWith('), grab('function matches('),
  grab('function chipCount('), grab('function setFilter('),
].join('\n');

// setFilter's only side effects are repaints, which are stubbed out; what it
// does to fStatus/fCategory is the behaviour under test.
const api = new Function('records', 'state', `
  var fStatus=state.fStatus, fCategory=state.fCategory, fTerm=state.fTerm;
  function syncChips(){}
  function render(){}
  ${code}
  return {
    matches: matches,
    chipCount: chipCount,
    setFilter: setFilter,
    rows: function(){ var n=0; for(var i=0;i<records.length;i++) if(matches(records[i])) n++; return n; },
    get: function(){ return {fStatus:fStatus, fCategory:fCategory, fTerm:fTerm}; }
  };
`);

// 62 PANs shaped like the screenshot: 37 Not Found (no quantity -> N/A),
// 23 No Allotment, 2 Allotted. Categories come from applied-share size.
const records = [];
let n = 0;
const add = (applied, allotted, status) => records.push({
  no: ++n, pan: 'PAN' + String(n).padStart(3, '0'), status, name: 'Name ' + n,
  applied, allotted, category: 'N/A', message: '', item: null,
});
for (let i = 0; i < 37; i++) add(0, 0, 'notfound');       // -> N/A
add(15, 19, 'alloted');                                    // -> Retail, allotted
add(15, 19, 'alloted');                                    // -> Retail, allotted
for (let i = 0; i < 17; i++) add(15, 0, 'none');           // -> Retail
for (let i = 0; i < 5; i++) add(300, 0, 'none');           // -> S-HNI
add(1020, 0, 'none');                                      // -> B-HNI (not allotted)

const q = r => (r.applied > 0 ? r.applied : r.allotted);
const vals = records.map(q).filter(v => v > 0);
const lo = Math.min(...vals), hi = Math.max(...vals);
records.forEach(r => {
  const v = q(r);
  r.category = v <= 0 ? 'N/A' : (lo === hi || v <= lo ? 'Retail' : (v >= hi ? 'BHNI' : 'SHNI'));
});

let fail = 0;
const check = (name, cond, extra) => {
  if (!cond) { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
  else console.log('ok   ' + name);
};

const STATUSES = ['all', 'alloted', 'none', 'notfound', 'error'];
const CATS = ['all', 'Retail', 'SHNI', 'BHNI', 'N/A'];

/* --- baseline totals match the screenshot ------------------------------- */
const base = api(records, { fStatus: 'all', fCategory: 'all', fTerm: '' });
check('62 rows unfiltered', base.rows() === 62);
check('Allotted = 2', base.chipCount('status', 'alloted') === 2);
check('No Allotment = 23', base.chipCount('status', 'none') === 23);
check('Not Found = 37', base.chipCount('status', 'notfound') === 37);
check('Retail = 19', base.chipCount('category', 'Retail') === 19);
check('S-HNI = 5', base.chipCount('category', 'SHNI') === 5);
check('B-HNI = 1', base.chipCount('category', 'BHNI') === 1);
check('N/A reachable = 37', base.chipCount('category', 'N/A') === 37);

/* --- a plain click leaves exactly one filter ---------------------------- */
let a = api(records, { fStatus: 'alloted', fCategory: 'all', fTerm: '' });
a.setFilter('category', 'BHNI', false);
check('picking a category clears the result filter', a.get().fStatus === 'all' && a.get().fCategory === 'BHNI', a.get());
check('...and the table is not empty', a.rows() === 1, a.rows());

a = api(records, { fStatus: 'all', fCategory: 'BHNI', fTerm: '' });
a.setFilter('status', 'alloted', false);
check('picking a result clears the category filter', a.get().fCategory === 'all' && a.get().fStatus === 'alloted', a.get());
check('...and shows both allotted PANs', a.rows() === 2, a.rows());

a = api(records, { fStatus: 'alloted', fCategory: 'Retail', fTerm: '' });
a.setFilter('status', 'all', false);
check('clicking the active chip again clears everything', a.rows() === 62, a.get());

/* --- shift/ctrl-click still combines ----------------------------------- */
a = api(records, { fStatus: 'alloted', fCategory: 'all', fTerm: '' });
a.setFilter('category', 'Retail', false, true);
check('additive click keeps both filters', a.get().fStatus === 'alloted' && a.get().fCategory === 'Retail', a.get());
check('...and ANDs them', a.rows() === 2, a.rows());

a = api(records, { fStatus: 'alloted', fCategory: 'all', fTerm: '' });
a.setFilter('category', 'BHNI', false, true);
check('additive click can still produce an empty combination', a.rows() === 0, a.rows());

/* --- the ✕ on a pill drops only that filter ---------------------------- */
a = api(records, { fStatus: 'alloted', fCategory: 'BHNI', fTerm: '' });
a.setFilter('category', 'all', false, true);        // what dropFilter('category') does
check('dropping the category keeps the result filter', a.get().fStatus === 'alloted' && a.rows() === 2, a.get());

/* --- the invariant: the number on a chip is what clicking it gives ----- *
 * Mirrors the two chip handlers in index.html: plain click, so the other
 * group resets, and clicking the already-active chip clears it.           */
function plainClick(from, kind, value) {
  const v = api(records, from);
  const cur = kind === 'status' ? from.fStatus : from.fCategory;
  v.setFilter(kind, value === cur ? 'all' : value, false);
  return v.rows();
}
const mismatches = [];
STATUSES.forEach(st => CATS.forEach(ct => {
  const from = { fStatus: st, fCategory: ct, fTerm: '' };
  const view = api(records, from);
  STATUSES.forEach(s => {
    const says = view.chipCount('status', s);
    const got = plainClick(from, 'status', s);
    if (says !== got && s !== st) mismatches.push({ from: [st, ct], chip: 'status:' + s, says, got });
  });
  CATS.forEach(c => {
    const says = view.chipCount('category', c);
    const got = plainClick(from, 'category', c);
    if (says !== got && c !== ct) mismatches.push({ from: [st, ct], chip: 'category:' + c, says, got });
  });
}));
check('every chip count equals the rows a click on it produces (' + STATUSES.length * CATS.length * 10 + ' clicks)',
  mismatches.length === 0, mismatches.slice(0, 5));

/* --- the handlers really do pass the modifier through ------------------ */
check('status chips pass the additive flag', /setFilter\('status',\s*f===fStatus \? 'all' : f,\s*false,\s*addsFilter\(ev\)\)/.test(src));
check('category chips pass the additive flag', /setFilter\('category',\s*c===fCategory \? 'all' : c,\s*false,\s*addsFilter\(ev\)\)/.test(src));
check('shift, ctrl and cmd all combine', /shiftKey\|\|ev\.ctrlKey\|\|ev\.metaKey/.test(src));

/* --- the zero-count class must not be the display:none empty-state one -- */
check('a zero count dims a chip, it does not add class "empty"',
  /toggleClass\('no-hits'/.test(src) && !/toggleClass\('empty'/.test(src));
check('the empty-state rule is scoped so it cannot hide chips',
  /#emptyState\.empty\{[^}]*display:none/.test(src) && !/^\s*\.empty\{/m.test(src));

/* --- search survives a chip click and still narrows ------------------- */
const searched = api(records, { fStatus: 'none', fCategory: 'SHNI', fTerm: 'pan0' });
check('search narrows within filters',
  records.filter(searched.matches).every(r => r.status === 'none' && r.category === 'SHNI' && /pan0/i.test(r.pan)));
const withTerm = api(records, { fStatus: 'all', fCategory: 'all', fTerm: 'pan04' });
check('chip counts respect the search box',
  withTerm.chipCount('status', 'all') === records.filter(r => /pan04/i.test(r.pan)).length);

console.log(fail ? '\n' + fail + ' failure(s)' : '\nall checks passed');
process.exit(fail ? 1 : 0);
