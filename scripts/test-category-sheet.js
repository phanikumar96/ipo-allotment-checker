/* Verifies that Sheet 4 ("By Category") formulas actually resolve against the
 * 'All Data' sheet: it extracts the real functions out of index.html, builds
 * both sheets from a synthetic record set, then evaluates every COUNTIF/SUMIF
 * by hand and compares with the in-memory truth. Run: node scripts/test-category-sheet.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('not found: ' + decl);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + decl);
}
function grabVar(decl) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('not found: ' + decl);
  let j = i, depth = 0;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(i, j + 1);
  }
  throw new Error('unbalanced: ' + decl);
}

const parts = [
  grabVar('var CAT_PREFER'), grabVar('var STATUS_TEXT'), grabVar('var CAT_DISPLAY'),
  grab('function displayCat('), grab('function catSortKey('),
  grab('function categoryBreakdown('), grab('function categoryRows('),
  grab('function categorySheetXml('), grab('function dataSheetXml('),
  grab('function exportCols('), grab('function exportMeta('), grabVar('var FIXED_COLS'),
  grab('function sheetXml('), grab('function cellXml('), grab('function ref('),
  grab('function colName('),
  grabVar('var FMT_STYLE'),
];

const harness = `
  var XMLDECL='<?xml?>';
  function xesc(s){ return String(s); }
  function nf(n){ return String(n); }
  function lookup(){ return ''; }
  function S(v,s){ return {v:v,t:'s',s:s}; }
  function N(v,s){ return {v:v,t:'n',s:s}; }
  function F(v,s){ return {v:v,t:'f',s:s}; }
  var extraCols=[], cfg={lot:15};
  var records=RECORDS, basis=BASIS;
  function getClientId(){ return 'CL1'; }
  var $=function(){ return {val:function(){ return 'MUG'; }, attr:function(){}, text:function(){} }; };
  var REGISTRAR_LABEL={FINTECH:'KFINTECH',MUG:'MUFG'};
  function sortedRecords(){ return records.slice(); }
  ${parts.join('\n')}
  return {cat:categorySheetXml(), data:rowsOf(sortedRecords()), cats:categoryRows()};
  function rowsOf(list){
    var cols=exportCols(), m=exportMeta();
    return list.map(function(rec){ return cols.map(function(c){ return c.get(rec,m); }); });
  }
`;

// Mixed set: Retail (15), S-HNI (300), B-HNI (1020), plus quantity-less rows.
const RECORDS = [];
let no = 0;
function rec(applied, allotted, status) {
  RECORDS.push({ id: ++no, no: no, pan: 'PAN' + no, status: status, name: 'N' + no,
    applied: applied, allotted: allotted, category: 'N/A', pemndg: '', lots: 0, apps: 1,
    note: '', item: null, message: '', statusNote: '' });
}
for (let i = 0; i < 8; i++) rec(15, i === 0 ? 15 : 0, i === 0 ? 'alloted' : 'none');
for (let i = 0; i < 4; i++) rec(300, i < 2 ? 15 : 0, i < 2 ? 'alloted' : 'none');
for (let i = 0; i < 3; i++) rec(1020, i === 0 ? 60 : 0, i === 0 ? 'alloted' : 'none');
for (let i = 0; i < 5; i++) rec(0, 0, 'notfound');

// Reproduce categorise()'s applied-share bucketing.
const q = r => (r.applied > 0 ? r.applied : r.allotted);
const vals = RECORDS.map(q).filter(v => v > 0);
const min = Math.min(...vals), max = Math.max(...vals);
RECORDS.forEach(r => {
  const v = q(r);
  r.category = v <= 0 ? 'N/A' : (min === max || v <= min ? 'Retail' : (v >= max ? 'BHNI' : 'SHNI'));
  r.lots = v > 0 ? Math.round(v / 15) : 0;
});
const BASIS = { lot: 15, ok: true, source: 'applied shares', min, max,
  how: 'MUFG: smallest applied quantity (' + min + ') is Retail, largest (' + max + ') is B-HNI.' };

const out = new Function('RECORDS', 'BASIS', harness)(RECORDS, BASIS);

// --- evaluate the sheet-4 formulas against the All Data rows -----------------
const dataRows = out.data;                 // 0-based; sheet row = index + 2
const colE = dataRows.map(r => r[4]);      // Category (display text)
const colD = dataRows.map(r => r[3]);      // Status
const colF = dataRows.map(r => r[5]);      // Applied Shares
const colG = dataRows.map(r => r[6]);      // Allotted Shares

const sheet = out.cat.match(/<f>(.*?)<\/f>/g).map(s => s.replace(/<\/?f>/g, ''));
const labels = out.cats.map(c => c.label);
let fail = 0;
labels.forEach((label, i) => {
  const f = sheet.slice(i * 5, i * 5 + 5);
  const rng = new RegExp("\\$E\\$2:\\$E\\$" + (dataRows.length + 1));
  if (!rng.test(f[0])) { console.log('FAIL range for ' + label + ': ' + f[0]); fail++; }
  const idx = colE.map((v, k) => (v === label ? k : -1)).filter(k => k >= 0);
  const want = {
    pans: idx.length,
    allottedPans: idx.filter(k => colD[k] === 'Allotted').length,
    applied: idx.reduce((s, k) => s + colF[k], 0),
    allotted: idx.reduce((s, k) => s + colG[k], 0),
  };
  const truth = RECORDS.filter(r => displayOf(r.category) === label);
  const got = {
    pans: truth.length,
    allottedPans: truth.filter(r => r.status === 'alloted').length,
    applied: truth.reduce((s, r) => s + r.applied, 0),
    allotted: truth.reduce((s, r) => s + r.allotted, 0),
  };
  const ok = JSON.stringify(want) === JSON.stringify(got) && want.pans > 0;
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label.padEnd(7) +
    ' formulas=' + JSON.stringify(want) + ' records=' + JSON.stringify(got));
});
function displayOf(c) { return { SHNI: 'S-HNI', BHNI: 'B-HNI' }[c] || c; }

const sumPans = labels.reduce((s, l) => s + colE.filter(v => v === l).length, 0);
const okTotal = sumPans === RECORDS.length;
if (!okTotal) fail++;
console.log((okTotal ? 'ok   ' : 'FAIL ') + 'All categories total = ' + sumPans + ' of ' + RECORDS.length + ' PANs');
console.log(fail ? '\n' + fail + ' failure(s)' : '\nall checks passed');
process.exit(fail ? 1 : 0);
