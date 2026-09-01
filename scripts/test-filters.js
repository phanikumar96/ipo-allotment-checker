/* Reproduces the reported case: 62 PANs, 2 Allotted, 1 B-HNI, and the chips
 * claiming "Allotted 2" + "B-HNI 1" while the table shows no rows.
 * Asserts the chip counts are faceted, i.e. a chip's number always equals the
 * number of rows you get by clicking it.
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
  grab('function facetCount('),
].join('\n');

const api = new Function('records', 'state', `
  var fStatus=state.fStatus, fCategory=state.fCategory, fTerm=state.fTerm;
  ${code}
  return {matches:matches, facetCount:facetCount};
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

// Baseline totals match the screenshot.
const base = api(records, { fStatus: 'all', fCategory: 'all', fTerm: '' });
check('62 rows unfiltered', records.filter(base.matches).length === 62);
check('Allotted = 2', base.facetCount('status', 'alloted') === 2);
check('Not Found = 37', base.facetCount('status', 'notfound') === 37);
check('Retail = 19', base.facetCount('category', 'Retail') === 19);
check('S-HNI = 5', base.facetCount('category', 'SHNI') === 5);
check('B-HNI = 1', base.facetCount('category', 'BHNI') === 1);
check('N/A reachable = 37', base.facetCount('category', 'N/A') === 37);

// The reported combination: with Allotted active, B-HNI must advertise 0.
const allotted = api(records, { fStatus: 'alloted', fCategory: 'all', fTerm: '' });
check('Allotted + B-HNI chip shows 0 (was 1)', allotted.facetCount('category', 'BHNI') === 0);
check('Allotted + Retail chip shows 2', allotted.facetCount('category', 'Retail') === 2);

// With B-HNI active, the Allotted chip must advertise 0.
const bhni = api(records, { fStatus: 'all', fCategory: 'BHNI', fTerm: '' });
check('B-HNI + Allotted chip shows 0 (was 2)', bhni.facetCount('status', 'alloted') === 0);
check('B-HNI + No Allotment chip shows 1', bhni.facetCount('status', 'none') === 1);

// The invariant that was broken: chip number == rows after clicking it.
const statuses = ['all', 'alloted', 'none', 'notfound', 'error'];
const cats = ['all', 'Retail', 'SHNI', 'BHNI', 'N/A'];
let mismatches = [];
statuses.forEach(st => cats.forEach(ct => {
  const view = api(records, { fStatus: st, fCategory: ct, fTerm: '' });
  const rows = records.filter(view.matches).length;
  // count the category chip 'ct' while status 'st' is active, and vice versa
  const fromStatusView = api(records, { fStatus: st, fCategory: 'all', fTerm: '' }).facetCount('category', ct);
  const fromCatView = api(records, { fStatus: 'all', fCategory: ct, fTerm: '' }).facetCount('status', st);
  if (fromStatusView !== rows) mismatches.push({ st, ct, chip: 'category', says: fromStatusView, rows });
  if (fromCatView !== rows) mismatches.push({ st, ct, chip: 'status', says: fromCatView, rows });
}));
check('every chip count equals rows after clicking it (' + statuses.length * cats.length * 2 + ' combos)',
  mismatches.length === 0, mismatches.slice(0, 5));

// Search must combine with both filters.
const searched = api(records, { fStatus: 'none', fCategory: 'SHNI', fTerm: 'pan0' });
check('search narrows within filters',
  records.filter(searched.matches).every(r => r.status === 'none' && r.category === 'SHNI' && /pan0/i.test(r.pan)));

console.log(fail ? '\n' + fail + ' failure(s)' : '\nall checks passed');
process.exit(fail ? 1 : 0);
