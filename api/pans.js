/* Shared PAN list — the one list every visitor of the site sees.
 *
 * APPEND-ONLY BY DESIGN. There is no delete path: no DELETE handler, and the
 * only write is ZADD. A PAN that lands here is never removed by the API, so a
 * stray request cannot wipe the group's list. Users who want a PAN out of their
 * own view hide it locally in the browser (see index.html hiddenPans).
 *
 * Storage is a Redis sorted set. The score is the insert timestamp, so:
 *   - ZADD ... NX  keeps the ORIGINAL score of a PAN already present, which
 *     makes re-adding a no-op and dedupes without a read-modify-write race;
 *   - ZRANGE returns the list in the order PANs were first added.
 * Concurrent adds from several people are therefore safe.
 *
 * Env (either naming works — Upstash native, or the pair Vercel KV injects):
 *   UPSTASH_REDIS_REST_URL   / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL          / KV_REST_API_TOKEN
 */

const KEY = 'ipo:pans:v1';
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MAX_PER_REQUEST = 500;   // one paste of PANs; keeps a bad body bounded
const MAX_TOTAL = 20000;       // hard ceiling on the shared list

function creds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  return { url: url.replace(/\/+$/, ''), token };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

// Upstash REST takes a command as a JSON array of arguments.
async function redis(cmd) {
  const { url, token } = creds();
  if (!url || !token) {
    const err = new Error('Shared list not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
    err.code = 'NOSTORE';
    throw err;
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text }; }
  if (!r.ok || body.error) throw new Error(body.error || `Redis HTTP ${r.status}`);
  return body.result;
}

function normalise(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input || '');
  const out = [];
  const seen = new Set();
  for (const piece of raw.split(/[^A-Za-z0-9]+/)) {
    const pan = piece.trim().toUpperCase();
    if (!pan || seen.has(pan)) continue;
    if (!PAN_RE.test(pan)) continue;          // silently drop typos; never stored
    seen.add(pan);
    out.push(pan);
    if (out.length >= MAX_PER_REQUEST) break;
  }
  return out;
}

async function readList() {
  const list = await redis(['ZRANGE', KEY, '0', '-1']);
  return Array.isArray(list) ? list : [];
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      const pans = await readList();
      res.status(200).json({ pans, count: pans.length });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};

      const incoming = normalise(body.pans !== undefined ? body.pans : body.pan);
      if (!incoming.length) {
        const pans = await readList();
        res.status(400).json({ error: 'No valid PAN in request', pans, count: pans.length });
        return;
      }

      const existing = await readList();
      if (existing.length + incoming.length > MAX_TOTAL) {
        res.status(413).json({ error: `Shared list is capped at ${MAX_TOTAL} PANs`, pans: existing, count: existing.length });
        return;
      }

      // NX so a PAN already in the list keeps its original position.
      const now = Date.now();
      const args = ['ZADD', KEY, 'NX'];
      incoming.forEach((pan, i) => { args.push(String(now + i * 0.001), pan); });
      const added = await redis(args);

      const pans = await readList();
      res.status(200).json({ pans, count: pans.length, added: Number(added) || 0 });
      return;
    }

    // Append-only: removal is deliberately not offered.
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.status(405).json({ error: 'The shared PAN list is append-only; PANs cannot be removed via the API.' });
  } catch (error) {
    const code = error.code === 'NOSTORE' ? 501 : 502;
    res.status(code).json({ error: String(error.message || error) });
  }
};
