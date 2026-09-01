/* End-to-end: real Chromium, real index.html, real api/pans.js.
 *
 * Proves the three things that were asked for:
 *   1. all PANs load by default on a fresh visit,
 *   2. an added PAN reaches the shared store,
 *   3. a DIFFERENT visitor (cleared localStorage) sees it after a refresh.
 * Then the three UI fixes: an unconfigured store reads as a setup step rather
 * than an error, the IPO dropdown stays inside the window, and picking a filter
 * chip clears the other row instead of leaving it lit.
 * Also asserts the page boots with no console errors, and that the shared list
 * cannot lose a PAN.
 *
 * Needs a Chromium from the playwright cache and a local jquery copy.
 * Run: node scripts/test-e2e-shared-pans.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JQ = path.join(os.tmpdir(), 'jquery.min.js');

function findChrome() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const dir of fs.readdirSync(base)) {
    if (!/^chromium-/.test(dir)) continue;
    const exe = path.join(base, dir, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP: no Chromium in the playwright cache'); process.exit(0); }
if (!fs.existsSync(JQ)) {
  try {
    execSync(`curl -sS --ssl-no-revoke -o "${JQ}" https://code.jquery.com/jquery-3.7.1.min.js`, { stdio: 'ignore' });
  } catch { /* checked below */ }
}
if (!fs.existsSync(JQ) || fs.statSync(JQ).size < 10000) {
  console.log('SKIP: could not obtain jquery locally'); process.exit(0);
}

/* ---- fake Upstash, so api/pans.js runs its real code path ---------------- */
const zset = new Map();
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  // Only the fake Redis is intercepted; CDP calls must reach the real network.
  if (!String(url).includes('fake.upstash.io')) return realFetch(url, opts);
  const cmd = JSON.parse(opts.body);
  const op = String(cmd[0]).toUpperCase();
  if (op === 'ZADD') {
    let i = 2, nx = false, added = 0;
    if (String(cmd[i]).toUpperCase() === 'NX') { nx = true; i++; }
    for (; i < cmd.length; i += 2) {
      const member = cmd[i + 1];
      if (zset.has(member) && nx) continue;
      if (!zset.has(member)) added++;
      zset.set(member, Number(cmd[i]));
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: added }) };
  }
  if (op === 'ZRANGE') {
    const out = [...zset.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: out }) };
  }
  throw new Error('unexpected ' + op);
};
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
const pansHandler = require('../api/pans.js');

/* ---- test server -------------------------------------------------------- */
let pansMode = 'ok';                  // 'ok' | 'down' | 'unconfigured'
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('https://code.jquery.com/jquery-3.7.1.min.js', '/vendor/jquery.js');

// Deliberately long names: this is what used to push the native <select> popup
// off the side of the window.
const IPOS = [
  { id: '11926', name: 'Symbiotec Pharmalab Limited - IPO' },
  { id: '11927', name: 'Augmont Enterprises Limited - IPO' },
  { id: '11928', name: 'Gaja Alternative Asset Management Limited - IPO' },
  { id: '11929', name: 'Lalithaa Jewellery Mart Limited - IPO' },
];

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/vendor/jquery.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(fs.readFileSync(JQ)); return;
  }
  if (url === '/api/pans') {
    if (pansMode === 'down') { res.statusCode = 503; res.end('{"error":"down"}'); return; }
    if (pansMode === 'unconfigured') {
      res.statusCode = 501;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"error":"Shared list not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN"}');
      return;
    }
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { body = {}; } }
      pansHandler({ method: req.method, body, query: {} }, {
        setHeader: (k, v) => res.setHeader(k, v),
        status(c) { res.statusCode = c; return this; },
        json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); },
        end() { res.end(); },
      });
    });
    return;
  }
  if (url === '/api/proxy') {         // the registrar call is not under test
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(/action=ipos/.test(req.url) ? IPOS : [])); return;
  }
  if (url === '/' || url === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html); return;
  }
  res.statusCode = 404; res.end('nope');
});

/* ---- minimal CDP client over the built-in WebSocket --------------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cdp(port) {
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      targets = list.find(t => t.type === 'page') || null;
    } catch { await sleep(250); }
    if (!targets) await sleep(250);
  }
  if (!targets) throw new Error('devtools never came up');
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('ws failed')); });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleErrors.push('UNCAUGHT: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
  };
  const send = (method, params) => new Promise(ok => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  await send('Runtime.enable');
  await send('Page.enable');
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result && r.result.result.value;
  };
  return { send, evaluate, consoleErrors, close: () => ws.close() };
}

let fail = 0;
const check = (name, cond, extra) => {
  if (!cond) { fail++; console.log('FAIL ' + name + (extra !== undefined ? '\n       -> ' + JSON.stringify(extra) : '')); }
  else console.log('ok   ' + name);
};

(async () => {
  const port = 8731;
  await new Promise(ok => server.listen(port, '127.0.0.1', ok));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ipo-e2e-'));
  const dport = 9412;
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--window-size=1280,1000',
    `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let c;
  try {
    c = await cdp(dport);

    // Waits for the shared-list status line to settle.
    const waitSync = async () => {
      for (let i = 0; i < 80; i++) {
        const t = await c.evaluate("document.getElementById('panSyncState').textContent");
        if (t && !/checking|saving/.test(t)) return t;
        await sleep(150);
      }
      return await c.evaluate("document.getElementById('panSyncState').textContent");
    };

    /* --- visitor 1, empty store: the baseline must load and be seeded ----- */
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await sleep(1200);
    let state = await waitSync();
    check('visitor 1 reaches the shared list', /shared with everyone/.test(state), state);
    check('empty store was seeded with all 62 PANs', zset.size === 62, zset.size);

    let hint = await c.evaluate("document.getElementById('panCountHint').textContent");
    check('visitor 1 shows 62 PANs', /^62 PANs/.test(hint), hint);
    check('visitor 1 sees them as shared, none pending', /62 shared/.test(hint) && !/not shared yet/.test(hint), hint);

    const chips = await c.evaluate("document.querySelectorAll('#panChips .chip').length");
    check('62 chips rendered', chips === 62, chips);

    const naChip = await c.evaluate("!!document.querySelector('#categoryChips [data-category=\"N/A\"]')");
    check('N/A category chip exists', naChip === true);

    /* --- visitor 1 adds a PAN -------------------------------------------- */
    await c.evaluate(`(function(){
      var i=document.getElementById('panAdd');
      i.value='ZZTOP1234Z';
      document.getElementById('panAddBtn').click();
    })()`);
    state = await waitSync();
    check('add reports success', /shared with everyone/.test(state), state);
    check('store now holds 63', zset.size === 63, zset.size);
    check('the new PAN is in the store', zset.has('ZZTOP1234Z'), [...zset.keys()].slice(-2));

    /* --- visitor 2: fresh browser state, must see the 63rd PAN ----------- */
    await c.evaluate("localStorage.clear()");
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?v2` });
    await sleep(1200);
    state = await waitSync();
    hint = await c.evaluate("document.getElementById('panCountHint').textContent");
    check('visitor 2 sees 63 PANs after refresh', /^63 PANs/.test(hint), hint);
    check('visitor 2 sees all 63 as shared', /63 shared/.test(hint), hint);
    const hasNew = await c.evaluate("!!document.querySelector('#panChips .chip[data-pan=\"ZZTOP1234Z\"]')");
    check("visitor 2 sees visitor 1's PAN", hasNew === true);

    /* --- the list can never shrink --------------------------------------- */
    const before = zset.size;
    await c.evaluate(`(function(){
      var x=document.querySelector('#panChips .chip .x');
      if(x) x.click();
    })()`);
    await sleep(600);
    check('removing a chip does not shrink the shared list', zset.size === before, { before, after: zset.size });

    /* --- the IPO dropdown must stay inside the window -------------------- */
    await c.evaluate(`(function(){
      document.querySelector('input[name=clientType][value=MUG]').click();
    })()`);
    for (let i = 0; i < 40; i++) {
      const n = await c.evaluate("document.querySelectorAll('#mugIpoSelect option').length");
      if (n > 1) break;
      await sleep(150);
    }
    const optCount = await c.evaluate("document.querySelectorAll('#mugIpoSelect option').length");
    check('IPO list loaded into the select', optCount === IPOS.length + 1, optCount);
    check('the native select is hidden behind the custom field',
      await c.evaluate("document.getElementById('mugIpoSelect').classList.contains('combo-native')") === true);
    check('the IPO label points at the visible control',
      await c.evaluate("document.querySelector('label[for=\"mugIpoSelectBtn\"]')!==null") === true);

    await c.evaluate(`(function(){
      var b=document.getElementById('mugIpoSelectBtn');
      b.scrollIntoView({block:'center'});
      b.click();
    })()`);
    await sleep(250);
    const box = await c.evaluate(`(function(){
      var b=document.getElementById('mugIpoSelectBtn').getBoundingClientRect();
      var p=document.querySelector('.combo-pop').getBoundingClientRect();
      var over=0, opts=document.querySelectorAll('.combo-opt');
      for(var i=0;i<opts.length;i++) if(opts[i].scrollWidth-opts[i].clientWidth>1) over++;
      return {open:getComputedStyle(document.querySelector('.combo-pop')).display,
              left:p.left, right:p.right, bottom:p.bottom, top:p.top,
              vw:window.innerWidth, vh:window.innerHeight,
              btnW:b.width, popW:p.width, opts:opts.length, overflowing:over};
    })()`);
    check('the dropdown opened', box.open !== 'none', box);
    check('it does not run past the right edge of the window', box.right <= box.vw + 0.5, box);
    check('it does not run past the left edge either', box.left >= -0.5, box);
    check('it stays inside the window vertically', box.top >= -0.5 && box.bottom <= box.vh + 0.5, box);
    check('it is exactly as wide as the field', Math.abs(box.popW - box.btnW) < 1.5, box);
    check('every IPO name fits (they wrap, they do not overflow)', box.overflowing === 0, box);
    check('all IPOs are listed', box.opts === IPOS.length + 1, box);

    // Typing filters the list; picking one drives the real <select> and the
    // client-ID plumbing hanging off its change event.
    await c.evaluate(`(function(){
      var i=document.querySelector('.combo-search input');
      i.value='Gaja'; i.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await sleep(150);
    const filtered = await c.evaluate("document.querySelectorAll('.combo-opt').length");
    check('typing filters the list', filtered === 1, filtered);
    await c.evaluate("document.querySelector('.combo-opt').click()");
    await sleep(200);
    const picked = await c.evaluate(`(function(){
      return {value:document.getElementById('mugIpoSelect').value,
              label:document.querySelector('#mugIpoSelectBtn .val').textContent,
              clientId:document.getElementById('clientId').value,
              stillOpen:getComputedStyle(document.querySelector('.combo-pop')).display!=='none'};
    })()`);
    check('picking an option sets the real select value', picked.value === '11928', picked);
    check('...updates the field label', /Gaja/.test(picked.label), picked);
    check('...fires change so the client ID follows', picked.clientId === '11928', picked);
    check('...and closes the panel', picked.stillOpen === false, picked);

    /* --- the chips must be on screen at all ------------------------------ *
     * Before any check has run every count is 0. The zero-count class used to
     * be called "empty", which collided with the global display:none
     * empty-state class and hid all ten chips - the filter rows were simply
     * not there until results existed.                                      */
    const chipRows = await c.evaluate(`(function(){
      function row(id){
        var host=document.getElementById(id), out=[], hidden=0;
        host.querySelectorAll('.filter-btn').forEach(function(b){
          var r=b.getBoundingClientRect();
          out.push(Math.round(r.width));
          if(r.width<20 || r.height<20 || getComputedStyle(b).display==='none') hidden++;
        });
        return {rowW:Math.round(host.getBoundingClientRect().width), widths:out, hidden:hidden,
                label:(host.querySelector('.cg-label')||{}).textContent};
      }
      return {status:row('statusChips'), category:row('categoryChips'),
              total:document.querySelectorAll('#statusChips .filter-btn,#categoryChips .filter-btn').length};
    })()`);
    check('all ten filter chips exist', chipRows.total === 10, chipRows);
    check('no chip is hidden when its count is 0',
      chipRows.status.hidden === 0 && chipRows.category.hidden === 0, chipRows);
    check('both chip rows have real width',
      chipRows.status.rowW > 200 && chipRows.category.rowW > 200, chipRows);
    check('each row says which question it answers',
      /Result/i.test(chipRows.status.label) && /Category/i.test(chipRows.category.label), chipRows);

    /* --- one chip click, one filter -------------------------------------- */
    const chipState = await c.evaluate(`(function(){
      document.querySelector('#statusChips [data-filter="alloted"]').click();
      document.querySelector('#categoryChips [data-category="Retail"]').click();
      return {status:document.querySelector('#statusChips .filter-btn.active').getAttribute('data-filter'),
              category:document.querySelector('#categoryChips .filter-btn.active').getAttribute('data-category'),
              lit:document.querySelectorAll('#statusChips .filter-btn.active, #categoryChips .filter-btn.active').length};
    })()`);
    check('picking a category resets the result row', chipState.status === 'all', chipState);
    check('...and the category is the one that was clicked', chipState.category === 'Retail', chipState);
    check('...with exactly one chip lit per row', chipState.lit === 2, chipState);

    /* --- unconfigured store: a setup step, not an error ------------------ */
    await c.evaluate("localStorage.clear()");
    pansMode = 'unconfigured';
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?setup` });
    await sleep(1500);
    state = await waitSync();
    hint = await c.evaluate("document.getElementById('panCountHint').textContent");
    const badge = await c.evaluate(`(function(){
      var b=document.getElementById('panSyncState');
      return {cls:b.className, setupShown:!document.getElementById('shareSetup').classList.contains('hidden'),
              hasLink:!!document.getElementById('shareSetupLink'),
              saveBadge:!document.getElementById('panSaveState').classList.contains('hidden')};
    })()`);
    check('unconfigured says sharing is off, not that something failed', /sharing off/.test(state), state);
    check('...styled as information, not as an error', /info/.test(badge.cls) && !/err/.test(badge.cls), badge);
    check('...with the setup steps on screen', badge.setupShown === true && badge.hasLink === true, badge);
    check('...and no redundant "saved on this device" pill', badge.saveBadge === false, badge);
    check('...still showing the baseline 62 PANs', /^62 PANs/.test(hint), hint);
    check('...and not claiming they are shared', !/shared/.test(hint), hint);

    /* --- unreachable: that IS an error ---------------------------------- */
    await c.evaluate("localStorage.clear()");
    pansMode = 'down';
    await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/?offline` });
    await sleep(1500);
    state = await waitSync();
    hint = await c.evaluate("document.getElementById('panCountHint').textContent");
    const downCls = await c.evaluate("document.getElementById('panSyncState').className");
    check('offline says so instead of pretending', /this device only/.test(state), state);
    check('...and is flagged as an error', /err/.test(downCls), downCls);
    check('offline still shows the baseline 62 PANs', /^62 PANs/.test(hint), hint);

    const errs = c.consoleErrors.filter(e => !/Failed to load resource|501|503|404/i.test(e));
    check('no unexpected console errors', errs.length === 0, errs);
  } catch (e) {
    fail++;
    console.log('FAIL harness: ' + (e && e.stack || e));
  } finally {
    if (c) c.close();
    chrome.kill();
    server.close();
  }
  console.log(fail ? '\n' + fail + ' failure(s)' : '\nall checks passed');
  process.exit(fail ? 1 : 0);
})();
