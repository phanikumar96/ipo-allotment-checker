/* Tests api/pans.js against an in-memory stand-in for Upstash REST.
 * Focus: the list is append-only, dedupes, and keeps insertion order.
 * Run: node scripts/test-pans-api.js */
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const zset = new Map();   // member -> score

// Minimal Upstash REST emulator: ZADD [NX] and ZRANGE only.
global.fetch = async (url, opts) => {
  const cmd = JSON.parse(opts.body);
  const op = String(cmd[0]).toUpperCase();
  if (op === 'ZADD') {
    let i = 2, nx = false;
    if (String(cmd[i]).toUpperCase() === 'NX') { nx = true; i++; }
    let added = 0;
    for (; i < cmd.length; i += 2) {
      const score = Number(cmd[i]), member = cmd[i + 1];
      if (zset.has(member) && nx) continue;      // NX: keep original score
      if (!zset.has(member)) added++;
      zset.set(member, score);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: added }) };
  }
  if (op === 'ZRANGE') {
    const ordered = [...zset.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(e => e[0]);
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: ordered }) };
  }
  throw new Error('unexpected command ' + op);
};

const handler = require('../api/pans.js');

function call(method, body) {
  return new Promise(resolve => {
    const res = {
      _status: 200, _json: null, _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      status(c) { this._status = c; return this; },
      json(o) { this._json = o; resolve({ status: this._status, body: o, headers: this._headers }); },
      end() { resolve({ status: this._status, body: null, headers: this._headers }); },
    };
    handler({ method, body, query: {} }, res);
  });
}

let fail = 0;
function check(name, cond, extra) {
  if (!cond) { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
  else console.log('ok   ' + name);
}

(async () => {
  let r = await call('GET');
  check('empty store returns []', r.status === 200 && r.body.pans.length === 0, r.body);

  r = await call('POST', { pans: ['ABCDE1234F', 'BCDEF2345G'] });
  check('POST adds two', r.status === 200 && r.body.added === 2 && r.body.count === 2, r.body);

  // Re-adding must not duplicate and must not reorder.
  r = await call('POST', { pans: ['ABCDE1234F', 'CDEFG3456H'] });
  check('re-add dedupes (1 new)', r.body.added === 1 && r.body.count === 3, r.body);
  check('insertion order kept',
    JSON.stringify(r.body.pans) === JSON.stringify(['ABCDE1234F', 'BCDEF2345G', 'CDEFG3456H']), r.body.pans);

  // A comma/space blob is what the paste box sends.
  r = await call('POST', { pans: 'DEFGH4567J, EFGHI5678K\nFGHIJ6789L' });
  check('accepts pasted blob', r.body.added === 3 && r.body.count === 6, r.body);

  // Typos must never enter the store, since nothing can be removed later.
  r = await call('POST', { pans: ['NOTAPAN', '12345', 'GHIJK7890M'] });
  check('drops invalid, keeps valid', r.body.added === 1 && r.body.count === 7, r.body);
  check('no junk stored', r.body.pans.every(p => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p)), r.body.pans);

  r = await call('POST', { pans: ['NOTAPAN'] });
  check('all-invalid POST is 400', r.status === 400, r.body);

  const before = (await call('GET')).body.count;
  r = await call('DELETE', { pans: ['ABCDE1234F'] });
  check('DELETE rejected with 405', r.status === 405, r.body);
  const after = (await call('GET')).body.count;
  check('DELETE changed nothing', before === after, { before, after });

  r = await call('PUT', {});
  check('PUT rejected too', r.status === 405, r.body);

  // Missing config must be reported, not silently swallowed.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  r = await call('GET');
  check('unconfigured store returns 501', r.status === 501 && /UPSTASH/.test(r.body.error), r.body);

  console.log(fail ? '\n' + fail + ' failure(s)' : '\nall checks passed');
  process.exit(fail ? 1 : 0);
})();
